import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { getMyProfile } from '../api/profile.js';
import { getBoostMissions, getBoostBalance, getBoostRanking, getArticleBoostStatuses,
    boostArticle, receiveBoostMissionReward } from '../api/boost.js';
import { delay } from '../utils/time.js';
import { pruneOldRecords } from '../utils/storageCleanup.js';
import { log } from '../ui/logger.js';
import { updateStatusUI } from '../ui/status.js';

const KST_OFFSET = 9 * 60 * 60 * 1000;
const BOOST_ACTION = 'ARTICLE_BOOST_ADD';
const day = timestamp => new Date(timestamp + KST_OFFSET).toISOString().slice(0, 10);

export function normalizeBoostMission(missions, now = Date.now()) {
    const candidates = missions.filter(mission => Array.isArray(mission?.details) &&
        mission.details.some(detail => detail.action_type === BOOST_ACTION) &&
        Number.isFinite(mission.start_dt) && Number.isFinite(mission.end_dt) &&
        mission.start_dt <= now && now < mission.end_dt);
    candidates.sort((a, b) => (b.created_at ?? b.start_dt) - (a.created_at ?? a.start_dt));
    const mission = candidates[0];
    if (!mission) return null;
    if (!/^\d+$/.test(String(mission.mission_id ?? '')) ||
        typeof mission.is_rewarded !== 'boolean' || typeof mission.is_completed !== 'boolean' ||
        mission.details.some(detail => !Number.isInteger(detail.current_count) || detail.current_count < 0 ||
            !Number.isInteger(detail.required_count) || detail.required_count < 1) ||
        !Array.isArray(mission.rewards) || mission.rewards.some(reward => !Number.isFinite(reward.amount) || reward.amount < 0)) {
        throw new Error('부스트 미션 진행도 응답이 올바르지 않습니다');
    }
    const boost = mission.details.find(detail => detail.action_type === BOOST_ACTION);
    return {
        id: String(mission.mission_id), title: mission.title,
        rewarded: mission.is_rewarded, completed: mission.is_completed,
        allCompleted: mission.details.every(detail => detail.current_count >= detail.required_count),
        current: boost.current_count, required: boost.required_count,
        details: mission.details,
        rewardAmount: mission.rewards.filter(reward => reward.type === 'FLAKE').reduce((sum, reward) => sum + reward.amount, 0)
    };
}

export function getEligibleBoostCandidates(articles, userId, now = Date.now()) {
    return articles.filter(article => /^\d+$/.test(String(article?.article_id ?? '')) &&
        Number.isFinite(article.score) && article.score >= 0 &&
        Number.isFinite(article.datetime) && article.datetime <= now && day(article.datetime) === day(now) &&
        article.today_contest_agree === true && article.source === 'postoffice' &&
        article.status === 'PUBLISHED' && article.coverage === 'PUBLIC' &&
        /^\d+$/.test(String(article.profile?.id ?? '')) && String(article.profile.id) !== String(userId) &&
        !['OFFICIAL', 'BOT'].includes(article.profile?.badge))
        .sort((a, b) => b.score - a.score || String(a.article_id).localeCompare(String(b.article_id)));
}

// Popular-post candidates seen today, shared by every account in this Chrome profile so the next
// account needs one ranking query instead of rankingQueries. localStorage, not sessionStorage:
// SGManager closes Chrome between accounts, which would drop a session store.
export const BOOST_RANKING_CACHE_KEY = 'stove-boost-ranking-v1';

function slimCandidate(article, seenAt) {
    return {
        article_id: article.article_id, title: article.title, score: article.score, datetime: article.datetime,
        today_contest_agree: article.today_contest_agree, source: article.source, status: article.status,
        coverage: article.coverage, profile: { id: article.profile?.id, badge: article.profile?.badge }, seenAt
    };
}

// Cached candidates from today that are not older than rankingCacheMaxAge. The cache is only a hint:
// anything unreadable is treated as empty. Every read also prunes it, so a cache from another day,
// expired entries or a broken record never stay behind in localStorage.
export function readRankingCache(storage, now) {
    try {
        const text = storage?.getItem(BOOST_RANKING_CACHE_KEY);
        if (!text) return [];
        let record = null;
        try { record = JSON.parse(text); } catch { /* removed below */ }
        const fresh = record?.date === day(now) && Array.isArray(record.articles)
            ? record.articles.filter(article => Number.isFinite(article?.seenAt) && article.seenAt <= now + 60000 &&
                now - article.seenAt <= CONFIG.boostMission.rankingCacheMaxAge)
            : [];
        if (fresh.length === 0) storage.removeItem(BOOST_RANKING_CACHE_KEY);
        else if (fresh.length < record.articles.length) {
            storage.setItem(BOOST_RANKING_CACHE_KEY, JSON.stringify({ ...record, articles: fresh }));
        }
        return fresh;
    } catch {
        return [];
    }
}

// One entry per post; the most recent observation wins, since a post's temperature changes over time.
export function mergeRankingCandidates(articles) {
    const byId = new Map();
    for (const article of articles) {
        const id = String(article?.article_id ?? '');
        const known = byId.get(id);
        if (!known || article.seenAt >= known.seenAt) byId.set(id, article);
    }
    return [...byId.values()];
}

function saveRankingCache(storage, now, articles) {
    // Own-post filtering is per account, so it happens when the cache is read, not here.
    const kept = getEligibleBoostCandidates(articles, '', now).slice(0, CONFIG.boostMission.rankingCacheSize);
    try {
        storage.setItem(BOOST_RANKING_CACHE_KEY, JSON.stringify({ date: day(now), articles: kept }));
    } catch { /* Losing the hint only costs the next account its extra queries. */ }
}

export function boostRecordKey(userId, missionId) {
    return `stove-boost-v1:${userId}:${missionId}`;
}

// 오늘(KST) 이 계정이 자동화로 한 부스트들. 미션이 없거나 이미 끝나도 하루 dailyBoosts회까지
// 실시간 인기글에 부스트한다: { date, boosts: [{ status, articleId, title, score, attemptedAt, generatedAt }] }
export function boostDailyKey(userId) {
    return `stove-boost-daily-v1:${userId}`;
}

function readRecord(storage, key) {
    if (!storage) throw new Error('부스트 실행 기록을 저장할 수 없습니다');
    const text = storage.getItem(key);
    if (!text) return {};
    const record = JSON.parse(text);
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        (record.boost && (!/^\d+$/.test(record.boost.articleId) ||
            !['pending', 'confirmed'].includes(record.boost.status))) ||
        (record.reward && !['pending', 'confirmed'].includes(record.reward.status))) {
        throw new Error('부스트 실행 기록을 확인할 수 없습니다');
    }
    return record;
}

export function dailyBoostLimit() {
    return Math.max(0, Math.floor(Number(CONFIG.boostMission.dailyBoosts)) || 0);
}

function isValidAttempt(attempt) {
    return Boolean(attempt) && typeof attempt === 'object' && /^\d+$/.test(String(attempt.articleId ?? '')) &&
        ['pending', 'confirmed'].includes(attempt.status);
}

function readDailyRecord(storage, key, today) {
    if (!storage) throw new Error('부스트 실행 기록을 저장할 수 없습니다');
    const text = storage.getItem(key);
    if (!text) return null;
    let record = JSON.parse(text);
    // The first daily version kept a single attempt at the top level.
    if (record && typeof record === 'object' && !Array.isArray(record.boosts) && 'articleId' in record) {
        const { date, ...attempt } = record;
        record = { date, boosts: [attempt] };
    }
    if (!record || typeof record !== 'object' || typeof record.date !== 'string' ||
        !Array.isArray(record.boosts) || !record.boosts.every(isValidAttempt)) {
        throw new Error('부스트 실행 기록을 확인할 수 없습니다');
    }
    return record.date === today ? record : null;
}

function services(deps) {
    return {
        getBoostMissions, getBoostBalance, getBoostRanking, getArticleBoostStatuses,
        boostArticle, receiveBoostMissionReward, getMyProfile, delay, log,
        now: () => Date.now(), storage: globalThis.localStorage,
        publish: status => { if (typeof document !== 'undefined') updateStatusUI({ boost: status }); },
        withLock: async (key, work) => {
            if (!globalThis.navigator?.locks?.request) {
                throw new Error('부스트 중복 실행 잠금을 사용할 수 없습니다');
            }
            return globalThis.navigator.locks.request(key, { ifAvailable: true }, lock =>
                lock ? work() : { success: false, reason: 'alreadyRunning' });
        },
        ...deps
    };
}

export async function checkBoostStatus(headers, deps = {}) {
    const io = services(deps);
    try {
        const [missions, balance, profile] = await Promise.all([
            io.getBoostMissions(headers), io.getBoostBalance(headers), io.getMyProfile(headers)
        ]);
        const userId = profile?.value?.user_id;
        if (profile?.code !== 0 || !/^\d+$/.test(String(userId ?? ''))) throw new Error('부스트 계정을 확인할 수 없습니다');
        const dailyKey = boostDailyKey(userId);
        const dailyBoosts = readDailyRecord(io.storage, dailyKey, day(io.now()))?.boosts || [];
        // Every run reads this status (snapshot, dashboard) even when no boost is scheduled: prune here.
        readRankingCache(io.storage, io.now());
        const dailyPending = dailyBoosts.some(attempt => attempt.status === 'pending');
        // The dashboard shows today's first (hottest) boosted post, plus how many more.
        const firstDaily = dailyBoosts[0] || null;
        const mission = normalizeBoostMission(missions, io.now());
        // Records of other (ended) missions, for any account in this profile, go after storageRetentionDays.
        pruneOldRecords(io.storage, 'stove-boost-v1:', { now: io.now(),
            timestamps: record => [record.boost?.attemptedAt, record.reward?.attemptedAt],
            keep: key => Boolean(mission) && key.endsWith(`:${mission.id}`) });
        if (!mission) {
            return { success: true, notAvailable: true, userId: String(userId), ...balance, dailyKey, dailyBoosts,
                verificationPending: dailyPending, selectedArticle: firstDaily };
        }
        const key = boostRecordKey(userId, mission.id);
        const record = readRecord(io.storage, key);
        const missionBoostToday = record.boost && Number.isFinite(record.boost.attemptedAt) &&
            day(record.boost.attemptedAt) === day(io.now()) ? record.boost : null;
        return {
            success: true, userId: String(userId), mission, ...balance, key, record, dailyKey, dailyBoosts,
            verificationPending: Boolean((record.boost && mission.current < mission.required) ||
                (record.reward && !mission.rewarded) || dailyPending),
            selectedArticle: firstDaily || missionBoostToday
        };
    } catch (error) {
        return { success: false, unknown: true, error: error.message };
    }
}

function requireStatus(status) {
    if (!status.success) throw new Error(status.error || '부스트 상태 확인 실패');
    return status;
}

function save(io, context, record) {
    io.storage.setItem(context.key, JSON.stringify(record));
}

function saveDaily(io, context, record) {
    io.storage.setItem(context.dailyKey, JSON.stringify(record));
}

// The reward claim needs an active mission; the daily boost does not. Either way the work runs
// under one lock per account (and mission), and the account must not change while it waits.
async function locked(headers, deps, work, { requireMission = true } = {}) {
    const io = services(deps);
    if (!CONFIG.boostMission.enabled) return { success: true, skipped: true, reason: 'disabled' };
    try {
        const initial = requireStatus(await checkBoostStatus(headers, io));
        io.publish(initial);
        if (initial.notAvailable && requireMission) return { success: true, skipped: true, reason: 'noMission' };
        return await io.withLock(initial.key || initial.dailyKey, async () => {
            const context = requireStatus(await checkBoostStatus(headers, io));
            if (context.userId !== initial.userId || context.key !== initial.key ||
                (context.notAvailable && requireMission)) throw new Error('부스트 계정 또는 미션이 변경되었습니다');
            io.publish(context);
            return work(context, io);
        });
    } catch (error) {
        io.log(`부스트 처리 중단: ${error.message}`, 'warning');
        io.publish({ success: false, unknown: true, error: error.message });
        return { success: false, reason: 'statusUnknown', error: error.message };
    }
}

/**
 * Confirms one boost. The article's own BOOST flag is the proof; the mission's progress counts only
 * when this attempt was the boost the 0/1 mission needed (an already finished mission proves
 * nothing about today's boost).
 */
async function verifyBoost(headers, context, io, articleId, missionCounts) {
    let latest = context;
    for (let i = 0; i < CONFIG.boostMission.verifyAttempts; i++) {
        if (i > 0) await io.delay(CONFIG.boostMission.verifyDelay);
        latest = await checkBoostStatus(headers, io);
        if (latest.success && (latest.userId !== context.userId ||
            (missionCounts && (latest.notAvailable || latest.key !== context.key)))) {
            return { confirmed: false, status: { success: false, unknown: true, error: '부스트 계정 또는 미션이 변경되었습니다' } };
        }
        if (missionCounts && latest.success && latest.mission.current >= latest.mission.required) {
            return { confirmed: true, status: latest };
        }
        try {
            const interactions = await io.getArticleBoostStatuses(headers, [articleId]);
            if (interactions[articleId]?.BOOST === true) return { confirmed: true, status: latest };
        } catch { /* A failed read never authorizes another boost. */ }
    }
    return { confirmed: false, status: latest };
}

async function verifyReward(headers, context, io) {
    let latest = context;
    for (let i = 0; i < CONFIG.boostMission.verifyAttempts; i++) {
        if (i > 0) await io.delay(CONFIG.boostMission.verifyDelay);
        latest = await checkBoostStatus(headers, io);
        if (latest.success && !latest.notAvailable && latest.key === context.key) {
            if (latest.mission.rewarded) return { confirmed: true, status: latest };
        } else if (latest.success) {
            return { confirmed: false, status: { success: false, unknown: true, error: '부스트 계정 또는 미션이 변경되었습니다' } };
        }
    }
    return { confirmed: false, status: latest };
}

function saveDailyBoosts(io, context, boosts) {
    if (boosts.length === 0) io.storage.removeItem(context.dailyKey);
    else saveDaily(io, context, { date: day(io.now()), boosts });
}

function confirmAttempt(io, context, boosts, record, articleId) {
    const attempt = boosts.find(item => item.articleId === articleId);
    if (attempt) {
        attempt.status = 'confirmed';
        saveDailyBoosts(io, context, boosts);
    }
    if (record?.boost?.articleId === articleId) {
        record.boost.status = 'confirmed';
        save(io, context, record);
    }
}

// Unconfirmed attempts are only ever re-checked, never repeated. Returns whether any were open and
// whether every one of them is confirmed now.
async function reviewPendingBoosts(headers, context, io, boosts, record) {
    const missionWaiting = Boolean(context.mission && record.boost && context.mission.current < context.mission.required);
    const attempts = boosts.filter(attempt => attempt.status === 'pending');
    if (missionWaiting && !attempts.some(attempt => attempt.articleId === record.boost.articleId)) attempts.push(record.boost);
    if (attempts.length === 0) return { hadPending: false, allConfirmed: true };
    let allConfirmed = true;
    let latest = context;
    for (const attempt of attempts) {
        const missionCounts = missionWaiting && record.boost.articleId === attempt.articleId;
        const result = await verifyBoost(headers, context, io, attempt.articleId, missionCounts);
        latest = result.status;
        if (result.confirmed) confirmAttempt(io, context, boosts, record, attempt.articleId);
        else allConfirmed = false;
    }
    io.publish(latest);
    io.log(allConfirmed ? '기존 부스트 실행을 확인했습니다' : '이전 부스트의 반영 확인 대기 중입니다. 추가 부스트는 하지 않습니다',
        allConfirmed ? 'success' : 'warning');
    return { hadPending: true, allConfirmed };
}

export async function executeBoostMission(headers, deps = {}) {
    return locked(headers, deps, async (initialContext, io) => {
        // Read (and prune) the shared candidate cache on every run, also when this run boosts nothing.
        const cached = readRankingCache(io.storage, io.now());
        let context = initialContext;
        let record = context.record || {};
        let boosts = context.dailyBoosts.map(attempt => ({ ...attempt }));
        const reviewed = await reviewPendingBoosts(headers, context, io, boosts, record);
        if (reviewed.hadPending) {
            if (!reviewed.allConfirmed) return { success: false, skipped: true, reason: 'previousAttempt' };
            // Everything open is confirmed: continue from the server's current state.
            context = requireStatus(await checkBoostStatus(headers, io));
            if (context.userId !== initialContext.userId || context.key !== initialContext.key) {
                throw new Error('부스트 계정 또는 미션이 변경되었습니다');
            }
            record = context.record || {};
            boosts = context.dailyBoosts.map(attempt => ({ ...attempt }));
        }
        const { mission } = context;
        const limit = dailyBoostLimit();
        const missionNeedsBoost = Boolean(mission && !mission.rewarded && !mission.completed &&
            mission.current === 0 && mission.required === 1 && !record.boost);
        const wanted = Math.max(limit - boosts.length, missionNeedsBoost ? 1 : 0);
        if (wanted < 1) {
            if (reviewed.hadPending) return { success: true, skipped: true, reason: 'previousAttempt' };
            if (boosts.length > 0) return { success: true, skipped: true, reason: 'alreadyBoostedToday' };
            if (!mission || mission.rewarded || mission.completed || mission.current >= mission.required) {
                return { success: true, skipped: true, reason: 'alreadyCompleted' };
            }
            io.log('부스트 0/1 및 잔여 횟수 조건을 충족하지 않아 건너뜁니다', 'info');
            return { success: true, skipped: true, reason: 'notActionable' };
        }
        if (context.remainingCount < 1) {
            io.log('부스트 잔여 횟수가 없어 건너뜁니다', 'info');
            return { success: true, skipped: true, reason: 'notActionable' };
        }
        const count = Math.min(wanted, context.remainingCount);
        if (limit > 0) io.log(`오늘의 인기글 부스트: 오늘 ${boosts.length}/${limit}회, 이번에 최대 ${count}회`, 'info');
        // Every query's posts are merged with today's cached ones; the hottest eligible posts win.
        const queries = cached.length > 0 ? 1 : CONFIG.boostMission.rankingQueries;
        if (cached.length > 0) io.log(`저장된 인기글 후보 ${cached.length}개와 합쳐 실시간 후보는 1번만 조회합니다`, 'info');
        const seen = [...cached];
        let ranking;
        for (let i = 0; i < queries; i++) {
            if (i > 0) await io.delay(CONFIG.boostMission.queryDelay);
            const next = await io.getBoostRanking(headers);
            const age = io.now() - next.generatedAt;
            if (age > CONFIG.boostMission.maxRankingAge || age < -60000 ||
                (ranking && next.generatedAt < ranking.generatedAt)) throw new Error('실시간 후보 집계가 오래되었거나 역전되었습니다');
            const repeated = ranking?.generatedAt === next.generatedAt;
            ranking = next;
            seen.push(...next.articles.map(article => slimCandidate(article, next.generatedAt)));
            io.log(`실시간 후보 조회 ${i + 1}/${queries}${repeated ? ' (같은 집계 시각)' : ''}`, 'info');
        }
        const merged = mergeRankingCandidates(seen);
        saveRankingCache(io.storage, io.now(), merged);
        const candidates = getEligibleBoostCandidates(merged, context.userId, io.now())
            .slice(0, CONFIG.boostMission.rankingCacheSize);
        if (candidates.length === 0) {
            io.log('조회한 후보 중 부스트 가능한 글이 없습니다', 'warning');
            return { success: true, skipped: true, reason: 'noCandidates' };
        }
        const interactions = await io.getArticleBoostStatuses(headers, candidates.map(article => article.article_id));
        const targets = candidates
            .filter(article => interactions[article.article_id]?.BOOST === false &&
                !boosts.some(attempt => attempt.articleId === String(article.article_id)))
            .slice(0, count);
        if (targets.length === 0) return { success: true, skipped: true, reason: 'alreadyBoosted' };

        const boostedIds = [];
        let expectedRemaining = context.remainingCount;
        let allConfirmed = true;
        let stopReason = null;
        for (const [index, selected] of targets.entries()) {
            if (index > 0) await io.delay(CONFIG.boostMission.boostDelay);
            const forMission = missionNeedsBoost && index === 0;
            // Re-read right before every write: another tab, the site or a manual boost may have acted meanwhile.
            const fresh = requireStatus(await checkBoostStatus(headers, io));
            if (fresh.userId !== context.userId || fresh.key !== context.key) throw new Error('부스트 계정 또는 미션이 변경되었습니다');
            if (fresh.remainingCount < 1 || fresh.remainingCount < expectedRemaining ||
                fresh.dailyBoosts.length !== boosts.length ||
                (forMission && (fresh.mission.current !== mission.current || fresh.mission.rewarded !== mission.rewarded ||
                    fresh.mission.completed !== mission.completed || Boolean(fresh.record.boost)))) {
                stopReason = 'stateChanged';
                break;
            }
            // Date can roll over while polling; never boost yesterday's candidate.
            if (!getEligibleBoostCandidates([selected], fresh.userId, io.now()).length) {
                stopReason = 'candidateExpired';
                break;
            }
            if (io.now() - ranking.generatedAt > CONFIG.boostMission.maxRankingAge) {
                throw new Error('실행 직전 후보 집계가 만료되었습니다');
            }
            const articleId = String(selected.article_id);
            const attempt = { status: 'pending', articleId, title: selected.title, score: selected.score,
                attemptedAt: io.now(), generatedAt: ranking.generatedAt };
            // Records are written before the request, so a lost response can never cause a second boost.
            boosts.push(attempt);
            saveDailyBoosts(io, context, boosts);
            if (forMission) {
                record.boost = { ...attempt };
                save(io, context, record);
            }
            io.log(`부스트 대상: ${selected.title} (${selected.score}℃)`, 'info');
            try {
                await io.boostArticle(headers, selected.article_id);
            } catch (error) {
                if (error.definiteFailure && error.code !== 81333) {
                    boosts.pop();
                    saveDailyBoosts(io, context, boosts);
                    if (forMission) {
                        delete record.boost;
                        save(io, context, record);
                    }
                    throw error;
                }
                io.log('부스트 응답이 불확실하여 서버 상태만 재확인합니다', 'warning');
            }
            const result = await verifyBoost(headers, { ...context, record }, io, articleId, forMission);
            if (!result.confirmed) {
                allConfirmed = false;
                break;
            }
            confirmAttempt(io, context, boosts, record, articleId);
            boostedIds.push(articleId);
            expectedRemaining -= 1;
        }
        // Re-read the saved records so a pending confirmation is visible in the dashboard.
        io.publish(await checkBoostStatus(headers, io));
        if (boostedIds.length > 0) {
            io.log(`부스트 ${boostedIds.length}회 실행을 확인했습니다${limit > 0 ? ` (오늘 ${boosts.length}/${limit})` : ''}`, 'success');
        }
        if (!allConfirmed) io.log('부스트 상태 반영 대기 중입니다. 추가 부스트는 하지 않습니다', 'warning');
        if (stopReason && boostedIds.length === 0) return { success: true, skipped: true, reason: stopReason };
        return { success: allConfirmed, boosted: boostedIds.length, articleIds: boostedIds,
            articleId: boostedIds[0] ?? targets[0].article_id, ...(stopReason ? { stopped: stopReason } : {}) };
    }, { requireMission: false });
}

export async function claimBoostMissionReward(headers, deps = {}) {
    return locked(headers, deps, async (context, io) => {
        const { mission, record } = context;
        if (mission.rewarded) return { success: true, skipped: true, reason: 'alreadyRewarded' };
        if (record.reward) {
            const result = await verifyReward(headers, context, io);
            if (result.confirmed) { record.reward.status = 'confirmed'; save(io, context, record); }
            io.publish(await checkBoostStatus(headers, io));
            if (!result.confirmed) io.log('이전 보상 수령의 상태 확인 대기 중입니다. 중복 수령 요청은 하지 않습니다', 'warning');
            return { success: result.confirmed, skipped: true, reason: 'previousRewardAttempt' };
        }
        if (!mission.allCompleted) {
            io.log('오늘의 1등 미션의 부스트·댓글·글쓰기 조건이 아직 완료되지 않았습니다', 'info');
            return { success: true, skipped: true, reason: 'requirementsIncomplete' };
        }
        record.reward = { status: 'pending', attemptedAt: io.now() };
        save(io, context, record);
        let rewardAmount = 0;
        try {
            rewardAmount = await io.receiveBoostMissionReward(headers, mission.id);
            record.reward = { ...record.reward, status: 'confirmed', amount: rewardAmount };
            save(io, context, record);
            state.earnings.boostMission = (state.earnings.boostMission || 0) + rewardAmount;
            io.log(`오늘의 1등 미션 보상 수령: ${rewardAmount} FLAKE`, 'success');
        } catch (error) {
            if (error.definiteFailure) {
                delete record.reward;
                save(io, context, record);
                throw error;
            }
            io.log('보상 수령 응답이 불확실하여 서버 상태만 재확인합니다', 'warning');
        }
        const result = await verifyReward(headers, context, io);
        if (result.confirmed) { record.reward.status = 'confirmed'; save(io, context, record); }
        io.publish(await checkBoostStatus(headers, io));
        if (!result.confirmed) io.log('보상 수령 상태 반영 대기 중입니다. 추가 수령 요청은 하지 않습니다', 'warning');
        return { success: result.confirmed, rewardAmount, verificationPending: !result.confirmed };
    });
}
