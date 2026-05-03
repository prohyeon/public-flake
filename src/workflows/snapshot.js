import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { getTodayString } from '../utils/time.js';
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

function getMissionCategory(componentNo, componentType) {
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
            return componentNo === state.missionComponents.weekly ? 'weekly' : 'attendance';
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

function normalizeRoulette(rouletteResult) {
    const current = rouletteResult?.value?.participation_cnt || 0;
    const limit = CONFIG.roulette.maxDraws;
    return {
        raw: rouletteResult,
        current,
        limit,
        remaining: Math.max(0, limit - current)
    };
}

function normalizeRouletteExtra(extraResult) {
    const value = extraResult?.value || {};
    const current = value.current_cnt || 0;
    const milestones = Array.isArray(value.milestones) ? value.milestones : [];
    const claimable = milestones.filter(milestone =>
        current >= (milestone.milestone || 0) &&
        !isReceived(milestone.received_yn ?? milestone.is_received)
    );

    return {
        raw: extraResult,
        current,
        currentCycle: value.current_cycle ?? null,
        milestones,
        claimable
    };
}

function normalizeShop(shopResult) {
    const value = shopResult?.value || {};
    const dailyAttendances = value.daily_attendances || null;
    const accumulatedAttendances = value.accumulated_attendances || null;
    const dailyRewards = Array.isArray(dailyAttendances?.rewards) ? dailyAttendances.rewards : [];
    const todayString = getTodayString();
    const unclaimedDaily = dailyRewards.filter(reward =>
        reward.attendance_date === todayString && !isReceived(reward.is_received)
    );

    return {
        raw: shopResult,
        dailyAttendances,
        accumulatedAttendances,
        unclaimedDaily
    };
}

async function settleSnapshotPart(factory) {
    try {
        return await factory();
    } catch {
        return null;
    }
}

export function normalizeMissionSnapshot(components = []) {
    const categories = emptyCategories();
    const byMissionNo = {};

    for (const component of Array.isArray(components) ? components : []) {
        const componentNo = component?.componentNo;
        const componentType = component?.component_info?.component_type;
        const category = getMissionCategory(componentNo, componentType);
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

    return { categories, byMissionNo };
}

export async function captureAutomationSnapshot(headers, deps = {}) {
    const services = { ...defaultServices, ...deps };

    if (!Object.values(state.missionComponents).some(Boolean)) {
        await settleSnapshotPart(() => services.getMissionComponentIds(headers));
    }

    const [
        articleWrite,
        missionComponents,
        rouletteResult,
        rouletteExtraResult,
        shopResult,
        majakResult,
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

    return {
        capturedAt: new Date().toISOString(),
        articleWrite,
        missions: normalizeMissionSnapshot(missionComponents || []),
        roulette: normalizeRoulette(rouletteResult),
        rouletteExtra: normalizeRouletteExtra(rouletteExtraResult),
        shop: normalizeShop(shopResult),
        majak: normalizeShop(majakResult),
        flake: {
            total: flakeTotal,
            monthly: flakeMonthly
        }
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
