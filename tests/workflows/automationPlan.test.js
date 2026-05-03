import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMissionSnapshot } from '../../src/workflows/snapshot.js';
import {
    buildAutomationPlan,
    buildRepairPlan
} from '../../src/workflows/automationPlan.js';

function baseSnapshot(overrides = {}) {
    return {
        articleWrite: { success: true, hasWrittenToday: false },
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

test('buildAutomationPlan separates safe parallel and serial flake-spending groups', () => {
    const missions = normalizeMissionSnapshot([
        {
            componentNo: 100,
            component_info: { component_type: 'SINGLE' },
            missions: [
                { mission_no: 11, title: 'Visit', status: 'INCOMPLETE', is_visit_mission: true },
                { mission_no: 12, title: 'Prize', status: 'INCOMPLETE', is_visit_mission: false },
                { mission_no: 13, title: 'Done visit', status: 'COMPLETE', is_visit_mission: true }
            ]
        }
    ]);
    const plan = buildAutomationPlan(baseSnapshot({
        missions,
        roulette: { success: true, unknown: false, remaining: 2 }
    }));

    assert.deepEqual(plan.plannedMissionNos, [11]);

    const community = plan.groups.find(group => group.id === 'community');
    assert.equal(community.concurrency, 3);
    assert.deepEqual(taskKinds(community), ['articleWrite', 'articleLikes', 'comments']);
    assert.equal(findTask(plan, 'comments').serialInside, true);
    assert.equal(findTask(plan, 'comments').nonAuthoritativeRepair, true);

    const visits = plan.groups.find(group => group.id === 'visits');
    assert.equal(visits.concurrency, 4);
    assert.deepEqual(findTask(plan, 'singleVisits').missionNos, [11]);

    const flakeSpending = plan.groups.find(group => group.id === 'flakeSpending');
    assert.equal(flakeSpending.concurrency, 1);
    assert.ok(taskKinds(flakeSpending).includes('rouletteDraws'));
    assert.ok(taskKinds(flakeSpending).includes('prizeEntry'));
    assert.equal(findTask(plan, 'rouletteDraws').spendsFlake, true);
    assert.equal(findTask(plan, 'prizeEntry').spendsFlake, true);
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

test('buildAutomationPlan skips articleWrite after writing today but keeps article engagement tasks', () => {
    const plan = buildAutomationPlan(baseSnapshot({
        articleWrite: { success: true, hasWrittenToday: true }
    }));
    const community = plan.groups.find(group => group.id === 'community');

    assert.deepEqual(taskKinds(community), ['articleLikes', 'comments']);
});

test('buildRepairPlan retries only bounded retryable categories and excludes rouletteDraws', () => {
    const plan = buildRepairPlan({
        articleStillMissing: true,
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
                { id: 'repairSafe:articleWrite', kind: 'articleWrite' },
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
