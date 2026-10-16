// Characterization harness: fakes the Tampermonkey/browser boundary so src modules can run
// unmodified while every observable side effect (HTTP, tabs, delays, logs, storage, title)
// is recorded. Behavior-preserving refactors must leave these recordings unchanged.
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';

export const DEFAULT_NOW = Date.parse('2026-10-16T01:00:00Z'); // 2026-10-16 10:00 KST
export const TEST_HEADERS = Object.freeze({
    'Authorization': 'Bearer test-suat',
    'caller-id': 'storee-lounge',
    'X-UUID': 'test-uuid',
    'x-lang': 'ko',
    'x-nation': 'KR',
    'x-device-type': 'P01',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://lounge.onstove.com',
    'Referer': 'https://lounge.onstove.com/'
});

const INITIAL_STATE = structuredClone(state);
const INITIAL_CONFIG = structuredClone(CONFIG);

// Restores in place so module-level references to nested objects stay valid.
function restoreInPlace(target, snapshot) {
    for (const key of Object.keys(target)) {
        if (!(key in snapshot)) delete target[key];
    }
    for (const [key, value] of Object.entries(snapshot)) {
        const current = target[key];
        if (Array.isArray(value)) {
            target[key] = structuredClone(value);
        } else if (value && typeof value === 'object' && current && typeof current === 'object' && !Array.isArray(current)) {
            restoreInPlace(current, value);
        } else {
            target[key] = structuredClone(value);
        }
    }
}

export function resetState() {
    restoreInPlace(state, INITIAL_STATE);
}

export function resetConfig() {
    restoreInPlace(CONFIG, INITIAL_CONFIG);
}

const RESPONSE = Symbol('gmResponse');

export function ok(body, status = 200) {
    return { [RESPONSE]: true, status, body };
}

export function httpError(status, body = { message: `HTTP ${status}` }) {
    return { [RESPONSE]: true, status, body };
}

export function rawText(text, status = 200) {
    return { [RESPONSE]: true, status, text };
}

export function networkError() {
    return { [RESPONSE]: true, failure: 'error' };
}

export function timeoutError() {
    return { [RESPONSE]: true, failure: 'timeout' };
}

function toResponse(value) {
    return value && value[RESPONSE] ? value : ok(value);
}

function matchesUrl(match, url, request) {
    if (typeof match === 'string') return match === url;
    if (match instanceof RegExp) return match.test(url);
    return Boolean(match(url, request));
}

// The script targets KST users and several modules read the local calendar. Pin the zone unless
// a test already chose one explicitly (Node applies runtime TZ changes).
const DEFAULT_TIME_ZONE = 'Asia/Seoul';

// jsdom schedules its own timers (e.g. storage event dispatch on setItem). Those are not app delays.
const JSDOM_FRAME = /[\\/]node_modules[\\/]jsdom[\\/]/;

const LOG_ICON_TYPES = new Map([['✓', 'success'], ['✗', 'error'], ['⏳', 'info'], ['⚠️', 'warning']]);

const DEFAULT_BODY = `
    <div id="stove-quest-automation">
        <div class="stove-progress-section">
            <div class="stove-progress-fill"></div>
            <div id="stove-progress-text"></div>
        </div>
        <div class="stove-log-section"><div id="stove-log-content"></div></div>
    </div>`;

/**
 * Installs fake globals and returns the recorder.
 *
 * Routes: h.on(method, match, response)
 *   - match: exact URL string, RegExp, or (url, request) => boolean
 *   - response: body object (200), ok()/httpError()/rawText()/networkError()/timeoutError(),
 *     an array (one entry per call, the last one repeats), or (request, callIndex) => response
 * Routes are checked in registration order; the first match wins.
 */
export function installHarness(options = {}) {
    const {
        now = DEFAULT_NOW,
        body = DEFAULT_BODY,
        url = 'https://profile.onstove.com/',
        cookies = { SUAT: 'test-suat', sgs_da_uuid: 'test-uuid' },
        random = 0.5,
        silenceConsole = true
    } = options;

    const pinnedTimeZone = process.env.TZ ? null : DEFAULT_TIME_ZONE;
    if (pinnedTimeZone) process.env.TZ = pinnedTimeZone;

    const dom = new JSDOM(`<!doctype html><html><head><title>STOVE</title></head><body>${body}</body></html>`, { url });
    const { window } = dom;
    const { document } = window;
    for (const [name, value] of Object.entries(cookies)) {
        document.cookie = `${name}=${value}; path=/`;
    }

    const routes = [];
    const requests = [];
    const unmatched = [];
    const tabs = [];
    const delays = [];
    const titles = [];
    const sounds = [];
    const alerts = [];
    const consoleCalls = [];

    const titleDescriptor = Object.getOwnPropertyDescriptor(window.Document.prototype, 'title');
    Object.defineProperty(document, 'title', {
        configurable: true,
        get() { return titleDescriptor.get.call(this); },
        set(value) {
            titles.push(String(value));
            titleDescriptor.set.call(this, value);
        }
    });

    window.scrollTo = () => {};
    window.AudioContext = function FakeAudioContext() {
        sounds.push('completion');
        const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
        return {
            currentTime: 0,
            destination: {},
            createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: param, type: 'sine' }),
            createGain: () => ({ connect() {}, gain: param })
        };
    };

    function openTab(tabUrl, tabOptions, via = 'GM_openInTab') {
        const entry = {
            url: tabUrl,
            active: Boolean(tabOptions?.active),
            via,
            options: tabOptions === undefined ? null : structuredClone(tabOptions),
            closed: false
        };
        tabs.push(entry);
        return { close() { entry.closed = true; } };
    }
    window.open = (tabUrl, target) => openTab(tabUrl, { active: true, target: target ?? null }, 'window.open');
    window.alert = message => { alerts.push(String(message)); };

    const nativeSetTimeout = globalThis.setTimeout;
    const nativeSetImmediate = globalThis.setImmediate;

    function respond(config, response) {
        nativeSetImmediate(() => {
            if (response.failure === 'timeout') return config.ontimeout?.();
            if (response.failure === 'error') return config.onerror?.({ error: 'network' });
            const responseText = response.text !== undefined
                ? response.text
                : JSON.stringify(response.body ?? {});
            config.onload?.({
                status: response.status,
                statusText: response.status >= 200 && response.status < 300 ? 'OK' : 'Error',
                responseText
            });
        });
    }

    function gmXmlHttpRequest(config) {
        const request = {
            method: config.method,
            url: config.url,
            headers: { ...(config.headers || {}) },
            body: config.data ? JSON.parse(config.data) : null
        };
        if (config.timeout !== undefined) request.timeout = config.timeout;
        requests.push(request);

        const route = routes.find(candidate =>
            candidate.method === config.method && matchesUrl(candidate.match, config.url, request));
        if (!route) {
            unmatched.push(request);
            respond(config, httpError(599, { message: 'unmatched request in test harness' }));
            return;
        }

        const callIndex = route.calls++;
        let response = route.response;
        if (Array.isArray(response)) response = response[Math.min(callIndex, response.length - 1)];
        if (typeof response === 'function') response = response(request, callIndex);
        respond(config, toResponse(response));
    }

    const saved = new Map();
    function setGlobal(name, value) {
        if (!saved.has(name)) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }

    setGlobal('window', window);
    setGlobal('document', document);
    setGlobal('localStorage', window.localStorage);
    setGlobal('sessionStorage', window.sessionStorage);
    setGlobal('GM_xmlhttpRequest', gmXmlHttpRequest);
    setGlobal('GM_openInTab', (tabUrl, tabOptions) => openTab(tabUrl, tabOptions));
    setGlobal('alert', window.alert);
    setGlobal('setTimeout', (callback, ms, ...args) => {
        if (JSDOM_FRAME.test(new Error().stack)) return nativeSetTimeout(callback, ms, ...args);
        delays.push(ms);
        return nativeSetTimeout(callback, 0, ...args);
    });
    if (silenceConsole) {
        const fakeConsole = Object.create(console);
        for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
            fakeConsole[method] = (...args) => consoleCalls.push({ method, args });
        }
        setGlobal('console', fakeConsole);
    }

    const originalRandom = Math.random;
    Math.random = typeof random === 'function' ? random : () => random;
    mock.timers.enable({ apis: ['Date'], now });

    resetState();
    resetConfig();

    function logs() {
        return [...document.querySelectorAll('#stove-log-content > div')].map(entry => {
            const text = entry.textContent;
            const icon = [...LOG_ICON_TYPES.keys()].find(prefix => text.startsWith(`${prefix} `));
            return icon
                ? `[${LOG_ICON_TYPES.get(icon)}] ${text.slice(icon.length + 1)}`
                : `[?] ${text}`;
        });
    }

    function storage(store) {
        return Object.fromEntries(Array.from({ length: store.length }, (_, index) => {
            const key = store.key(index);
            return [key, store.getItem(key)];
        }).sort(([a], [b]) => a.localeCompare(b)));
    }

    return {
        window,
        document,
        requests,
        unmatched,
        tabs,
        delays,
        titles,
        sounds,
        alerts,
        consoleCalls,

        on(method, match, response) {
            routes.push({ method, match, response, calls: 0 });
            return this;
        },

        logs,

        // Requests without the shared lounge/reward header noise, for compact assertions.
        calls() {
            return requests.map(({ method, url: requestUrl, body: requestBody }) =>
                requestBody === null ? `${method} ${requestUrl}` : `${method} ${requestUrl} ${JSON.stringify(requestBody)}`);
        },

        snapshot({ unordered = false } = {}) {
            const result = {
                requests: structuredClone(requests),
                tabs: structuredClone(tabs),
                delays: [...delays],
                logs: logs(),
                titles: [...titles],
                sounds: sounds.length,
                alerts: [...alerts],
                localStorage: storage(window.localStorage),
                sessionStorage: storage(window.sessionStorage),
                state: structuredClone(state)
            };
            if (unordered) {
                // Parallel task groups may interleave differently after a refactor without a
                // behavior change, so compare those runs as multisets.
                const sortByJson = list => list.map(item => JSON.stringify(item)).sort().map(item => JSON.parse(item));
                result.requests = sortByJson(result.requests);
                result.tabs = sortByJson(result.tabs);
                result.delays = [...result.delays].sort((a, b) => a - b);
                result.logs = [...result.logs].sort();
            }
            return result;
        },

        assertAllRequestsMatched() {
            assert.deepEqual(unmatched.map(request => `${request.method} ${request.url}`), [],
                'every request must hit a fixture route');
        },

        uninstall() {
            mock.timers.reset();
            Math.random = originalRandom;
            for (const [name, descriptor] of saved) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else delete globalThis[name];
            }
            saved.clear();
            if (pinnedTimeZone) delete process.env.TZ;
            resetState();
            resetConfig();
            window.close();
        }
    };
}

/**
 * node:test helper: installs a fresh harness for the test and, on teardown, fails the test if
 * any request missed the fixtures. Workflows swallow API errors in try/catch, so a rejected
 * unmatched request alone would not fail the test.
 */
export function useHarness(t, options) {
    const harness = installHarness(options);
    t.after(() => {
        try {
            harness.assertAllRequestsMatched();
        } finally {
            harness.uninstall();
        }
    });
    return harness;
}
