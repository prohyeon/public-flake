import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../../src/state.js';
import { getTodayString } from '../../src/utils/time.js';
import {
    captureAutomationSnapshot,
    compareSnapshots,
    getSnapshotSummary,
    normalizeMissionSnapshot
} from '../../src/workflows/snapshot.js';

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
        }
    ]);

    assert.equal(snapshot.byMissionNo[1].category, 'daily');
    assert.equal(snapshot.byMissionNo[1].buttonUrl, 'https://daily.example');
    assert.equal(snapshot.byMissionNo[2].category, 'weekly');
    assert.equal(snapshot.byMissionNo[3].category, 'attendance');
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
    const today = getTodayString();
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
            getTotalFlakeBalance: async () => ({ value: { amount: 1000 } }),
            getMonthlyFlakeTotal: async () => {
                throw new Error('monthly failed');
            }
        }
    );

    assert.deepEqual(calls, ['componentIds']);
    assert.equal(snapshot.articleWrite.hasWrittenToday, true);
    assert.equal(snapshot.missions.byMissionNo[1].status, 'COMPLETE');
    assert.equal(snapshot.roulette.current, 2);
    assert.equal(snapshot.roulette.remaining >= 0, true);
    assert.deepEqual(snapshot.rouletteExtra.claimable.map(item => item.gift_no), [1, 2]);
    assert.deepEqual(snapshot.shop.unclaimedDaily.map(item => item.item_no), [10]);
    assert.deepEqual(snapshot.majak.unclaimedDaily, []);
    assert.deepEqual(snapshot.flake.total, { value: { amount: 1000 } });
    assert.equal(snapshot.flake.monthly, null);
    assert.equal(typeof snapshot.capturedAt, 'string');
});
