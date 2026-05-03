export async function runTask(task) {
    try {
        const value = await task.run();
        return { id: task.id, status: 'fulfilled', value };
    } catch (reason) {
        return { id: task.id, status: 'rejected', reason };
    }
}

export async function runLimited(tasks, concurrency = 1) {
    if (tasks.length === 0) return [];

    const limit = Math.min(tasks.length, Math.max(1, Math.floor(concurrency) || 1));
    const results = new Array(tasks.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < tasks.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await runTask(tasks[index]);
        }
    }

    await Promise.all(Array.from({ length: limit }, () => worker()));
    return results;
}

export async function runTaskGroups(groups, hooks = {}) {
    const groupResults = [];

    for (const group of groups) {
        hooks.onGroupStart?.(group);
        const results = await runLimited(group.tasks || [], group.concurrency);
        hooks.onGroupDone?.(group, results);
        groupResults.push({ groupId: group.id, results });
    }

    return groupResults;
}

export function flattenTaskResults(groupResults) {
    return groupResults.flatMap(groupResult =>
        groupResult.results.map(result => ({
            ...result,
            groupId: groupResult.groupId
        }))
    );
}
