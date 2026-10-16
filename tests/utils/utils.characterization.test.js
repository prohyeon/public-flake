// Characterization of src/utils/tabs.js, time.js, auth.js, maintenance.js and audio.js.
// Several of these read the machine timezone (Date#getTimezoneOffset / local getters); those tests pin
// process.env.TZ (Node applies runtime changes; each test file runs in its own process) and restore it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, DEFAULT_NOW, TEST_HEADERS } from '../helpers/gmHarness.js';
import { CONFIG } from '../../src/config.js';
import { closeTab, openTabInBackground } from '../../src/utils/tabs.js';
import {
    delay,
    getKSTDate,
    getTimestamp,
    getTodayKSTString,
    getTodayString
} from '../../src/utils/time.js';
import { extractHeaders, getCookie } from '../../src/utils/auth.js';
import { isMaintenanceMode } from '../../src/utils/maintenance.js';
import { playCompletionSound } from '../../src/utils/audio.js';

function withTimeZone(t, timeZone) {
    const had = Object.hasOwn(process.env, 'TZ');
    const previous = process.env.TZ;
    process.env.TZ = timeZone;
    t.after(() => {
        if (had) process.env.TZ = previous;
        else delete process.env.TZ;
    });
}

const at = iso => ({ now: Date.parse(iso) });

// ---------------------------------------------------------------------------------------------
// tabs.js
// ---------------------------------------------------------------------------------------------

test('openTabInBackground: GM_openInTab with insert/setParent, background unless active is requested', t => {
    useHarness(t);
    const opened = [];
    globalThis.GM_openInTab = (url, options) => {
        opened.push({ url, options });
        return { handle: opened.length };
    };

    assert.deepEqual(openTabInBackground('https://example.test/a'), { handle: 1 });
    assert.deepEqual(openTabInBackground('https://example.test/b', true), { handle: 2 });
    assert.deepEqual(opened, [
        { url: 'https://example.test/a', options: { active: false, insert: true, setParent: true } },
        { url: 'https://example.test/b', options: { active: true, insert: true, setParent: true } }
    ]);
});

test('openTabInBackground: without GM_openInTab it falls back to window.open(url, "_blank")', t => {
    const h = useHarness(t);
    delete globalThis.GM_openInTab;
    const calls = [];
    h.window.open = (...args) => {
        calls.push(args);
        return 'window-handle';
    };
    assert.equal(openTabInBackground('https://example.test/c', true), 'window-handle');
    assert.deepEqual(calls, [['https://example.test/c', '_blank']], 'the active flag is not forwarded');
});

test('closeTab: counts only tabs whose close() succeeded', t => {
    useHarness(t);
    const closed = [];
    const tab = name => ({ close() { closed.push(name); } });

    assert.equal(closeTab(null), 0);
    assert.equal(closeTab(undefined), 0);
    assert.equal(closeTab(tab('single')), 1, 'a single tab is accepted without an array');
    assert.equal(closeTab([]), 0);
    assert.equal(closeTab([
        tab('first'),
        null,
        { notATab: true },
        { close() { throw new Error('already closed'); } },
        'not-a-tab',
        tab('last')
    ]), 2);
    assert.deepEqual(closed, ['single', 'first', 'last']);
});

// ---------------------------------------------------------------------------------------------
// time.js
// ---------------------------------------------------------------------------------------------

test('getKSTDate / getTodayKSTString: KST calendar date regardless of the machine timezone', async t => {
    for (const timeZone of ['UTC', 'Asia/Seoul', 'America/Los_Angeles']) {
        await t.test(timeZone, async st => {
            withTimeZone(st, timeZone);
            const cases = [
                ['2026-10-16T01:00:00.000Z', '2026-10-16'],
                ['2026-10-16T14:59:59.999Z', '2026-10-16'],
                ['2026-10-16T15:00:00.000Z', '2026-10-17'],
                ['2026-12-31T15:00:00.000Z', '2027-01-01']
            ];
            for (const [iso, expected] of cases) {
                await st.test(iso, sst => {
                    useHarness(sst, at(iso));
                    assert.equal(getKSTDate(), expected);
                    assert.equal(getTodayKSTString(), expected);
                });
            }
        });
    }
});

test('getTodayString: the LOCAL calendar date (differs from KST off-Korea)', async t => {
    const cases = [
        ['Asia/Seoul', '2026-10-16T01:00:00Z', '2026-10-16'],
        ['Asia/Seoul', '2026-10-15T15:00:00Z', '2026-10-16'],
        ['UTC', '2026-10-15T15:00:00Z', '2026-10-15'],
        ['America/Los_Angeles', '2026-10-16T01:00:00Z', '2026-10-15']
    ];
    for (const [timeZone, iso, expected] of cases) {
        await t.test(`${timeZone} @ ${iso}`, st => {
            withTimeZone(st, timeZone);
            useHarness(st, at(iso));
            assert.equal(getTodayString(), expected);
        });
    }
});

test('delay / getTimestamp: delays go through setTimeout, timestamps through Date.now', async t => {
    const h = useHarness(t);
    assert.equal(await delay(1234), undefined);
    await delay(0);
    assert.deepEqual(h.delays, [1234, 0]);
    assert.equal(getTimestamp(), DEFAULT_NOW);
});

// ---------------------------------------------------------------------------------------------
// auth.js
// ---------------------------------------------------------------------------------------------

test('extractHeaders: the lounge header set built from the SUAT cookie and sgs_da_uuid', t => {
    useHarness(t);
    assert.deepEqual(extractHeaders(), TEST_HEADERS);
    assert.deepEqual(extractHeaders(), {
        Authorization: 'Bearer test-suat',
        'caller-id': 'storee-lounge',
        'X-UUID': 'test-uuid',
        'x-lang': 'ko',
        'x-nation': 'KR',
        'x-device-type': 'P01',
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Origin: 'https://lounge.onstove.com',
        Referer: 'https://lounge.onstove.com/'
    });
});

test('extractHeaders: localStorage uuid wins over the cookie', t => {
    useHarness(t, { cookies: { SUAT: 'tok', sgs_da_uuid: 'cookie-uuid' } });
    localStorage.setItem('sgs_da_uuid', 'storage-uuid');
    const headers = extractHeaders();
    assert.equal(headers['X-UUID'], 'storage-uuid');
    assert.equal(headers.Authorization, 'Bearer tok');
});

test('extractHeaders: uuid may come from localStorage alone', t => {
    useHarness(t, { cookies: { SUAT: 'tok' } });
    localStorage.setItem('sgs_da_uuid', 'storage-only');
    assert.equal(extractHeaders()['X-UUID'], 'storage-only');
});

test('extractHeaders: missing token is reported before a missing uuid', async t => {
    await t.test('no cookies', st => {
        useHarness(st, { cookies: {} });
        assert.throws(() => extractHeaders(), { message: 'Authorization token (SUAT) not found' });
    });
    await t.test('empty SUAT', st => {
        useHarness(st, { cookies: { SUAT: '', sgs_da_uuid: 'u' } });
        assert.throws(() => extractHeaders(), { message: 'Authorization token (SUAT) not found' });
    });
    await t.test('no uuid', st => {
        useHarness(st, { cookies: { SUAT: 'tok' } });
        assert.throws(() => extractHeaders(), { message: 'UUID (sgs_da_uuid) not found' });
    });
});

test('getCookie: exact-name lookup; a duplicated cookie name reads as missing', t => {
    const h = useHarness(t, { cookies: { XSUAT: 'prefixed', SUAT: 'a=b==', other: '1' } });
    assert.equal(getCookie('SUAT'), 'a=b==', 'values may contain "="');
    assert.equal(getCookie('XSUAT'), 'prefixed');
    assert.equal(getCookie('other'), '1');
    assert.equal(getCookie('missing'), null);

    // A host-only and a domain cookie with the same name are both sent: "SUAT=a=b==; ...; SUAT=dup".
    h.document.cookie = 'SUAT=dup; domain=onstove.com; path=/';
    assert.equal(h.document.cookie.split('; ').filter(part => part.startsWith('SUAT=')).length, 2);
    assert.equal(getCookie('SUAT'), null);
    assert.throws(() => extractHeaders(), { message: 'Authorization token (SUAT) not found' });
});

// ---------------------------------------------------------------------------------------------
// maintenance.js
// ---------------------------------------------------------------------------------------------

test('isMaintenanceMode: off unless enabled; then compares a computed date with startDate', t => {
    withTimeZone(t, 'UTC');
    useHarness(t);
    assert.equal(CONFIG.maintenanceMode.enabled, false);
    CONFIG.maintenanceMode.startDate = '2000-01-01';
    assert.equal(isMaintenanceMode(), false, 'disabled ignores the date');

    CONFIG.maintenanceMode.enabled = true;
    CONFIG.maintenanceMode.startDate = '2025-11-01';
    assert.equal(isMaintenanceMode(), true);
    CONFIG.maintenanceMode.startDate = '2026-10-16';
    assert.equal(isMaintenanceMode(), true, 'the start date itself is in maintenance');
    CONFIG.maintenanceMode.startDate = '2026-10-17';
    assert.equal(isMaintenanceMode(), false);
});

test('isMaintenanceMode: the day boundary depends on the machine timezone', async t => {
    // 2026-10-15T16:00Z is 2026-10-16 01:00 in KST. The code adds getTimezoneOffset() and then +9h before
    // toISOString(), so only on a UTC machine does it compute the KST date; on a KST machine it computes the
    // UTC date and the maintenance day starts at 09:00 KST instead of 00:00.
    const cases = [
        ['UTC', '2026-10-15T14:59:59Z', false],
        ['UTC', '2026-10-15T16:00:00Z', true],
        ['Asia/Seoul', '2026-10-15T16:00:00Z', false],
        ['Asia/Seoul', '2026-10-15T23:59:59Z', false],
        ['Asia/Seoul', '2026-10-16T00:00:00Z', true],
        ['America/Los_Angeles', '2026-10-15T08:59:59Z', true],
        ['America/Los_Angeles', '2026-10-15T07:59:59Z', false]
    ];
    for (const [timeZone, iso, expected] of cases) {
        await t.test(`${timeZone} @ ${iso}`, st => {
            withTimeZone(st, timeZone);
            useHarness(st, at(iso));
            CONFIG.maintenanceMode.enabled = true;
            CONFIG.maintenanceMode.startDate = '2026-10-16';
            assert.equal(isMaintenanceMode(), expected);
        });
    }
});

// ---------------------------------------------------------------------------------------------
// audio.js
// ---------------------------------------------------------------------------------------------

test('playCompletionSound: plays through AudioContext, falls back to webkitAudioContext, never throws', t => {
    const h = useHarness(t);
    playCompletionSound();
    assert.equal(h.sounds.length, 1);

    const FakeContext = h.window.AudioContext;
    h.window.AudioContext = undefined;
    h.window.webkitAudioContext = FakeContext;
    playCompletionSound();
    assert.equal(h.sounds.length, 2);

    h.window.webkitAudioContext = undefined;
    assert.doesNotThrow(() => playCompletionSound());
    assert.equal(h.sounds.length, 2);
});
