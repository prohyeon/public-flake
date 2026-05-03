import test from 'node:test';
import assert from 'node:assert/strict';

import {
    flattenTaskResults,
    runLimited,
    runTask,
    runTaskGroups,
    waitForBackgroundTasks
} from '../../src/workflows/taskRunner.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('runTask captures successful task result', async () => {
    const result = await runTask({
        id: 'success',
        run: async () => 'done'
    });

    assert.deepEqual(result, {
        id: 'success',
        status: 'fulfilled',
        value: 'done'
    });
});

test('runTask captures rejected task result', async () => {
    const reason = new Error('failed');

    const result = await runTask({
        id: 'failure',
        run: async () => {
            throw reason;
        }
    });

    assert.deepEqual(result, {
        id: 'failure',
        status: 'rejected',
        reason
    });
});

test('runTask returns immediately for background tasks and exposes awaited result', async () => {
    let completed = false;

    const result = await runTask({
        id: 'background',
        background: true,
        run: async () => {
            await delay(30);
            completed = true;
            return 'done';
        }
    });

    assert.equal(result.id, 'background');
    assert.equal(result.status, 'background');
    assert.equal(completed, false);
    assert.deepEqual(await result.promise, {
        id: 'background',
        status: 'fulfilled',
        value: 'done'
    });
    assert.equal(completed, true);
});

test('runLimited never exceeds concurrency and preserves task order', async () => {
    let active = 0;
    let maxActive = 0;
    const completionOrder = [];
    const tasks = [
        { id: 'a', wait: 30 },
        { id: 'b', wait: 10 },
        { id: 'c', wait: 20 },
        { id: 'd', wait: 5 }
    ].map(({ id, wait }) => ({
        id,
        run: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await delay(wait);
            completionOrder.push(id);
            active -= 1;
            return id.toUpperCase();
        }
    }));

    const results = await runLimited(tasks, 2);

    assert.equal(maxActive, 2);
    assert.notDeepEqual(completionOrder, ['a', 'b', 'c', 'd']);
    assert.deepEqual(results.map(result => result.id), ['a', 'b', 'c', 'd']);
    assert.deepEqual(results.map(result => result.value), ['A', 'B', 'C', 'D']);
});

test('runLimited with empty tasks returns []', async () => {
    assert.deepEqual(await runLimited([], 3), []);
});

test('runLimited clamps concurrency <=0 to 1', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = ['a', 'b', 'c'].map(id => ({
        id,
        run: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await delay(5);
            active -= 1;
            return id;
        }
    }));

    const results = await runLimited(tasks, 0);

    assert.equal(maxActive, 1);
    assert.deepEqual(results.map(result => result.id), ['a', 'b', 'c']);
});

test('runLimited clamps non-numeric concurrency to 1', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = ['a', 'b'].map(id => ({
        id,
        run: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await delay(5);
            active -= 1;
            return id;
        }
    }));

    const results = await runLimited(tasks, Number.NaN);

    assert.equal(maxActive, 1);
    assert.deepEqual(results.map(result => result.id), ['a', 'b']);
});

test('runTaskGroups runs groups serially and tasks inside group concurrently', async () => {
    const events = [];
    let active = 0;
    let maxFirstGroupActive = 0;
    const groups = [
        {
            id: 'first',
            concurrency: 2,
            tasks: ['one', 'two'].map(id => ({
                id,
                run: async () => {
                    active += 1;
                    maxFirstGroupActive = Math.max(maxFirstGroupActive, active);
                    events.push(`first:${id}:start`);
                    await delay(15);
                    events.push(`first:${id}:done`);
                    active -= 1;
                    return id;
                }
            }))
        },
        {
            id: 'second',
            concurrency: 1,
            tasks: [
                {
                    id: 'three',
                    run: async () => {
                        events.push('second:three:start');
                        return 'three';
                    }
                }
            ]
        }
    ];

    const groupResults = await runTaskGroups(groups, {
        onGroupDone: group => events.push(`${group.id}:done`)
    });

    assert.equal(maxFirstGroupActive, 2);
    assert.deepEqual(groupResults.map(groupResult => groupResult.groupId), ['first', 'second']);
    assert.ok(events.indexOf('first:done') < events.indexOf('second:three:start'));
});

test('runTaskGroups lets following groups proceed while background tasks continue', async () => {
    const events = [];
    const groups = [
        {
            id: 'first',
            concurrency: 1,
            tasks: [
                {
                    id: 'slow-background',
                    background: true,
                    run: async () => {
                        events.push('background:start');
                        await delay(30);
                        events.push('background:done');
                        return 'slow';
                    }
                }
            ]
        },
        {
            id: 'second',
            concurrency: 1,
            tasks: [
                {
                    id: 'fast-foreground',
                    run: async () => {
                        events.push('foreground:run');
                        return 'fast';
                    }
                }
            ]
        }
    ];

    const groupResults = await runTaskGroups(groups);
    await waitForBackgroundTasks(groupResults);

    assert.equal(groupResults[0].results[0].status, 'background');
    assert.ok(events.indexOf('foreground:run') < events.indexOf('background:done'));
});

test('waitForBackgroundTasks resolves background task results with their group id', async () => {
    const groupResults = [
        {
            groupId: 'community',
            results: [
                {
                    id: 'comments',
                    status: 'background',
                    promise: Promise.resolve({
                        id: 'comments',
                        status: 'fulfilled',
                        value: { attempted: 2 }
                    })
                }
            ]
        }
    ];

    const backgroundResults = await waitForBackgroundTasks(groupResults);

    assert.deepEqual(backgroundResults, [
        {
            groupId: 'community',
            results: [
                {
                    id: 'comments',
                    status: 'fulfilled',
                    value: { attempted: 2 }
                }
            ]
        }
    ]);
});

test('runTaskGroups calls hooks in order', async () => {
    const hookCalls = [];
    const groups = [
        { id: 'alpha', tasks: [{ id: 'a', run: async () => 'A' }] },
        { id: 'beta', tasks: [] },
        { id: 'gamma' }
    ];

    const groupResults = await runTaskGroups(groups, {
        onGroupStart: group => hookCalls.push(`start:${group.id}`),
        onGroupDone: (group, results) => hookCalls.push(`done:${group.id}:${results.length}`)
    });

    assert.deepEqual(hookCalls, [
        'start:alpha',
        'done:alpha:1',
        'start:beta',
        'done:beta:0',
        'start:gamma',
        'done:gamma:0'
    ]);
    assert.deepEqual(groupResults, [
        {
            groupId: 'alpha',
            results: [{ id: 'a', status: 'fulfilled', value: 'A' }]
        },
        { groupId: 'beta', results: [] },
        { groupId: 'gamma', results: [] }
    ]);
});

test('flattenTaskResults attaches groupId', () => {
    const flattened = flattenTaskResults([
        {
            groupId: 'daily',
            results: [
                { id: 'visit', status: 'fulfilled', value: true },
                { id: 'write', status: 'rejected', reason: 'missing' }
            ]
        },
        {
            groupId: 'shop',
            results: [{ id: 'claim', status: 'fulfilled', value: 3 }]
        }
    ]);

    assert.deepEqual(flattened, [
        { groupId: 'daily', id: 'visit', status: 'fulfilled', value: true },
        { groupId: 'daily', id: 'write', status: 'rejected', reason: 'missing' },
        { groupId: 'shop', id: 'claim', status: 'fulfilled', value: 3 }
    ]);
});

test('flattenTaskResults preserves enclosing groupId when result has groupId', () => {
    const flattened = flattenTaskResults([
        {
            groupId: 'enclosing',
            results: [
                {
                    groupId: 'task-owned',
                    id: 'nested',
                    status: 'fulfilled',
                    value: true
                }
            ]
        }
    ]);

    assert.deepEqual(flattened, [
        {
            groupId: 'enclosing',
            id: 'nested',
            status: 'fulfilled',
            value: true
        }
    ]);
});
