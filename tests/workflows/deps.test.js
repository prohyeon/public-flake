// The workflow steps accept an optional deps object (services pattern) so they can be
// unit-tested without the GM harness. These tests pin that seam.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../../src/config.js';
import { resetState, resetConfig } from '../helpers/gmHarness.js';
import { state } from '../../src/state.js';
import { claimDailyShopRewards } from '../../src/workflows/shop.js';
import { runRouletteDraws } from '../../src/workflows/roulette.js';
import { checkDailyShopStatus, checkRouletteStatus } from '../../src/workflows/status.js';
import { executeWeeklyMissions } from '../../src/workflows/missions.js';
import { createAutomationTaskHandlers } from '../../src/workflows/automation.js';

beforeEach(() => {
    resetState();
    resetConfig();
});

function recorder() {
    const logs = [];
    const delays = [];
    return {
        logs,
        delays,
        deps: {
            log: (message, type) => logs.push(`[${type}] ${message}`),
            delay: async ms => { delays.push(ms); }
        }
    };
}

test('daily shop claims today\'s unclaimed rewards through injected services', async () => {
    const r = recorder();
    const claims = [];
    const earned = await claimDailyShopRewards({}, {
        ...r.deps,
        getTodayString: () => '2026-10-16',
        getDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [
            { attendance_date: '2026-10-16', is_received: false, item_no: 1, item_type: 'FLAKE', flake_amount: 30 },
            { attendance_date: '2026-10-15', is_received: false, item_no: 2, item_type: 'FLAKE', flake_amount: 99 }
        ] } } }),
        claimDailyReward: async (headers, itemNo, type) => { claims.push([itemNo, type]); return { code: 0 }; }
    });

    assert.equal(earned, 30);
    assert.deepEqual(claims, [[1, 'flake']]);
    assert.equal(state.completed.dailyShop, true);
    assert.deepEqual(r.delays, [CONFIG.delays.betweenActions]);
});

test('roulette draws stop at the injected participation limit', async () => {
    const r = recorder();
    CONFIG.roulette.maxDraws = 2;
    let count = 0;
    const net = await runRouletteDraws({}, {
        ...r.deps,
        getRouletteParticipationCount: async () => ({ value: { participation_cnt: count } }),
        executeRouletteDraw: async () => { count++; return { code: 0, value: { gift_info: { gift_price: 150, gift_name: '150 FLAKE' } } }; }
    });

    assert.equal(count, 2);
    assert.equal(net, 2 * 150 - 2 * CONFIG.roulette.drawCost);
});

test('status checks read through injected services', async () => {
    const daily = await checkDailyShopStatus({}, {
        getTodayString: () => '2026-10-16',
        getDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [
            { attendance_date: '2026-10-16', is_received: true }
        ] } } })
    });
    const roulette = await checkRouletteStatus({}, {
        getRouletteParticipationCount: async () => ({ value: { participation_cnt: 7 } })
    });

    assert.deepEqual(daily, { success: true, received: true, notReceived: false });
    assert.deepEqual(roulette, { success: true, current: 7, limit: CONFIG.roulette.maxDraws, remaining: CONFIG.roulette.maxDraws - 7 });
});

test('mission steps read and claim through injected services', async () => {
    const r = recorder();
    state.missionComponents.weekly = 401;
    const claims = [];
    await executeWeeklyMissions({}, {
        ...r.deps,
        apiRequest: async () => ({ code: 0, value: { missions: [{ mission_no: 9, title: 'w', status: 'RECEIVABLE' }] } }),
        receiveMissionReward: async (headers, missionNo, componentNo) => { claims.push([missionNo, componentNo]); return { reward_amount: 100 }; }
    });

    assert.deepEqual(claims, [[9, 401]]);
    assert.equal(state.earnings.weeklyMissions, 100);
    assert.equal(r.logs.at(-1), '[success] ✅ 위클리 미션 처리 완료!');
});

test('automation task handlers dispatch to injected steps and collect their tabs', async () => {
    const allTabs = [];
    const handlers = createAutomationTaskHandlers({
        headers: { h: 1 },
        allTabs,
        deps: {
            executeDailyMissions: async headers => { assert.deepEqual(headers, { h: 1 }); return ['tab-a', 'tab-b']; },
            claimDailyShopRewards: async () => 42
        }
    });

    assert.deepEqual(await handlers.dailyMissions(), { tabCount: 2 });
    assert.equal(await handlers.dailyShop(), 42);
    assert.deepEqual(allTabs, ['tab-a', 'tab-b']);
});
