import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeSpecialForce, collectSpecialForceRewards } from '../../src/workflows/specialForce.js';
import { renderSpecialForce } from '../../src/ui/specialForce.js';
import { state } from '../../src/state.js';
import { specialForceShop } from '../helpers/specialForceFixture.js';

const now = new Date('2026-10-01T12:00:00+09:00');
const headers = { Authorization: 'Bearer test-only', 'X-UUID': 'test-device' };

test('captured period and seven milestones are derived from data with KST boundaries', () => {
    const result = normalizeSpecialForce(specialForceShop(), now);
    assert.equal(result.periodDays, 14);
    assert.equal(result.rewardCount, 7);
    assert.equal(result.targetDays, 7);
    assert.equal(result.totalPlayDays, 1);
    assert.deepEqual(result.claimable.map(r => r.item_no), [25]);
    assert.equal(normalizeSpecialForce(specialForceShop(), new Date('2026-10-15T00:00:00+09:00')).claimable.length, 0);
    assert.equal(normalizeSpecialForce(specialForceShop(), new Date('2026-09-30T23:59:59+09:00')).notStarted, true);
    const changed = specialForceShop();
    changed.date_info.attend_end_dt = '2026-10-20T23:59:59';
    changed.accumulated_plays.rewards.pop();
    assert.equal(normalizeSpecialForce(changed, now).periodDays, 20);
    assert.equal(normalizeSpecialForce(changed, now).rewardCount, 6);
});

test('malformed or duplicated rewards fail closed, and ended/sold-out events never claim', () => {
    for (const change of [v => { v.accumulated_plays.total_play_days = '1'; },
        v => { v.accumulated_plays.rewards[0].eligible = 'true'; },
        v => { v.accumulated_plays.rewards.push(v.accumulated_plays.rewards[0]); }]) {
        const value = specialForceShop(); change(value);
        assert.throws(() => normalizeSpecialForce(value, now));
    }
    const value = specialForceShop();
    value.event_ended = true;
    assert.equal(normalizeSpecialForce(value, now).claimable.length, 0);
    value.event_ended = false; value.accumulated_plays.rewards[0].sold_out = true;
    assert.equal(normalizeSpecialForce(value, now).claimable.length, 0);
});

test('dashboard renders seven states and HTML as text; unavailable/error data is explicit', t => {
    const dom = new JSDOM('<div id="stove-special-force-data"></div><button id="stove-btn-special-force-claim"></button>');
    const original = globalThis.document;
    globalThis.document = dom.window.document;
    t.after(() => { globalThis.document = original; dom.window.close(); });
    const value = specialForceShop();
    value.accumulated_plays.rewards[0].item_name = '&lt;img src=x onerror=alert(1)&gt; &amp; SP';
    renderSpecialForce(normalizeSpecialForce(value, now));
    assert.match(document.body.textContent, /14일 행사/);
    assert.match(document.body.textContent, /보상 0\/7개/);
    assert.match(document.body.textContent, /7일차/);
    assert.equal(document.querySelector('img'), null);
    assert.equal(document.querySelector('button').disabled, false);
    renderSpecialForce({ success: false, error: '확인 불가' });
    assert.match(document.body.textContent, /확인 실패/);
    assert.equal(document.querySelector('button').disabled, true);
});

test('claim rereads eligibility, verifies receipt and becomes idempotent on repeat', async t => {
    const original = globalThis.document;
    globalThis.document = { getElementById: () => null };
    t.after(() => { globalThis.document = original; });
    const value = specialForceShop();
    let posts = 0;
    const deps = { now, getHeaders: () => headers, getShop: async () => structuredClone(value), claim: async (_headers, reward) => {
        posts++;
        value.accumulated_plays.rewards.find(r => r.item_no === reward.item_no).is_received = true;
        return { flake_amount: 1000 };
    } };
    state.earnings.specialForce = 0;
    const result = await collectSpecialForceRewards(headers, deps);
    assert.equal(result.success, true);
    assert.deepEqual(result.claimed, [25]);
    assert.equal(result.after.receivedCount, 1);
    assert.equal(state.earnings.specialForce, 1000);
    assert.equal((await collectSpecialForceRewards(headers, deps)).success, true);
    assert.equal(posts, 1);
});

test('account switch or uncertain POST prevents retries and successful completion', async t => {
    const original = globalThis.document;
    globalThis.document = { getElementById: () => null };
    t.after(() => { globalThis.document = original; });
    let session = headers, posts = 0;
    const deps = { now, getHeaders: () => session, getShop: async () => {
        session = { Authorization: 'Bearer changed' }; return specialForceShop();
    }, claim: async () => { posts++; } };
    assert.equal((await collectSpecialForceRewards(headers, deps)).success, false);
    assert.equal(posts, 0);
    session = headers;
    const failed = await collectSpecialForceRewards(headers, { ...deps, getShop: async () => specialForceShop(),
        claim: async () => { posts++; throw new Error('timeout'); } });
    assert.equal(failed.success, false);
    assert.equal(posts, 1);
    const pending = await collectSpecialForceRewards(headers, { ...deps, getShop: async () => specialForceShop(),
        claim: async () => ({ flake_amount: 1000 }) });
    assert.equal(pending.success, false);
    assert.match(pending.error, /반영 확인 대기/);
});
