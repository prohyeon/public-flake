// Characterization of src/workflows/pointExchange.js through the HTTP boundary (no dependency injection,
// so refactor B's optional deps cannot mask a change). This workflow spends FLAKE: every test asserts the
// exact list of write requests, and the refusal paths assert that no write is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import { useHarness, httpError, rawText, TEST_HEADERS } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';
import { exchangeConfiguredPoints, runPointCashChargeAllInOne, runPointExchange } from '../../src/workflows/pointExchange.js';

const API = 'https://api.onstove.com';
const BILL_BALANCE_URL = `${API}/mileage/v1.0/balance?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY`;
const RATE_URL = `${API}/mileage/v1.0/exchange?from_use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY&to_deposit_rule_id=PL_STOVE_COMMUNITY_MILE_PAID&client_id=M_STOVE_COMMUNITY`;
const EXCHANGE_URL = `${API}/mileage/v1.0/exchange/point`;
const POINT_BALANCE_URL = `${API}/point/v1.0/balance?client_id=M_STOVE_PC&use_rule_id=ML_STOVE_PC_MILE_PAID`;
const CHARGE_URL = `${API}/pay/v1.0/payment/45/request/direct`;

const EXCHANGE_WRITE = `POST ${EXCHANGE_URL}`;
const CHARGE_WRITE = `POST ${CHARGE_URL}`;

const RATE_OK = { code: 0, value: { exchange_id: 1, min_exchange_amount: 1000, max_exchange_amount: 100000, from_amount: 25, to_amount: 1 } };
const EXCHANGE_OK = { code: 0, value: { exchanged_amount: 7700, residue_mileage: 57500 } };
const POINT_BALANCE_OK = { code: 0, value: { mileage_amount: 7700 } };
const CHARGE_OK = { code: 0, value: { order_no: 2605101202375031, return_url: '' } };

const PANEL_BODY = `
    <div id="stove-quest-automation">
        <button id="stove-btn-start"></button>
        <button id="stove-btn-point-cash-charge"><span id="stove-btn-point-cash-charge-status"></span></button>
        <button id="stove-btn-reward-shop"></button>
        <button id="stove-btn-status-refresh"></button>
        <div class="stove-log-section"><div id="stove-log-content"></div></div>
    </div>`;

const balanceOf = amount => ({ code: 0, value: { mileage_amount: amount } });

function setup(t, {
    balance = balanceOf(250000),
    rate = RATE_OK,
    exchange = EXCHANGE_OK,
    pointBalance = POINT_BALANCE_OK,
    charge = CHARGE_OK,
    harness = {}
} = {}) {
    const h = useHarness(t, { body: PANEL_BODY, ...harness });
    h.on('GET', BILL_BALANCE_URL, balance)
        .on('GET', RATE_URL, rate)
        .on('POST', EXCHANGE_URL, exchange)
        .on('GET', POINT_BALANCE_URL, pointBalance)
        .on('POST', CHARGE_URL, charge);
    return h;
}

const writes = h => h.requests.filter(request => request.method !== 'GET').map(request => `${request.method} ${request.url}`);
// node:timers/promises is not affected by the harness's global setTimeout replacement.
const flush = async () => {
    for (let i = 0; i < 3; i++) await sleep(2);
};

const EXCHANGE_SUCCESS_LOGS = [
    '[info] 💱 7700 포인트 교환 준비 중...',
    '[info]   💎 현재 보유: 250,000 FLAKE',
    '[info]   ✓ 필요 플레이크: 192,500 FLAKE',
    '[success] 7,700 포인트 교환 완료 (-192,500 FLAKE)',
    '[info]   💰 잔여 FLAKE: 57,500'
];

// -------------------------------------------------------------------------------------------------
// exchangeConfiguredPoints
// -------------------------------------------------------------------------------------------------

test('exchange: balance -> rate -> one exchange POST of 192,500 FLAKE for 7,700 points', async t => {
    const h = setup(t);
    const result = await exchangeConfiguredPoints(TEST_HEADERS);

    assert.deepEqual(result, { success: true, pointAmount: 7700, spentFlake: 192500, exchangedAmount: 7700, residueFlake: 57500 });
    assert.deepEqual(h.calls(), [
        `GET ${BILL_BALANCE_URL}`,
        `GET ${RATE_URL}`,
        `${EXCHANGE_WRITE} {"client_id":"M_STOVE_COMMUNITY","exchange_id":1,"from_amount":192500,"descriptions":"플레이크 전환"}`
    ]);
    assert.deepEqual(writes(h), [EXCHANGE_WRITE]);
    assert.deepEqual(h.logs(), EXCHANGE_SUCCESS_LOGS);
    assertGolden('api/point-exchange-workflow-exchange-success', h.snapshot());
});

test('exchange: refuses without any write when the balance is one FLAKE short', async t => {
    const h = setup(t, { balance: balanceOf(192499) });
    const result = await exchangeConfiguredPoints(TEST_HEADERS);

    assert.deepEqual(result, { success: false, reason: 'insufficientBalance', availableFlake: 192499, requiredFlake: 192500 });
    assert.deepEqual(h.calls(), [`GET ${BILL_BALANCE_URL}`, `GET ${RATE_URL}`]);
    assert.deepEqual(writes(h), []);
    assert.deepEqual(h.logs(), [
        '[info] 💱 7700 포인트 교환 준비 중...',
        '[info]   💎 현재 보유: 192,499 FLAKE',
        '[info]   ✓ 필요 플레이크: 192,500 FLAKE',
        '[error] 플레이크 부족: 192,499 / 192,500 FLAKE'
    ]);
    assertGolden('api/point-exchange-workflow-insufficient', h.snapshot());
});

test('exchange: an exact 192,500 balance is enough', async t => {
    const h = setup(t, { balance: balanceOf(192500) });
    assert.equal((await exchangeConfiguredPoints(TEST_HEADERS)).success, true);
    assert.deepEqual(writes(h), [EXCHANGE_WRITE]);
});

test('exchange: a null mileage amount counts as 0 FLAKE and is refused', async t => {
    const h = setup(t, { balance: balanceOf(null) });
    assert.deepEqual(await exchangeConfiguredPoints(TEST_HEADERS),
        { success: false, reason: 'insufficientBalance', availableFlake: 0, requiredFlake: 192500 });
    assert.deepEqual(writes(h), []);
    assert.equal(h.logs()[1], '[info]   💎 현재 보유: 0 FLAKE');
});

test('exchange: an unknown balance (missing amount, even an error-coded response) does not block the POST', async t => {
    for (const balance of [{ code: 0, value: {} }, { code: 55555, message: 'balance lookup failed' }, rawText('<html>login</html>')]) {
        await t.test(JSON.stringify(balance), async st => {
            const h = setup(st, { balance });
            const result = await exchangeConfiguredPoints(TEST_HEADERS);
            assert.equal(result.success, true);
            assert.deepEqual(writes(h), [EXCHANGE_WRITE], 'the exchange is posted without a known balance');
            assert.deepEqual(h.logs(), EXCHANGE_SUCCESS_LOGS.filter(line => !line.includes('현재 보유')));
        });
    }
});

test('exchange: rate lookup failures are reported with mapped messages and no write', async t => {
    const h = setup(t, {
        rate: [{ code: 55018 }, { code: 1, message: 'rate down' }, {}, { code: 0 }, rawText('oops'), { code: 55025, message: 'ignored' }]
    });
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await exchangeConfiguredPoints(TEST_HEADERS));

    assert.deepEqual(results, [
        { success: false, reason: 'rateLookupFailed', message: '최저 전환 금액보다 작습니다' },
        { success: false, reason: 'rateLookupFailed', message: 'rate down' },
        { success: false, reason: 'rateLookupFailed', message: '알 수 없는 오류' },
        { success: false, reason: 'rateLookupFailed', message: '알 수 없는 오류' },
        { success: false, reason: 'rateLookupFailed', message: '알 수 없는 오류' },
        { success: false, reason: 'rateLookupFailed', message: '포인트 적립 월간 한도를 초과했습니다' }
    ]);
    assert.deepEqual(writes(h), []);
    assert.deepEqual(h.logs().filter(line => line.startsWith('[error]')), [
        '[error] 전환 비율 조회 실패: 최저 전환 금액보다 작습니다',
        '[error] 전환 비율 조회 실패: rate down',
        '[error] 전환 비율 조회 실패: 알 수 없는 오류',
        '[error] 전환 비율 조회 실패: 알 수 없는 오류',
        '[error] 전환 비율 조회 실패: 알 수 없는 오류',
        '[error] 전환 비율 조회 실패: 포인트 적립 월간 한도를 초과했습니다'
    ]);
});

test('exchange: an unexpected rate throws before the POST', async t => {
    const h = setup(t, { rate: { code: 0, value: { ...RATE_OK.value, from_amount: 24 } } });
    await assert.rejects(exchangeConfiguredPoints(TEST_HEADERS), { message: 'Expected 192500 flake but exchange rate requires 184800' });
    assert.deepEqual(writes(h), []);
    assert.deepEqual(h.logs(), ['[info] 💱 7700 포인트 교환 준비 중...', '[info]   💎 현재 보유: 250,000 FLAKE']);
});

test('exchange: failure codes map to messages; each attempt is a single POST, never retried', async t => {
    const failures = [
        { code: 55002 }, { code: 55018 }, { code: 55019 }, { code: 55021 }, { code: 55022 }, { code: 55024 }, { code: 55025 },
        { code: 99, message: 'server says no' }, { code: 99 }, rawText('')
    ];
    const h = setup(t, { exchange: failures });
    const results = [];
    for (let i = 0; i < failures.length; i++) results.push(await exchangeConfiguredPoints(TEST_HEADERS));

    assert.deepEqual(results.map(({ reason, message, code }) => ({ reason, message, code })), [
        { reason: 'exchangeFailed', message: '플레이크 잔액이 부족합니다', code: 55002 },
        { reason: 'exchangeFailed', message: '최저 전환 금액보다 작습니다', code: 55018 },
        { reason: 'exchangeFailed', message: '최대 전환 금액을 초과했습니다', code: 55019 },
        { reason: 'exchangeFailed', message: '플레이크 사용 일일 한도를 초과했습니다', code: 55021 },
        { reason: 'exchangeFailed', message: '플레이크 사용 월간 한도를 초과했습니다', code: 55022 },
        { reason: 'exchangeFailed', message: '포인트 적립 일일 한도를 초과했습니다', code: 55024 },
        { reason: 'exchangeFailed', message: '포인트 적립 월간 한도를 초과했습니다', code: 55025 },
        { reason: 'exchangeFailed', message: 'server says no', code: 99 },
        { reason: 'exchangeFailed', message: '알 수 없는 오류', code: 99 },
        { reason: 'exchangeFailed', message: '알 수 없는 오류', code: undefined }
    ]);
    assert.ok(results.every(result => result.success === false));
    assert.equal(writes(h).length, failures.length);
    assert.equal(h.logs().at(-1), '[error] 포인트 교환 실패: 알 수 없는 오류');
});

test('exchange: success without amounts falls back to the plan; residue_flake is the second residue source', async t => {
    const h = setup(t, { exchange: [{ code: 0 }, { code: 0, value: { residue_flake: 100 } }, { code: 0, value: { residue_mileage: 0, residue_flake: 5 } }] });

    assert.deepEqual(await exchangeConfiguredPoints(TEST_HEADERS),
        { success: true, pointAmount: 7700, spentFlake: 192500, exchangedAmount: 7700, residueFlake: null });
    assert.equal(h.logs().at(-1), '[success] 7,700 포인트 교환 완료 (-192,500 FLAKE)', 'no residue line without a residue');
    assert.equal((await exchangeConfiguredPoints(TEST_HEADERS)).residueFlake, 100);
    assert.equal(h.logs().at(-1), '[info]   💰 잔여 FLAKE: 100');
    assert.equal((await exchangeConfiguredPoints(TEST_HEADERS)).residueFlake, 0);
    assert.equal(h.logs().at(-1), '[info]   💰 잔여 FLAKE: 0');
    assert.deepEqual(writes(h), [EXCHANGE_WRITE, EXCHANGE_WRITE, EXCHANGE_WRITE]);
});

test('exchange: an HTTP failure on the balance lookup rejects before any write', async t => {
    const h = setup(t, { balance: httpError(500) });
    await assert.rejects(exchangeConfiguredPoints(TEST_HEADERS), { message: 'API Error: 500 Error' });
    assert.deepEqual(h.calls(), [`GET ${BILL_BALANCE_URL}`]);
});

test('exchange: an HTTP failure on the POST rejects after exactly one write', async t => {
    const h = setup(t, { exchange: httpError(502) });
    await assert.rejects(exchangeConfiguredPoints(TEST_HEADERS), { message: 'API Error: 502 Error' });
    assert.deepEqual(writes(h), [EXCHANGE_WRITE]);
});

test('exchange: disabled in CONFIG -> no request at all', async t => {
    const h = setup(t);
    CONFIG.pointExchange.enabled = false;
    assert.deepEqual(await exchangeConfiguredPoints(TEST_HEADERS), { success: false, reason: 'disabled' });
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.logs(), ['[info] ⏭️ 포인트 교환 기능이 비활성화되어 있습니다']);
});

// -------------------------------------------------------------------------------------------------
// runPointCashChargeAllInOne
// -------------------------------------------------------------------------------------------------

test('all-in-one: exchange then charge -> exactly two writes, success notice, order number logged', async t => {
    const h = setup(t);
    const result = await runPointCashChargeAllInOne(TEST_HEADERS);

    assert.deepEqual(result, { success: true, pointAmount: 7700, chargedCash: 7700, orderNo: '2605101202375031' });
    assert.deepEqual(h.requests.map(request => `${request.method} ${request.url}`), [
        `GET ${BILL_BALANCE_URL}`,
        `GET ${RATE_URL}`,
        EXCHANGE_WRITE,
        `GET ${POINT_BALANCE_URL}`,
        CHARGE_WRITE
    ]);
    assert.deepEqual(writes(h), [EXCHANGE_WRITE, CHARGE_WRITE]);
    assert.equal(h.requests[4].body.access_token, 'test-suat');
    assert.deepEqual(h.logs(), [
        ...EXCHANGE_SUCCESS_LOGS,
        '[info] 💳 7,700 포인트로 7,700 캐시 충전 준비 중...',
        '[info]   💰 현재 포인트: 7,700 P',
        '[success] 7700 캐시 충전 완료 (주문번호: 2605101202375031)'
    ]);

    const notice = h.document.getElementById('stove-success-notice');
    assert.equal(notice.textContent, '7700 캐시 충전 성공');
    assert.equal(notice.className, 'stove-success-notice');
    assert.equal(h.document.getElementById('stove-quest-automation').firstChild, notice, 'notice is the first panel child');
    assertGolden('api/point-exchange-workflow-all-in-one-success', h.snapshot());

    await flush();
    assert.deepEqual(h.delays, [6000, 300], 'the notice hides after 6s and is removed 300ms later');
    assert.equal(h.document.getElementById('stove-success-notice'), null);
});

test('all-in-one: an insufficient FLAKE balance stops before any write or point lookup', async t => {
    const h = setup(t, { balance: balanceOf(100000) });
    assert.deepEqual(await runPointCashChargeAllInOne(TEST_HEADERS),
        { success: false, reason: 'insufficientBalance', availableFlake: 100000, requiredFlake: 192500 });
    assert.deepEqual(h.calls(), [`GET ${BILL_BALANCE_URL}`, `GET ${RATE_URL}`]);
    assert.equal(h.document.getElementById('stove-success-notice'), null);
});

test('all-in-one: a failed point-balance lookup leaves the FLAKE already exchanged (one write, no charge)', async t => {
    const h = setup(t, { pointBalance: [{ code: 54040 }, { code: 3, message: 'point api down' }, {}] });
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await runPointCashChargeAllInOne(TEST_HEADERS));

    assert.deepEqual(results, [
        { success: false, reason: 'pointBalanceLookupFailed', message: '로스트아크 포인트 설정을 찾을 수 없습니다' },
        { success: false, reason: 'pointBalanceLookupFailed', message: 'point api down' },
        { success: false, reason: 'pointBalanceLookupFailed', message: '알 수 없는 오류' }
    ]);
    assert.deepEqual(writes(h), [EXCHANGE_WRITE, EXCHANGE_WRITE, EXCHANGE_WRITE]);
    assert.equal(h.logs().at(-1), '[error] 포인트 잔액 조회 실패: 알 수 없는 오류');
});

test('all-in-one: insufficient points after the exchange skips the charge', async t => {
    const h = setup(t, { pointBalance: { code: 0, value: { mileage_amount: 7699 } } });
    assert.deepEqual(await runPointCashChargeAllInOne(TEST_HEADERS),
        { success: false, reason: 'insufficientPoints', availablePoints: 7699, requiredPoints: 7700 });
    assert.deepEqual(writes(h), [EXCHANGE_WRITE]);
    assert.deepEqual(h.logs().slice(-2), ['[info]   💰 현재 포인트: 7,699 P', '[error] 포인트 부족: 7,699 / 7,700 P']);
});

test('all-in-one: an unknown point balance does not block the charge', async t => {
    const h = setup(t, { pointBalance: { code: 0 } });
    assert.equal((await runPointCashChargeAllInOne(TEST_HEADERS)).success, true);
    assert.deepEqual(writes(h), [EXCHANGE_WRITE, CHARGE_WRITE]);
    assert.equal(h.logs().some(line => line.includes('현재 포인트')), false);
});

test('all-in-one: charge failures are reported once without a notice; a missing order number is tolerated', async t => {
    const h = setup(t, { charge: [{ code: 54040 }, { code: 9, message: 'denied' }, { code: 0, value: {} }] });

    assert.deepEqual(await runPointCashChargeAllInOne(TEST_HEADERS),
        { success: false, reason: 'cashChargeFailed', message: '로스트아크 포인트 설정을 찾을 수 없습니다', code: 54040 });
    assert.deepEqual(await runPointCashChargeAllInOne(TEST_HEADERS),
        { success: false, reason: 'cashChargeFailed', message: 'denied', code: 9 });
    assert.equal(h.document.getElementById('stove-success-notice'), null);
    assert.equal(h.logs().at(-1), '[error] 로스트아크 캐시 충전 실패: denied');

    assert.deepEqual(await runPointCashChargeAllInOne(TEST_HEADERS),
        { success: true, pointAmount: 7700, chargedCash: 7700, orderNo: null });
    assert.equal(h.logs().at(-1), '[success] 7700 캐시 충전 완료');
    assert.deepEqual(writes(h), [EXCHANGE_WRITE, CHARGE_WRITE, EXCHANGE_WRITE, CHARGE_WRITE, EXCHANGE_WRITE, CHARGE_WRITE]);
});

test('all-in-one: disabled flags are checked before any request', async t => {
    const h = setup(t);
    CONFIG.lostArkCashCharge.enabled = false;
    assert.deepEqual(await runPointCashChargeAllInOne(TEST_HEADERS), { success: false, reason: 'disabled' });
    assert.deepEqual(h.logs(), ['[info] ⏭️ 로스트아크 캐시 충전 기능이 비활성화되어 있습니다']);

    CONFIG.lostArkCashCharge.enabled = true;
    CONFIG.pointExchange.enabled = false;
    assert.deepEqual(await runPointCashChargeAllInOne(TEST_HEADERS), { success: false, reason: 'disabled' });
    assert.equal(h.logs().at(-1), '[info] ⏭️ 포인트 교환 기능이 비활성화되어 있습니다');
    assert.deepEqual(h.requests, []);
});

// -------------------------------------------------------------------------------------------------
// runPointExchange (the panel's 💱 button)
// -------------------------------------------------------------------------------------------------

const BUTTON_IDS = ['stove-btn-start', 'stove-btn-reward-shop', 'stove-btn-status-refresh', 'stove-btn-point-cash-charge'];

function buttonStates(document) {
    return Object.fromEntries(BUTTON_IDS.map(id => {
        const button = document.getElementById(id);
        return [id, { disabled: button.disabled, opacity: button.style.opacity }];
    }));
}

test('runPointExchange: locks the panel while charging, then releases it', async t => {
    let duringRun;
    const h = setup(t, {
        balance: () => {
            duringRun = { isRunning: state.isRunning, buttons: buttonStates(h.document) };
            return balanceOf(250000);
        }
    });

    assert.equal(await runPointExchange(), undefined);

    assert.deepEqual(duringRun, {
        isRunning: true,
        buttons: {
            'stove-btn-start': { disabled: true, opacity: '0.5' },
            'stove-btn-reward-shop': { disabled: true, opacity: '0.5' },
            'stove-btn-status-refresh': { disabled: true, opacity: '0.5' },
            'stove-btn-point-cash-charge': { disabled: true, opacity: '0.5' }
        }
    });
    assert.equal(state.isRunning, false);
    // The cash-charge button is re-evaluated from state.pointCashCharge.availableFlake, which setButtonState(true)
    // set to 0 (Number(null)); the successful run never refreshes it.
    assert.deepEqual(buttonStates(h.document), {
        'stove-btn-start': { disabled: false, opacity: '1' },
        'stove-btn-reward-shop': { disabled: false, opacity: '1' },
        'stove-btn-status-refresh': { disabled: false, opacity: '1' },
        'stove-btn-point-cash-charge': { disabled: true, opacity: '0.45' }
    });
    assert.equal(h.document.getElementById('stove-btn-point-cash-charge-status').textContent, '192,500 플레이크 부족');
    assert.deepEqual(state.pointCashCharge, { availableFlake: 0, hasRequiredFlake: false });
    assert.deepEqual(writes(h), [EXCHANGE_WRITE, CHARGE_WRITE]);
    assert.equal(h.logs().at(-1), '[success] 7700 캐시 충전 완료 (주문번호: 2605101202375031)');
});

test('runPointExchange: refuses to start while another run is active', async t => {
    const h = setup(t);
    state.isRunning = true;
    await runPointExchange();
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.logs(), ['[warning] 이미 실행 중입니다']);
    assert.equal(state.isRunning, true, 'the other run keeps its lock');
    assert.equal(h.document.getElementById('stove-btn-start').disabled, false, 'buttons are not touched');
});

test('runPointExchange: a missing login is logged, makes no request and releases the lock', async t => {
    const h = setup(t, { harness: { cookies: { sgs_da_uuid: 'test-uuid' } } });
    await runPointExchange();
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.logs(), ['[error] 올인원 충전 오류: Authorization token (SUAT) not found']);
    assert.equal(state.isRunning, false);
    assert.equal(h.document.getElementById('stove-btn-start').disabled, false);
});

test('runPointExchange: thrown workflow errors are logged and nothing is written', async t => {
    const h = setup(t, { rate: { code: 0, value: { ...RATE_OK.value, to_amount: 3 } } });
    await runPointExchange();
    assert.deepEqual(writes(h), []);
    assert.equal(h.logs().at(-1), '[error] 올인원 충전 오류: Point exchange amount must resolve to a whole flake amount');
    assert.equal(state.isRunning, false);
});

test('runPointExchange: an HTTP error on the charge is logged after the exchange write', async t => {
    const h = setup(t, { charge: httpError(500) });
    await runPointExchange();
    assert.deepEqual(writes(h), [EXCHANGE_WRITE, CHARGE_WRITE]);
    assert.equal(h.logs().at(-1), '[error] 올인원 충전 오류: API Error: 500 Error');
    assert.equal(h.document.getElementById('stove-success-notice'), null);
    assert.equal(state.isRunning, false);
});
