// Wall-clock time per runAutomation step, printed in the panel log so slow steps can be found.
// Timing never awaits or wraps a promise chain: it only reads the clock, so task interleaving
// (and every request/delay the run makes) is unchanged.
import { getTimestamp } from '../utils/time.js';

const SECTION_ORDER = ['준비', '그룹', '백그라운드', '마무리'];

export function formatSeconds(ms) {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
}

function shortTaskId(id) {
    return String(id).split(':').pop();
}

export function createRunTiming(now = getTimestamp) {
    const startedAt = now();
    const phases = [];
    const taskMs = new Map();
    const groupStartedAt = new Map();

    function record(section, label, ms) {
        if (section) phases.push({ section, label, ms });
        return ms;
    }

    return {
        /** Starts a step; the returned function records and returns its elapsed ms. */
        start(section, label) {
            const begin = now();
            return () => record(section, label, now() - begin);
        },

        startGroup(id) {
            groupStartedAt.set(id, now());
        },

        /** Elapsed ms since startGroup(id); recorded under `section` unless it is null. */
        endGroup(section, id) {
            const begin = groupStartedAt.get(id) ?? now();
            return record(section, id, now() - begin);
        },

        record,

        /** Copies the plan so each task records how long its run() took to settle. */
        timeTasks(plan) {
            const groups = plan.groups.map(group => ({
                ...group,
                tasks: group.tasks.map(task => ({
                    ...task,
                    run: () => {
                        const begin = now();
                        const settle = () => { taskMs.set(task.id, now() - begin); };
                        let result;
                        try {
                            result = task.run();
                        } catch (error) {
                            settle();
                            throw error;
                        }
                        // Observe without chaining: the runner still awaits the original value.
                        if (result && typeof result.then === 'function') result.then(settle, settle);
                        else settle();
                        return result;
                    }
                }))
            }));
            return { ...plan, groups };
        },

        taskMs(id) {
            return taskMs.get(id);
        },

        /** " · 1.2초", plus per-task times when more than one foreground task ran. */
        groupSuffix(ms, results = []) {
            const timed = results
                .filter(result => result.status !== 'background' && taskMs.has(result.id))
                .map(result => `${shortTaskId(result.id)} ${formatSeconds(taskMs.get(result.id))}`);
            return ` · ${formatSeconds(ms)}${timed.length > 1 ? ` (${timed.join(' · ')})` : ''}`;
        },

        summaryLines() {
            const lines = [`⏱ 단계별 소요 시간 · 총 ${formatSeconds(now() - startedAt)}`];
            const sections = [...new Set([...SECTION_ORDER, ...phases.map(phase => phase.section)])];
            for (const section of sections) {
                const items = phases.filter(phase => phase.section === section);
                if (items.length === 0) continue;
                lines.push(`  ${section}: ${items.map(item => `${shortTaskId(item.label)} ${formatSeconds(item.ms)}`).join(' · ')}`);
            }
            return lines;
        }
    };
}
