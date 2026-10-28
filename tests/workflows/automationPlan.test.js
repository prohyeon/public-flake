import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../../src/config.js';
import { normalizeMissionSnapshot } from '../../src/workflows/snapshot.js';
import {
    buildAutomationPlan,
    buildRepairPlan
} from '../../src/workflows/automationPlan.js';

function baseSnapshot(overrides = {}) {
    return {
        missions: normalizeMissionSnapshot([]),
        roulette: { success: true, unknown: false, remaining: 0 },
        rouletteExtra: { success: true, claimable: [] },
        shop: { success: true, unclaimedDaily: [] },
        majak: { success: true, unclaimedDaily: [] },
        ...overrides
    };
}

function taskKinds(group) {
    return group.tasks.map(task => task.kind);
}

function findTask(plan, kind) {
    return plan.groups.flatMap(group => group.tasks).find(task => task.kind === kind);
}

function missionSnapshot(missions) {
    return normalizeMissionSnapshot([
        {
            componentNo: 100,
            component_info: { component_type: 'SINGLE' },
            missions
        }
    ]);
}

test('buildAutomationPlan separates safe parallel and serial flake-spending groups', () => {
    const missions = missionSnapshot([
        { mission_no: 11, title: 'Visit', status: 'INCOMPLETE', is_visit_mission: true },
        { mission_no: CONFIG.prizeEntry.missionNo, title: 'Prize', status: 'INCOMPLETE', is_visit_mission: false },
        { mission_no: 13, title: 'Done visit', status: 'COMPLETE', is_visit_mission: true }
    ]);
    const plan = buildAutomationPlan(baseSnapshot({
        missions,
        roulette: { success: true, unknown: false, remaining: 2 }
    }));

    assert.deepEqual(plan.plannedMissionNos, [11]);

    const visits = plan.groups.find(group => group.id === 'visits');
    assert.equal(visits.concurrency, 1);
    assert.deepEqual(findTask(plan, 'singleVisits').missionNos, [11]);

    const flakeSpending = plan.groups.find(group => group.id === 'flakeSpending');
    assert.equal(flakeSpending.concurrency, 1);
    assert.deepEqual(taskKinds(flakeSpending), ['rouletteDraws', 'rouletteExtra', 'prizeEntry']);
    assert.equal(findTask(plan, 'rouletteDraws').spendsFlake, true);
    assert.equal(findTask(plan, 'rouletteExtra').afterRouletteDraws, true);
    assert.equal(findTask(plan, 'prizeEntry').spendsFlake, true);
});

test('buildAutomationPlan includes intended handler kinds for a fully actionable snapshot', () => {
    const missions = missionSnapshot([
        { mission_no: 11, title: 'Visit', status: 'INCOMPLETE', is_visit_mission: true },
        { mission_no: CONFIG.prizeEntry.missionNo, title: 'Prize', status: 'INCOMPLETE', is_visit_mission: false }
    ]);
    const plan = buildAutomationPlan(baseSnapshot({
        missions,
        roulette: { success: true, unknown: false, remaining: 2 },
        rouletteExtra: { success: true, claimable: [{ milestone: 1 }] },
        shop: { success: true, unclaimedDaily: [{ giftNo: 1 }] },
        majak: { success: true, unclaimedDaily: [{ giftNo: 2 }] }
    }));

    assert.deepEqual(
        plan.groups.map(group => [group.id, taskKinds(group)]),
        [
            ['setup', ['requiredPages', 'componentRefresh', 'eventRefresh']],
            ['visits', ['singleVisits', 'dailyMissions', 'contentMissions', 'bannerMissions']],
            ['missionClaims', ['weeklyMissions', 'attendanceMissions', 'surveyMissions']],
            ['flakeSpending', ['rouletteDraws', 'rouletteExtra', 'prizeEntry']],
            ['followups', ['dailyShop', 'dailyAccumulatedShop', 'majakShop']]
        ]
    );
});

test('buildAutomationPlan keeps initially claimable rouletteExtra in followups when no roulette draws are planned', () => {
    const plan = buildAutomationPlan(baseSnapshot({
        roulette: { success: true, unknown: false, remaining: 0 },
        rouletteExtra: { success: true, claimable: [{ milestone: 1 }] }
    }));

    const flakeSpending = plan.groups.find(group => group.id === 'flakeSpending');
    const followups = plan.groups.find(group => group.id === 'followups');

    assert.equal(flakeSpending, undefined);
    assert.deepEqual(taskKinds(followups), ['rouletteExtra', 'dailyAccumulatedShop', 'majakShop']);
});

test('buildAutomationPlan does not schedule rouletteDraws when roulette snapshot is degraded or unknown', () => {
    const degradedPlan = buildAutomationPlan(baseSnapshot({
        roulette: { success: false, unknown: false, remaining: 5 }
    }));
    const unknownPlan = buildAutomationPlan(baseSnapshot({
        roulette: { success: true, unknown: true, remaining: 5 }
    }));

    assert.equal(findTask(degradedPlan, 'rouletteDraws'), undefined);
    assert.equal(findTask(unknownPlan, 'rouletteDraws'), undefined);
});

test('buildAutomationPlan schedules rouletteDraws when roulette success and remaining is positive', () => {
    const plan = buildAutomationPlan(baseSnapshot({
        roulette: { success: true, unknown: false, remaining: 1 }
    }));

    assert.equal(findTask(plan, 'rouletteDraws').spendsFlake, true);
});

test('buildAutomationPlan schedules receivable visit missions for reward claiming', () => {
    const missions = missionSnapshot([
        { mission_no: 406, title: '스토브 메인 방문하기', status: 'RECEIVABLE', is_visit_mission: true }
    ]);
    const plan = buildAutomationPlan(baseSnapshot({ missions }));

    assert.deepEqual(plan.plannedMissionNos, [406]);
    assert.deepEqual(findTask(plan, 'singleVisits').missionNos, [406]);
});

test('buildAutomationPlan schedules prizeEntry when configured prize mission is incomplete', () => {
    const plan = buildAutomationPlan(baseSnapshot({
        missions: missionSnapshot([
            { mission_no: CONFIG.prizeEntry.missionNo, title: 'Prize', status: 'INCOMPLETE', is_visit_mission: false }
        ])
    }));

    assert.equal(findTask(plan, 'prizeEntry').spendsFlake, true);
});

test('buildAutomationPlan matches prizeEntry mission by configured title', () => {
    const plan = buildAutomationPlan(baseSnapshot({
        missions: missionSnapshot([
            { mission_no: 999999, title: CONFIG.prizeEntry.missionTitle, status: 'INCOMPLETE', is_visit_mission: false }
        ])
    }));

    assert.equal(findTask(plan, 'prizeEntry').spendsFlake, true);
});

test('buildAutomationPlan does not schedule prizeEntry without incomplete known prize mission', () => {
    const cases = [
        ['receivable', missionSnapshot([
            { mission_no: CONFIG.prizeEntry.missionNo, title: 'Prize', status: 'RECEIVABLE', is_visit_mission: false }
        ])],
        ['complete', missionSnapshot([
            { mission_no: CONFIG.prizeEntry.missionNo, title: 'Prize', status: 'COMPLETE', is_visit_mission: false }
        ])],
        ['completed', missionSnapshot([
            { mission_no: CONFIG.prizeEntry.missionNo, title: 'Prize', status: 'COMPLETED', is_visit_mission: false }
        ])],
        ['missing', missionSnapshot([
            { mission_no: 123, title: 'Other', status: 'INCOMPLETE', is_visit_mission: false }
        ])],
        ['failed missions', { success: false, byMissionNo: {} }]
    ];

    for (const [name, missions] of cases) {
        const plan = buildAutomationPlan(baseSnapshot({ missions }));

        assert.equal(findTask(plan, 'prizeEntry'), undefined, name);
    }
});

test('buildAutomationPlan does not schedule followups from missing sections', () => {
    const plan = buildAutomationPlan(baseSnapshot({
        rouletteExtra: undefined,
        shop: undefined,
        majak: undefined
    }));

    assert.equal(findTask(plan, 'rouletteExtra'), undefined);
    assert.equal(findTask(plan, 'dailyShop'), undefined);
    assert.equal(findTask(plan, 'dailyAccumulatedShop'), undefined);
    assert.equal(findTask(plan, 'majakShop'), undefined);
});

test('buildRepairPlan retries only bounded retryable categories and excludes rouletteDraws', () => {
    const plan = buildRepairPlan({
        incompleteMissionNos: [21, 22],
        unclaimedDailyShop: 1,
        claimableExtra: 2,
        unclaimedMajakShop: 0,
        rouletteStillRemaining: true
    });

    assert.deepEqual(plan.plannedMissionNos, [21, 22]);
    assert.deepEqual(plan.groups, [
        {
            id: 'repairSafe',
            concurrency: 1,
            tasks: [
                { id: 'repairSafe:singleVisits', kind: 'singleVisits', missionNos: [21, 22] },
                { id: 'repairSafe:dailyShop', kind: 'dailyShop' },
                { id: 'repairSafe:rouletteExtra', kind: 'rouletteExtra' }
            ]
        }
    ]);
    assert.equal(findTask(plan, 'rouletteDraws'), undefined);
});

test('buildRepairPlan includes majakShop when unclaimedMajakShop is positive', () => {
    const plan = buildRepairPlan({ unclaimedMajakShop: 1 });

    assert.deepEqual(plan.groups, [
        {
            id: 'repairSafe',
            concurrency: 1,
            tasks: [
                { id: 'repairSafe:majakShop', kind: 'majakShop' }
            ]
        }
    ]);
});

function categorySnapshot(statusesByType) {
    return normalizeMissionSnapshot(Object.entries(statusesByType).map(([type, statuses], index) => ({
        componentNo: 900 + index,
        component_info: { component_type: type },
        missions: statuses.map((status, missionIndex) => ({ mission_no: 9000 + index * 10 + missionIndex, title: type, status }))
    })));
}

test('buildAutomationPlan skips a mission task only when its whole category is proven complete', () => {
    const plan = buildAutomationPlan(baseSnapshot({
        missions: categorySnapshot({
            SINGLE: ['COMPLETE', 'INCOMPLETE'],
            CONTENT1: ['COMPLETE', 'COMPLETED'],
            BANNER: ['COMPLETE'],
            SURVEY: ['RECEIVABLE'],
            // ACCUMULATION is "attendance" unless it is the weekly component; no weekly component here.
            ACCUMULATION: ['COMPLETE']
        })
    }));

    assert.deepEqual(plan.skippedDone, ['contentMissions', 'bannerMissions', 'attendanceMissions']);
    assert.deepEqual(taskKinds(plan.groups.find(group => group.id === 'visits')), ['dailyMissions']);
    // weekly has no missions at all: an empty category may be a component that failed to load.
    assert.deepEqual(taskKinds(plan.groups.find(group => group.id === 'missionClaims')), ['weeklyMissions', 'surveyMissions']);
});

test('buildAutomationPlan keeps every mission task when the missions section is unknown or empty', () => {
    const everyMissionTask = ['dailyMissions', 'contentMissions', 'bannerMissions', 'weeklyMissions', 'attendanceMissions', 'surveyMissions'];
    for (const missions of [
        normalizeMissionSnapshot([]),
        { ...categorySnapshot({ CONTENT1: ['COMPLETE'] }), success: false },
        { ...categorySnapshot({ CONTENT1: ['COMPLETE'] }), unknown: true },
        undefined
    ]) {
        const plan = buildAutomationPlan(baseSnapshot({ missions }));
        assert.deepEqual(plan.skippedDone, []);
        for (const kind of everyMissionTask) assert.ok(findTask(plan, kind), kind);
    }
});
