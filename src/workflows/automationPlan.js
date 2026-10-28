import { CONFIG } from '../config.js';

function task(id, kind, meta = {}) {
    return { id, kind, ...meta };
}

function group(id, concurrency, tasks) {
    const filteredTasks = tasks.filter(Boolean);
    if (filteredTasks.length === 0) return null;
    return { id, concurrency, tasks: filteredTasks };
}

function filterGroups(groups) {
    return groups.filter(Boolean);
}

function isSectionKnown(section) {
    return Boolean(section) && section.success !== false && section.unknown !== true;
}

// A mission task is skipped only when the snapshot proves its whole category is done: the section
// is known, the category has missions and every one is COMPLETE. "Nothing receivable yet" is not
// enough because missions become receivable mid-run (the reward-shop visit counts monthly
// attendance), and an empty category may be a component that failed to load.
const MISSION_TASK_CATEGORIES = {
    dailyMissions: 'daily',
    contentMissions: 'content',
    bannerMissions: 'banner',
    weeklyMissions: 'weekly',
    attendanceMissions: 'attendance',
    surveyMissions: 'survey'
};

function isCategoryDone(snapshot, category) {
    if (!isSectionKnown(snapshot?.missions)) return false;
    const missions = snapshot.missions.categories?.[category];
    return Boolean(missions) && missions.all.length > 0 && missions.complete.length === missions.all.length;
}

function getVisitMissionNos(snapshot) {
    return Object.values(snapshot?.missions?.byMissionNo || {})
        .filter(mission =>
            mission.category === 'daily' &&
            (mission.status === 'INCOMPLETE' || mission.status === 'RECEIVABLE') &&
            mission.isVisitMission === true
        )
        .map(mission => mission.missionNo);
}

function isConfiguredPrizeMission(mission) {
    const configuredMissionNo = CONFIG.prizeEntry?.missionNo;
    const configuredMissionTitle = CONFIG.prizeEntry?.missionTitle;

    return (
        configuredMissionNo != null &&
        String(mission?.missionNo) === String(configuredMissionNo)
    ) || (
        Boolean(configuredMissionTitle) &&
        mission?.title === configuredMissionTitle
    );
}

function getPrizeEntryMission(snapshot) {
    return Object.values(snapshot?.missions?.byMissionNo || {})
        .find(isConfiguredPrizeMission);
}

function shouldSchedulePrizeEntry(snapshot) {
    if (!CONFIG.prizeEntry?.enabled || !isSectionKnown(snapshot?.missions)) return false;

    return getPrizeEntryMission(snapshot)?.status === 'INCOMPLETE';
}

export function buildAutomationPlan(snapshot = {}) {
    const plannedMissionNos = getVisitMissionNos(snapshot);
    const skippedDone = Object.keys(MISSION_TASK_CATEGORIES)
        .filter(kind => isCategoryDone(snapshot, MISSION_TASK_CATEGORIES[kind]));
    const missionTask = (id, kind, meta) => (skippedDone.includes(kind) ? null : task(id, kind, meta));
    const roulette = snapshot.roulette;
    const rouletteExtra = snapshot.rouletteExtra;
    const shop = snapshot.shop;
    const majak = snapshot.majak;
    const shouldRunRouletteDraws = isSectionKnown(roulette) && roulette.remaining > 0;

    const groups = filterGroups([
        // These legacy tasks are safe/idempotent and may internally no-op on initial runs.
        group('setup', 3, [
            task('setup:requiredPages', 'requiredPages'),
            task('setup:componentRefresh', 'componentRefresh'),
            task('setup:eventRefresh', 'eventRefresh')
        ]),
        group('visits', plannedMissionNos.length > 0 ? 1 : 4, [
            plannedMissionNos.length > 0
                ? task('visits:singleVisits', 'singleVisits', { missionNos: plannedMissionNos })
                : null,
            missionTask('visits:dailyMissions', 'dailyMissions'),
            missionTask('visits:contentMissions', 'contentMissions'),
            missionTask('visits:bannerMissions', 'bannerMissions')
        ]),
        group('missionClaims', 2, [
            missionTask('missionClaims:weeklyMissions', 'weeklyMissions'),
            missionTask('missionClaims:attendanceMissions', 'attendanceMissions'),
            missionTask('missionClaims:surveyMissions', 'surveyMissions')
        ]),
        group('flakeSpending', 1, [
            shouldRunRouletteDraws
                ? task('flakeSpending:rouletteDraws', 'rouletteDraws', { spendsFlake: true })
                : null,
            shouldRunRouletteDraws
                ? task('flakeSpending:rouletteExtra', 'rouletteExtra', { afterRouletteDraws: true })
                : null,
            shouldSchedulePrizeEntry(snapshot)
                ? task('flakeSpending:prizeEntry', 'prizeEntry', { spendsFlake: true })
                : null
        ]),
        group('followups', 1, [
            !shouldRunRouletteDraws && isSectionKnown(rouletteExtra) && (rouletteExtra.claimable?.length || 0) > 0
                ? task('followups:rouletteExtra', 'rouletteExtra')
                : null,
            isSectionKnown(shop) && (shop.unclaimedDaily?.length || 0) > 0
                ? task('followups:dailyShop', 'dailyShop')
                : null,
            isSectionKnown(shop)
                ? task('followups:dailyAccumulatedShop', 'dailyAccumulatedShop')
                : null,
            isSectionKnown(majak)
                ? task('followups:majakShop', 'majakShop')
                : null
        ]),
    ]);

    return { plannedMissionNos, groups, skippedDone };
}

export function buildRepairPlan(diff = {}) {
    const plannedMissionNos = diff.incompleteMissionNos || [];
    const tasks = [
        plannedMissionNos.length > 0
            ? task('repairSafe:singleVisits', 'singleVisits', { missionNos: plannedMissionNos })
            : null,
        diff.unclaimedDailyShop > 0
            ? task('repairSafe:dailyShop', 'dailyShop')
            : null,
        diff.claimableExtra > 0
            ? task('repairSafe:rouletteExtra', 'rouletteExtra')
            : null,
        diff.unclaimedMajakShop > 0
            ? task('repairSafe:majakShop', 'majakShop')
            : null
    ];
    const groups = filterGroups([
        group('repairSafe', 1, tasks)
    ]);

    return { plannedMissionNos, groups };
}
