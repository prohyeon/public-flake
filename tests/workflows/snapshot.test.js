import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';
import { getTodayKSTString } from '../../src/utils/time.js';
import {
    captureAutomationSnapshot,
    compareSnapshots,
    getSnapshotSummary,
    normalizeMissionSnapshot
} from '../../src/workflows/snapshot.js';

let originalMissionComponents;

function resetMissionComponents() {
    state.missionComponents = {
        daily: null,
        content: null,
        weekly: null,
        survey: null,
        banner: null,
        attendance: null
    };
}

beforeEach(() => {
    originalMissionComponents = { ...state.missionComponents };
});

afterEach(() => {
    state.missionComponents = originalMissionComponents;
});

test('normalizeMissionSnapshot indexes missions by mission number and category', () => {
    resetMissionComponents();
    state.missionComponents.weekly = 200;

    const snapshot = normalizeMissionSnapshot([
        {
            componentNo: 100,
            component_info: { component_type: 'SINGLE' },
            missions: [
                { mission_no: 1, title: 'Daily visit', status: 'COMPLETE', mission_type: 'VISIT', is_visit_mission: true, reward_amount: 10, button_url: 'https://daily.example' }
            ]
        },
        {
            componentNo: 200,
            component_info: { component_type: 'ACCUMULATION' },
            missions: [
                { mission_no: 2, title: 'Weekly work', status: 'RECEIVABLE', mission_type: 'WEEKLY', reward_amount: 20 }
            ]
        },
        {
            componentNo: 300,
            component_info: { component_type: 'ACCUMULATION' },
            missions: [
                { mission_no: 3, title: 'Attendance work', status: 'INCOMPLETE', mission_type: 'ATTENDANCE', url: 'https://attendance.example' }
            ]
        },
        {
            componentNo: 400,
            component_info: { component_type: 'CONTENT1' },
            missions: [
                { mission_no: 4, title: 'Content work', status: 'INCOMPLETE' }
            ]
        },
        {
            componentNo: 500,
            component_info: { component_type: 'SURVEY' },
            missions: [
                { mission_no: 5, title: 'Survey work', status: 'INCOMPLETE' }
            ]
        },
        {
            componentNo: 600,
            component_info: { component_type: 'BANNER' },
            missions: [
                { mission_no: 6, title: 'Banner work', status: 'INCOMPLETE' }
            ]
        },
        {
            componentNo: 700,
            component_info: { component_type: 'UNKNOWN' },
            missions: [
                { mission_no: 7, title: 'Other work', status: 'INCOMPLETE' }
            ]
        }
    ], { missionComponents: { weekly: 200, attendance: 300 } });

    assert.equal(snapshot.byMissionNo[1].category, 'daily');
    assert.equal(snapshot.byMissionNo[1].buttonUrl, 'https://daily.example');
    assert.equal(snapshot.byMissionNo[2].category, 'weekly');
    assert.equal(snapshot.byMissionNo[3].category, 'attendance');
    assert.equal(snapshot.byMissionNo[4].category, 'content');
    assert.equal(snapshot.byMissionNo[5].category, 'survey');
    assert.equal(snapshot.byMissionNo[6].category, 'banner');
    assert.equal(snapshot.byMissionNo[7].category, 'other');
    assert.deepEqual(snapshot.categories.daily.complete.map(mission => mission.missionNo), [1]);
    assert.deepEqual(snapshot.categories.weekly.receivable.map(mission => mission.missionNo), [2]);
    assert.deepEqual(snapshot.categories.attendance.incomplete.map(mission => mission.missionNo), [3]);
    assert.deepEqual(Object.keys(snapshot.categories), ['daily', 'content', 'weekly', 'banner', 'attendance', 'survey', 'other']);
});

test('compareSnapshots reports still-incomplete planned missions', () => {
    const result = compareSnapshots(
        { articleWrite: { hasWrittenToday: false } },
        {
            articleWrite: { hasWrittenToday: false },
            missions: {
                byMissionNo: {
                    10: { status: 'INCOMPLETE' },
                    11: { status: 'RECEIVABLE' },
                    12: { status: 'COMPLETED' }
                }
            },
            roulette: { remaining: 1 },
            shop: { unclaimedDaily: [1, 2] },
            majak: { unclaimedDaily: [3] },
            rouletteExtra: { claimable: [4] }
        },
        { plannedMissionNos: [10, 11, 12] }
    );

    assert.deepEqual(result, {
        articleStillMissing: true,
        rouletteStillRemaining: true,
        incompleteMissionNos: [10],
        unclaimedDailyShop: 2,
        unclaimedMajakShop: 1,
        claimableExtra: 1
    });
});

test('compareSnapshots treats missing planned mission in after snapshot as incomplete', () => {
    const result = compareSnapshots(
        {},
        { missions: { byMissionNo: { 21: { status: 'COMPLETE' } } } },
        { plannedMissionNos: [21, 22] }
    );

    assert.deepEqual(result.incompleteMissionNos, [22]);
});

test('getSnapshotSummary counts completed and incomplete work', () => {
    const summary = getSnapshotSummary({
        articleWrite: { hasWrittenToday: true },
        roulette: { remaining: 3 },
        missions: normalizeMissionSnapshot([
            {
                componentNo: 100,
                component_info: { component_type: 'SINGLE' },
                missions: [
                    { mission_no: 1, title: 'Done one', status: 'COMPLETE' },
                    { mission_no: 2, title: 'Done two', status: 'COMPLETED' },
                    { mission_no: 3, title: 'Ready', status: 'RECEIVABLE' },
                    { mission_no: 4, title: 'Todo', status: 'INCOMPLETE' }
                ]
            }
        ])
    });

    assert.deepEqual(summary, {
        articleWritten: true,
        rouletteRemaining: 3,
        missions: {
            complete: 2,
            receivable: 1,
            incomplete: 1
        }
    });
});

test('captureAutomationSnapshot uses dependency overrides and survives dependency rejection', async () => {
    resetMissionComponents();
    const today = getTodayKSTString();
    const calls = [];
    const snapshot = await captureAutomationSnapshot(
        { Authorization: 'Bearer test' },
        {
            getMissionComponentIds: async () => {
                calls.push('componentIds');
                state.missionComponents.daily = 100;
                return state.missionComponents;
            },
            checkArticleWriteStatus: async () => ({ success: true, hasWrittenToday: true }),
            getAllDailyMissions: async () => [
                {
                    componentNo: 100,
                    component_info: { component_type: 'SINGLE' },
                    missions: [
                        { mission_no: 1, title: 'Daily visit', status: 'COMPLETE' }
                    ]
                }
            ],
            getRouletteSubEventNo: () => 'draw-event',
            getRouletteParticipationCount: async (headers, subEventNo) => {
                assert.equal(subEventNo, 'draw-event');
                return { value: { participation_cnt: 2 } };
            },
            getRouletteExtraSubEventNo: () => 'extra-event',
            getRouletteExtra: async (headers, subEventNo) => {
                assert.equal(subEventNo, 'extra-event');
                return {
                    value: {
                        current_cnt: 5,
                        milestones: [
                            { gift_no: 1, milestone: 3, is_received: 'N' },
                            { gift_no: 2, milestone: 5, is_received: false },
                            { gift_no: 3, milestone: 7, is_received: 'N' },
                            { gift_no: 4, milestone: 1, is_received: 'Y' }
                        ]
                    }
                };
            },
            getDailyShopRewards: async () => ({
                value: {
                    daily_attendances: {
                        rewards: [
                            { attendance_date: today, is_received: false, item_no: 10 },
                            { attendance_date: '1999-01-01', is_received: false, item_no: 11 }
                        ]
                    },
                    accumulated_attendances: {
                        rewards: [{ item_no: 20, is_received: false }]
                    }
                }
            }),
            getMajakDailyShopRewards: async () => ({
                value: {
                    daily_attendances: {
                        rewards: [{ attendance_date: today, is_received: true, item_no: 30 }]
                    },
                    accumulated_attendances: {
                        rewards: [{ item_no: 40, is_received: true }]
                    }
                }
            }),
            getTotalFlakeBalance: async () => 1000,
            getMonthlyFlakeTotal: async () => ({ value: { total_deposit_amount: 250 } })
        }
    );

    assert.deepEqual(calls, ['componentIds']);
    assert.equal(snapshot.articleWrite.hasWrittenToday, true);
    assert.equal(snapshot.missions.byMissionNo[1].status, 'COMPLETE');
    assert.equal(snapshot.roulette.current, 2);
    assert.equal(snapshot.roulette.remaining, CONFIG.roulette.maxDraws - 2);
    assert.deepEqual(snapshot.rouletteExtra.claimable.map(item => item.gift_no), [1, 2]);
    assert.deepEqual(snapshot.shop.unclaimedDaily.map(item => item.item_no), [10]);
    assert.equal(snapshot.shop.date, today);
    assert.deepEqual(snapshot.majak.unclaimedDaily, []);
    assert.equal(snapshot.majak.date, today);
    assert.equal(snapshot.flake.total, 1000);
    assert.equal(snapshot.flake.monthly, 250);
    assert.equal(snapshot.flake.rawTotal, 1000);
    assert.deepEqual(snapshot.flake.rawMonthly, { value: { total_deposit_amount: 250 } });
    assert.equal(snapshot.degraded, false);
    assert.deepEqual(snapshot.errors, {});
    assert.equal(typeof snapshot.capturedAt, 'string');
});

test('captureAutomationSnapshot marks failed sections degraded and non-actionable', async () => {
    resetMissionComponents();
    state.missionComponents.weekly = 900;

    const snapshot = await captureAutomationSnapshot(
        { Authorization: 'Bearer test' },
        {
            getMissionComponentIds: async () => ({ weekly: 900 }),
            checkArticleWriteStatus: async () => ({ success: true, hasWrittenToday: true }),
            getAllDailyMissions: async () => {
                throw new TypeError('mission failed');
            },
            getRouletteSubEventNo: () => 'draw-event',
            getRouletteParticipationCount: async () => {
                throw new Error('roulette failed');
            },
            getRouletteExtraSubEventNo: () => 'extra-event',
            getRouletteExtra: async () => ({ value: { current_cnt: 0, milestones: [] } }),
            getDailyShopRewards: async () => {
                throw new Error('shop failed');
            },
            getMajakDailyShopRewards: async () => {
                throw new Error('majak failed');
            },
            getTotalFlakeBalance: async () => ({ value: { mileage_amount: 123 } }),
            getMonthlyFlakeTotal: async () => ({ value: 45 })
        }
    );

    assert.equal(snapshot.degraded, true);
    assert.deepEqual(Object.keys(snapshot.errors).sort(), ['majak', 'missions', 'roulette', 'shop']);
    assert.deepEqual(snapshot.errors.roulette, { name: 'Error', message: 'roulette failed' });
    assert.equal(snapshot.roulette.remaining, 0);
    assert.equal(snapshot.roulette.unknown, true);
    assert.equal(snapshot.roulette.success, false);
    assert.equal(snapshot.missions.success, false);
    assert.deepEqual(snapshot.missions.byMissionNo, {});
    assert.deepEqual(snapshot.missions.categories.daily.all, []);
    assert.equal(snapshot.shop.success, false);
    assert.deepEqual(snapshot.shop.unclaimedDaily, []);
    assert.equal(snapshot.majak.success, false);
    assert.deepEqual(snapshot.majak.unclaimedDaily, []);
    assert.equal(snapshot.flake.total, 123);
    assert.equal(snapshot.flake.monthly, 45);
});

test('captureAutomationSnapshot marks resolved invalid payloads degraded and non-actionable', async () => {
    resetMissionComponents();
    state.missionComponents.daily = 100;

    const snapshot = await captureAutomationSnapshot(
        { Authorization: 'Bearer test' },
        {
            getMissionComponentIds: async () => null,
            checkArticleWriteStatus: async () => ({ success: false, error: 'profile missing' }),
            getAllDailyMissions: async () => null,
            getRouletteSubEventNo: () => 'draw-event',
            getRouletteParticipationCount: async () => ({ code: 1234, message: 'bad roulette' }),
            getRouletteExtraSubEventNo: () => 'extra-event',
            getRouletteExtra: async () => ({ value: { current_cnt: 0, milestones: [] } }),
            getDailyShopRewards: async () => ({ code: 999, message: 'bad shop' }),
            getMajakDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [] } } }),
            getTotalFlakeBalance: async () => ({ value: { mileage_amount: 'not-a-number' } }),
            getMonthlyFlakeTotal: async () => ({ value: { total_deposit_amount: null } })
        }
    );

    assert.equal(snapshot.degraded, true);
    assert.deepEqual(
        Object.keys(snapshot.errors).sort(),
        ['articleWrite', 'flake', 'missionComponents', 'missions', 'roulette', 'shop']
    );
    assert.equal(snapshot.articleWrite.success, false);
    assert.equal(snapshot.articleWrite.error, 'profile missing');
    assert.equal(snapshot.roulette.remaining, 0);
    assert.equal(snapshot.roulette.success, false);
    assert.equal(snapshot.roulette.unknown, true);
    assert.equal(snapshot.shop.success, false);
    assert.deepEqual(snapshot.shop.unclaimedDaily, []);
    assert.equal(snapshot.missions.success, false);
    assert.deepEqual(snapshot.missions.categories, {
        daily: { all: [], complete: [], receivable: [], incomplete: [] },
        content: { all: [], complete: [], receivable: [], incomplete: [] },
        weekly: { all: [], complete: [], receivable: [], incomplete: [] },
        banner: { all: [], complete: [], receivable: [], incomplete: [] },
        attendance: { all: [], complete: [], receivable: [], incomplete: [] },
        survey: { all: [], complete: [], receivable: [], incomplete: [] },
        other: { all: [], complete: [], receivable: [], incomplete: [] }
    });
    assert.deepEqual(snapshot.missions.byMissionNo, {});
    assert.equal(snapshot.flake.total, null);
    assert.equal(snapshot.flake.monthly, null);
    assert.ok(snapshot.errors.flake.total);
    assert.ok(snapshot.errors.flake.monthly);
});

test('captureAutomationSnapshot marks null roulette participation count degraded and non-actionable', async () => {
    resetMissionComponents();

    const snapshot = await captureAutomationSnapshot(
        { Authorization: 'Bearer test' },
        {
            getMissionComponentIds: async () => ({ daily: 100 }),
            checkArticleWriteStatus: async () => ({ success: true, hasWrittenToday: true }),
            getAllDailyMissions: async () => [],
            getRouletteSubEventNo: () => 'draw-event',
            getRouletteParticipationCount: async () => ({ value: { participation_cnt: null } }),
            getRouletteExtraSubEventNo: () => 'extra-event',
            getRouletteExtra: async () => ({ value: { current_cnt: 0, milestones: [] } }),
            getDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [] } } }),
            getMajakDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [] } } }),
            getTotalFlakeBalance: async () => 100,
            getMonthlyFlakeTotal: async () => 25
        }
    );

    assert.equal(snapshot.degraded, true);
    assert.ok(snapshot.errors.roulette);
    assert.equal(snapshot.roulette.success, false);
    assert.equal(snapshot.roulette.unknown, true);
    assert.equal(snapshot.roulette.remaining, 0);
});

test('captureAutomationSnapshot accepts zero roulette participation count', async () => {
    resetMissionComponents();

    const snapshot = await captureAutomationSnapshot(
        { Authorization: 'Bearer test' },
        {
            getMissionComponentIds: async () => ({ daily: 100 }),
            checkArticleWriteStatus: async () => ({ success: true, hasWrittenToday: true }),
            getAllDailyMissions: async () => [],
            getRouletteSubEventNo: () => 'draw-event',
            getRouletteParticipationCount: async () => ({ value: { participation_cnt: 0 } }),
            getRouletteExtraSubEventNo: () => 'extra-event',
            getRouletteExtra: async () => ({ value: { current_cnt: 0, milestones: [] } }),
            getDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [] } } }),
            getMajakDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [] } } }),
            getTotalFlakeBalance: async () => 100,
            getMonthlyFlakeTotal: async () => 25
        }
    );

    assert.equal(snapshot.degraded, false);
    assert.deepEqual(snapshot.errors, {});
    assert.equal(snapshot.roulette.success, true);
    assert.equal(snapshot.roulette.unknown, false);
    assert.equal(snapshot.roulette.current, 0);
    assert.equal(snapshot.roulette.remaining, CONFIG.roulette.maxDraws);
});

test('captureAutomationSnapshot marks malformed truthy rouletteExtra payload degraded and non-actionable', async () => {
    resetMissionComponents();

    const snapshot = await captureAutomationSnapshot(
        { Authorization: 'Bearer test' },
        {
            getMissionComponentIds: async () => ({ daily: 100 }),
            checkArticleWriteStatus: async () => ({ success: true, hasWrittenToday: true }),
            getAllDailyMissions: async () => [],
            getRouletteSubEventNo: () => 'draw-event',
            getRouletteParticipationCount: async () => ({ value: { participation_cnt: 0 } }),
            getRouletteExtraSubEventNo: () => 'extra-event',
            getRouletteExtra: async () => ({ value: { current_cnt: 5, milestones: 'bad' } }),
            getDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [] } } }),
            getMajakDailyShopRewards: async () => ({ value: { daily_attendances: { rewards: [] } } }),
            getTotalFlakeBalance: async () => 100,
            getMonthlyFlakeTotal: async () => 25
        }
    );

    assert.equal(snapshot.degraded, true);
    assert.ok(snapshot.errors.rouletteExtra);
    assert.equal(snapshot.rouletteExtra.success, false);
    assert.deepEqual(snapshot.rouletteExtra.milestones, []);
    assert.deepEqual(snapshot.rouletteExtra.claimable, []);
});

test('captureAutomationSnapshot marks malformed truthy shop and majak payloads degraded and non-actionable', async () => {
    resetMissionComponents();

    const snapshot = await captureAutomationSnapshot(
        { Authorization: 'Bearer test' },
        {
            getMissionComponentIds: async () => ({ daily: 100 }),
            checkArticleWriteStatus: async () => ({ success: true, hasWrittenToday: true }),
            getAllDailyMissions: async () => [],
            getRouletteSubEventNo: () => 'draw-event',
            getRouletteParticipationCount: async () => ({ value: { participation_cnt: 0 } }),
            getRouletteExtraSubEventNo: () => 'extra-event',
            getRouletteExtra: async () => ({ value: { current_cnt: 0, milestones: [] } }),
            getDailyShopRewards: async () => ({ value: { daily_attendances: 'bad' } }),
            getMajakDailyShopRewards: async () => ({ value: { accumulated_attendances: [] } }),
            getTotalFlakeBalance: async () => 100,
            getMonthlyFlakeTotal: async () => 25
        }
    );

    assert.equal(snapshot.degraded, true);
    assert.ok(snapshot.errors.shop);
    assert.ok(snapshot.errors.majak);
    assert.equal(snapshot.shop.success, false);
    assert.equal(snapshot.majak.success, false);
    assert.deepEqual(snapshot.shop.unclaimedDaily, []);
    assert.deepEqual(snapshot.majak.unclaimedDaily, []);
});
