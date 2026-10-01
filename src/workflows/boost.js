import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { getMyProfile } from '../api/profile.js';
import { getBoostMissions, getBoostBalance, getBoostRanking, getArticleBoostStatuses,
    boostArticle, receiveBoostMissionReward } from '../api/boost.js';
import { delay } from '../utils/time.js';
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

export function boostRecordKey(userId, missionId) {
    return `stove-boost-v1:${userId}:${missionId}`;
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
        const mission = normalizeBoostMission(missions, io.now());
        if (!mission) return { success: true, notAvailable: true, userId: String(userId), ...balance };
        const key = boostRecordKey(userId, mission.id);
        const record = readRecord(io.storage, key);
        return {
            success: true, userId: String(userId), mission, ...balance, key, record,
            verificationPending: Boolean((record.boost && mission.current < mission.required) ||
                (record.reward && !mission.rewarded)),
            selectedArticle: record.boost && Number.isFinite(record.boost.attemptedAt) &&
                day(record.boost.attemptedAt) === day(io.now()) ? record.boost : null
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

async function locked(headers, deps, work) {
    const io = services(deps);
    if (!CONFIG.boostMission.enabled) return { success: true, skipped: true, reason: 'disabled' };
    try {
        const initial = requireStatus(await checkBoostStatus(headers, io));
        io.publish(initial);
        if (initial.notAvailable) return { success: true, skipped: true, reason: 'noMission' };
        return await io.withLock(initial.key, async () => {
            const context = requireStatus(await checkBoostStatus(headers, io));
            if (context.notAvailable || context.key !== initial.key) throw new Error('부스트 계정 또는 미션이 변경되었습니다');
            io.publish(context);
            return work(context, io);
        });
    } catch (error) {
        io.log(`부스트 처리 중단: ${error.message}`, 'warning');
        io.publish({ success: false, unknown: true, error: error.message });
        return { success: false, reason: 'statusUnknown', error: error.message };
    }
}

async function verify(headers, context, io, articleId = null, reward = false) {
    let latest = context;
    for (let i = 0; i < CONFIG.boostMission.verifyAttempts; i++) {
        if (i > 0) await io.delay(CONFIG.boostMission.verifyDelay);
        latest = await checkBoostStatus(headers, io);
        if (latest.success && !latest.notAvailable && latest.key === context.key) {
            if (reward ? latest.mission.rewarded : latest.mission.current >= latest.mission.required) {
                return { confirmed: true, status: latest };
            }
        } else if (latest.success) {
            return { confirmed: false, status: { success: false, unknown: true, error: '부스트 계정 또는 미션이 변경되었습니다' } };
        }
        if (articleId && !reward) {
            try {
                const interactions = await io.getArticleBoostStatuses(headers, [articleId]);
                if (interactions[articleId]?.BOOST === true) return { confirmed: true, status: latest };
            } catch { /* A failed read never authorizes another boost. */ }
        }
    }
    return { confirmed: false, status: latest };
}

export async function executeBoostMission(headers, deps = {}) {
    return locked(headers, deps, async (context, io) => {
        const { mission, record } = context;
        if (mission.rewarded || mission.completed || mission.current >= mission.required) {
            return { success: true, skipped: true, reason: 'alreadyCompleted' };
        }
        if (record.boost) {
            const result = await verify(headers, context, io, record.boost.articleId);
            if (result.confirmed) { record.boost.status = 'confirmed'; save(io, context, record); }
            io.publish(result.status);
            io.log(result.confirmed ? '기존 부스트 실행을 확인했습니다' : '이전 부스트의 반영 확인 대기 중입니다. 추가 부스트는 하지 않습니다', result.confirmed ? 'success' : 'warning');
            return { success: result.confirmed, skipped: true, reason: 'previousAttempt' };
        }
        if (mission.current !== 0 || mission.required !== 1 || context.remainingCount < 1) {
            io.log('부스트 0/1 및 잔여 횟수 조건을 충족하지 않아 건너뜁니다', 'info');
            return { success: true, skipped: true, reason: 'notActionable' };
        }
        let ranking;
        for (let i = 0; i < CONFIG.boostMission.rankingQueries; i++) {
            if (i > 0) await io.delay(CONFIG.boostMission.queryDelay);
            const next = await io.getBoostRanking(headers);
            const age = io.now() - next.generatedAt;
            if (age > CONFIG.boostMission.maxRankingAge || age < -60000 ||
                (ranking && next.generatedAt < ranking.generatedAt)) throw new Error('실시간 후보 집계가 오래되었거나 역전되었습니다');
            const repeated = ranking?.generatedAt === next.generatedAt;
            ranking = next;
            io.log(`실시간 후보 조회 ${i + 1}/${CONFIG.boostMission.rankingQueries}${repeated ? ' (같은 집계 시각)' : ''}`, 'info');
        }
        const candidates = getEligibleBoostCandidates(ranking.articles, context.userId, io.now());
        if (candidates.length === 0) {
            io.log('마지막 조회에 부스트 가능한 후보가 없습니다', 'warning');
            return { success: true, skipped: true, reason: 'noCandidates' };
        }
        const interactions = await io.getArticleBoostStatuses(headers, candidates.map(article => article.article_id));
        const selected = candidates.find(article => interactions[article.article_id]?.BOOST === false);
        if (!selected) return { success: true, skipped: true, reason: 'alreadyBoosted' };
        const fresh = requireStatus(await checkBoostStatus(headers, io));
        if (fresh.notAvailable || fresh.key !== context.key) throw new Error('부스트 계정 또는 미션이 변경되었습니다');
        if (fresh.mission.rewarded || fresh.mission.completed || fresh.mission.current !== 0 || fresh.mission.required !== 1 ||
            fresh.remainingCount < 1 || fresh.record.boost) return { success: true, skipped: true, reason: 'stateChanged' };
        // Date can roll over while polling; never boost yesterday's candidate.
        if (!getEligibleBoostCandidates([selected], fresh.userId, io.now()).length) {
            return { success: true, skipped: true, reason: 'candidateExpired' };
        }
        if (io.now() - ranking.generatedAt > CONFIG.boostMission.maxRankingAge) {
            throw new Error('실행 직전 후보 집계가 만료되었습니다');
        }
        record.boost = { status: 'pending', articleId: String(selected.article_id),
            title: selected.title, score: selected.score, attemptedAt: io.now(), generatedAt: ranking.generatedAt };
        save(io, context, record);
        io.log(`부스트 대상: ${selected.title} (${selected.score}℃)`, 'info');
        let accepted = false;
        try {
            await io.boostArticle(headers, selected.article_id);
            accepted = true;
        } catch (error) {
            if (error.definiteFailure && error.code !== 81333) {
                delete record.boost;
                save(io, context, record);
                throw error;
            }
            io.log('부스트 응답이 불확실하여 서버 상태만 재확인합니다', 'warning');
        }
        const result = await verify(headers, context, io, selected.article_id);
        if (result.confirmed) { record.boost.status = 'confirmed'; save(io, context, record); }
        // Re-read the saved record so pending confirmation is visible in the dashboard.
        io.publish(await checkBoostStatus(headers, io));
        io.log(result.confirmed ? '부스트 1회 실행을 확인했습니다' : '부스트 상태 반영 대기 중입니다. 추가 부스트는 하지 않습니다', result.confirmed ? 'success' : 'warning');
        return { success: result.confirmed, accepted, boosted: result.confirmed, articleId: selected.article_id };
    });
}

export async function claimBoostMissionReward(headers, deps = {}) {
    return locked(headers, deps, async (context, io) => {
        const { mission, record } = context;
        if (mission.rewarded) return { success: true, skipped: true, reason: 'alreadyRewarded' };
        if (record.reward) {
            const result = await verify(headers, context, io, null, true);
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
        const result = await verify(headers, context, io, null, true);
        if (result.confirmed) { record.reward.status = 'confirmed'; save(io, context, record); }
        io.publish(await checkBoostStatus(headers, io));
        if (!result.confirmed) io.log('보상 수령 상태 반영 대기 중입니다. 추가 수령 요청은 하지 않습니다', 'warning');
        return { success: result.confirmed, rewardAmount, verificationPending: !result.confirmed };
    });
}
