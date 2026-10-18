import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { pruneOldRecords } from '../../src/utils/storageCleanup.js';
import { checkBoostStatus } from '../../src/workflows/boost.js';
import { checkReviewEventStatus } from '../../src/workflows/reviewEvent.js';
import { boostFixture, BOOST_NOW } from '../helpers/boostFixture.js';
import { reviewEventFixture, REVIEW_NOW } from '../helpers/reviewEventFixture.js';

const DAY = 24 * 60 * 60 * 1000;

// A Map with the key()/length part of the Storage interface the cleanup walks.
function walkable(records) {
    return {
        getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value),
        removeItem: key => records.delete(key), key: index => [...records.keys()][index] ?? null,
        get length() { return records.size; }
    };
}

test('pruneOldRecords removes old, timestamp-less and unreadable records under the prefix only', () => {
    const now = Date.parse('2026-10-18T00:00:00Z');
    const records = new Map([
        ['p:old', JSON.stringify({ at: now - 8 * DAY })],
        ['p:edge', JSON.stringify({ at: now - CONFIG.storageRetentionDays * DAY })],
        ['p:recent', JSON.stringify({ at: now - DAY })],
        ['p:newest-wins', JSON.stringify({ at: now - 30 * DAY, later: now - DAY })],
        ['p:no-time', JSON.stringify({})],
        ['p:broken', '{not json'],
        ['p:kept', JSON.stringify({ at: now - 30 * DAY })],
        ['other:old', JSON.stringify({ at: now - 30 * DAY })]
    ]);
    const removed = pruneOldRecords(walkable(records), 'p:', { now, timestamps: record => [record.at, record.later],
        keep: key => key === 'p:kept' });
    assert.deepEqual(removed, ['p:old', 'p:no-time', 'p:broken']);
    assert.deepEqual([...records.keys()], ['p:edge', 'p:recent', 'p:newest-wins', 'p:kept', 'other:old']);
});

test('pruneOldRecords never throws and skips storage it cannot walk', () => {
    assert.deepEqual(pruneOldRecords(null, 'p:', { now: 0, timestamps: () => [] }), []);
    assert.deepEqual(pruneOldRecords({ getItem: () => null }, 'p:', { now: 0, timestamps: () => [] }), []);
    const failing = { length: 1, key: () => 'p:x', getItem: () => '{}', removeItem: () => { throw new Error('blocked'); } };
    assert.deepEqual(pruneOldRecords(failing, 'p:', { now: 0, timestamps: () => [] }), []);
});

test('a boost status read drops old records of ended missions but keeps the active mission\'s', async () => {
    const f = boostFixture();
    f.deps.storage = walkable(f.records);
    const old = JSON.stringify({ boost: { status: 'confirmed', articleId: '11', attemptedAt: BOOST_NOW - 8 * DAY } });
    f.records.set('stove-boost-v1:100:1', old);
    f.records.set('stove-boost-v1:300:1', old);
    f.records.set('stove-boost-v1:100:0', old);
    f.records.set('stove-boost-v1:300:7', JSON.stringify({ reward: { status: 'confirmed', attemptedAt: BOOST_NOW - DAY } }));
    assert.equal((await checkBoostStatus({}, f.deps)).success, true);
    assert.deepEqual([...f.records.keys()].sort(), ['stove-boost-v1:100:1', 'stove-boost-v1:300:1', 'stove-boost-v1:300:7']);
});

test('with no active boost mission every old mission record is dropped', async () => {
    const f = boostFixture();
    f.deps.storage = walkable(f.records);
    f.deps.getBoostMissions = async () => [];
    f.records.set('stove-boost-v1:100:1', JSON.stringify({ boost: { status: 'confirmed', articleId: '11',
        attemptedAt: BOOST_NOW - 8 * DAY } }));
    assert.equal((await checkBoostStatus({}, f.deps)).notAvailable, true);
    assert.deepEqual([...f.records.keys()], []);
});

test('a review status read drops old records of other events but keeps the selected event\'s', async () => {
    const f = reviewEventFixture();
    f.deps.storage = walkable(f.records);
    const old = JSON.stringify({ status: 'confirmed', eventNo: 1, commentId: '5', attemptedAt: REVIEW_NOW - 8 * DAY });
    f.records.set('stove-review-v1:100:14523486', old);
    f.records.set('stove-review-v1:100:999', old);
    f.records.set('stove-review-v1:200:998', JSON.stringify({ status: 'pending', eventNo: 2, attemptedAt: REVIEW_NOW - DAY }));
    assert.equal((await checkReviewEventStatus({}, f.deps)).success, true);
    assert.deepEqual([...f.records.keys()].sort(), ['stove-review-v1:100:14523486', 'stove-review-v1:200:998']);
});
