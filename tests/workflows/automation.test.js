import test from 'node:test';
import assert from 'node:assert/strict';

import {
    REWARD_SHOP_URL,
    focusRewardShopForMonthlyAttendanceIfNeeded
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
