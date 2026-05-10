import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildPointExchangePayload,
    calculateRequiredFlake,
    createPointExchangePlan,
    extractBillFlakeBalance
} from '../../src/api/pointExchange.js';

const exchangeRate = {
    exchange_id: 1,
    min_exchange_amount: 1000,
    max_exchange_amount: 100000,
    from_amount: 25,
    to_amount: 1
};

test('createPointExchangePlan targets 7700 points for 192500 flake', () => {
    const plan = createPointExchangePlan(exchangeRate, {
        pointAmount: 7700,
        requiredFlakeAmount: 192500
    });

    assert.deepEqual(plan, {
        exchangeId: 1,
        pointAmount: 7700,
        fromAmount: 192500
    });
});

test('calculateRequiredFlake applies the bill exchange ratio', () => {
    assert.equal(calculateRequiredFlake(7700, exchangeRate), 192500);
});

test('createPointExchangePlan rejects targets outside bill limits', () => {
    assert.throws(
        () => createPointExchangePlan(exchangeRate, { pointAmount: 500, requiredFlakeAmount: 12500 }),
        /minimum exchange amount/
    );
});

test('createPointExchangePlan rejects unexpected flake totals', () => {
    assert.throws(
        () => createPointExchangePlan(exchangeRate, { pointAmount: 7700, requiredFlakeAmount: 190000 }),
        /Expected 190000 flake/
    );
});

test('buildPointExchangePayload posts the required flake amount', () => {
    assert.deepEqual(
        buildPointExchangePayload({ exchangeId: 1, fromAmount: 192500 }),
        {
            client_id: 'M_STOVE_COMMUNITY',
            exchange_id: 1,
            from_amount: 192500,
            descriptions: '플레이크 전환'
        }
    );
});

test('extractBillFlakeBalance reads the bill balance response', () => {
    assert.equal(extractBillFlakeBalance({ value: { mileage_amount: 250000 } }), 250000);
    assert.equal(extractBillFlakeBalance({ value: { mileage_amount: '192500' } }), 192500);
    assert.equal(extractBillFlakeBalance({ value: {} }), null);
});
