import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    autoParticipateVisitMissions,
    isTargetedSingleVisitMission,
    normalizeSingleVisitMissionOptions
} from '../../src/workflows/missions.js';

const originalDocument = globalThis.document;

afterEach(() => {
    globalThis.document = originalDocument;
});

test('normalizeSingleVisitMissionOptions accepts task options with missionNos', () => {
    const options = normalizeSingleVisitMissionOptions({
        id: 'repairSafe:singleVisits',
        kind: 'singleVisits',
        missionNos: [21, 22, 21]
    });

    assert.equal(options.targeted, true);
    assert.deepEqual(options.targetMissionNos, [21, 22]);
});

test('normalizeSingleVisitMissionOptions accepts nested task metadata with missionNos', () => {
    const options = normalizeSingleVisitMissionOptions({
        id: 'repairSafe:singleVisits',
        kind: 'singleVisits',
        meta: { missionNos: [31] }
    });

    assert.equal(options.targeted, true);
    assert.deepEqual(options.targetMissionNos, [31]);
});

test('isTargetedSingleVisitMission ignores missions outside active missionNo filter', () => {
    const options = normalizeSingleVisitMissionOptions({ missionNos: [21, '22'] });

    assert.equal(isTargetedSingleVisitMission({ mission_no: 21 }, options), true);
    assert.equal(isTargetedSingleVisitMission({ mission_no: 22 }, options), true);
    assert.equal(isTargetedSingleVisitMission({ mission_no: 23 }, options), false);
});

test('isTargetedSingleVisitMission preserves existing behavior without missionNo filter', () => {
    const options = normalizeSingleVisitMissionOptions();

    assert.equal(options.targeted, false);
    assert.equal(isTargetedSingleVisitMission({ mission_no: 23 }, options), true);
});

test('autoParticipateVisitMissions posts visit mission, opens button URL, then claims receivable reward', async () => {
    const calls = [];
    globalThis.document = { getElementById: () => null };
    const deps = {
        getAllDailyMissions: async () => [
            {
                componentNo: 226,
                missions: [
                    {
                        mission_no: 406,
                        mission_type: 'SINGLE',
                        status: 'INCOMPLETE',
                        is_visit_mission: true,
                        title: '스토브 메인 방문하기',
                        reward_amount: 100,
                        button_url: 'https://store.onstove.com/'
                    }
                ]
            }
        ],
        participateMission: async (_headers, missionNo, componentNo) => {
            calls.push(`participate:${missionNo}:${componentNo}`);
            return { value: { status: 'RECEIVABLE', reward_amount: 100 } };
        },
        receiveMissionReward: async (_headers, missionNo, componentNo) => {
            calls.push(`receive:${missionNo}:${componentNo}`);
            return { status: 'COMPLETE', reward_amount: 100 };
        },
        openTabInBackground: (url, active) => {
            calls.push(`open:${url}:${active}`);
            return { url, active };
        },
        delay: async () => {},
        log: () => {}
    };

    const result = await autoParticipateVisitMissions({}, { missionNos: [406], deps });

    assert.deepEqual(calls, [
        'participate:406:226',
        'open:https://store.onstove.com/:false',
        'receive:406:226'
    ]);
    assert.deepEqual(
        { participated: result.participated, completed: result.completed, total: result.total },
        { participated: 1, completed: 1, total: 1 }
    );
});

test('autoParticipateVisitMissions claims already receivable visit missions', async () => {
    const calls = [];
    globalThis.document = { getElementById: () => null };
    const deps = {
        getAllDailyMissions: async () => [
            {
                componentNo: 226,
                missions: [
                    {
                        mission_no: 406,
                        mission_type: 'SINGLE',
                        status: 'RECEIVABLE',
                        is_visit_mission: true,
                        title: '스토브 메인 방문하기',
                        reward_amount: 100,
                        button_url: 'https://store.onstove.com/'
                    }
                ]
            }
        ],
        participateMission: async (_headers, missionNo, componentNo) => {
            calls.push(`participate:${missionNo}:${componentNo}`);
            return { value: { status: 'RECEIVABLE' } };
        },
        receiveMissionReward: async (_headers, missionNo, componentNo) => {
            calls.push(`receive:${missionNo}:${componentNo}`);
            return { status: 'COMPLETE', reward_amount: 100 };
        },
        openTabInBackground: (url, active) => {
            calls.push(`open:${url}:${active}`);
            return { url, active };
        },
        delay: async () => {},
        log: () => {}
    };

    const result = await autoParticipateVisitMissions({}, { missionNos: [406], deps });

    assert.deepEqual(calls, ['receive:406:226']);
    assert.equal(result.completed, 1);
});

test('autoParticipateVisitMissions attempts reward claim after no-content participate response', async () => {
    const calls = [];
    globalThis.document = { getElementById: () => null };
    const deps = {
        getAllDailyMissions: async () => [
            {
                componentNo: 226,
                missions: [
                    {
                        mission_no: 406,
                        mission_type: 'SINGLE',
                        status: 'INCOMPLETE',
                        is_visit_mission: true,
                        title: '스토브 메인 방문하기',
                        reward_amount: 100,
                        button_url: 'https://store.onstove.com/'
                    }
                ]
            }
        ],
        participateMission: async (_headers, missionNo, componentNo) => {
            calls.push(`participate:${missionNo}:${componentNo}`);
            return { success: true };
        },
        receiveMissionReward: async (_headers, missionNo, componentNo) => {
            calls.push(`receive:${missionNo}:${componentNo}`);
            return { status: 'COMPLETE', reward_amount: 100 };
        },
        openTabInBackground: (url, active) => {
            calls.push(`open:${url}:${active}`);
            return { url, active };
        },
        delay: async () => {},
        log: () => {}
    };

    const result = await autoParticipateVisitMissions({}, { missionNos: [406], deps });

    assert.deepEqual(calls, [
        'participate:406:226',
        'open:https://store.onstove.com/:false',
        'receive:406:226'
    ]);
    assert.equal(result.completed, 1);
});
