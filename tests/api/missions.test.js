import test from 'node:test';
import assert from 'node:assert/strict';

import * as missionsApi from '../../src/api/missions.js';

const julyMissionComponents = [
    { component_no: 272, type: 'SINGLE', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-31T23:59:59' },
    { component_no: 273, type: 'SINGLE', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-31T23:59:59' },
    { component_no: 271, type: 'SINGLE', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-31T23:59:59' },
    { component_no: 274, type: 'ACCUMULATION', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-07T23:59:59' },
    { component_no: 280, type: 'CONTENT1', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-31T23:59:59' },
    { component_no: 281, type: 'SURVEY', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-31T23:59:59' },
    { component_no: 282, type: 'ACHIEVEMENT', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-31T23:59:59' },
    { component_no: 283, type: 'BANNER', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-31T23:59:59' },
    { component_no: 284, type: 'ACCUMULATION', start_dt: '2026-07-01T00:00:00', end_dt: '2026-07-31T23:59:59' }
];

test('mapMissionComponentIds preserves every active SINGLE component from the reward page', () => {
    assert.equal(typeof missionsApi.mapMissionComponentIds, 'function');

    const components = missionsApi.mapMissionComponentIds(julyMissionComponents, {
        now: new Date('2026-07-06T12:00:00+09:00')
    });

    assert.deepEqual(components.dailyComponents, [272, 273, 271]);
    assert.equal(components.daily, 271);
    assert.deepEqual(
        missionsApi.getMissionComponentNos(components),
        [272, 273, 271, 280, 274, 281, 283, 284]
    );
});

test('getMissionComponentNos supports legacy state with only a single daily component', () => {
    assert.equal(typeof missionsApi.getMissionComponentNos, 'function');

    assert.deepEqual(
        missionsApi.getMissionComponentNos({
            daily: 100,
            dailyComponents: [],
            content: 200,
            weekly: null,
            survey: 300,
            banner: null,
            attendance: null
        }),
        [100, 200, 300]
    );
});
