import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyMonthlyAttendanceRecord,
    loadMonthlyAttendanceContext,
    monthlyAttendanceRecordKey,
    saveMonthlyAttendanceRecord
} from '../../src/workflows/monthlyAttendance.js';
import { getAutomationOutcome, recheckMonthlyAttendance } from '../../src/workflows/automation.js';

const TODAY = '2026-10-10';

function memoryStorage(initial = {}) {
    const data = { ...initial };
    return {
        data,
        getItem: key => (key in data ? data[key] : null),
        setItem: (key, value) => { data[key] = String(value); }
    };
}

const snapshotWithCount = (count, status = 'INCOMPLETE') => ({
    missions: {
        success: true,
        byMissionNo: {
            399: { missionNo: 399, category: 'attendance', status, userCompleteCount: count }
        }
    }
});

const diffWith = progress => ({
    monthlyAttendanceProgress: {
        checked: 1, increased: 0, notIncreasedMissionNos: [], unknownMissionNos: [], ...progress
    }
});

const completedRun = diff => ({
    snapshot: { degraded: false },
    diff,
    plan: { groups: [] },
    specialForceResult: { success: true },
    boostRewardResult: undefined,
    groupResults: []
});

test('second run on the same day treats unchanged monthly attendance as already counted', async () => {
    const storage = memoryStorage({
        [monthlyAttendanceRecordKey('12345')]: JSON.stringify({ date: TODAY, counts: { 399: 9 } })
    });
    const context = await loadMonthlyAttendanceContext({}, {
        getMyProfile: async () => ({ code: 0, value: { user_id: 12345 } }),
        storage,
        today: TODAY
    });

    const diff = applyMonthlyAttendanceRecord(
        diffWith({ notIncreasedMissionNos: [399] }), snapshotWithCount(9), context);

    assert.deepEqual(diff.monthlyAttendanceProgress.notIncreasedMissionNos, []);
    assert.deepEqual(diff.monthlyAttendanceProgress.alreadyCountedMissionNos, [399]);
    assert.equal(getAutomationOutcome(completedRun(diff)).success, true);
});

test('record from a previous day does not hide a missing monthly attendance increase', async () => {
    const storage = memoryStorage({
        [monthlyAttendanceRecordKey('12345')]: JSON.stringify({ date: '2026-10-09', counts: { 399: 8 } })
    });
    const context = await loadMonthlyAttendanceContext({}, {
        getMyProfile: async () => ({ code: 0, value: { user_id: '12345' } }),
        storage,
        today: TODAY
    });

    assert.equal(context.record, null);
    const diff = applyMonthlyAttendanceRecord(
        diffWith({ notIncreasedMissionNos: [399] }), snapshotWithCount(8), context);
    assert.deepEqual(diff.monthlyAttendanceProgress.notIncreasedMissionNos, [399]);
    assert.equal(getAutomationOutcome(completedRun(diff)).success, false);
});

test('missing profile disables the record without failing the run', async () => {
    const context = await loadMonthlyAttendanceContext({}, {
        getMyProfile: async () => { throw new Error('network'); },
        storage: memoryStorage(),
        today: TODAY
    });
    assert.equal(context, null);

    const diff = diffWith({ notIncreasedMissionNos: [399] });
    assert.equal(applyMonthlyAttendanceRecord(diff, snapshotWithCount(9), context), diff);
    assert.equal(saveMonthlyAttendanceRecord(context, snapshotWithCount(8), snapshotWithCount(9), diff), null);
});

test('confirmed increase is saved for the current KST day only', () => {
    const storage = memoryStorage();
    const context = { storage, key: monthlyAttendanceRecordKey('12345'), today: TODAY, record: null };

    const saved = saveMonthlyAttendanceRecord(
        context, snapshotWithCount(8), snapshotWithCount(9),
        diffWith({ increased: 1 }));
    assert.deepEqual(saved, { date: TODAY, counts: { 399: 9 } });
    assert.deepEqual(JSON.parse(storage.data[context.key]), saved);

    const notSaved = saveMonthlyAttendanceRecord(
        { storage: memoryStorage(), key: 'k', today: TODAY, record: null },
        snapshotWithCount(8), snapshotWithCount(8),
        diffWith({ notIncreasedMissionNos: [399] }));
    assert.equal(notSaved, null);
});

test('recheck after opening the reward shop uses the refreshed snapshot', async () => {
    const waits = [];
    const logs = [];
    const snapshots = [snapshotWithCount(8), snapshotWithCount(9)];
    const compare = snapshot => snapshot.missions.byMissionNo[399].userCompleteCount >= 9
        ? diffWith({ increased: 1 })
        : diffWith({ notIncreasedMissionNos: [399] });

    const result = await recheckMonthlyAttendance({
        afterSnapshot: snapshotWithCount(8),
        diff: diffWith({ notIncreasedMissionNos: [399] }),
        capture: async () => snapshots.shift(),
        compare,
        deps: {
            delay: async ms => waits.push(ms),
            writeLog: (message, type) => logs.push({ message, type }),
            attempts: 3,
            delayMs: 10
        }
    });

    assert.deepEqual(waits, [10, 10]);
    assert.equal(result.afterSnapshot.missions.byMissionNo[399].userCompleteCount, 9);
    assert.deepEqual(result.diff.monthlyAttendanceProgress.notIncreasedMissionNos, []);
    assert.equal(logs.at(-1).type, 'success');
});

test('recheck downgrades a still-unchanged count to a warning without a same-day record', async () => {
    const failed = { missions: { success: false } };
    const logs = [];
    const result = await recheckMonthlyAttendance({
        afterSnapshot: snapshotWithCount(8),
        diff: diffWith({ notIncreasedMissionNos: [399] }),
        capture: async () => failed,
        compare: () => { throw new Error('must not compare failed snapshot'); },
        deps: {
            delay: async () => {},
            writeLog: (message, type) => logs.push({ message, type }),
            attempts: 2,
            delayMs: 0
        }
    });

    assert.deepEqual(result.diff.monthlyAttendanceProgress.notIncreasedMissionNos, []);
    assert.deepEqual(result.diff.monthlyAttendanceProgress.unverifiedMissionNos, [399]);
    assert.equal(getAutomationOutcome(completedRun(result.diff)).success, true);
    assert.equal(logs.at(-1).type, 'warning');
    assert.match(logs.at(-1).message, /이미 출석했을 수 있어/);
});

test('recheck keeps unreadable monthly attendance as a failure', async () => {
    const result = await recheckMonthlyAttendance({
        afterSnapshot: snapshotWithCount(8),
        diff: diffWith({ unknownMissionNos: [399] }),
        capture: async () => ({ missions: { success: false } }),
        compare: () => { throw new Error('must not compare failed snapshot'); },
        deps: { delay: async () => {}, writeLog: () => {}, attempts: 1, delayMs: 0 }
    });

    assert.deepEqual(result.diff.monthlyAttendanceProgress.unknownMissionNos, [399]);
    assert.equal(getAutomationOutcome(completedRun(result.diff)).success, false);
});

test('unverified monthly attendance is remembered so later same-day runs skip the recheck', () => {
    const storage = memoryStorage();
    const context = { storage, key: monthlyAttendanceRecordKey('12345'), today: TODAY, record: null };

    const saved = saveMonthlyAttendanceRecord(
        context, snapshotWithCount(9), snapshotWithCount(9),
        diffWith({ unverifiedMissionNos: [399] }));
    assert.deepEqual(saved, { date: TODAY, counts: { 399: 9 } });

    const nextRun = applyMonthlyAttendanceRecord(
        diffWith({ notIncreasedMissionNos: [399] }), snapshotWithCount(9), context);
    assert.deepEqual(nextRun.monthlyAttendanceProgress.alreadyCountedMissionNos, [399]);
});
