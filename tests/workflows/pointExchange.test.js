import test from 'node:test';
import assert from 'node:assert/strict';

import {
    exchangeConfiguredPoints,
    runPointCashChargeAllInOne
} from '../../src/workflows/pointExchange.js';

const exchangeRateResponse = {
    code: 0,
    value: {
        exchange_id: 1,
        min_exchange_amount: 1000,
        max_exchange_amount: 100000,
        from_amount: 25,
        to_amount: 1
    }
};

test('exchangeConfiguredPoints checks balance and posts the 7700 point exchange', async () => {
    const calls = [];
    const logs = [];
    const headers = { Authorization: 'Bearer test' };

    const result = await exchangeConfiguredPoints(headers, {
        getBillFlakeBalance: async (receivedHeaders) => {
            calls.push('balance');
            assert.equal(receivedHeaders, headers);
            return { code: 0, value: { mileage_amount: 250000 } };
        },
        getPointExchangeRate: async (receivedHeaders) => {
            calls.push('rate');
            assert.equal(receivedHeaders, headers);
            return exchangeRateResponse;
        },
        exchangeFlakeForPoints: async (receivedHeaders, plan) => {
            calls.push('exchange');
            assert.equal(receivedHeaders, headers);
            assert.deepEqual(plan, {
                exchangeId: 1,
                pointAmount: 7700,
                fromAmount: 192500
            });
            return { code: 0, value: { exchanged_amount: 7700, residue_mileage: 57500 } };
        },
        log: (message, type) => logs.push({ message, type })
    });

    assert.deepEqual(calls, ['balance', 'rate', 'exchange']);
    assert.deepEqual(result, {
        success: true,
        pointAmount: 7700,
        spentFlake: 192500,
        exchangedAmount: 7700,
        residueFlake: 57500
    });
    assert.ok(logs.some(entry => entry.message.includes('7700 포인트')));
});

test('exchangeConfiguredPoints skips POST when flake balance is insufficient', async () => {
    const calls = [];

    const result = await exchangeConfiguredPoints({ Authorization: 'Bearer test' }, {
        getBillFlakeBalance: async () => {
            calls.push('balance');
            return { code: 0, value: { mileage_amount: 100000 } };
        },
        getPointExchangeRate: async () => {
            calls.push('rate');
            return exchangeRateResponse;
        },
        exchangeFlakeForPoints: async () => {
            calls.push('exchange');
            throw new Error('exchange should not be called');
        },
        log: () => {}
    });

    assert.deepEqual(calls, ['balance', 'rate']);
    assert.deepEqual(result, {
        success: false,
        reason: 'insufficientBalance',
        availableFlake: 100000,
        requiredFlake: 192500
    });
});

test('runPointCashChargeAllInOne exchanges flake and charges 7700 Lost Ark cash', async () => {
    const calls = [];
    const logs = [];
    const notices = [];
    const headers = { Authorization: 'Bearer test-token' };

    const result = await runPointCashChargeAllInOne(headers, {
        getBillFlakeBalance: async () => {
            calls.push('flakeBalance');
            return { code: 0, value: { mileage_amount: 250000 } };
        },
        getPointExchangeRate: async () => {
            calls.push('rate');
            return exchangeRateResponse;
        },
        exchangeFlakeForPoints: async () => {
            calls.push('exchange');
            return { code: 0, value: { exchanged_amount: 7700, residue_mileage: 57500 } };
        },
        getLostArkPointBalance: async (receivedHeaders) => {
            calls.push('pointBalance');
            assert.equal(receivedHeaders, headers);
            return { code: 0, value: { mileage_amount: 7700 } };
        },
        chargeLostArkCashWithPoints: async (receivedHeaders) => {
            calls.push('cashCharge');
            assert.equal(receivedHeaders, headers);
            return { code: 0, value: { order_no: 2605101202375031, return_url: '' } };
        },
        showSuccessNotice: (message) => notices.push(message),
        log: (message, type) => logs.push({ message, type })
    });

    assert.deepEqual(calls, ['flakeBalance', 'rate', 'exchange', 'pointBalance', 'cashCharge']);
    assert.deepEqual(result, {
        success: true,
        pointAmount: 7700,
        chargedCash: 7700,
        orderNo: '2605101202375031'
    });
    assert.ok(logs.some(entry => entry.message.includes('7700 캐시 충전 완료')));
    assert.ok(notices.some(message => message.includes('7700 캐시 충전 성공')));
});

test('runPointCashChargeAllInOne stops before charging when flake is insufficient', async () => {
    const calls = [];

    const result = await runPointCashChargeAllInOne({ Authorization: 'Bearer test-token' }, {
        getBillFlakeBalance: async () => {
            calls.push('flakeBalance');
            return { code: 0, value: { mileage_amount: 100000 } };
        },
        getPointExchangeRate: async () => {
            calls.push('rate');
            return exchangeRateResponse;
        },
        exchangeFlakeForPoints: async () => {
            calls.push('exchange');
            return { code: 0 };
        },
        getLostArkPointBalance: async () => {
            calls.push('pointBalance');
            return { code: 0 };
        },
        chargeLostArkCashWithPoints: async () => {
            calls.push('cashCharge');
            return { code: 0 };
        },
        log: () => {}
    });

    assert.deepEqual(calls, ['flakeBalance', 'rate']);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'insufficientBalance');
});
