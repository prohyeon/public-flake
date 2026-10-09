import { getMyProfile } from '../api/profile.js';
import { getTodayKSTString } from '../utils/time.js';

// 월간출석은 하루 한 번만 오른다. 같은 날 다시 실행하거나 실행 전에 이미 출석이
// 반영됐다면 실행 중 +1이 관측되지 않으므로, 오늘 확인된 횟수를 계정별로 기록해 둔다.
export const MONTHLY_ATTENDANCE_RECHECK_ATTEMPTS = 3;
export const MONTHLY_ATTENDANCE_RECHECK_DELAY_MS = 3000;

export const monthlyAttendanceRecordKey = userId => `stove-monthly-attendance-v1:${userId}`;

function attendanceCount(snapshot, missionNo) {
    const count = snapshot?.missions?.byMissionNo?.[missionNo]?.userCompleteCount;
    return Number.isFinite(count) ? count : null;
}

export function readMonthlyAttendanceRecord(storage, key, today) {
    try {
        const text = storage?.getItem(key);
        if (!text) return null;
        const record = JSON.parse(text);
        if (!record || record.date !== today || typeof record.counts !== 'object' ||
            record.counts === null || Array.isArray(record.counts)) {
            return null;
        }
        return record;
    } catch {
        return null;
    }
}

export async function loadMonthlyAttendanceContext(headers, deps = {}) {
    const fetchProfile = deps.getMyProfile || getMyProfile;
    const storage = deps.storage === undefined ? globalThis.localStorage : deps.storage;
    const today = deps.today || getTodayKSTString();
    try {
        const profile = await fetchProfile(headers);
        const userId = profile?.value?.user_id;
        if (profile?.code !== 0 || !/^\d+$/.test(String(userId ?? '')) || !storage) return null;
        const key = monthlyAttendanceRecordKey(userId);
        return { storage, key, today, record: readMonthlyAttendanceRecord(storage, key, today) };
    } catch {
        return null;
    }
}

// 오늘 이미 +1이 확인된 횟수 이상이면 미증가가 아니라 '오늘 이미 반영'으로 분류한다.
export function applyMonthlyAttendanceRecord(diff, afterSnapshot, context) {
    const progress = diff?.monthlyAttendanceProgress;
    const counts = context?.record?.counts;
    if (!progress || !counts) return diff;

    const notIncreasedMissionNos = [];
    const alreadyCountedMissionNos = [...(progress.alreadyCountedMissionNos || [])];
    for (const missionNo of progress.notIncreasedMissionNos || []) {
        const confirmed = counts[missionNo];
        const current = attendanceCount(afterSnapshot, missionNo);
        if (Number.isFinite(confirmed) && current !== null && current >= confirmed) {
            alreadyCountedMissionNos.push(missionNo);
        } else {
            notIncreasedMissionNos.push(missionNo);
        }
    }

    return {
        ...diff,
        monthlyAttendanceProgress: { ...progress, notIncreasedMissionNos, alreadyCountedMissionNos }
    };
}

export function saveMonthlyAttendanceRecord(context, beforeSnapshot, afterSnapshot, diff) {
    const progress = diff?.monthlyAttendanceProgress;
    if (!context?.storage || !progress) return null;

    const pending = new Set([
        ...(progress.notIncreasedMissionNos || []),
        ...(progress.unknownMissionNos || [])
    ]);
    const counts = { ...(context.record?.counts || {}) };
    for (const mission of Object.values(beforeSnapshot?.missions?.byMissionNo || {})) {
        if (mission.category !== 'attendance' || pending.has(mission.missionNo)) continue;
        const before = mission.userCompleteCount;
        const after = attendanceCount(afterSnapshot, mission.missionNo);
        const alreadyCounted = (progress.alreadyCountedMissionNos || []).includes(mission.missionNo);
        if (after !== null && (alreadyCounted || (Number.isFinite(before) && after - before >= 1))) {
            counts[mission.missionNo] = Math.max(after, counts[mission.missionNo] ?? after);
        }
    }
    if (Object.keys(counts).length === 0) return null;

    const record = { date: context.today, counts };
    try {
        context.storage.setItem(context.key, JSON.stringify(record));
        context.record = record;
        return record;
    } catch {
        return null;
    }
}
