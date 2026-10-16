// Characterization of the HTTP contracts of src/api/request.js, pointExchange.js, lostArkCashCharge.js,
// preRegistration.js and specialForce.js. Method, URL, headers, body and timeout are locked exactly
// (refactor D dedupes header/URL construction and must not change them); console output is not.
import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, httpError, rawText, TEST_HEADERS } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import { apiRequest } from '../../src/api/request.js';
import {
    buildBillFlakeBalanceUrl,
    buildPointExchangePayload,
    buildPointExchangeRateUrl,
    calculateRequiredFlake,
    createPointExchangePlan,
    exchangeFlakeForPoints,
    extractBillFlakeBalance,
    getBillFlakeBalance,
    getPointExchangeRate,
    makePointExchangeHeaders
} from '../../src/api/pointExchange.js';
import {
    buildLostArkCashChargeUrl,
    buildLostArkPaymentInfoUrl,
    buildLostArkPointBalanceUrl,
    buildLostArkPointCashChargePayload,
    chargeLostArkCashWithPoints,
    extractBearerToken,
    extractLostArkOrderNo,
    extractStovePointBalance,
    getLostArkPaymentInfo,
    getLostArkPointBalance,
    makeLostArkPaymentHeaders
} from '../../src/api/lostArkCashCharge.js';
import { addIndieWishlist, PRE_REGISTRATION_ALREADY_JOINED, registerPreRegistration } from '../../src/api/preRegistration.js';
import { claimSpecialForceReward, getSpecialForceShop, SPECIAL_FORCE_GAME_ID } from '../../src/api/specialForce.js';
import { specialForceShop } from '../helpers/specialForceFixture.js';

const API = 'https://api.onstove.com';

// ---------------------------------------------------------------------------------------------
// src/api/request.js
// ---------------------------------------------------------------------------------------------

function captureGm(onRequest) {
    const configs = [];
    globalThis.GM_xmlhttpRequest = config => {
        configs.push(config);
        onRequest(config);
    };
    return configs;
}

test('apiRequest: the GM_xmlhttpRequest config is anonymous, JSON-encodes truthy bodies and adds only positive timeouts', async t => {
    useHarness(t);
    const configs = captureGm(config => config.onload({ status: 200, statusText: 'OK', responseText: '{"code":0}' }));
    const headers = { Authorization: 'Bearer x' };

    await apiRequest('https://example.test/get', 'GET', headers);
    await apiRequest('https://example.test/post', 'POST', headers, { a: 1, nested: { b: [1, 2] } }, { timeout: 15000 });
    await apiRequest('https://example.test/empty-object', 'PUT', headers, {});
    await apiRequest('https://example.test/array', 'POST', headers, []);
    await apiRequest('https://example.test/zero', 'POST', headers, 0);
    await apiRequest('https://example.test/empty-string', 'POST', headers, '');
    await apiRequest('https://example.test/zero-timeout', 'POST', headers, { a: 1 }, { timeout: 0 });

    const callbackNames = ['onabort', 'onerror', 'onload', 'ontimeout'];
    for (const config of configs) {
        for (const name of callbackNames) assert.equal(typeof config[name], 'function', `${name} is provided`);
        assert.equal(config.headers, headers, 'headers are passed through as given');
    }
    assert.deepEqual(configs.map(config => Object.fromEntries(Object.entries(config)
        .filter(([key]) => !callbackNames.includes(key) && key !== 'headers'))), [
        { method: 'GET', url: 'https://example.test/get', anonymous: true, data: null },
        { method: 'POST', url: 'https://example.test/post', anonymous: true, data: '{"a":1,"nested":{"b":[1,2]}}', timeout: 15000 },
        { method: 'PUT', url: 'https://example.test/empty-object', anonymous: true, data: '{}' },
        { method: 'POST', url: 'https://example.test/array', anonymous: true, data: '[]' },
        // Falsy bodies are sent as no body at all.
        { method: 'POST', url: 'https://example.test/zero', anonymous: true, data: null },
        { method: 'POST', url: 'https://example.test/empty-string', anonymous: true, data: null },
        { method: 'POST', url: 'https://example.test/zero-timeout', anonymous: true, data: '{"a":1}' }
    ]);
});

test('apiRequest: 2xx resolves parsed JSON (or {success:true} when unparseable); other statuses reject', async t => {
    const h = useHarness(t);
    h.on('GET', 'https://x/200', { code: 0, value: 1 })
        .on('GET', 'https://x/204', rawText('', 204))
        .on('GET', 'https://x/299', rawText('[1,2]', 299))
        .on('GET', 'https://x/null', rawText('null'))
        .on('GET', 'https://x/html', rawText('<html>login</html>'))
        .on('GET', 'https://x/300', rawText('{"code":0}', 300))
        .on('GET', 'https://x/404', httpError(404))
        .on('GET', 'https://x/199', rawText('{}', 199));

    assert.deepEqual(await apiRequest('https://x/200', 'GET', {}), { code: 0, value: 1 });
    assert.deepEqual(await apiRequest('https://x/204', 'GET', {}), { success: true });
    assert.deepEqual(await apiRequest('https://x/299', 'GET', {}), [1, 2]);
    assert.equal(await apiRequest('https://x/null', 'GET', {}), null);
    assert.deepEqual(await apiRequest('https://x/html', 'GET', {}), { success: true });
    await assert.rejects(apiRequest('https://x/300', 'GET', {}), { message: 'API Error: 300 Error' });
    await assert.rejects(apiRequest('https://x/404', 'GET', {}), { message: 'API Error: 404 Error' });
    await assert.rejects(apiRequest('https://x/199', 'GET', {}), { message: 'API Error: 199 Error' });
});

test('apiRequest: rejection messages for statusText, abort, network error and timeout', async t => {
    useHarness(t);
    const outcomes = {
        'https://x/unavailable': config => config.onload({ status: 503, statusText: 'Service Unavailable', responseText: '' }),
        'https://x/no-status-text': config => config.onload({ status: 503, responseText: '' }),
        'https://x/abort': config => config.onabort(),
        'https://x/error': config => config.onerror({ error: 'boom' }),
        'https://x/timeout': config => config.ontimeout()
    };
    captureGm(config => outcomes[config.url](config));

    await assert.rejects(apiRequest('https://x/unavailable', 'GET', {}), { message: 'API Error: 503 Service Unavailable' });
    await assert.rejects(apiRequest('https://x/no-status-text', 'GET', {}), { message: 'API Error: 503 undefined' });
    await assert.rejects(apiRequest('https://x/abort', 'GET', {}), { message: 'API request aborted' });
    await assert.rejects(apiRequest('https://x/error', 'GET', {}), { message: 'Network error' });
    await assert.rejects(apiRequest('https://x/timeout', 'POST', {}, { a: 1 }, { timeout: 1 }), { message: 'API request timed out' });
});

// ---------------------------------------------------------------------------------------------
// src/api/pointExchange.js
// ---------------------------------------------------------------------------------------------

const BILL_HEADERS = {
    Authorization: 'Bearer test-suat',
    'caller-id': 'billuser',
    Accept: 'application/json',
    'Content-Type': 'application/json'
};
const RATE_URL = `${API}/mileage/v1.0/exchange?from_use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY&to_deposit_rule_id=PL_STOVE_COMMUNITY_MILE_PAID&client_id=M_STOVE_COMMUNITY`;
const BILL_BALANCE_URL = `${API}/mileage/v1.0/balance?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY`;
const EXCHANGE_URL = `${API}/mileage/v1.0/exchange/point`;

test('pointExchange: rate, balance and exchange requests (method/url/headers/body)', async t => {
    const h = useHarness(t);
    h.on('GET', RATE_URL, { code: 0, value: { exchange_id: 1 } })
        .on('GET', BILL_BALANCE_URL, { code: 0, value: { mileage_amount: 250000 } })
        .on('POST', EXCHANGE_URL, { code: 0, value: { exchanged_amount: 7700 } });

    assert.deepEqual(await getPointExchangeRate(TEST_HEADERS), { code: 0, value: { exchange_id: 1 } });
    assert.deepEqual(await getBillFlakeBalance(TEST_HEADERS), { code: 0, value: { mileage_amount: 250000 } });
    // String plan values are coerced to numbers; pointAmount is not part of the body.
    assert.deepEqual(await exchangeFlakeForPoints(TEST_HEADERS, { exchangeId: '3', fromAmount: '192500', pointAmount: 7700 }),
        { code: 0, value: { exchanged_amount: 7700 } });

    assert.deepEqual(h.requests, [
        { method: 'GET', url: RATE_URL, headers: BILL_HEADERS, body: null },
        { method: 'GET', url: BILL_BALANCE_URL, headers: BILL_HEADERS, body: null },
        {
            method: 'POST',
            url: EXCHANGE_URL,
            headers: BILL_HEADERS,
            body: { client_id: 'M_STOVE_COMMUNITY', exchange_id: 3, from_amount: 192500, descriptions: '플레이크 전환' }
        }
    ]);
    assertGolden('api/point-exchange-requests', h.requests);
});

test('pointExchange: header, URL and payload builders', () => {
    assert.deepEqual(makePointExchangeHeaders({ authorization: 'Bearer lower', 'X-UUID': 'dropped', Origin: 'dropped' }), {
        Authorization: 'Bearer lower',
        'caller-id': 'billuser',
        Accept: 'application/json',
        'Content-Type': 'application/json'
    });
    const noAuth = makePointExchangeHeaders({});
    assert.equal(Object.hasOwn(noAuth, 'Authorization'), true);
    assert.equal(noAuth.Authorization, undefined);

    assert.equal(buildPointExchangeRateUrl(), RATE_URL);
    assert.equal(buildBillFlakeBalanceUrl(), BILL_BALANCE_URL);
    assert.equal(buildPointExchangeRateUrl({ fromUseRuleId: 'A B', toDepositRuleId: 'T&1', clientId: 'C' }),
        `${API}/mileage/v1.0/exchange?from_use_rule_id=A+B&to_deposit_rule_id=T%261&client_id=C`);
    assert.equal(buildBillFlakeBalanceUrl({ clientId: 'C', fromUseRuleId: 'R' }),
        `${API}/mileage/v1.0/balance?client_id=C&use_rule_id=R`);
    assert.deepEqual(buildPointExchangePayload({ exchangeId: '9', fromAmount: '25' }, { clientId: 'OTHER', description: 'd' }),
        { client_id: 'OTHER', exchange_id: 9, from_amount: 25, descriptions: 'd' });
});

test('pointExchange: calculateRequiredFlake and createPointExchangePlan validation', () => {
    const rate = { exchange_id: 1, min_exchange_amount: 1000, max_exchange_amount: 100000, from_amount: 25, to_amount: 1 };

    assert.equal(calculateRequiredFlake('7700', { from_amount: '25', to_amount: '1' }), 192500);
    for (const [points, exchangeRate] of [
        [7700, { from_amount: 25 }],
        [7700, { to_amount: 1 }],
        [7700, { from_amount: 0, to_amount: 1 }],
        [0, { from_amount: 25, to_amount: 1 }],
        [7700, null],
        [7700, { from_amount: null, to_amount: 1 }]
    ]) {
        assert.throws(() => calculateRequiredFlake(points, exchangeRate), { message: 'Invalid point exchange rate' });
    }
    assert.throws(() => calculateRequiredFlake(7700, { from_amount: 25, to_amount: 3 }),
        { message: 'Point exchange amount must resolve to a whole flake amount' });

    assert.deepEqual(createPointExchangePlan(rate), { exchangeId: 1, pointAmount: 7700, fromAmount: 192500 });
    assert.deepEqual(createPointExchangePlan({ exchange_id: '4', from_amount: 25, to_amount: 1 }),
        { exchangeId: 4, pointAmount: 7700, fromAmount: 192500 }, 'missing limits are not enforced');
    assert.deepEqual(createPointExchangePlan({ ...rate, from_amount: 10 }, { requiredFlakeAmount: undefined }),
        { exchangeId: 1, pointAmount: 7700, fromAmount: 77000 }, 'an undefined expected amount skips the cross-check');
    // Number(null) === 0: a null expected amount is a check against 0, not a skipped check.
    assert.throws(() => createPointExchangePlan({ ...rate, from_amount: 10 }, { requiredFlakeAmount: null }),
        { message: 'Expected 0 flake but exchange rate requires 77000' });
    assert.throws(() => createPointExchangePlan({ ...rate, exchange_id: undefined }), { message: 'Invalid point exchange target' });
    assert.throws(() => createPointExchangePlan({ ...rate, exchange_id: 0 }), { message: 'Invalid point exchange target' });
    assert.throws(() => createPointExchangePlan(rate, { pointAmount: 0 }), { message: 'Invalid point exchange target' });
    assert.throws(() => createPointExchangePlan(rate, { pointAmount: 999 }),
        { message: 'Target point amount is below minimum exchange amount 1000' });
    assert.throws(() => createPointExchangePlan({ ...rate, max_exchange_amount: 7699 }),
        { message: 'Target point amount exceeds maximum exchange amount 7699' });
    assert.throws(() => createPointExchangePlan({ ...rate, from_amount: 24 }),
        { message: 'Expected 192500 flake but exchange rate requires 184800' });
    assert.throws(() => createPointExchangePlan(null), { message: 'Invalid point exchange target' });
});

test('pointExchange: extractBillFlakeBalance treats null/empty amounts as 0 and missing ones as unknown', () => {
    assert.equal(extractBillFlakeBalance({ value: { mileage_amount: 192500 } }), 192500);
    assert.equal(extractBillFlakeBalance({ value: { mileage_amount: null } }), 0);
    assert.equal(extractBillFlakeBalance({ value: { mileage_amount: '' } }), 0);
    assert.equal(extractBillFlakeBalance({ value: { mileage_amount: 'abc' } }), null);
    assert.equal(extractBillFlakeBalance({ value: {} }), null);
    assert.equal(extractBillFlakeBalance(null), null);
    assert.equal(extractBillFlakeBalance(undefined), null);
});

// ---------------------------------------------------------------------------------------------
// src/api/lostArkCashCharge.js
// ---------------------------------------------------------------------------------------------

const PAYMENT_HEADERS = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-suat',
    'X-Lang': 'ko',
    'X-Nation': 'KR',
    'caller-id': 'bill-payweb',
    'caller-detail': 'test-uuid'
};
const POINT_BALANCE_URL = `${API}/point/v1.0/balance?client_id=M_STOVE_PC&use_rule_id=ML_STOVE_PC_MILE_PAID`;
const CHARGE_URL = `${API}/pay/v1.0/payment/45/request/direct`;

test('lostArkCashCharge: point balance and direct charge requests (method/url/headers/body)', async t => {
    const h = useHarness(t);
    h.on('GET', POINT_BALANCE_URL, { code: 0, value: { mileage_amount: 7700 } })
        .on('POST', CHARGE_URL, { code: 0, value: { order_no: 2605101202375031 } });

    assert.deepEqual(await getLostArkPointBalance(TEST_HEADERS), { code: 0, value: { mileage_amount: 7700 } });
    assert.deepEqual(await chargeLostArkCashWithPoints(TEST_HEADERS), { code: 0, value: { order_no: 2605101202375031 } });

    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[0], { method: 'GET', url: POINT_BALANCE_URL, headers: PAYMENT_HEADERS, body: null });
    assert.equal(h.requests[1].method, 'POST');
    assert.equal(h.requests[1].url, CHARGE_URL);
    assert.deepEqual(h.requests[1].headers, PAYMENT_HEADERS);
    assert.deepEqual(h.requests[1].body, buildLostArkPointCashChargePayload({ accessToken: 'test-suat' }));
    assert.equal(h.requests[1].body.access_token, 'test-suat', 'the raw SUAT (without "Bearer ") is the access token');
    assert.equal(Object.hasOwn(h.requests[1], 'timeout'), false);
    assertGolden('api/lost-ark-cash-charge-requests', h.requests);
});

test('lostArkCashCharge: payment header fallbacks and bearer token extraction', () => {
    assert.deepEqual(makeLostArkPaymentHeaders({
        authorization: 'Bearer lower',
        'X-Lang': 'en',
        'x-lang': 'ko',
        'X-Nation': 'US',
        'x-nation': 'KR',
        'caller-detail': 'detail-wins',
        'X-UUID': 'uuid'
    }), {
        'Content-Type': 'application/json',
        Authorization: 'Bearer lower',
        'X-Lang': 'en',
        'X-Nation': 'US',
        'caller-id': 'bill-payweb',
        'caller-detail': 'detail-wins'
    });
    assert.deepEqual(makeLostArkPaymentHeaders({}), {
        'Content-Type': 'application/json',
        Authorization: undefined,
        'X-Lang': 'ko',
        'X-Nation': 'KR',
        'caller-id': 'bill-payweb',
        'caller-detail': ''
    });

    assert.equal(extractBearerToken({ Authorization: 'bearer   spaced-token' }), 'spaced-token');
    assert.equal(extractBearerToken({ Authorization: 'Basic abc' }), 'Basic abc');
    assert.equal(extractBearerToken({ Authorization: 'Bearer ' }), 'Bearer ');
    assert.equal(extractBearerToken({}), '');
});

test('lostArkCashCharge: URL builders, payload overrides and response extraction', () => {
    assert.equal(buildLostArkPointBalanceUrl({ pointClientId: 'P', pointUseRuleId: 'R' }),
        `${API}/point/v1.0/balance?client_id=P&use_rule_id=R`);
    assert.equal(buildLostArkCashChargeUrl(), CHARGE_URL);
    assert.equal(buildLostArkCashChargeUrl({ gameCode: '99' }), `${API}/pay/v1.0/payment/99/request/direct`);

    const payload = buildLostArkPointCashChargePayload({ accessToken: 't' }, { productName: 'P', cashAmount: 100, pointMallId: 'M' });
    assert.equal(payload.prod_name, 'P');
    assert.equal(payload.sales_prod_name, 'P');
    assert.equal(payload.total_pay_amt, 100);
    assert.deepEqual(payload.multi_pay_list, [{ paytool_code: 99, pg_code: 'STOVE_MILEAGE', mall_id: 'M', cash_amt: 100, pay_amt: 0 }]);

    assert.equal(extractStovePointBalance({ value: { mileage_amount: null } }), 0);
    assert.equal(extractStovePointBalance(null), null);
    assert.equal(extractLostArkOrderNo({ value: { order_no: 0 } }), '0');
    assert.equal(extractLostArkOrderNo({ value: { order_no: '' } }), null);
    assert.equal(extractLostArkOrderNo({ value: { order_no: null } }), null);
    assert.equal(extractLostArkOrderNo(null), null);
});

// Dead code: getLostArkPaymentInfo / buildLostArkPaymentInfoUrl are not called anywhere in src.
// If refactor F removes them, delete this test with them.
test('lostArkCashCharge (unused export): payment info request', async t => {
    const h = useHarness(t);
    const url = `${API}/pay/v1.0/payment/info/2605101202375031`;
    h.on('GET', url, { code: 0, value: { status: 'DONE' } });
    assert.equal(buildLostArkPaymentInfoUrl('2605101202375031'), url);
    assert.deepEqual(await getLostArkPaymentInfo(TEST_HEADERS, '2605101202375031'), { code: 0, value: { status: 'DONE' } });
    assert.deepEqual(h.requests, [{ method: 'GET', url, headers: PAYMENT_HEADERS, body: null }]);
});

// ---------------------------------------------------------------------------------------------
// src/api/preRegistration.js and src/api/specialForce.js (shared event-hub headers)
// ---------------------------------------------------------------------------------------------

const EVENT_HEADERS = {
    ...TEST_HEADERS,
    'caller-id': 'event-hub',
    'caller-detail': 'test-uuid',
    Origin: 'https://event.onstove.com',
    Referer: 'https://event.onstove.com/',
    'X-Timezone': 'Asia/Seoul',
    'X-Utc-Offset': '540'
};
const REGISTER_URL = `${API}/dailyshop/v1.0/campaigns/202610/luvplace/register`;
const WISHLIST_URL = `${API}/shop/v2.0/indie/wishlist/add`;
const CAMPAIGN = { month: '202610', key: 'luvplace', title: 'luvplace 사전등록', shopItemId: 14203, endDate: '2026-10-15' };

test('preRegistration: register and wishlist requests (method/url/headers/body/timeout)', async t => {
    const h = useHarness(t);
    h.on('POST', REGISTER_URL, { code: 0, message: 'OK', value: { registration_no: 29231 } })
        .on('POST', WISHLIST_URL, { value: { cart_id: '0' }, response_code: 0 });

    assert.deepEqual(await registerPreRegistration(TEST_HEADERS, CAMPAIGN), { registered: true, registrationNo: 29231 });
    assert.equal(await addIndieWishlist(TEST_HEADERS, 14203), true);

    assert.deepEqual(h.requests, [
        { method: 'POST', url: REGISTER_URL, headers: EVENT_HEADERS, body: null, timeout: 15000 },
        {
            method: 'POST',
            url: WISHLIST_URL,
            headers: { ...EVENT_HEADERS, 'Content-Type': 'application/json' },
            body: { shop_key: 'indie', shop_item_ids: [{ shop_item_id: 14203 }], shop_item_ids_str: '[{"shop_item_id":14203}]' },
            timeout: 15000
        }
    ]);
    assertGolden('api/pre-registration-requests', h.requests);
});

test('preRegistration: campaign validation happens before any request', async t => {
    const h = useHarness(t);
    h.on('POST', `${API}/dailyshop/v1.0/campaigns/202611/Luv-Place2/register`, { code: PRE_REGISTRATION_ALREADY_JOINED });

    assert.equal(PRE_REGISTRATION_ALREADY_JOINED, 90605);
    assert.deepEqual(await registerPreRegistration(TEST_HEADERS, { month: 202611, key: 'Luv-Place2' }), { alreadyJoined: true });
    for (const campaign of [null, {}, { month: '2026-10', key: 'x' }, { month: '20261', key: 'x' }, { month: '202610', key: 'luv_place' },
        { month: '202610', key: '' }, { month: '202610', key: 'a/b' }]) {
        await assert.rejects(registerPreRegistration(TEST_HEADERS, campaign), { message: '사전등록 캠페인 설정 확인 실패' });
    }
    for (const id of [0, -1, 1.5, '14203', null, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(addIndieWishlist(TEST_HEADERS, id), { message: '찜하기 상품 번호 확인 실패' });
    }
    assert.deepEqual(h.calls(), [`POST ${API}/dailyshop/v1.0/campaigns/202611/Luv-Place2/register`]);
});

test('preRegistration: response classification', async t => {
    const h = useHarness(t);
    h.on('POST', REGISTER_URL, [
        { code: 0, value: { registration_no: '29231' } },
        { code: 0 },
        { message: 'no code' },
        { code: 90605, value: { registration_no: 1 } },
        httpError(500)
    ]).on('POST', WISHLIST_URL, [
        { response_code: 1 },
        { value: {} },
        rawText('<html></html>')
    ]);

    await assert.rejects(registerPreRegistration(TEST_HEADERS, CAMPAIGN), { message: '사전등록 응답 확인 실패 (code=0)' });
    await assert.rejects(registerPreRegistration(TEST_HEADERS, CAMPAIGN), { message: '사전등록 응답 확인 실패 (code=0)' });
    await assert.rejects(registerPreRegistration(TEST_HEADERS, CAMPAIGN), { message: '사전등록 응답 확인 실패 (code=없음)' });
    assert.deepEqual(await registerPreRegistration(TEST_HEADERS, CAMPAIGN), { alreadyJoined: true });
    await assert.rejects(registerPreRegistration(TEST_HEADERS, CAMPAIGN), { message: 'API Error: 500 Error' });

    await assert.rejects(addIndieWishlist(TEST_HEADERS, 14203), { message: '찜하기 응답 확인 실패 (code=1)' });
    await assert.rejects(addIndieWishlist(TEST_HEADERS, 14203), { message: '찜하기 응답 확인 실패 (code=없음)' });
    // An unparseable 2xx becomes { success: true }, which has no response_code.
    await assert.rejects(addIndieWishlist(TEST_HEADERS, 14203), { message: '찜하기 응답 확인 실패 (code=없음)' });
    assert.equal(h.requests.length, 8);
});

const FAMILY_LINKS_URL = `${API}/dailyshop/v1.0/services/family-links`;
const SF_SHOP_URL = `${API}/dailyshop/v1.0/202610/services/specialforce`;
const SF_CLAIM_URL = `${API}/dailyshop/v1.0/attendances/accumulate-play/flake?item_no=25`;
const SF_LINKS = [{ service_id: 'other', progress_month: '202609' }, { service_id: 'specialforce', progress_month: '202610' }];

test('specialForce: shop lookup and claim requests (method/url/headers/body/timeout)', async t => {
    const h = useHarness(t);
    const shop = specialForceShop();
    h.on('GET', FAMILY_LINKS_URL, { code: 0, value: SF_LINKS })
        .on('GET', SF_SHOP_URL, { code: 0, value: shop })
        .on('POST', SF_CLAIM_URL, { code: 0, value: { item_no: 25, category: 'ACCUMULATE_PLAY', flake_amount: 1000 } });

    const result = await getSpecialForceShop(TEST_HEADERS);
    assert.deepEqual(result, { ...shop, month: '202610' });
    assert.equal(SPECIAL_FORCE_GAME_ID, 'GM-2A26-6A4CAF50_IND');
    assert.deepEqual(await claimSpecialForceReward(TEST_HEADERS, result.accumulated_plays.rewards[0]),
        { item_no: 25, category: 'ACCUMULATE_PLAY', flake_amount: 1000 });

    assert.deepEqual(h.requests, [
        { method: 'GET', url: FAMILY_LINKS_URL, headers: EVENT_HEADERS, body: null, timeout: 15000 },
        { method: 'GET', url: SF_SHOP_URL, headers: EVENT_HEADERS, body: null, timeout: 15000 },
        { method: 'POST', url: SF_CLAIM_URL, headers: EVENT_HEADERS, body: { item_no: 25 }, timeout: 15000 }
    ]);
    assertGolden('api/special-force-requests', h.requests);
});

test('specialForce: family-links classification', async t => {
    const h = useHarness(t);
    h.on('GET', FAMILY_LINKS_URL, [
        { code: 0, value: [] },
        { code: 0, value: [{ service_id: 'specialforce' }] },
        { code: 0, value: { service_id: 'specialforce' } },
        { code: 0, value: [{ service_id: 'specialforce', progress_month: '2026-10' }] },
        { code: 1, value: [] },
        { code: 0, value: null },
        {},
        { code: 0, value: [{ service_id: 'specialforce', progress_month: 202610 }] }
    ]).on('GET', SF_SHOP_URL, { code: 7 });

    assert.deepEqual(await getSpecialForceShop(TEST_HEADERS), { notAvailable: true });
    assert.deepEqual(await getSpecialForceShop(TEST_HEADERS), { notAvailable: true });
    await assert.rejects(getSpecialForceShop(TEST_HEADERS), { message: '행사 목록 형식 확인 실패' });
    await assert.rejects(getSpecialForceShop(TEST_HEADERS), { message: '행사 월 형식 확인 실패' });
    await assert.rejects(getSpecialForceShop(TEST_HEADERS), { message: '스페셜포스 API 확인 실패 (code=1)' });
    await assert.rejects(getSpecialForceShop(TEST_HEADERS), { message: '스페셜포스 API 확인 실패 (code=0)' });
    await assert.rejects(getSpecialForceShop(TEST_HEADERS), { message: '스페셜포스 API 확인 실패 (code=없음)' });
    // The shop lookup response goes through the same code/value check.
    await assert.rejects(getSpecialForceShop(TEST_HEADERS), { message: '스페셜포스 API 확인 실패 (code=7)' });

    assert.equal(h.calls().filter(call => call === `GET ${FAMILY_LINKS_URL}`).length, 8);
    assert.equal(h.calls().filter(call => call === `GET ${SF_SHOP_URL}`).length, 1,
        'only a valid month reaches the shop lookup');
});

test('specialForce: numeric progress month is returned as a string', async t => {
    const h = useHarness(t);
    h.on('GET', FAMILY_LINKS_URL, { code: 0, value: [{ service_id: 'specialforce', progress_month: 202610 }] })
        .on('GET', SF_SHOP_URL, { code: 0, value: { service_id: SPECIAL_FORCE_GAME_ID, month: 'ignored' } });
    assert.deepEqual(await getSpecialForceShop(TEST_HEADERS), { service_id: SPECIAL_FORCE_GAME_ID, month: '202610' });
    assert.deepEqual(h.calls(), [`GET ${FAMILY_LINKS_URL}`, `GET ${SF_SHOP_URL}`]);
});

test('specialForce: claim validation before the request and strict response checks after it', async t => {
    const h = useHarness(t);
    const reward = { item_type: 'FLAKE', item_no: 25 };
    h.on('POST', SF_CLAIM_URL, [
        { code: 0, value: { item_no: 26, category: 'ACCUMULATE_PLAY', flake_amount: 1000 } },
        { code: 0, value: { item_no: 25, category: 'DAILY', flake_amount: 1000 } },
        { code: 0, value: { item_no: 25, category: 'ACCUMULATE_PLAY', flake_amount: -1 } },
        { code: 0, value: { item_no: 25, category: 'ACCUMULATE_PLAY', flake_amount: '1000' } },
        { code: 0, value: { item_no: 25, category: 'ACCUMULATE_PLAY' } },
        { code: 3 },
        { code: 0, value: { item_no: 25, category: 'ACCUMULATE_PLAY', flake_amount: 0, extra: true } }
    ]);

    for (const invalid of [
        { item_type: 'ITEM', item_no: 25 },
        { item_type: 'FLAKE', item_no: 0 },
        { item_type: 'FLAKE', item_no: '25' },
        { item_type: 'FLAKE', item_no: 2.5 },
        { item_type: 'FLAKE' }
    ]) {
        await assert.rejects(claimSpecialForceReward(TEST_HEADERS, invalid), { message: '지원하지 않는 스페셜포스 보상' });
    }
    assert.equal(h.requests.length, 0, 'unsupported rewards are rejected without a request');

    const mismatch = { message: '보상 응답 일치 확인 실패; 상태를 새로고침해 주세요' };
    for (let i = 0; i < 5; i++) await assert.rejects(claimSpecialForceReward(TEST_HEADERS, reward), mismatch);
    await assert.rejects(claimSpecialForceReward(TEST_HEADERS, reward), { message: '스페셜포스 API 확인 실패 (code=3)' });
    assert.deepEqual(await claimSpecialForceReward(TEST_HEADERS, reward),
        { item_no: 25, category: 'ACCUMULATE_PLAY', flake_amount: 0, extra: true });
    assert.equal(h.requests.length, 7, 'each claim is a single POST, never retried');
});
