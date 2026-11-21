import test from 'node:test';
import assert from 'node:assert/strict';

import {
    REWARD_SHOP_URL,
    focusRewardShopForMonthlyAttendanceIfNeeded,
    getAutomationOutcome
} from '../../src/workflows/automation.js';

test('focusRewardShopForMonthlyAttendanceIfNeeded logs and opens reward shop when monthly attendance did not increase', () => {
    const logs = [];
    const openedTabs = [];
    const tab = { id: 'reward-shop' };

    const result = focusRewardShopForMonthlyAttendanceIfNeeded(
        {
            monthlyAttendanceProgress: {
                checked: 1,
                increased: 0,
                notIncreasedMissionNos: [31],
                unknownMissionNos: []
            }
        },
        {
            writeLog: (message, type) => logs.push({ message, type }),
            openRewardShop: (url, active) => {
                openedTabs.push({ url, active });
                return tab;
            }
        }
    );

    assert.equal(result, tab);
    assert.deepEqual(openedTabs, [{ url: REWARD_SHOP_URL, active: true }]);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].type, 'warning');
    assert.match(logs[0].message, /월간출석 \+1/);
    assert.match(logs[0].message, /리워드샵/);
});

test('focusRewardShopForMonthlyAttendanceIfNeeded does nothing when monthly attendance increased', () => {
    const logs = [];
    const openedTabs = [];

    const result = focusRewardShopForMonthlyAttendanceIfNeeded(
        {
            monthlyAttendanceProgress: {
                checked: 1,
                increased: 1,
                notIncreasedMissionNos: [],
                unknownMissionNos: []
            }
        },
        {
            writeLog: (message, type) => logs.push({ message, type }),
            openRewardShop: (url, active) => openedTabs.push({ url, active })
        }
    );

    assert.equal(result, null);
    assert.deepEqual(openedTabs, []);
    assert.deepEqual(logs, []);
});

const completedRun = overrides => ({
    snapshot: { degraded: false },
    diff: {},
    plan: { groups: [] },
    ...overrides
});

test('automation succeeds when tasks and final verification succeed', () => {
    assert.deepEqual(getAutomationOutcome(completedRun({
        groupResults: [{ groupId: 'visits', results: [
            { id: 'visits:singleVisits', status: 'fulfilled', value: { attempted: 1, errors: [] } }
        ] }]
    })), { success: true, issues: [] });
});

test('caught failures and rejected tasks prevent a successful completion report', () => {
    for (const result of [
        { status: 'fulfilled', value: { error: true, message: 'write failed' } },
        { status: 'fulfilled', value: { success: false } },
        { status: 'rejected', reason: new Error('network error') }
    ]) {
        const outcome = getAutomationOutcome(completedRun({
            groupResults: [{ groupId: 'visits', results: [{ id: 'failed', ...result }] }]
        }));
        assert.equal(outcome.success, false);
    }
});

test('remaining snapshot items and unknown final state prevent success', () => {
    for (const diff of [
        { incompleteMissionNos: [3] },
        { unclaimedDailyShop: 1 },
        { unclaimedMajakShop: 1 },
        { claimableExtra: 1 },
        { monthlyAttendanceProgress: { notIncreasedMissionNos: [31] } },
        { monthlyAttendanceProgress: { unknownMissionNos: [31] } }
    ]) {
        assert.equal(getAutomationOutcome(completedRun({ diff })).success, false);
    }
    assert.equal(getAutomationOutcome(completedRun({ snapshot: { degraded: true } })).success, false);
});

test('remaining roulette draws prevent success only when roulette was enabled and planned', () => {
    const input = completedRun({
        diff: { rouletteStillRemaining: true },
        plan: { groups: [{ tasks: [{ kind: 'rouletteDraws' }] }] },
        rouletteEnabled: true
    });
    assert.equal(getAutomationOutcome(input).success, false);
    assert.equal(getAutomationOutcome({ ...input, rouletteEnabled: false }).success, true);
    assert.equal(getAutomationOutcome({ ...input, plan: { groups: [] } }).success, true);
});

