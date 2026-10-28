import test from 'node:test';
import assert from 'node:assert/strict';

import { createRunTiming, formatSeconds } from '../../src/workflows/runTiming.js';

function clock(...times) {
    let index = 0;
    return () => times[Math.min(index++, times.length - 1)];
}

test('formatSeconds shows one decimal and never a negative time', () => {
    assert.equal(formatSeconds(0), '0.0초');
    assert.equal(formatSeconds(1249), '1.2초');
    assert.equal(formatSeconds(44960), '45.0초');
    assert.equal(formatSeconds(-5), '0.0초');
});

test('steps and groups are summarized by section in a fixed order, then any extra section', () => {
    const timing = createRunTiming(clock(0, 0, 800, 1000, 4500, 4500, 64200, 70000));
    const endSnapshot = timing.start('준비', '초기 스냅샷');
    assert.equal(endSnapshot(), 800);
    timing.startGroup('visits');
    assert.equal(timing.endGroup('그룹', 'visits'), 3500);
    timing.record('마무리', '상태 업데이트', 450);
    timing.record('기타', '측정', 10);
    timing.record('백그라운드', 'community:comments', 44960);
    timing.startGroup('ignored');
    assert.equal(timing.endGroup(null, 'ignored'), 59700, 'a null section is measured but not summarized');
    assert.deepEqual(timing.summaryLines(), [
        '소요 시간 · 총 70.0초',
        '  준비: 초기 스냅샷 0.8초',
        '  그룹: visits 3.5초',
        '  백그라운드: comments 45.0초',
        '  마무리: 상태 업데이트 0.5초',
        '  기타: 측정 0.0초'
    ]);
});

test('a run that recorded nothing still reports its total', () => {
    assert.deepEqual(createRunTiming(clock(1000, 3500)).summaryLines(), ['소요 시간 · 총 2.5초']);
});

test('timeTasks records sync, resolved, rejected and throwing tasks without replacing their results', async () => {
    let now = 0;
    const timing = createRunTiming(() => now);
    let resolveSlow;
    const slow = new Promise(resolve => { resolveSlow = resolve; });
    const failure = new Error('boom');
    const failed = Promise.reject(failure);
    failed.catch(() => {});
    const plan = {
        plannedMissionNos: [1],
        groups: [{
            id: 'g', concurrency: 2, tasks: [
                { id: 'g:sync', kind: 'sync', run: () => { now += 100; return 'value'; } },
                { id: 'g:slow', kind: 'slow', background: true, run: () => slow },
                { id: 'g:failed', kind: 'failed', run: () => failed },
                { id: 'g:throws', kind: 'throws', run: () => { now += 5; throw failure; } }
            ]
        }]
    };
    const timed = timing.timeTasks(plan);

    assert.notEqual(timed, plan);
    assert.deepEqual(timed.plannedMissionNos, [1]);
    assert.deepEqual(timed.groups[0].tasks.map(({ id, kind, background }) => ({ id, kind, background })),
        plan.groups[0].tasks.map(({ id, kind, background }) => ({ id, kind, background })));
    const [sync, slowTask, failedTask, throwing] = timed.groups[0].tasks;

    assert.equal(sync.run(), 'value');
    assert.equal(timing.taskMs('g:sync'), 100);

    // The runner awaits the very same promise, so timing adds no step to the task's chain.
    assert.equal(slowTask.run(), slow);
    assert.equal(timing.taskMs('g:slow'), undefined, 'not settled yet');
    now += 2000;
    resolveSlow('done');
    assert.equal(await slow, 'done');
    assert.equal(timing.taskMs('g:slow'), 2000);

    assert.equal(failedTask.run(), failed);
    await assert.rejects(failed, failure);
    assert.equal(timing.taskMs('g:failed'), 0);

    assert.throws(() => throwing.run(), failure);
    assert.equal(timing.taskMs('g:throws'), 5);
});

test('groupSuffix lists per-task times only when several foreground tasks were timed', () => {
    let now = 0;
    const timing = createRunTiming(() => now);
    const timed = timing.timeTasks({
        groups: [{
            id: 'visits', tasks: [
                { id: 'visits:singleVisits', run: () => { now += 2600; } },
                { id: 'visits:bannerMissions', run: () => { now += 4150; } },
                { id: 'community:comments', run: () => { now += 1; } }
            ]
        }]
    });
    for (const task of timed.groups[0].tasks) task.run();

    assert.equal(timing.groupSuffix(6750, [
        { id: 'visits:singleVisits', status: 'fulfilled' },
        { id: 'visits:bannerMissions', status: 'rejected' },
        { id: 'community:comments', status: 'background' }
    ]), ' · 6.8초 (singleVisits 2.6초 · bannerMissions 4.2초)');
    assert.equal(timing.groupSuffix(2600, [{ id: 'visits:singleVisits', status: 'fulfilled' }]), ' · 2.6초');
    assert.equal(timing.groupSuffix(0, [{ id: 'untimed', status: 'fulfilled' }]), ' · 0.0초');
});
