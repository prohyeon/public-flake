import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';
import { checkBoostStatus, executeBoostMission, claimBoostMissionReward, getEligibleBoostCandidates,
    normalizeBoostMission, boostRecordKey, boostDailyKey, BOOST_RANKING_CACHE_KEY, readRankingCache,
    mergeRankingCandidates } from '../../src/workflows/boost.js';
import { boostFixture, boostCandidate, BOOST_NOW } from '../helpers/boostFixture.js';

// Most cases check the safety of a single boost, so they run with a one-per-day limit; the
// five-per-day default is covered by the "daily boosts" cases at the end.
beforeEach(() => {
    state.earnings.boostMission = 0;
    CONFIG.boostMission.dailyBoosts = 1;
});

function manyCandidates(f, count) {
    f.rankings[0].articles = Array.from({ length: count }, (_, index) => boostCandidate(21 + index, 900 - index * 10));
}

test('HAR-shaped unsorted candidates select the maximum score after exactly five reads, then claim once', async () => {
    const f = boostFixture();
    const initial = await checkBoostStatus({}, f.deps);
    assert.equal(initial.mission.current, 0);
    assert.equal(initial.remainingCount, 5);
    assert.equal(initial.mission.allCompleted, false);
    assert.equal((await executeBoostMission({}, f.deps)).success, true);
    assert.equal(f.metrics.rankings, 5);
    assert.deepEqual(f.metrics.delays, [2000, 2000, 2000, 2000]);
    assert.deepEqual(f.metrics.boosts, ['12']);
    assert.deepEqual(f.metrics.rewards, [], 'boosting does not race background comment completion');
    assert.equal((await claimBoostMissionReward({}, f.deps)).rewardAmount, 3000);
    assert.equal(state.earnings.boostMission, 3000);
    await executeBoostMission({}, f.deps);
    await claimBoostMissionReward({}, f.deps);
    assert.deepEqual(f.metrics.boosts, ['12']);
    assert.deepEqual(f.metrics.rewards, ['1']);
    assert.equal(f.metrics.rankings, 5);
    assert.equal(state.earnings.boostMission, 3000);
    const final = await checkBoostStatus({}, f.deps);
    assert.equal(final.mission.rewarded, true);
    assert.equal(final.mission.current, 1);
    assert.equal(final.remainingCount, 4);
});

test('every ranking read is merged; a hotter post seen only in an earlier read is selected', async () => {
    const f = boostFixture();
    f.rankings.splice(0, 1, ...Array.from({ length: 4 }, () => ({ generatedAt: BOOST_NOW - 1000,
        articles: [boostCandidate(11, 5000)] })), { generatedAt: BOOST_NOW,
        articles: [boostCandidate(12, 200), boostCandidate(13, 300)] });
    await executeBoostMission({}, f.deps);
    assert.deepEqual(f.metrics.boosts, ['11']);
});

test('a post seen in several reads keeps its latest temperature', async () => {
    const f = boostFixture();
    f.rankings.splice(0, 1, { generatedAt: BOOST_NOW - 2000, articles: [boostCandidate(11, 5000), boostCandidate(12, 400)] },
        { generatedAt: BOOST_NOW, articles: [boostCandidate(11, 100), boostCandidate(12, 400)] });
    await executeBoostMission({}, f.deps);
    assert.deepEqual(f.metrics.boosts, ['12']);
});

// The next account runs in the same Chrome profile: same storage, its own user and boost flags.
function nextAccount(previous, userId = '300') {
    const f = boostFixture();
    f.deps.storage = previous.deps.storage;
    f.deps.getMyProfile = async () => ({ code: 0, value: { user_id: userId } });
    return f;
}

test('the next account merges the cached candidates with a single ranking read', async () => {
    const first = boostFixture();
    first.rankings.splice(0, 1, { generatedAt: BOOST_NOW, articles: [boostCandidate(11, 5000), boostCandidate(12, 400)] });
    await executeBoostMission({}, first.deps);
    assert.equal(first.metrics.rankings, 5);
    assert.deepEqual(first.metrics.boosts, ['11']);
    const cache = JSON.parse(first.records.get(BOOST_RANKING_CACHE_KEY));
    assert.equal(cache.date, '2026-10-01');
    assert.deepEqual(cache.articles.map(article => article.article_id), ['11', '12']);

    CONFIG.boostMission.dailyBoosts = 2;
    const second = nextAccount(first);
    second.rankings.splice(0, 1, { generatedAt: BOOST_NOW, articles: [boostCandidate(13, 600)] });
    await executeBoostMission({}, second.deps);
    assert.equal(second.metrics.rankings, 1);
    assert.deepEqual(second.metrics.delays.filter(ms => ms === CONFIG.boostMission.queryDelay), []);
    assert.deepEqual(second.metrics.boosts, ['11', '13'], 'cached 5000℃ first, then the new 600℃ post');
    assert.deepEqual(JSON.parse(first.records.get(BOOST_RANKING_CACHE_KEY)).articles.map(article => article.article_id),
        ['11', '13', '12'], 'the merged list is kept for the account after');
});

test('cached candidates exclude the posts of the account reading them', async () => {
    const first = boostFixture();
    first.rankings.splice(0, 1, { generatedAt: BOOST_NOW, articles: [boostCandidate(11, 5000, { profile: { id: '300' } }),
        boostCandidate(12, 400)] });
    await executeBoostMission({}, first.deps);
    assert.deepEqual(first.metrics.boosts, ['11']);
    const second = nextAccount(first, '300');
    await executeBoostMission({}, second.deps);
    assert.deepEqual(second.metrics.boosts, ['12']);
});

test('a cache from another day, an expired one or an unreadable one means a full set of reads', async () => {
    const stale = [
        JSON.stringify({ date: '2026-09-30', articles: [{ ...boostCandidate(11, 5000), seenAt: BOOST_NOW }] }),
        JSON.stringify({ date: '2026-10-01', articles: [{ ...boostCandidate(11, 5000),
            seenAt: BOOST_NOW - CONFIG.boostMission.rankingCacheMaxAge - 1 }] }),
        '{not json'
    ];
    for (const text of stale) {
        const f = boostFixture();
        f.records.set(BOOST_RANKING_CACHE_KEY, text);
        assert.equal((await executeBoostMission({}, f.deps)).success, true);
        assert.equal(f.metrics.rankings, 5);
        assert.deepEqual(f.metrics.boosts, ['12'], 'the stale post is not boosted');
        assert.ok(!f.records.get(BOOST_RANKING_CACHE_KEY).includes('"11","title":"후보 11","score":5000'));
    }
});

test('a status read prunes the cache: another day, expired entries and broken records are removed', async () => {
    const entry = (id, seenAt) => ({ ...boostCandidate(id, 100), seenAt });
    const maxAge = CONFIG.boostMission.rankingCacheMaxAge;
    const cases = [
        [JSON.stringify({ date: '2026-09-30', articles: [entry(11, BOOST_NOW)] }), undefined],
        [JSON.stringify({ date: '2026-10-01', articles: [entry(11, BOOST_NOW - maxAge - 1)] }), undefined],
        ['{not json', undefined],
        [JSON.stringify({ date: '2026-10-01', articles: [entry(11, BOOST_NOW - maxAge - 1), entry(12, BOOST_NOW)] }), ['12']]
    ];
    for (const [text, kept] of cases) {
        const f = boostFixture();
        f.records.set(BOOST_RANKING_CACHE_KEY, text);
        assert.equal((await checkBoostStatus({}, f.deps)).success, true);
        const left = f.records.get(BOOST_RANKING_CACHE_KEY);
        assert.deepEqual(left && JSON.parse(left).articles.map(article => article.article_id), kept);
    }
});

test('readRankingCache and mergeRankingCandidates', () => {
    assert.deepEqual(readRankingCache(null, BOOST_NOW), []);
    assert.deepEqual(readRankingCache({ getItem: () => { throw new Error('blocked'); } }, BOOST_NOW), []);
    const merged = mergeRankingCandidates([{ article_id: '1', score: 9, seenAt: 1 }, { article_id: '1', score: 3, seenAt: 2 },
        { article_id: '2', score: 5, seenAt: 1 }]);
    assert.deepEqual(merged, [{ article_id: '1', score: 3, seenAt: 2 }, { article_id: '2', score: 5, seenAt: 1 }]);
});

test('eligibility excludes own, past KST day, future, non-consenting, official and private posts', () => {
    const articles = [boostCandidate(11, 100), boostCandidate(12, 1000, { profile: { id: '100' } }),
        boostCandidate(13, 1000, { datetime: Date.parse('2026-09-30T14:59:59Z') }),
        boostCandidate(14, 1000, { datetime: BOOST_NOW + 1 }),
        boostCandidate(15, 1000, { today_contest_agree: false }),
        boostCandidate(16, 1000, { profile: { id: '200', badge: 'OFFICIAL' } }),
        boostCandidate(17, 1000, { coverage: 'PRIVATE' }), boostCandidate(18, NaN),
        boostCandidate(19, 50, { datetime: Date.parse('2026-09-30T15:00:00Z') })];
    assert.deepEqual(getEligibleBoostCandidates(articles, '100', BOOST_NOW).map(a => a.article_id), ['11', '19']);
});

test('an already-boosted highest candidate is excluded before selecting the next highest', async () => {
    const f = boostFixture();
    f.boosted.add('12');
    await executeBoostMission({}, f.deps);
    assert.deepEqual(f.metrics.boosts, ['11']);
});

test('no available candidates or all already boosted causes zero writes', async () => {
    for (const variant of ['empty', 'alreadyBoosted']) {
        const f = boostFixture();
        if (variant === 'empty') f.rankings[0].articles = [];
        else for (const a of f.rankings[0].articles) f.boosted.add(a.article_id);
        const result = await executeBoostMission({}, f.deps);
        assert.equal(result.skipped, true);
        assert.equal(f.metrics.rankings, 5);
        assert.deepEqual(f.metrics.boosts, []);
    }
});

test('with daily boosts off, completed, rewarded, exhausted and non-single-count missions never initiate a boost', async () => {
    CONFIG.boostMission.dailyBoosts = 0;
    for (const variant of ['completed', 'serverCompleted', 'rewarded', 'exhausted', 'differentCount']) {
        const f = boostFixture();
        if (variant === 'completed') f.mission.details[0].current_count = 1;
        if (variant === 'serverCompleted') f.mission.is_completed = true;
        if (variant === 'rewarded') f.mission.is_rewarded = true;
        if (variant === 'exhausted') f.deps.getBoostBalance = async () => ({ remainingCount: 0 });
        if (variant === 'differentCount') f.mission.details[0].required_count = 2;
        assert.equal((await executeBoostMission({}, f.deps)).skipped, true);
        assert.equal(f.metrics.rankings, 0);
        assert.deepEqual(f.metrics.boosts, []);
    }
});

test('daily boost: a finished or absent mission still gets one popular-post boost per KST day', async () => {
    for (const variant of ['completed', 'serverCompleted', 'rewarded', 'differentCount', 'noMission']) {
        const f = boostFixture();
        if (variant === 'completed') f.mission.details[0].current_count = 1;
        if (variant === 'serverCompleted') f.mission.is_completed = true;
        if (variant === 'rewarded') f.mission.is_rewarded = true;
        if (variant === 'differentCount') f.mission.details[0].required_count = 2;
        if (variant === 'noMission') f.deps.getBoostMissions = async () => [];
        const result = await executeBoostMission({}, f.deps);
        assert.equal(result.success, true, variant);
        assert.deepEqual(f.metrics.boosts, ['12'], `${variant}: the hottest eligible post`);
        const daily = JSON.parse(f.records.get(boostDailyKey('100')));
        assert.equal(daily.date, '2026-10-01');
        assert.deepEqual(daily.boosts.map(({ status, articleId }) => ({ status, articleId })), [{ status: 'confirmed', articleId: '12' }]);
        assert.equal((await executeBoostMission({}, f.deps)).reason, 'alreadyBoostedToday', variant);
        assert.deepEqual(f.metrics.boosts, ['12'], `${variant}: once per day`);
        assert.equal(f.metrics.rankings, 5);
        if (variant === 'rewarded') {
            assert.equal(f.records.has(boostRecordKey('100', '1')), false, 'a finished mission keeps no new mission record');
        }
    }
});

test('daily boost: no charge left means no ranking read and no write', async () => {
    const f = boostFixture();
    f.mission.is_rewarded = true;
    f.deps.getBoostBalance = async () => ({ remainingCount: 0 });
    assert.equal((await executeBoostMission({}, f.deps)).reason, 'notActionable');
    assert.equal(f.metrics.rankings, 0);
    assert.deepEqual(f.metrics.boosts, []);
});

test("daily boost: yesterday's record does not block today's boost", async () => {
    const f = boostFixture();
    f.mission.is_rewarded = true;
    f.records.set(boostDailyKey('100'), JSON.stringify({ date: '2026-09-30', boosts: [{ status: 'confirmed', articleId: '11' }] }));
    await executeBoostMission({}, f.deps);
    assert.deepEqual(f.metrics.boosts, ['12']);
});

test('daily boost: with a finished mission only the post itself can confirm an uncertain boost', async () => {
    const f = boostFixture();
    f.mission.details[0].current_count = 1;
    f.mission.is_rewarded = true;
    // The request times out and the server never applies it: the post stays un-boosted.
    f.deps.boostArticle = async (headers, id) => { f.metrics.boosts.push(String(id)); throw new Error('timeout'); };
    const result = await executeBoostMission({}, f.deps);
    assert.equal(result.success, false, 'the finished mission (1/1) proves nothing about today');
    assert.equal(JSON.parse(f.records.get(boostDailyKey('100'))).boosts[0].status, 'pending');
    assert.equal((await checkBoostStatus({}, f.deps)).verificationPending, true);
    assert.equal((await executeBoostMission({}, f.deps)).reason, 'previousAttempt');
    assert.deepEqual(f.metrics.boosts, ['12'], 'never a second boost while the first is unconfirmed');
    assert.equal(f.metrics.rankings, 5);
    // Once the post shows the boost, the pending attempt is confirmed without another write.
    f.boosted.add('12');
    assert.equal((await executeBoostMission({}, f.deps)).success, true);
    assert.equal(JSON.parse(f.records.get(boostDailyKey('100'))).boosts[0].status, 'confirmed');
    assert.deepEqual(f.metrics.boosts, ['12']);
});

test("daily boost: a definite rejection clears today's record so a later run may try again", async () => {
    const f = boostFixture();
    f.mission.is_rewarded = true;
    f.deps.boostArticle = async () => {
        const error = new Error('forbidden');
        error.definiteFailure = true;
        error.code = 40300;
        throw error;
    };
    assert.equal((await executeBoostMission({}, f.deps)).success, false);
    assert.equal(f.records.has(boostDailyKey('100')), false);
});

test('daily boost: a corrupt daily record fails closed', async () => {
    const f = boostFixture();
    f.mission.is_rewarded = true;
    f.records.set(boostDailyKey('100'), '{"date":"2026-10-01","boosts":[{"status":"maybe","articleId":"12"}]}');
    assert.equal((await executeBoostMission({}, f.deps)).success, false);
    assert.equal(f.metrics.rankings, 0);
    assert.deepEqual(f.metrics.boosts, []);
});

test('malformed counts, failed lookup and unknown identity fail closed', async () => {
    for (const variant of ['counts', 'lookup', 'identity']) {
        const f = boostFixture();
        if (variant === 'counts') delete f.mission.details[0].current_count;
        if (variant === 'lookup') f.deps.getBoostMissions = async () => { throw new Error('offline'); };
        if (variant === 'identity') f.deps.getMyProfile = async () => ({ code: 1, value: { user_id: '100' } });
        assert.equal((await executeBoostMission({}, f.deps)).success, false);
        assert.equal(f.metrics.rankings, 0);
        assert.deepEqual(f.metrics.boosts, []);
    }
});

test('a failed fifth query, stale snapshot or reversed generation time never uses earlier candidates', async () => {
    for (const variant of ['failure', 'stale', 'reversed']) {
        const f = boostFixture();
        if (variant === 'failure') {
            const get = f.deps.getBoostRanking;
            f.deps.getBoostRanking = async () => {
                if (f.metrics.rankings === 4) throw new Error('offline');
                return get();
            };
        }
        if (variant === 'stale') f.rankings[0].generatedAt = BOOST_NOW - 11 * 60000;
        if (variant === 'reversed') f.rankings.push({ ...structuredClone(f.rankings[0]), generatedAt: BOOST_NOW - 1 });
        assert.equal((await executeBoostMission({}, f.deps)).success, false);
        assert.deepEqual(f.metrics.boosts, []);
    }
});

test('mission completion or account change during polling is checked before writing', async () => {
    for (const variant of ['mission', 'account']) {
        const f = boostFixture();
        let userId = '100';
        f.deps.getMyProfile = async () => ({ code: 0, value: { user_id: userId } });
        const get = f.deps.getBoostRanking;
        f.deps.getBoostRanking = async () => {
            const ranking = await get();
            if (f.metrics.rankings === 5) {
                if (variant === 'mission') f.mission.details[0].current_count = 1;
                else userId = '101';
            }
            return ranking;
        };
        await executeBoostMission({}, f.deps);
        assert.deepEqual(f.metrics.boosts, []);
    }
});

test('already-interacted response preserves the target record and reconciles instead of switching posts', async () => {
    const f = boostFixture();
    f.deps.boostArticle = async (headers, id) => {
        f.metrics.boosts.push(String(id));
        f.boosted.add(String(id));
        const error = new Error('already boosted');
        error.code = 81333;
        error.definiteFailure = true;
        throw error;
    };
    assert.equal((await executeBoostMission({}, f.deps)).success, true);
    await executeBoostMission({}, f.deps);
    assert.deepEqual(f.metrics.boosts, ['12']);
    assert.equal(f.metrics.rankings, 5);
});

test('a lost response with server acceptance is reconciled instead of issuing a second boost', async () => {
    const f = boostFixture();
    const put = f.deps.boostArticle;
    f.deps.boostArticle = async (...args) => { await put(...args); throw new Error('lost response'); };
    assert.equal((await executeBoostMission({}, f.deps)).success, true);
    await executeBoostMission({}, f.deps);
    assert.deepEqual(f.metrics.boosts, ['12']);
});

test('an unknown write survives reload and blocks further boost attempts', async () => {
    const f = boostFixture();
    f.deps.boostArticle = async (headers, id) => { f.metrics.boosts.push(String(id)); throw new Error('timeout'); };
    assert.equal((await executeBoostMission({}, f.deps)).success, false);
    const saved = f.records.get(boostRecordKey('100', '1'));
    assert.equal(JSON.parse(saved).boost.status, 'pending');
    const reloaded = boostFixture();
    reloaded.records.set(boostRecordKey('100', '1'), saved);
    assert.equal((await executeBoostMission({}, reloaded.deps)).success, false);
    assert.deepEqual(reloaded.metrics.boosts, []);
    assert.equal(reloaded.metrics.rankings, 0);
    assert.equal((await checkBoostStatus({}, reloaded.deps)).verificationPending, true);
});

test('storage failure, invalid persisted data or an unavailable cross-tab lock prevents writes', async () => {
    for (const variant of ['storage', 'corrupt', 'lock']) {
        const f = boostFixture();
        if (variant === 'storage') f.deps.storage.setItem = () => { throw new Error('storage blocked'); };
        if (variant === 'corrupt') f.records.set(boostRecordKey('100', '1'), '{invalid');
        if (variant === 'lock') delete f.deps.withLock;
        assert.equal((await executeBoostMission({}, f.deps)).success, false);
        assert.deepEqual(f.metrics.boosts, []);
        assert.deepEqual(f.metrics.rewards, []);
    }
});

test('two concurrent runs under a shared account lock issue one boost', async () => {
    const f = boostFixture();
    await Promise.all([executeBoostMission({}, f.deps), executeBoostMission({}, f.deps)]);
    assert.deepEqual(f.metrics.boosts, ['12']);
    assert.equal(f.metrics.rankings, 5);
});

test('reward waits for all details, then can be claimed without another boost', async () => {
    const f = boostFixture();
    f.mission.details[1].current_count = 0;
    await executeBoostMission({}, f.deps);
    assert.equal((await claimBoostMissionReward({}, f.deps)).reason, 'requirementsIncomplete');
    assert.deepEqual(f.metrics.rewards, []);
    f.mission.details[1].current_count = 1;
    assert.equal((await claimBoostMissionReward({}, f.deps)).success, true);
    assert.deepEqual(f.metrics.rewards, ['1']);
    assert.deepEqual(f.metrics.boosts, ['12']);
});

test('unknown reward response is not retried or counted as certain earnings', async () => {
    const f = boostFixture();
    f.mission.details[0].current_count = 1;
    f.deps.receiveBoostMissionReward = async (headers, id) => { f.metrics.rewards.push(String(id)); throw new Error('timeout'); };
    assert.equal((await claimBoostMissionReward({}, f.deps)).success, false);
    await claimBoostMissionReward({}, f.deps);
    assert.deepEqual(f.metrics.rewards, ['1']);
    assert.equal(state.earnings.boostMission, 0);
    assert.equal((await checkBoostStatus({}, f.deps)).verificationPending, true);
});

test('lost reward response is reconciled from rewarded flag with no second POST', async () => {
    const f = boostFixture();
    f.mission.details[0].current_count = 1;
    const post = f.deps.receiveBoostMissionReward;
    f.deps.receiveBoostMissionReward = async (...args) => { await post(...args); throw new Error('timeout'); };
    assert.equal((await claimBoostMissionReward({}, f.deps)).success, true);
    await claimBoostMissionReward({}, f.deps);
    assert.deepEqual(f.metrics.rewards, ['1']);
    assert.equal(state.earnings.boostMission, 0, 'uncertain receipt amount is not guessed');
});

test('active boost mission is selected by server dates, and empty or ended missions are unavailable', () => {
    const f = boostFixture();
    assert.equal(normalizeBoostMission([f.mission], BOOST_NOW).id, '1');
    assert.equal(normalizeBoostMission([], BOOST_NOW), null);
    f.mission.end_dt = BOOST_NOW;
    assert.equal(normalizeBoostMission([f.mission], BOOST_NOW), null);
});

test('daily boost: an account change while confirming leaves the attempt pending', async () => {
    const f = boostFixture();
    f.mission.is_rewarded = true;
    let userId = '100';
    f.deps.getMyProfile = async () => ({ code: 0, value: { user_id: userId } });
    const put = f.deps.boostArticle;
    f.deps.boostArticle = async (...args) => {
        const result = await put(...args);
        userId = '101';
        return result;
    };
    assert.equal((await executeBoostMission({}, f.deps)).success, false);
    assert.equal(JSON.parse(f.records.get(boostDailyKey('100'))).boosts[0].status, 'pending');
    assert.deepEqual(f.metrics.boosts, ['12']);
});

test('daily boosts: five different popular posts a day, hottest first, one second apart', async () => {
    CONFIG.boostMission.dailyBoosts = 5;
    const f = boostFixture();
    f.mission.is_rewarded = true;
    manyCandidates(f, 7);
    const result = await executeBoostMission({}, f.deps);
    assert.equal(result.success, true);
    assert.equal(result.boosted, 5);
    assert.deepEqual(f.metrics.boosts, ['21', '22', '23', '24', '25']);
    assert.equal(f.metrics.rankings, 5, 'one ranking search serves every boost');
    assert.deepEqual(f.metrics.delays, [2000, 2000, 2000, 2000, 1000, 1000, 1000, 1000]);
    const status = await checkBoostStatus({}, f.deps);
    assert.equal(status.remainingCount, 0);
    assert.deepEqual(status.dailyBoosts.map(attempt => attempt.status), Array(5).fill('confirmed'));
    assert.equal((await executeBoostMission({}, f.deps)).reason, 'alreadyBoostedToday');
    assert.equal(f.metrics.boosts.length, 5);
});

test('daily boosts: charges limit a run, and a later run the same day fills up to five without repeats', async () => {
    CONFIG.boostMission.dailyBoosts = 5;
    const f = boostFixture();
    f.mission.is_rewarded = true;
    manyCandidates(f, 7);
    let remaining = 3;
    f.deps.getBoostBalance = async () => ({ remainingCount: remaining, nextChargeAt: null });
    const put = f.deps.boostArticle;
    f.deps.boostArticle = async (...args) => { remaining -= 1; return put(...args); };

    assert.equal((await executeBoostMission({}, f.deps)).boosted, 3);
    remaining = 5; // recharged later the same day
    assert.equal((await executeBoostMission({}, f.deps)).boosted, 2);
    assert.deepEqual(f.metrics.boosts, ['21', '22', '23', '24', '25']);
    assert.equal((await executeBoostMission({}, f.deps)).reason, 'alreadyBoostedToday');
    assert.equal(f.metrics.boosts.length, 5);
});

test('daily boosts: an unconfirmed boost stops the run and blocks new ones until it is confirmed', async () => {
    CONFIG.boostMission.dailyBoosts = 5;
    const f = boostFixture();
    f.mission.is_rewarded = true;
    manyCandidates(f, 7);
    const put = f.deps.boostArticle;
    f.deps.boostArticle = async (headers, id) => {
        if (String(id) === '22') { f.metrics.boosts.push('22'); throw new Error('timeout'); }
        return put(headers, id);
    };
    const first = await executeBoostMission({}, f.deps);
    assert.equal(first.success, false);
    assert.deepEqual(f.metrics.boosts, ['21', '22']);
    assert.deepEqual(JSON.parse(f.records.get(boostDailyKey('100'))).boosts.map(attempt => attempt.status), ['confirmed', 'pending']);

    assert.equal((await executeBoostMission({}, f.deps)).reason, 'previousAttempt');
    assert.deepEqual(f.metrics.boosts, ['21', '22'], 'no new boost while one is unconfirmed');

    f.boosted.add('22'); // the server did apply it
    const third = await executeBoostMission({}, f.deps);
    assert.equal(third.success, true);
    assert.deepEqual(f.metrics.boosts, ['21', '22', '23', '24', '25'], 'confirmed, then filled up to five');
});

test("daily boosts: the one-boost record of the first daily version still counts toward today's five", async () => {
    CONFIG.boostMission.dailyBoosts = 5;
    const f = boostFixture();
    f.mission.is_rewarded = true;
    manyCandidates(f, 7);
    f.boosted.add('21');
    f.records.set(boostDailyKey('100'), JSON.stringify({ date: '2026-10-01', status: 'confirmed', articleId: '21' }));
    assert.equal((await executeBoostMission({}, f.deps)).boosted, 4);
    assert.deepEqual(f.metrics.boosts, ['22', '23', '24', '25']);
    assert.equal(JSON.parse(f.records.get(boostDailyKey('100'))).boosts.length, 5);
});

test('daily boosts: with a 0/1 mission the first boost also completes the mission', async () => {
    CONFIG.boostMission.dailyBoosts = 5;
    const f = boostFixture();
    manyCandidates(f, 3);
    assert.equal((await executeBoostMission({}, f.deps)).boosted, 3, 'fewer posts than charges: every post once');
    assert.equal(JSON.parse(f.records.get(boostRecordKey('100', '1'))).boost.articleId, '21');
    assert.equal((await claimBoostMissionReward({}, f.deps)).rewardAmount, 3000);
});

test('daily boosts: a charge spent elsewhere mid-run stops the remaining boosts', async () => {
    CONFIG.boostMission.dailyBoosts = 5;
    const f = boostFixture();
    f.mission.is_rewarded = true;
    manyCandidates(f, 7);
    let remaining = 5;
    f.deps.getBoostBalance = async () => ({ remainingCount: remaining, nextChargeAt: null });
    const put = f.deps.boostArticle;
    f.deps.boostArticle = async (...args) => {
        remaining -= 2; // our boost plus one made in another tab at the same moment
        return put(...args);
    };
    const result = await executeBoostMission({}, f.deps);
    assert.equal(result.success, true);
    assert.equal(result.boosted, 1);
    assert.equal(result.stopped, 'stateChanged');
    assert.deepEqual(f.metrics.boosts, ['21']);
});
