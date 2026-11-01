import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizePlayEvent, collectPlayEventRewards } from '../../src/workflows/playEvent.js';
import { renderPlayEvent } from '../../src/ui/playEvent.js';
import { state } from '../../src/state.js';
import { playEventShop } from '../helpers/playEventFixture.js';

const now = new Date('2026-11-02T12:00:00+09:00');
const headers = { Authorization: 'Bearer test-only', 'X-UUID': 'test-device' };

test('captured period and ten milestones are derived from data with KST boundaries', () => {
    const result = normalizePlayEvent(playEventShop(), now);
    assert.equal(result.periodDays, 15);
    assert.equal(result.rewardCount, 10);
    assert.equal(result.targetDays, 10);
    assert.equal(result.totalPlayDays, 1);
    assert.deepEqual(result.claimable.map(r => r.item_no), [42]);
    assert.equal(normalizePlayEvent(playEventShop(), new Date('2026-11-16T00:00:00+09:00')).claimable.length, 0);
    assert.equal(normalizePlayEvent(playEventShop(), new Date('2026-10-31T23:59:59+09:00')).notStarted, true);
    const changed = playEventShop();
    changed.date_info.attend_end_dt = '2026-11-20T23:59:59';
    changed.accumulated_plays.rewards.pop();
    assert.equal(normalizePlayEvent(changed, now).periodDays, 20);
    assert.equal(normalizePlayEvent(changed, now).rewardCount, 9);
});

test('malformed or duplicated rewards fail closed, and ended/sold-out events never claim', () => {
    for (const change of [v => { v.accumulated_plays.total_play_days = '1'; },
        v => { v.accumulated_plays.rewards[0].eligible = 'true'; },
        v => { v.accumulated_plays.rewards.push(v.accumulated_plays.rewards[0]); }]) {
        const value = playEventShop(); change(value);
        assert.throws(() => normalizePlayEvent(value, now));
    }
    const value = playEventShop();
    value.event_ended = true;
    assert.equal(normalizePlayEvent(value, now).claimable.length, 0);
    value.event_ended = false; value.accumulated_plays.rewards[0].sold_out = true;
    assert.equal(normalizePlayEvent(value, now).claimable.length, 0);
});

test('a reward that needs a game character is never claimed automatically', () => {
    const value = playEventShop();
    value.accumulated_plays.rewards[0].has_game_character = true;
    assert.deepEqual(normalizePlayEvent(value, now).claimable, []);
});

test('dashboard renders ten states and HTML as text; unavailable/error data is explicit', t => {
    const dom = new JSDOM('<div id="stove-play-event-data"></div><button id="stove-btn-play-event-claim"></button>');
    const original = globalThis.document;
    globalThis.document = dom.window.document;
    t.after(() => { globalThis.document = original; dom.window.close(); });
    const value = playEventShop();
    value.accumulated_plays.rewards[0].item_name = '&lt;img src=x onerror=alert(1)&gt; &amp; SP';
    renderPlayEvent(normalizePlayEvent(value, now));
    assert.match(document.body.textContent, /15일 행사/);
    assert.match(document.body.textContent, /보상 0\/10개/);
    assert.match(document.body.textContent, /10일차/);
    assert.equal(document.querySelector('img'), null);
    assert.equal(document.querySelector('button').disabled, false);
    renderPlayEvent({ success: false, error: '확인 불가' });
    assert.match(document.body.textContent, /확인 실패/);
    assert.equal(document.querySelector('button').disabled, true);
});

test('claim rereads eligibility, verifies receipt and becomes idempotent on repeat', async t => {
    const original = globalThis.document;
    globalThis.document = { getElementById: () => null };
    t.after(() => { globalThis.document = original; });
    const value = playEventShop();
    let posts = 0;
    const deps = { now, getHeaders: () => headers, getShop: async () => structuredClone(value), claim: async (_headers, reward) => {
        posts++;
        value.accumulated_plays.rewards.find(r => r.item_no === reward.item_no).is_received = true;
        return { flake_amount: 1000 };
    } };
    state.earnings.playEvent = 0;
    const result = await collectPlayEventRewards(headers, deps);
    assert.equal(result.success, true);
    assert.deepEqual(result.claimed, [42]);
    assert.equal(result.after.receivedCount, 1);
    assert.equal(state.earnings.playEvent, 1000);
    assert.equal((await collectPlayEventRewards(headers, deps)).success, true);
    assert.equal(posts, 1);
});

test('account switch or uncertain POST prevents retries and successful completion', async t => {
    const original = globalThis.document;
    globalThis.document = { getElementById: () => null };
    t.after(() => { globalThis.document = original; });
    let session = headers, posts = 0;
    const deps = { now, getHeaders: () => session, getShop: async () => {
        session = { Authorization: 'Bearer changed' }; return playEventShop();
    }, claim: async () => { posts++; } };
    assert.equal((await collectPlayEventRewards(headers, deps)).success, false);
    assert.equal(posts, 0);
    session = headers;
    const failed = await collectPlayEventRewards(headers, { ...deps, getShop: async () => playEventShop(),
        claim: async () => { posts++; throw new Error('timeout'); } });
    assert.equal(failed.success, false);
    assert.equal(posts, 1);
    const pending = await collectPlayEventRewards(headers, { ...deps, getShop: async () => playEventShop(),
        claim: async () => ({ flake_amount: 1000 }) });
    assert.equal(pending.success, false);
    assert.match(pending.error, /반영 확인 대기/);
});
