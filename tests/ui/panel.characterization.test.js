// Characterization of src/main.js (createUI / initializeUI / init) through the distributed bundle.
// main.js runs init() on import, so it is only reachable by evaluating the userscript in jsdom.
// Locks: full panel markup, button id -> action wiring (first HTTP request / tab), maintenance mode,
// the log-copy button, the deferred DOMContentLoaded mount, and the 500ms initial status check.
// Console output is deliberately NOT asserted (refactor D moves it behind a debug flag).
//
// Maintenance mode cannot be reached by patching the distributed bundle: Rollup constant-folds
// CONFIG.maintenanceMode.enabled === false, so isMaintenanceMode() and the whole maintenance branch of
// initializeUI are absent from it. The maintenance scenarios therefore use a variant bundle built from
// src (vite.config.js + a transform that flips enabled to true) into a temp dir, i.e. exactly what a
// release with maintenance mode switched on would ship. Everything else runs against BUNDLE_PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'vite';

import { readUserscriptBundle } from '../helpers/bundle.js';
import { assertGolden } from '../helpers/golden.js';

const userscript = readUserscriptBundle();
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let maintenanceBundlePromise;

async function buildMaintenanceBundle() {
    // The project config's own outDir is the repo root (the committed bundle). Spread it explicitly with
    // configFile: false so the temp outDir cannot be lost in a config merge; never use emptyOutDir.
    const { default: projectConfig } = await import(pathToFileURL(join(ROOT, 'vite.config.js')).href);
    const outDir = mkdtempSync(join(tmpdir(), 'stove-maintenance-bundle-'));
    try {
        await build({
            ...projectConfig,
            configFile: false,
            root: ROOT,
            logLevel: 'silent',
            build: { ...projectConfig.build, outDir, emptyOutDir: false },
            plugins: [...projectConfig.plugins, {
                name: 'characterization-maintenance-mode',
                enforce: 'pre',
                transform(code, id) {
                    if (!id.replace(/\\/g, '/').endsWith('/src/config.js')) return null;
                    const patched = code.replace(/(maintenanceMode:\s*\{\s*enabled:\s*)false/, '$1true');
                    if (patched === code) throw new Error('maintenanceMode.enabled: false not found in src/config.js');
                    return { code: patched, map: null };
                }
            }]
        });
        return readFileSync(join(outDir, 'stove-quest-automation.user.js'), 'utf8');
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
}

// Built lazily (once) so that only the maintenance tests depend on the variant build succeeding.
async function getMaintenanceBundle() {
    maintenanceBundlePromise ??= buildMaintenanceBundle();
    const source = await maintenanceBundlePromise;
    assert.match(source, /점검 모드 활성화/, 'the variant bundle keeps the maintenance branch');
    return source;
}

const MY_HOME = `<!doctype html><html><head><title>MY홈</title></head><body>
<div id="__nuxt"><div data-slot="App"><header data-slot="Header">Header</header>
<div data-slot="Body"><div style="display:flex"><aside>Navigation</aside><div data-slot="Contents">MY홈 contents</div></div></div>
</div></div></body></html>`;

const BUTTON_IDS = [
    'stove-btn-start',
    'stove-btn-point-cash-charge',
    'stove-btn-reward-shop',
    'stove-btn-status-refresh',
    'stove-btn-copy-log'
];
const MAINTENANCE_DISABLED_IDS = BUTTON_IDS.filter(id => id !== 'stove-btn-copy-log');

function bundleConfigValue(source, key) {
    const match = source.match(new RegExp(`const CONFIG = \\{[\\s\\S]*?\\b${key}:\\s*["']([^"']+)["']`));
    assert.ok(match, `bundle CONFIG.${key} is present`);
    return match[1];
}

function patchOnce(source, pattern, replacement) {
    const patched = source.replace(pattern, replacement);
    assert.notEqual(patched, source, `bundle patch ${pattern} applied`);
    return patched;
}

// Lets queued promise callbacks settle. setTimeout is captured below, so use the outer setImmediate.
async function settle(rounds = 6) {
    for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve));
}

/**
 * Evaluates the bundle in a fresh MY홈 window (module state such as state.isRunning or the special
 * force busy flag lives inside the bundle, so every scenario gets its own window).
 * - GM_xmlhttpRequest records requests; `respond(request)` may return a body (answered as HTTP 200),
 *   otherwise the request stays pending forever, freezing the workflow right after it.
 * - setTimeout callbacks are captured, never run automatically; `runTimers(ms)` runs them.
 */
function mountBundle(t, { source = userscript, readyState = 'complete', respond = () => undefined, clipboard, now } = {}) {
    const dom = new JSDOM(MY_HOME, { runScripts: 'outside-only', url: 'https://profile.onstove.com/' });
    t.after(() => dom.window.close());
    const { window } = dom;
    const { document } = window;
    if (now !== undefined) {
        const RealDate = window.Date;
        window.Date = class FixedDate extends RealDate {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return now; }
        };
    }

    const requests = [];
    const tabs = [];
    const timers = [];
    const alerts = [];
    const clipboardWrites = [];

    window.GM_xmlhttpRequest = config => {
        const request = {
            method: config.method,
            url: config.url,
            headers: { ...(config.headers || {}) },
            body: config.data == null ? null : JSON.parse(config.data),
            anonymous: config.anonymous
        };
        if (config.timeout !== undefined) request.timeout = config.timeout;
        requests.push(request);
        const body = respond(request);
        if (body !== undefined) {
            Promise.resolve().then(() => config.onload({ status: 200, statusText: 'OK', responseText: JSON.stringify(body) }));
        }
    };
    window.GM_openInTab = (url, options) => {
        tabs.push({ url, options: { ...options } });
        return { close() {} };
    };
    window.setTimeout = (callback, ms, ...args) => {
        timers.push({ ms, callback: () => callback(...args) });
        return timers.length;
    };
    window.clearTimeout = () => {};
    window.scrollTo = () => {};
    window.alert = message => alerts.push(String(message));
    window.console = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(method => [method, () => {}]));
    Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: clipboard || (async text => { clipboardWrites.push(text); })
        }
    });
    document.cookie = 'SUAT=test-suat; path=/';
    document.cookie = 'sgs_da_uuid=test-uuid; path=/';
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => readyState });

    window.eval(source);

    const byId = id => document.getElementById(id);
    return {
        window,
        document,
        requests,
        tabs,
        timers,
        alerts,
        clipboardWrites,
        byId,
        get panel() { return byId('stove-quest-automation'); },
        logs: () => [...document.querySelectorAll('#stove-log-content > div')].map(entry => entry.textContent),
        timerDelays: ms => timers.filter(timer => timer.ms === ms),
        runTimers(ms) {
            const due = timers.filter(timer => timer.ms === ms && !timer.ran);
            for (const timer of due) {
                timer.ran = true;
                timer.callback();
            }
            return due.length;
        },
        disabledStates: () => Object.fromEntries(BUTTON_IDS.map(id => [id, Boolean(byId(id)?.disabled)]))
    };
}

const describeRequest = request => `${request.method} ${request.url}`;

const MISSION_PAGE = 'https://api.onstove.com/flake-shop/v1/page?page_type=MISSION';
const BILL_BALANCE = 'https://api.onstove.com/mileage/v1.0/balance?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY';

test('mount: the full panel markup (template, <style>, initializeUI effects) matches the golden', t => {
    const m = mountBundle(t);
    const { panel } = m;
    assert.ok(panel, 'the bundle creates the panel');
    assert.equal(panel.dataset.stoveMount, 'myhome');
    assert.equal(panel.parentElement, m.document.querySelector('#__nuxt > [data-slot="App"]'));
    assert.equal(panel.nextElementSibling, m.document.querySelector('#__nuxt [data-slot="Body"]'));

    const version = bundleConfigValue(userscript, 'version');
    const lastUpdated = bundleConfigValue(userscript, 'lastUpdated');
    const html = panel.outerHTML;
    const versionMarkup = `<span class="stove-panel-version">v${version} · ${lastUpdated}</span>`;
    assert.equal(html.split(versionMarkup).length, 2, 'version and date are rendered once from CONFIG');
    // Release bumps must not invalidate the markup golden, so the two release values are placeholders.
    const normalized = html
        .replace(versionMarkup, '<span class="stove-panel-version">v{CONFIG.version} · {CONFIG.lastUpdated}</span>');

    assert.equal(panel.querySelectorAll('style').length, 1);
    assert.ok(panel.firstElementChild.tagName === 'STYLE', 'the <style> block is the first child');
    assertGolden('panel/mounted-panel', { outerHTMLLines: normalized.split('\n') });

    assert.deepEqual([...panel.querySelectorAll('[id]')].map(element => element.id), [
        'stove-maintenance-notice',
        'stove-btn-start',
        'stove-btn-point-cash-charge',
        'stove-btn-point-cash-charge-status',
        'stove-btn-reward-shop',
        'stove-btn-status-refresh',
        'stove-status-mission-daily',
        'stove-status-mission-weekly',
        'stove-status-mission-content',
        'stove-status-mission-attendance',
        'stove-status-survey',
        'stove-status-roulette',
        'stove-status-daily',
        'stove-status-majak',
        'stove-status-total-flake',
        'stove-status-monthly-flake',
        'stove-toggle-timing',
        'stove-btn-copy-log',
        'stove-log-content'
    ]);
    assert.deepEqual([...panel.querySelectorAll('button')].map(button => button.id), [
        'stove-btn-start',
        'stove-btn-point-cash-charge',
        'stove-btn-reward-shop',
        'stove-btn-status-refresh',
        'stove-btn-copy-log'
    ]);
});

test('mount: initializeUI leaves the normal-mode panel ready, without requests until the 500ms status check', t => {
    const m = mountBundle(t);

    assert.deepEqual(m.logs(), ['자동화 패널이 준비되었습니다']);
    assert.equal(m.byId('stove-maintenance-notice').style.display, 'none');
    assert.deepEqual(m.disabledStates(), {
        'stove-btn-start': false,
        'stove-btn-point-cash-charge': true,
        'stove-btn-reward-shop': false,
        'stove-btn-status-refresh': false,
        'stove-btn-copy-log': false
    });
    // updatePointCashChargeButtonAvailability(null) runs once during initialization. Number(null) === 0, so the
    // "unknown balance" call renders as a known balance of 0 and replaces the template's "플레이크 확인 중".
    const charge = m.byId('stove-btn-point-cash-charge');
    assert.equal(charge.title, '192,500 플레이크 필요 (현재 0)');
    assert.equal(charge.style.opacity, '0.45');
    assert.equal(m.byId('stove-btn-point-cash-charge-status').textContent, '192,500 플레이크 부족');
    assert.equal(m.byId('stove-btn-copy-log').textContent, '복사');

    assert.deepEqual(m.requests, []);
    assert.deepEqual(m.tabs, []);
    assert.deepEqual(m.alerts, []);
    assert.equal(m.document.title, 'MY홈');
    assert.equal(m.timerDelays(500).length, 1, 'exactly one 500ms timer: the initial checkAllStatus');
});

test('mount: the 500ms timer runs checkAllStatus (mission components first)', async t => {
    const m = mountBundle(t);
    assert.equal(m.runTimers(500), 1);
    await settle();

    assert.deepEqual(m.requests.map(describeRequest), [`GET ${MISSION_PAGE}`]);
    assert.equal(m.byId('stove-status-roulette').textContent, '확인 중...', 'status rows switch to loading');
    assert.deepEqual(m.alerts, []);

    // The status refresh button triggers the very same request sequence.
    const refresh = mountBundle(t);
    refresh.byId('stove-btn-status-refresh').click();
    await settle();
    assert.deepEqual(refresh.requests, m.requests);
});

// Button id -> action. Each button is clicked in its own window; requests never get a response, so the
// recording is exactly what the action issues before it first waits on the network.
// Fixed clock: some first requests carry a timestamp query.
const BUTTON_NOW = Date.parse('2026-10-16T01:00:00Z');

const BUTTON_ACTIONS = {
    // Full automation reads the profile alongside the before-snapshot.
    'stove-btn-start': {
        action: 'runAutomation',
        requests: [
            `GET ${MISSION_PAGE}`,
            `GET https://api.onstove.com/postie/v1.0/user/me?timestemp=${BUTTON_NOW}`
        ],
        tabs: []
    },
    'stove-btn-point-cash-charge': { action: 'runPointExchange', requests: [`GET ${BILL_BALANCE}`], tabs: [] },
    'stove-btn-reward-shop': { action: 'openRewardShop', requests: [], tabs: ['https://reward.onstove.com/ko'] },
    'stove-btn-status-refresh': { action: 'checkAllStatus', requests: [`GET ${MISSION_PAGE}`], tabs: [] }
};

test('button wiring: every action button triggers its own workflow (first requests / tabs golden)', async t => {
    const recordings = {};
    for (const [id, expected] of Object.entries(BUTTON_ACTIONS)) {
        await t.test(`${id} -> ${expected.action}`, async st => {
            const m = mountBundle(st, { now: BUTTON_NOW });
            const logCount = m.logs().length;
            const button = m.byId(id);
            // The cash-charge button starts disabled (no flake balance yet),
            // and jsdom, like browsers, ignores click() on disabled buttons. Enable them to reach the listener.
            button.disabled = false;
            button.click();
            await settle();

            assert.deepEqual(m.requests.map(describeRequest), expected.requests);
            assert.deepEqual(m.tabs.map(tab => tab.url), expected.tabs);
            assert.deepEqual(m.alerts, []);
            recordings[id] = {
                action: expected.action,
                requests: m.requests,
                tabs: m.tabs,
                title: m.document.title,
                newLogs: m.logs().slice(logCount),
                disabledAfterClick: m.disabledStates()
            };
        });
    }
    assertGolden('panel/button-actions', recordings);

    // Distinguishing details, stated explicitly.
    assert.equal(recordings['stove-btn-start'].title, '[SG_RUNNING] 전체 자동화 실행 중 | MY홈');
    assert.equal(recordings['stove-btn-point-cash-charge'].title, 'MY홈');
    assert.deepEqual(recordings['stove-btn-reward-shop'].tabs, [{ url: 'https://reward.onstove.com/ko', options: { active: true, insert: true } }]);
    assert.deepEqual(recordings['stove-btn-reward-shop'].newLogs, ['리워드샵 페이지를 새 탭에서 엽니다...', '리워드샵 탭이 열렸습니다!']);
    assert.deepEqual(recordings['stove-btn-point-cash-charge'].requests[0].headers, {
        Authorization: 'Bearer test-suat',
        'caller-id': 'billuser',
        Accept: 'application/json',
        'Content-Type': 'application/json'
    });
});

test('button wiring: buttons that start disabled ignore clicks', async t => {
    const m = mountBundle(t);
    m.byId('stove-btn-point-cash-charge').click();
    await settle();
    assert.deepEqual(m.requests, []);
    assert.deepEqual(m.logs(), ['자동화 패널이 준비되었습니다']);
});

test('copy-log button: copies the log text, shows and restores the icon after 1000ms', async t => {
    const m = mountBundle(t);
    m.byId('stove-btn-reward-shop').click();
    const button = m.byId('stove-btn-copy-log');
    button.click();
    await settle();

    // jsdom has no innerText, so the textContent fallback (entries concatenated without newlines) is copied.
    assert.deepEqual(m.clipboardWrites, [m.byId('stove-log-content').textContent]);
    assert.equal(m.clipboardWrites[0],
        '자동화 패널이 준비되었습니다리워드샵 페이지를 새 탭에서 엽니다...리워드샵 탭이 열렸습니다!');
    assert.equal(button.textContent, '복사됨');
    assert.equal(m.timerDelays(1000).length, 1);
    assert.equal(m.runTimers(1000), 1);
    assert.equal(button.textContent, '복사');
    assert.deepEqual(m.requests, [], 'copying the log makes no request');
    assert.equal(m.logs().length, 3, 'copying does not log');
});

test('copy-log button: a clipboard failure leaves the icon unchanged and schedules nothing', async t => {
    const m = mountBundle(t, { clipboard: async () => { throw new Error('denied'); } });
    const button = m.byId('stove-btn-copy-log');
    button.click();
    await settle();
    assert.equal(button.textContent, '복사');
    assert.equal(m.timerDelays(1000).length, 0);
    assert.deepEqual(m.logs(), ['자동화 패널이 준비되었습니다']);
});

test('copy-log button: missing log content skips the copy; a button removed mid-copy is tolerated', async t => {
    const noLog = mountBundle(t);
    noLog.byId('stove-log-content').remove();
    noLog.byId('stove-btn-copy-log').click();
    await settle();
    assert.deepEqual(noLog.clipboardWrites, []);

    const writes = [];
    let removedButton;
    const gone = mountBundle(t, {
        clipboard: async text => {
            writes.push(text);
            removedButton = gone.byId('stove-btn-copy-log');
            removedButton.remove();
        }
    });
    gone.byId('stove-btn-copy-log').click();
    await settle();
    assert.equal(writes.length, 1);
    assert.equal(removedButton.textContent, '복사', 'the detached button is not touched');
    assert.equal(gone.timerDelays(1000).length, 0);
});

test('maintenance mode: notice shown, six buttons disabled and inert, warning logged; copy-log still works', async t => {
    const maintenanceBundle = await getMaintenanceBundle();
    const m = mountBundle(t, { source: maintenanceBundle });
    const { panel } = m;

    const version = bundleConfigValue(maintenanceBundle, 'version');
    const lastUpdated = bundleConfigValue(maintenanceBundle, 'lastUpdated');
    const normalized = panel.outerHTML
        .replace(`<div>v${version}</div>`, '<div>v{CONFIG.version}</div>')
        .replace(`<div>Updated: ${lastUpdated}</div>`, '<div>Updated: {CONFIG.lastUpdated}</div>');
    assertGolden('panel/maintenance-panel', { outerHTMLLines: normalized.split('\n') });

    assert.equal(m.byId('stove-maintenance-notice').style.display, 'block');
    assert.equal(m.byId('stove-maintenance-notice').textContent.replace(/\s+/g, ' ').trim(),
        '점검 중 11월 플레이크 구조 확인중입니다, 업데이트 이후 사용할 수 있습니다');
    assert.deepEqual(m.logs(), ['점검 모드 활성화: 모든 기능이 비활성화되었습니다']);
    for (const id of MAINTENANCE_DISABLED_IDS) assert.equal(m.byId(id).disabled, true, `${id} is disabled`);
    assert.equal(m.byId('stove-btn-copy-log').disabled, false);
    // updatePointCashChargeButtonAvailability is not called: the template's title/status are untouched.
    assert.equal(m.byId('stove-btn-point-cash-charge').title, '192,500 플레이크 이상일 때 충전 가능');
    assert.equal(m.byId('stove-btn-point-cash-charge').getAttribute('style'), null);

    // No listeners are attached: even re-enabled buttons do nothing.
    for (const id of MAINTENANCE_DISABLED_IDS) {
        m.byId(id).disabled = false;
        m.byId(id).click();
    }
    await settle();
    assert.deepEqual(m.requests, []);
    assert.deepEqual(m.tabs, []);
    assert.equal(m.document.title, 'MY홈');
    assert.deepEqual(m.logs(), ['점검 모드 활성화: 모든 기능이 비활성화되었습니다']);

    m.byId('stove-btn-copy-log').click();
    await settle();
    assert.deepEqual(m.clipboardWrites, ['점검 모드 활성화: 모든 기능이 비활성화되었습니다']);
    assert.equal(m.byId('stove-btn-copy-log').textContent, '복사됨');
});

test('maintenance mode: the 500ms status check is still scheduled and still calls the API', async t => {
    const maintenanceBundle = await getMaintenanceBundle();
    const m = mountBundle(t, { source: maintenanceBundle });

    assert.equal(m.timerDelays(500).length, 1, 'checkAllStatus is scheduled even in maintenance mode');
    m.runTimers(500);
    await settle();
    assert.deepEqual(m.requests.map(describeRequest), [`GET ${MISSION_PAGE}`]);
});

test('maintenance mode: before CONFIG.maintenanceMode.startDate (2025-11-01) the normal panel is kept', async t => {
    const maintenanceBundle = await getMaintenanceBundle();
    // Far from the date boundary on purpose: the exact boundary depends on the machine timezone
    // (see the isMaintenanceMode tests in tests/utils/utils.characterization.test.js).
    const before = mountBundle(t, { source: maintenanceBundle, now: Date.parse('2025-10-01T03:00:00Z') });
    assert.equal(before.byId('stove-maintenance-notice').style.display, 'none');
    assert.deepEqual(before.logs(), ['자동화 패널이 준비되었습니다']);
    before.byId('stove-btn-reward-shop').click();
    assert.deepEqual(before.tabs.map(tab => tab.url), ['https://reward.onstove.com/ko']);

    const after = mountBundle(t, { source: maintenanceBundle, now: Date.parse('2025-11-02T03:00:00Z') });
    assert.equal(after.byId('stove-maintenance-notice').style.display, 'block');
    assert.deepEqual(after.logs(), ['점검 모드 활성화: 모든 기능이 비활성화되었습니다']);
});

test('init: while the document is loading, mounting waits for a single DOMContentLoaded', t => {
    const m = mountBundle(t, { readyState: 'loading' });
    assert.equal(m.panel, null, 'nothing is mounted before DOMContentLoaded');
    assert.equal(m.timerDelays(500).length, 0);

    m.document.dispatchEvent(new m.window.Event('DOMContentLoaded'));
    assert.ok(m.panel);
    assert.equal(m.panel.dataset.stoveMount, 'myhome');
    assert.deepEqual(m.logs(), ['자동화 패널이 준비되었습니다']);
    assert.equal(m.timerDelays(500).length, 1);

    m.document.dispatchEvent(new m.window.Event('DOMContentLoaded'));
    assert.equal(m.document.querySelectorAll('#stove-quest-automation').length, 1);
    assert.equal(m.timerDelays(500).length, 1, 'the bootstrap listener runs once');
    assert.deepEqual(m.logs(), ['자동화 패널이 준비되었습니다']);
});

test('initializeUI: a missing button is skipped without breaking the other listeners', async t => {
    const source = patchOnce(userscript, 'id="stove-btn-reward-shop"', 'id="stove-btn-reward-shop-renamed"');
    assert.equal(userscript.split('id="stove-btn-reward-shop"').length, 2, 'the template holds the only id attribute');
    const m = mountBundle(t, { source });
    assert.deepEqual(m.logs(), ['자동화 패널이 준비되었습니다']);
    m.byId('stove-btn-reward-shop-renamed').click();
    m.byId('stove-btn-status-refresh').click();
    await settle();
    assert.deepEqual(m.tabs, []);
    assert.deepEqual(m.requests.map(describeRequest), [`GET ${MISSION_PAGE}`]);
    assert.equal(m.timerDelays(500).length, 1);
});

test('initializeUI: maintenance mode tolerates a missing notice element', async t => {
    const source = patchOnce(await getMaintenanceBundle(), 'id="stove-maintenance-notice"', 'id="stove-maintenance-notice-renamed"');
    const m = mountBundle(t, { source });
    assert.equal(m.byId('stove-maintenance-notice-renamed').style.display, 'none');
    for (const id of MAINTENANCE_DISABLED_IDS) assert.equal(m.byId(id).disabled, true);
    assert.deepEqual(m.logs(), ['점검 모드 활성화: 모든 기능이 비활성화되었습니다']);
});
