import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isTargetedSingleVisitMission,
    normalizeSingleVisitMissionOptions
} from '../../src/workflows/missions.js';

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
