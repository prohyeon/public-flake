// Characterization of src/api/profile.js at the HTTP boundary: exact URLs, per-endpoint header
// rewrites (caller-id / caller-detail / Origin) and how each function surfaces failures.
process.env.TZ = 'Asia/Seoul'; // yyyyMM and tz_offset are derived from the local zone
import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, httpError, networkError, timeoutError, rawText, ok, TEST_HEADERS, DEFAULT_NOW } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import { getMyProfile, getMonthlyFlakeNet, getMonthlyFlakeTotal, getTotalFlakeBalance } from '../../src/api/profile.js';

const API = 'https://api.onstove.com';
const PROFILE_URL = `${API}/postie/v1.0/user/me?timestemp=${DEFAULT_NOW}`;
const BALANCE_URL = `${API}/mileage/v1.0/balance?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY`;
const DEPOSIT_URL = `${API}/mileage/v2.0/master/deposit/total?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY&tz_offset=540&yyyyMM=202610`;

// Lounge headers after the dashboard has already rewritten them for another API.
const CALLER_DETAIL_HEADERS = Object.freeze({ Authorization: 'Bearer other', 'caller-detail': 'detail-uuid' });

test('time zone is pinned to KST for this file', () => {
    assert.equal(new Date(DEFAULT_NOW).getTimezoneOffset(), -540);
});

// ---------------------------------------------------------------- getMyProfile

test('getMyProfile: GET user/me with profile caller headers; X-UUID moves to caller-detail', async t => {
    const h = useHarness(t);
    const body = { code: 0, message: 'OK', value: { user_id: '100', nickname: '테스터' } };
    h.on('GET', PROFILE_URL, body);

    assert.deepEqual(await getMyProfile(TEST_HEADERS), body);
    assert.deepEqual(h.requests[0].headers, {
        'Authorization': 'Bearer test-suat',
        'caller-id': 'indie-web-my',
        'x-lang': 'ko',
        'x-nation': 'KR',
        'x-device-type': 'P01',
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Origin': 'https://profile.onstove.com',
        'Referer': 'https://profile.onstove.com/',
        'caller-detail': 'test-uuid'
    });
    assert.equal('X-UUID' in h.requests[0].headers, false);
    assertGolden('status/api-profile-me', h.snapshot());
});

test('getMyProfile: without X-UUID the headers keep any caller-detail and add none', async t => {
    const h = useHarness(t);
    h.on('GET', PROFILE_URL, { code: 0, value: { user_id: '7' } });
    await getMyProfile({ Authorization: 'Bearer a' });
    await getMyProfile(CALLER_DETAIL_HEADERS);
    assert.deepEqual(h.requests.map(request => request.headers), [
        { Authorization: 'Bearer a', 'caller-id': 'indie-web-my', Origin: 'https://profile.onstove.com', Referer: 'https://profile.onstove.com/' },
        { Authorization: 'Bearer other', 'caller-detail': 'detail-uuid', 'caller-id': 'indie-web-my',
            Origin: 'https://profile.onstove.com', Referer: 'https://profile.onstove.com/' }
    ]);
});

test('getMyProfile: returns any parsed body untouched (code is not checked) and rejects on transport errors', async t => {
    const h = useHarness(t);
    h.on('GET', PROFILE_URL, [
        { code: 401, message: 'Unauthorized' },
        rawText('<html>'),
        httpError(500),
        networkError(),
        timeoutError()
    ]);
    assert.deepEqual(await getMyProfile(TEST_HEADERS), { code: 401, message: 'Unauthorized' });
    assert.deepEqual(await getMyProfile(TEST_HEADERS), { success: true });
    await assert.rejects(getMyProfile(TEST_HEADERS), { message: 'API Error: 500 Error' });
    await assert.rejects(getMyProfile(TEST_HEADERS), { message: 'Network error' });
    await assert.rejects(getMyProfile(TEST_HEADERS), { message: 'API request timed out' });
    assert.equal(h.requests.length, 5);
});

// ---------------------------------------------------------------- getMonthlyFlakeTotal

test('getMonthlyFlakeTotal: GET the KST month deposit total with flake-fe mileage headers', async t => {
    const h = useHarness(t);
    h.on('GET', DEPOSIT_URL, { code: 0, message: 'OK', value: { total_deposit_amount: 14950 } });

    assert.equal(await getMonthlyFlakeTotal(TEST_HEADERS), 14950);
    assert.deepEqual(h.requests[0].headers, {
        'Authorization': 'Bearer test-suat',
        'caller-id': 'flake-fe',
        'caller-detail': 'test-uuid',
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': '*/*',
        'Origin': 'https://reward.onstove.com',
        'Referer': 'https://reward.onstove.com/'
    });
    assertGolden('status/api-monthly-flake', h.snapshot());
});

test('getMonthlyFlakeTotal: every failure collapses to 0 (indistinguishable from a real 0)', async t => {
    const h = useHarness(t);
    h.on('GET', DEPOSIT_URL, [
        { code: 0, value: {} },
        { code: 0, value: { total_deposit_amount: 0 } },
        { code: 1001, message: 'denied', value: { total_deposit_amount: 999 } },
        { code: 0, value: null },
        rawText('oops'),
        httpError(500),
        networkError()
    ]);
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await getMonthlyFlakeTotal(CALLER_DETAIL_HEADERS));
    assert.deepEqual(results, [0, 0, 0, 0, 0, 0, 0]);
    assert.equal(h.requests[0].headers['caller-detail'], 'detail-uuid', 'falls back to caller-detail when X-UUID is absent');
    assert.equal(h.requests[0].headers.Authorization, 'Bearer other');
});

test('getMonthlyFlakeTotal: month and tz_offset follow the local (KST) calendar at a month boundary', async t => {
    const h = useHarness(t, { now: Date.parse('2026-10-31T15:30:00Z') }); // 2026-11-01 00:30 KST
    const url = `${API}/mileage/v2.0/master/deposit/total?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY&tz_offset=540&yyyyMM=202611`;
    h.on('GET', url, { code: 0, value: { total_deposit_amount: 1 } });
    assert.equal(await getMonthlyFlakeTotal(TEST_HEADERS), 1);
});

// ---------------------------------------------------------------- getMonthlyFlakeNet

const HISTORY_PATH = /^https:\/\/api\.onstove\.com\/mileage\/v1\.0\/master\/myinfo\?/;
const row = (type_code, mileage_amount, reg_datetime = DEFAULT_NOW) => ({ type_code, mileage_amount, reg_datetime });
const historyPage = rows => ({ code: 0, message: 'OK', value: rows });
const fullPage = (reg_datetime, amount = 1) => historyPage(Array.from({ length: 1000 }, () => row('ADD', amount, reg_datetime)));

test('getMonthlyFlakeNet: sums the KST month ADD and USE rows with the bill page headers', async t => {
    const h = useHarness(t);
    h.on('GET', HISTORY_PATH, historyPage([row('ADD', 1000), row('USE', -300), row('ADD', 10)]));

    assert.equal(await getMonthlyFlakeNet(TEST_HEADERS), 710);
    assert.equal(h.requests.length, 1, 'a page shorter than page_size is the last page');
    assert.deepEqual(Object.fromEntries(new URL(h.requests[0].url).searchParams), {
        page_size: '1000',
        page_index: '1',
        request_type: 'ALL',
        attribute_code_list: 'STOVE_MILE_PLAY_B,STOVE_MILE_PLAY_S',
        start_date: String(Date.parse('2026-10-01T00:00:00+09:00')),
        end_date: String(Date.parse('2026-10-31T23:59:59+09:00'))
    });
    assert.deepEqual(h.requests[0].headers, {
        'Authorization': 'Bearer test-suat',
        'caller-id': 'billuser',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Origin': 'https://bill.onstove.com',
        'Referer': 'https://bill.onstove.com/'
    });
});

test('getMonthlyFlakeNet: other row types are ignored and the net may be negative', async t => {
    const h = useHarness(t);
    h.on('GET', HISTORY_PATH, historyPage([
        row('USE', -500), row('ADD', 100), row('EXCHANGE_USE', -25000), row('EXPIRE', -7), row('USE_CANCEL', 500)
    ]));
    assert.equal(await getMonthlyFlakeNet(TEST_HEADERS), -400);
});

test('getMonthlyFlakeNet: only voucher exchanges are left out of the shop purchases', async t => {
    const h = useHarness(t);
    const shop = (descriptions, mileage_amount) => ({ ...row('USE', mileage_amount), service_name: 'SHOP_PRODUCT', descriptions });
    h.on('GET', HISTORY_PATH, historyPage([
        row('ADD', 23990),
        shop('플레이크 샵 GS25 1만원 상품권 교환', -300000),
        shop('플레이크 → 메가커피 모바일 금액권 1만원 교환', -300000),
        shop('플레이크 샵 아메리카노 교환권 교환', -110000),
        shop('플레이크 샵 게임 아이템 교환', -700),
        { ...row('USE', -9000), service_name: 'DRAW', descriptions: '꽝 없는 럭키 캡슐' },
        { ...row('USE', -1500), service_name: 'APPLY', descriptions: '상품권 경품 이벤트' }
    ]));
    assert.equal(await getMonthlyFlakeNet(TEST_HEADERS), 12790);
});

test('getMonthlyFlakeNet: on the 1st it starts at 00:00 that day and never counts the previous month', async t => {
    const h = useHarness(t, { now: Date.parse('2026-10-31T15:30:00Z') }); // 2026-11-01 00:30 KST
    const firstOfMonth = Date.parse('2026-11-01T00:00:00+09:00');
    h.on('GET', HISTORY_PATH, historyPage([
        row('ADD', 100, firstOfMonth + 1000),
        row('USE', -10, firstOfMonth),
        row('ADD', 5000, firstOfMonth - 1000)
    ]));

    assert.equal(await getMonthlyFlakeNet(TEST_HEADERS), 90);
    const params = new URL(h.requests[0].url).searchParams;
    assert.equal(params.get('start_date'), String(firstOfMonth));
    assert.equal(params.get('end_date'), String(Date.parse('2026-11-30T23:59:59+09:00')));
});

test('getMonthlyFlakeNet: follows full pages until a short page', async t => {
    const h = useHarness(t);
    h.on('GET', HISTORY_PATH, [fullPage(DEFAULT_NOW), fullPage(DEFAULT_NOW), historyPage([row('USE', -5, DEFAULT_NOW - 1000)])]);

    assert.equal(await getMonthlyFlakeNet(TEST_HEADERS), 1995);
    assert.deepEqual(h.requests.map(r => new URL(r.url).searchParams.get('page_index')), ['1', '2', '3']);
});

test('getMonthlyFlakeNet: every failure is an error, never a sum', async t => {
    const h = useHarness(t);
    h.on('GET', HISTORY_PATH, [
        { code: 1001, message: 'denied', value: [] },
        { code: 0, value: null },
        historyPage([row('ADD', '100')]),
        rawText('oops'),
        httpError(500),
        networkError()
    ]);
    for (let i = 0; i < 6; i++) assert.deepEqual(await getMonthlyFlakeNet(TEST_HEADERS), { error: true });
});

test('getMonthlyFlakeNet: a page newer than the previous page is an overlap error', async t => {
    const h = useHarness(t);
    h.on('GET', HISTORY_PATH, [fullPage(DEFAULT_NOW - 1000), fullPage(DEFAULT_NOW)]);
    assert.deepEqual(await getMonthlyFlakeNet(TEST_HEADERS), { error: true });
    assert.equal(h.requests.length, 2);
});

test('getMonthlyFlakeNet: stops at the page limit with an error', async t => {
    const h = useHarness(t);
    h.on('GET', HISTORY_PATH, fullPage(DEFAULT_NOW));
    assert.deepEqual(await getMonthlyFlakeNet(TEST_HEADERS), { error: true });
    assert.equal(h.requests.length, 20);
});

// ---------------------------------------------------------------- getTotalFlakeBalance

test('getTotalFlakeBalance: GET the mileage balance with flake-fe mileage headers', async t => {
    const h = useHarness(t);
    h.on('GET', BALANCE_URL, { code: 0, message: 'OK', value: { mileage_amount: 192500 } });

    assert.equal(await getTotalFlakeBalance(TEST_HEADERS), 192500);
    assert.deepEqual(h.requests[0].headers, {
        'Authorization': 'Bearer test-suat',
        'caller-id': 'flake-fe',
        'caller-detail': 'test-uuid',
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': '*/*',
        'Origin': 'https://reward.onstove.com',
        'Referer': 'https://reward.onstove.com/'
    });
    assertGolden('status/api-total-flake', h.snapshot());
});

test('getTotalFlakeBalance: every failure collapses to 0 (indistinguishable from a real 0)', async t => {
    const h = useHarness(t);
    h.on('GET', BALANCE_URL, [
        { code: 0, value: {} },
        { code: 2, value: { mileage_amount: 5 } },
        { code: 0 },
        rawText(''),
        httpError(503),
        timeoutError(),
        ok({ code: 0, value: { mileage_amount: 7 } }, 201)
    ]);
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await getTotalFlakeBalance(CALLER_DETAIL_HEADERS));
    assert.deepEqual(results, [0, 0, 0, 0, 0, 0, 7]);
    assert.equal(h.requests[0].headers['caller-detail'], 'detail-uuid');
});

test('profile reads never write', async t => {
    const h = useHarness(t);
    h.on('GET', PROFILE_URL, { code: 0, value: { user_id: '1' } })
        .on('GET', BALANCE_URL, { code: 0, value: { mileage_amount: 1 } })
        .on('GET', DEPOSIT_URL, { code: 0, value: { total_deposit_amount: 1 } });
    await getMyProfile(TEST_HEADERS);
    await getTotalFlakeBalance(TEST_HEADERS);
    await getMonthlyFlakeTotal(TEST_HEADERS);
    assert.deepEqual(h.requests.filter(request => request.method !== 'GET' || request.body !== null), []);
});
