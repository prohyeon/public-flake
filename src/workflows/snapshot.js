import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { getTodayKSTString } from '../utils/time.js';
import { getAllDailyMissions, getMissionComponentIds } from '../api/missions.js';
import {
    getRouletteParticipationCount,
    getRouletteSubEventNo,
    getRouletteExtra,
    getRouletteExtraSubEventNo
} from '../api/roulette.js';
import { getDailyShopRewards, getMajakDailyShopRewards } from '../api/shop.js';
import { getTotalFlakeBalance, getMonthlyFlakeTotal } from '../api/profile.js';
import { checkArticleWriteStatus } from './status.js';

const SNAPSHOT_CATEGORIES = ['daily', 'content', 'weekly', 'banner', 'attendance', 'survey', 'other'];
const COMPLETE_STATUSES = new Set(['COMPLETE', 'COMPLETED']);
const DONE_OR_READY_STATUSES = new Set(['COMPLETE', 'COMPLETED', 'RECEIVABLE']);

const defaultServices = {
    checkArticleWriteStatus,
    getAllDailyMissions,
    getMissionComponentIds,
    getRouletteParticipationCount,
    getRouletteSubEventNo,
    getRouletteExtra,
    getRouletteExtraSubEventNo,
    getDailyShopRewards,
    getMajakDailyShopRewards,
    getTotalFlakeBalance,
    getMonthlyFlakeTotal
};

function emptyCategories() {
    return Object.fromEntries(
        SNAPSHOT_CATEGORIES.map(category => [
            category,
            { all: [], complete: [], receivable: [], incomplete: [] }
        ])
    );
}

function getMissionCategory(componentNo, componentType, missionComponents = state.missionComponents) {
    switch (componentType) {
        case 'SINGLE':
            return 'daily';
        case 'CONTENT1':
            return 'content';
        case 'SURVEY':
            return 'survey';
        case 'BANNER':
            return 'banner';
        case 'ACCUMULATION':
            return componentNo === missionComponents.weekly ? 'weekly' : 'attendance';
        default:
            return 'other';
    }
}

function isReceived(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        return ['Y', 'YES', 'TRUE', '1'].includes(value.toUpperCase());
    }
    return false;
}

function serializeError(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error)
    };
}

function makeSnapshotError(section, message, extra = {}) {
    return {
        name: 'SnapshotValidationError',
        message,
        section,
        ...extra
    };
}

function failedSection(error, extra = {}) {
    return {
        success: false,
        error,
        ...extra
    };
}

function normalizeRoulette(rouletteResult) {
    if (!rouletteResult.ok) {
        return failedSection(rouletteResult.error, {
            raw: null,
            current: 0,
            limit: CONFIG.roulette.maxDraws,
            remaining: 0,
            unknown: true
        });
    }

    if (rouletteResult.error) {
        return failedSection(rouletteResult.error, {
            raw: rouletteResult.value ?? null,
            current: 0,
            limit: CONFIG.roulette.maxDraws,
            remaining: 0,
            unknown: true
        });
    }

    const current = rouletteResult.value.value.participation_cnt;
    const limit = CONFIG.roulette.maxDraws;
    return {
        success: true,
        raw: rouletteResult.value,
        current,
        limit,
        remaining: Math.max(0, limit - current),
        unknown: false
    };
}

function normalizeRouletteExtra(extraResult) {
    if (!extraResult.ok) {
        return failedSection(extraResult.error, {
            raw: null,
            current: 0,
            currentCycle: null,
            milestones: [],
            claimable: []
        });
    }

    if (extraResult.error) {
        return failedSection(extraResult.error, {
            raw: extraResult.value ?? null,
            current: 0,
            currentCycle: null,
            milestones: [],
            claimable: []
        });
    }

    const value = extraResult.value?.value || {};
    const current = value.current_cnt || 0;
    const milestones = Array.isArray(value.milestones) ? value.milestones : [];
    const claimable = milestones.filter(milestone =>
        current >= (milestone.milestone || 0) &&
        !isReceived(milestone.received_yn ?? milestone.is_received)
    );

    return {
        success: true,
        raw: extraResult.value,
        current,
        currentCycle: value.current_cycle ?? null,
        milestones,
        claimable
    };
}

function normalizeShop(shopResult) {
    const todayString = getTodayKSTString();

    if (!shopResult.ok) {
        return failedSection(shopResult.error, {
            raw: null,
            date: todayString,
            dailyAttendances: null,
            accumulatedAttendances: null,
            unclaimedDaily: []
        });
    }

    if (shopResult.error) {
        return failedSection(shopResult.error, {
            raw: shopResult.value ?? null,
            date: todayString,
            dailyAttendances: null,
            accumulatedAttendances: null,
            unclaimedDaily: []
        });
    }

    const value = shopResult.value?.value || {};
    const dailyAttendances = value.daily_attendances || null;
    const accumulatedAttendances = value.accumulated_attendances || null;
    const dailyRewards = Array.isArray(dailyAttendances?.rewards) ? dailyAttendances.rewards : [];
    const unclaimedDaily = dailyRewards.filter(reward =>
        reward.attendance_date === todayString && !isReceived(reward.is_received)
    );

    return {
        success: true,
        raw: shopResult.value,
        date: todayString,
        dailyAttendances,
        accumulatedAttendances,
        unclaimedDaily
    };
}

async function settleSnapshotPart(factory) {
    try {
        return { ok: true, value: await factory(), error: null };
    } catch (error) {
        return { ok: false, value: null, error: serializeError(error) };
    }
}

function hasNonzeroCode(value) {
    return Object.hasOwn(value || {}, 'code') && value.code !== 0;
}

function validateCodeResult(section, result) {
    if (!result.ok) return result;
    if (!result.value) {
        return {
            ...result,
            error: makeSnapshotError(section, `${section} returned empty payload`)
        };
    }
    if (hasNonzeroCode(result.value)) {
        return {
            ...result,
            error: makeSnapshotError(section, result.value.message || `${section} returned nonzero code`, {
                code: result.value.code
            })
        };
    }
    return result;
}

function validateRouletteResult(result) {
    const validated = validateCodeResult('roulette', result);
    if (!validated.ok || validated.error) return validated;

    const hasParticipationCount = Object.hasOwn(validated.value?.value || {}, 'participation_cnt');
    if (!hasParticipationCount) {
        return {
            ...validated,
            error: makeSnapshotError('roulette', 'Roulette payload missing participation count')
        };
    }

    return validated;
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateRouletteExtraResult(result) {
    const validated = validateCodeResult('rouletteExtra', result);
    if (!validated.ok || validated.error) return validated;

    const value = validated.value?.value;
    if (!isRecord(value) || !Array.isArray(value.milestones)) {
        return {
            ...validated,
            error: makeSnapshotError('rouletteExtra', 'Roulette extra payload missing milestones array')
        };
    }

    return validated;
}

function validateAttendanceShopResult(section, result) {
    const validated = validateCodeResult(section, result);
    if (!validated.ok || validated.error) return validated;

    const value = validated.value?.value;
    if (!isRecord(value)) {
        return {
            ...validated,
            error: makeSnapshotError(section, `${section} payload missing attendance data`)
        };
    }

    const attendanceKeys = ['daily_attendances', 'accumulated_attendances'];
    const recognizedKeys = attendanceKeys.filter(key => Object.hasOwn(value, key));
    const malformedKey = recognizedKeys.find(key => !isRecord(value[key]));

    if (recognizedKeys.length === 0 || malformedKey) {
        return {
            ...validated,
            error: makeSnapshotError(section, `${section} payload contained invalid attendance data`)
        };
    }

    return validated;
}

function hasComponentIds(value) {
    return Boolean(value && typeof value === 'object' && Object.values(value).some(componentNo => componentNo != null));
}

function extractNumericFlake(raw) {
    if (typeof raw === 'number') return raw;

    const value = raw?.value;
    if (typeof value === 'number') return value;
    if (typeof value?.mileage_amount === 'number') return value.mileage_amount;
    if (typeof value?.total_deposit_amount === 'number') return value.total_deposit_amount;
    if (typeof value?.amount === 'number') return value.amount;

    return null;
}

function normalizeFlake(totalResult, monthlyResult) {
    const errors = {};
    if (!totalResult.ok) errors.total = totalResult.error;
    if (!monthlyResult.ok) errors.monthly = monthlyResult.error;

    const total = totalResult.ok ? extractNumericFlake(totalResult.value) : null;
    const monthly = monthlyResult.ok ? extractNumericFlake(monthlyResult.value) : null;
    if (totalResult.ok && total === null) {
        errors.total = makeSnapshotError('flake', 'Unable to extract total flake balance');
    }
    if (monthlyResult.ok && monthly === null) {
        errors.monthly = makeSnapshotError('flake', 'Unable to extract monthly flake total');
    }

    return {
        success: totalResult.ok && monthlyResult.ok && Object.keys(errors).length === 0,
        error: Object.keys(errors).length > 0 ? errors : undefined,
        total,
        monthly,
        rawTotal: totalResult.ok ? totalResult.value : null,
        rawMonthly: monthlyResult.ok ? monthlyResult.value : null
    };
}

export function normalizeMissionSnapshot(components = [], options = {}) {
    const missionComponents = options.missionComponents || state.missionComponents;
    const categories = emptyCategories();
    const byMissionNo = {};

    for (const component of Array.isArray(components) ? components : []) {
        const componentNo = component?.componentNo;
        const componentType = component?.component_info?.component_type;
        const category = getMissionCategory(componentNo, componentType, missionComponents);
        const missions = Array.isArray(component?.missions) ? component.missions : [];

        for (const mission of missions) {
            const normalized = {
                missionNo: mission.mission_no,
                componentNo,
                componentType,
                category,
                title: mission.title,
                status: mission.status,
                missionType: mission.mission_type,
                isVisitMission: mission.is_visit_mission === true,
                rewardAmount: mission.reward_amount || 0,
                buttonUrl: mission.button_url || mission.url || null
            };

            categories[category].all.push(normalized);
            byMissionNo[normalized.missionNo] = normalized;

            if (COMPLETE_STATUSES.has(normalized.status)) {
                categories[category].complete.push(normalized);
            } else if (normalized.status === 'RECEIVABLE') {
                categories[category].receivable.push(normalized);
            } else if (normalized.status === 'INCOMPLETE') {
                categories[category].incomplete.push(normalized);
            }
        }
    }

    return { success: true, categories, byMissionNo };
}

export async function captureAutomationSnapshot(headers, deps = {}) {
    const services = { ...defaultServices, ...deps };
    const errors = {};

    const missionComponentResult = await settleSnapshotPart(() => services.getMissionComponentIds(headers));
    let missionComponentIds = state.missionComponents;
    if (missionComponentResult.ok && hasComponentIds(missionComponentResult.value)) {
        missionComponentIds = missionComponentResult.value;
    } else if (!missionComponentResult.ok) {
        errors.missionComponents = missionComponentResult.error;
    } else {
        errors.missionComponents = makeSnapshotError('missionComponents', 'Mission component refresh returned no component IDs');
    }

    const [
        articleWrite,
        missionComponents,
        rawRouletteResult,
        rawRouletteExtraResult,
        rawShopResult,
        rawMajakResult,
        flakeTotal,
        flakeMonthly
    ] = await Promise.all([
        settleSnapshotPart(() => services.checkArticleWriteStatus(headers)),
        settleSnapshotPart(() => services.getAllDailyMissions(headers)),
        settleSnapshotPart(() => services.getRouletteParticipationCount(headers, services.getRouletteSubEventNo())),
        settleSnapshotPart(() => services.getRouletteExtra(headers, services.getRouletteExtraSubEventNo())),
        settleSnapshotPart(() => services.getDailyShopRewards(headers)),
        settleSnapshotPart(() => services.getMajakDailyShopRewards(headers)),
        settleSnapshotPart(() => services.getTotalFlakeBalance(headers)),
        settleSnapshotPart(() => services.getMonthlyFlakeTotal(headers))
    ]);

    const rouletteResult = validateRouletteResult(rawRouletteResult);
    const rouletteExtraResult = validateRouletteExtraResult(rawRouletteExtraResult);
    const shopResult = validateAttendanceShopResult('shop', rawShopResult);
    const majakResult = validateAttendanceShopResult('majak', rawMajakResult);
    const articleWriteError = articleWrite.ok && (!articleWrite.value || articleWrite.value.success === false)
        ? makeSnapshotError('articleWrite', articleWrite.value?.error || articleWrite.value?.message || 'Article write status returned unsuccessful payload')
        : null;
    let missionsError = null;
    if (missionComponents.ok && !Array.isArray(missionComponents.value)) {
        missionsError = makeSnapshotError('missions', 'Missions payload was not an array');
    } else if (
        missionComponents.ok &&
        Object.hasOwn(errors, 'missionComponents') &&
        Array.isArray(missionComponents.value) &&
        missionComponents.value.length === 0
    ) {
        missionsError = makeSnapshotError('missions', 'Missions payload was empty after component refresh failed');
    }

    const sectionResults = {
        articleWrite: articleWriteError ? { ...articleWrite, error: articleWriteError } : articleWrite,
        missions: missionComponents,
        roulette: rouletteResult,
        rouletteExtra: rouletteExtraResult,
        shop: shopResult,
        majak: majakResult
    };

    for (const [sectionName, result] of Object.entries(sectionResults)) {
        if (!result.ok || result.error) errors[sectionName] = result.error;
    }
    if (missionsError) errors.missions = missionsError;

    const flake = normalizeFlake(flakeTotal, flakeMonthly);
    if (!flake.success) {
        errors.flake = flake.error;
    }

    const missions = missionComponents.ok && !missionsError
        ? normalizeMissionSnapshot(missionComponents.value, { missionComponents: missionComponentIds })
        : failedSection(missionComponents.error || missionsError, {
            categories: emptyCategories(),
            byMissionNo: {}
        });

    return {
        capturedAt: new Date().toISOString(),
        degraded: Object.keys(errors).length > 0,
        errors,
        articleWrite: articleWrite.ok && !articleWriteError
            ? articleWrite.value
            : failedSection(articleWrite.error || articleWriteError, articleWrite.value || {}),
        missions,
        roulette: normalizeRoulette(rouletteResult),
        rouletteExtra: normalizeRouletteExtra(rouletteExtraResult),
        shop: normalizeShop(shopResult),
        majak: normalizeShop(majakResult),
        flake
    };
}

export function compareSnapshots(before, after, plan = {}) {
    const plannedMissionNos = plan.plannedMissionNos || [];
    const afterMissions = after?.missions?.byMissionNo || {};
    const incompleteMissionNos = plannedMissionNos.filter(missionNo => {
        const mission = afterMissions[missionNo];
        return !mission || !DONE_OR_READY_STATUSES.has(mission.status);
    });

    return {
        articleStillMissing: before?.articleWrite?.hasWrittenToday === false &&
            after?.articleWrite?.hasWrittenToday === false,
        rouletteStillRemaining: (after?.roulette?.remaining || 0) > 0,
        incompleteMissionNos,
        unclaimedDailyShop: after?.shop?.unclaimedDaily?.length || 0,
        unclaimedMajakShop: after?.majak?.unclaimedDaily?.length || 0,
        claimableExtra: after?.rouletteExtra?.claimable?.length || 0
    };
}

export function getSnapshotSummary(snapshot) {
    const missions = Object.values(snapshot?.missions?.byMissionNo || {});

    return {
        articleWritten: snapshot?.articleWrite?.hasWrittenToday === true,
        rouletteRemaining: snapshot?.roulette?.remaining || 0,
        missions: {
            complete: missions.filter(mission => COMPLETE_STATUSES.has(mission.status)).length,
            receivable: missions.filter(mission => mission.status === 'RECEIVABLE').length,
            incomplete: missions.filter(mission => mission.status === 'INCOMPLETE').length
        }
    };
}
