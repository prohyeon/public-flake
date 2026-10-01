import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../../src/state.js';
import { checkBoostStatus, executeBoostMission, claimBoostMissionReward, getEligibleBoostCandidates,
    normalizeBoostMission, boostRecordKey } from '../../src/workflows/boost.js';
import { boostFixture, boostCandidate, BOOST_NOW } from '../helpers/boostFixture.js';

beforeEach(() => { state.earnings.boostMission = 0; });

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

test('only the final ranking is used; an earlier hotter or disappeared candidate is not selected', async () => {
    const f = boostFixture();
    f.rankings.splice(0, 1, ...Array.from({ length: 4 }, () => ({ generatedAt: BOOST_NOW - 1000,
        articles: [boostCandidate(11, 5000)] })), { generatedAt: BOOST_NOW,
        articles: [boostCandidate(12, 200), boostCandidate(13, 300)] });
    await executeBoostMission({}, f.deps);
    assert.deepEqual(f.metrics.boosts, ['13']);
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

test('completed, rewarded, exhausted and non-single-count missions never initiate a boost', async () => {
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
