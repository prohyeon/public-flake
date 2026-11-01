import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizePlayEvent, collectPlayEventRewards } from '../../src/workflows/playEvent.js';
import { renderPlayEvent } from '../../src/ui/playEvent.js';
import { playEventShop } from '../helpers/playEventFixture.js';

const now = new Date('2026-11-02T12:00:00+09:00');
const headers = { Authorization: 'Bearer test-only', 'X-UUID': 'test-device' };

function withDom(t) {
    const dom = new JSDOM('<section class="stove-card stove-pe-section">' +
        '<div id="stove-play-event-data"></div><button id="stove-btn-play-event-claim"></button></section>');
    const original = globalThis.document;
    globalThis.document = dom.window.document;
    t.after(() => { globalThis.document = original; dom.window.close(); });
    return dom.window.document;
}

function allReceived() {
    const value = playEventShop();
    value.accumulated_plays.rewards.forEach(reward => { reward.is_received = true; });
    return value;
}

test('finished means every reward is received; reaching day 10 with a reward still unclaimed is not finished', () => {
    assert.equal(normalizePlayEvent(allReceived(), now).finished, true);
    const reachedTenUnclaimed = playEventShop();
    reachedTenUnclaimed.accumulated_plays.total_play_days = 10;
    reachedTenUnclaimed.accumulated_plays.rewards.forEach(reward => { reward.is_received = false; });
    assert.equal(normalizePlayEvent(reachedTenUnclaimed, now).finished, false);
});

test('an event past its end date or flagged as ended counts as finished', () => {
    assert.equal(normalizePlayEvent(playEventShop(), new Date('2026-11-16T00:00:00+09:00')).finished, true);
    const flagged = playEventShop();
    flagged.event_ended = true;
    assert.equal(normalizePlayEvent(flagged, now).finished, true);
    assert.equal(normalizePlayEvent(playEventShop(), now).finished, false);
});

test('a finished or unavailable event skips the claim and never calls the claim API', async t => {
    withDom(t);
    let claims = 0;
    const deps = (getShop) => ({
        getShop, now, getHeaders: () => headers,
        claim: async () => { claims += 1; return { flake_amount: 1 }; },
    });
    const finished = await collectPlayEventRewards(headers, deps(async () => allReceived()));
    assert.equal(finished.success, true);
    assert.equal(finished.skipped, true);
    assert.deepEqual(finished.claimed, []);

    const unavailable = await collectPlayEventRewards(headers, deps(async () => ({ notAvailable: true })));
    assert.equal(unavailable.success, true);
    assert.equal(unavailable.skipped, true);
    assert.equal(claims, 0);
});

test('the play-event section is hidden when finished or unavailable and shown again for a running event', t => {
    const doc = withDom(t);
    const section = doc.querySelector('.stove-pe-section');
    renderPlayEvent(normalizePlayEvent(allReceived(), now));
    assert.equal(section.style.display, 'none');
    renderPlayEvent({ success: true, notAvailable: true });
    assert.equal(section.style.display, 'none');
    renderPlayEvent(normalizePlayEvent(playEventShop(), now));
    assert.equal(section.style.display, '');
});
