import test from 'node:test';
import assert from 'node:assert/strict';

import { installHarness, useHarness, httpError, rawText, networkError, timeoutError, DEFAULT_NOW, TEST_HEADERS }
    from './helpers/gmHarness.js';
import { apiRequest } from '../src/api/request.js';
import { CONFIG } from '../src/config.js';
import { state } from '../src/state.js';
import { delay, getKSTDate } from '../src/utils/time.js';
import { log } from '../src/ui/logger.js';
import { openTabInBackground, closeTab } from '../src/utils/tabs.js';
import { extractHeaders } from '../src/utils/auth.js';
import { setAutomationSignal, AUTOMATION_SIGNAL } from '../src/utils/automationSignal.js';

test('routes answer in order, sequences repeat their last entry, and every request is traced', async t => {
    const h = useHarness(t);
    h.on('GET', 'https://api.onstove.com/a', [{ n: 1 }, { n: 2 }])
        .on('POST', /\/b$/, (request, callIndex) => ({ echo: request.body, callIndex }));

    assert.deepEqual(await apiRequest('https://api.onstove.com/a', 'GET', { x: '1' }), { n: 1 });
    assert.deepEqual(await apiRequest('https://api.onstove.com/a', 'GET', {}), { n: 2 });
    assert.deepEqual(await apiRequest('https://api.onstove.com/a', 'GET', {}), { n: 2 });
    assert.deepEqual(await apiRequest('https://api.onstove.com/b', 'POST', {}, { k: 1 }), { echo: { k: 1 }, callIndex: 0 });

    assert.deepEqual(h.calls(), [
        'GET https://api.onstove.com/a',
        'GET https://api.onstove.com/a',
        'GET https://api.onstove.com/a',
        'POST https://api.onstove.com/b {"k":1}'
    ]);
    assert.deepEqual(h.requests[0].headers, { x: '1' });
});

test('failure responses reach apiRequest the same way Tampermonkey reports them', async t => {
    const h = useHarness(t);
    h.on('GET', 'https://x/500', httpError(500))
        .on('GET', 'https://x/text', rawText('not json'))
        .on('GET', 'https://x/net', networkError())
        .on('GET', 'https://x/timeout', timeoutError());

    await assert.rejects(apiRequest('https://x/500', 'GET', {}), /API Error: 500/);
    assert.deepEqual(await apiRequest('https://x/text', 'GET', {}), { success: true });
    await assert.rejects(apiRequest('https://x/net', 'GET', {}), /Network error/);
    await assert.rejects(apiRequest('https://x/timeout', 'GET', {}), /timed out/);
});

test('unmatched requests are recorded even when the caller swallows the rejection', async () => {
    const h = installHarness();
    try {
        await apiRequest('https://api.onstove.com/unknown', 'GET', {}).catch(() => null);
        assert.equal(h.unmatched.length, 1);
        assert.throws(() => h.assertAllRequestsMatched(), /every request must hit a fixture route/);
    } finally {
        h.uninstall();
    }
});

test('delays are recorded and resolve immediately; time and randomness are fixed', async t => {
    const h = useHarness(t, { random: 0.25 });
    const started = performance.now();
    await delay(11000);
    await delay(200);
    assert.ok(performance.now() - started < 1000);
    assert.deepEqual(h.delays, [11000, 200]);
    assert.equal(Date.now(), DEFAULT_NOW);
    assert.equal(getKSTDate(), '2026-10-16');
    assert.equal(Math.random(), 0.25);
});

test('panel logs, tabs, title signals, cookies and storage are observable', async t => {
    const h = useHarness(t);
    log('시작', 'info');
    log('완료', 'success');
    log('주의', 'warning');
    log('실패', 'error');
    const tab = openTabInBackground('https://example.com/a', false);
    openTabInBackground('https://example.com/b', true);
    closeTab([tab]);
    setAutomationSignal(AUTOMATION_SIGNAL.running, '실행 중');
    sessionStorage.setItem('k', 'v');

    assert.deepEqual(h.logs(), ['[info] 시작', '[success] 완료', '[warning] 주의', '[error] 실패']);
    assert.deepEqual(h.tabs, [
        { url: 'https://example.com/a', active: false, closed: true },
        { url: 'https://example.com/b', active: true, closed: false }
    ]);
    assert.deepEqual(h.titles, ['[SG_RUNNING] 실행 중 | STOVE']);
    assert.deepEqual(extractHeaders(), TEST_HEADERS);
    assert.deepEqual(h.snapshot().sessionStorage, { k: 'v' });
});

test('uninstall restores globals, state and CONFIG in place', () => {
    const missionComponents = state.missionComponents;
    const roulette = CONFIG.roulette;
    const h = installHarness();
    state.earnings.roulette = 999;
    state.extra = true;
    state.missionComponents.daily = 7;
    CONFIG.roulette.enabled = false;
    CONFIG.dailyMissions.skipMissions.push(1);
    h.uninstall();

    assert.equal(typeof globalThis.GM_xmlhttpRequest, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(state.earnings.roulette, 0);
    assert.equal('extra' in state, false);
    assert.equal(state.missionComponents, missionComponents);
    assert.equal(state.missionComponents.daily, null);
    assert.equal(CONFIG.roulette, roulette);
    assert.equal(CONFIG.roulette.enabled, true);
    assert.deepEqual(CONFIG.dailyMissions.skipMissions, []);
});
