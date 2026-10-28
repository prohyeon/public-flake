import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, resetRunProgress } from '../src/state.js';

test('createInitialState returns independent objects', () => {
    const a = createInitialState();
    const b = createInitialState();
    a.earnings.roulette = 10;
    a.missionComponents.dailyComponents.push(1);
    assert.equal(b.earnings.roulette, 0);
    assert.deepEqual(b.missionComponents.dailyComponents, []);
});

test('resetRunProgress zeroes per-run flags and earnings and keeps loaded ids and balances', () => {
    const target = createInitialState();
    target.isRunning = true;
    target.completed.roulette = true;
    target.earnings.majak = 30;
    target.missionComponents.daily = 226;
    target.rouletteEvents.draw = '100';
    target.prizeInfo.giftNo = 9;
    target.pointCashCharge.availableFlake = 1234;

    resetRunProgress(target);

    const initial = createInitialState();
    assert.deepEqual(target.completed, initial.completed);
    assert.deepEqual(target.earnings, initial.earnings);
    assert.equal(target.isRunning, true);
    assert.equal(target.missionComponents.daily, 226);
    assert.equal(target.rouletteEvents.draw, '100');
    assert.equal(target.prizeInfo.giftNo, 9);
    assert.equal(target.pointCashCharge.availableFlake, 1234);
});
