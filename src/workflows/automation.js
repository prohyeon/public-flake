import { runPreRegistrations } from './preRegistration.js';
import { CONFIG } from '../config.js';
import { state, resetRunProgress } from '../state.js';
import { delay } from '../utils/time.js';
import { extractHeaders } from '../utils/auth.js';
import { playCompletionSound } from '../utils/audio.js';
import { getMissionComponentIds } from '../api/missions.js';
import { getRouletteEventIds, getPrizeInfo } from '../api/roulette.js';
import { log, timingText } from '../ui/logger.js';
import { setButtonState } from '../ui/progress.js';
import { captureAutomationSnapshot, compareSnapshots, getSnapshotSummary } from './snapshot.js';
import { buildAutomationPlan, buildRepairPlan } from './automationPlan.js';
import { runTaskGroups, flattenTaskResults, waitForBackgroundTasks } from './taskRunner.js';
import { createRunTiming, formatSeconds } from './runTiming.js';
import { runRouletteDraws, claimRouletteExtraRewards } from './roulette.js';
import { claimDailyShopRewards, claimMajakDailyShopRewards, claimDailyAccumulatedRewards } from './shop.js';
import {
    executeDailyMissions, executeContentMissions, executeWeeklyMissions,
    executeBannerMissions, executeAttendanceMissions, executeSurveyMissions,
    executePrizeEntry, autoParticipateVisitMissions
} from './missions.js';
import { visitRequiredPages, checkAllStatus } from './status.js';
import { closeTab, openTabInBackground } from '../utils/tabs.js';
import { AUTOMATION_SIGNAL, setAutomationSignal } from '../utils/automationSignal.js';
import {
    MONTHLY_ATTENDANCE_RECHECK_ATTEMPTS, MONTHLY_ATTENDANCE_RECHECK_DELAY_MS,
    loadMonthlyAttendanceContext, applyMonthlyAttendanceRecord, saveMonthlyAttendanceRecord,
    markMonthlyAttendanceUnverified
} from './monthlyAttendance.js';

export const REWARD_SHOP_URL = 'https://reward.onstove.com/ko';

function taskServices(deps = {}) {
    return {
        visitRequiredPages,
        getMissionComponentIds,
        getRouletteEventIds,
        getPrizeInfo,
        autoParticipateVisitMissions,
        executeDailyMissions,
        executeContentMissions,
        executeBannerMissions,
        executeWeeklyMissions,
        executeAttendanceMissions,
        executeSurveyMissions,
        runRouletteDraws,
        executePrizeEntry,
        claimRouletteExtraRewards,
        claimDailyShopRewards,
        claimDailyAccumulatedRewards,
        claimMajakDailyShopRewards,
        delay,
        log,
        ...deps
    };
}

export function createAutomationTaskHandlers({ headers, allTabs = [], deps = {} }) {
    const io = taskServices(deps);
    // Tabs opened by a task stay open until the whole run ends, then runAutomation closes them.
    const collectTabs = tabs => {
        if (tabs?.length) allTabs.push(...tabs);
        return { tabCount: tabs?.length || 0 };
    };
    return {
        requiredPages: async () => collectTabs(await io.visitRequiredPages()),

        componentRefresh: async () => io.getMissionComponentIds(headers),

        eventRefresh: async () => {
            const events = await io.getRouletteEventIds(headers);
            if (CONFIG.prizeEntry.enabled) {
                await io.getPrizeInfo(headers);
            }
            return events;
        },


        singleVisits: async (task) => io.autoParticipateVisitMissions(headers, task),

        dailyMissions: async () => collectTabs(await io.executeDailyMissions(headers)),

        contentMissions: async () => collectTabs(await io.executeContentMissions(headers)),

        bannerMissions: async () => collectTabs(await io.executeBannerMissions(headers)),

        weeklyMissions: async () => io.executeWeeklyMissions(headers),
        attendanceMissions: async () => io.executeAttendanceMissions(headers),
        surveyMissions: async () => io.executeSurveyMissions(headers),
        rouletteDraws: async () => io.runRouletteDraws(headers),
        prizeEntry: async () => io.executePrizeEntry(headers),
        rouletteExtra: async () => io.claimRouletteExtraRewards(headers),
        dailyShop: async () => io.claimDailyShopRewards(headers),
        dailyAccumulatedShop: async () => io.claimDailyAccumulatedRewards(headers),
        majakShop: async () => io.claimMajakDailyShopRewards(headers)
    };
}

export function bindTaskHandlers(plan = {}, handlers = {}) {
    const groups = (plan.groups || [])
        .map(group => {
            const tasks = (group.tasks || [])
                .filter(task => handlers[task.kind])
                .map(task => ({
                    ...task,
                    run: () => handlers[task.kind](task)
                }));

            return { ...group, tasks };
        })
        .filter(group => group.tasks.length > 0);

    return { ...plan, groups };
}

function hasSafeRepairableItems(diff = {}) {
    return Boolean(
        (diff.incompleteMissionNos || []).length > 0 ||
        diff.unclaimedDailyShop > 0 ||
        diff.unclaimedMajakShop > 0 ||
        diff.claimableExtra > 0
    );
}

function hasMonthlyAttendanceVerificationIssue(diff = {}) {
    const progress = diff.monthlyAttendanceProgress || {};
    return Boolean(
        (progress.notIncreasedMissionNos || []).length > 0 ||
        (progress.unknownMissionNos || []).length > 0
    );
}

function hasSnapshotDiffWarning(diff = {}) {
    return hasSafeRepairableItems(diff) || hasMonthlyAttendanceVerificationIssue(diff);
}

export function focusRewardShopForMonthlyAttendanceIfNeeded(diff = {}, deps = {}) {
    if (!hasMonthlyAttendanceVerificationIssue(diff)) return null;

    const writeLog = deps.writeLog || log;
    const openRewardShop = deps.openRewardShop || openTabInBackground;
    writeLog('\uC6D4\uAC04\uCD9C\uC11D +1 \uD655\uC778\uC774 \uC548 \uB418\uC5B4 \uB9AC\uC6CC\uB4DC\uC0F5\uC73C\uB85C \uD3EC\uCEE4\uC2A4\uB97C \uC774\uB3D9\uD569\uB2C8\uB2E4', 'warning');

    return openRewardShop(REWARD_SHOP_URL, true);
}

// 리워드샵을 연 뒤 출석 반영까지 시간이 걸리므로, 최종 판정 전에 스냅샷을 다시 읽는다.
export async function recheckMonthlyAttendance({ afterSnapshot, diff, capture, compare, deps = {} }) {
    const wait = deps.delay || delay;
    const writeLog = deps.writeLog || log;
    const attempts = deps.attempts ?? MONTHLY_ATTENDANCE_RECHECK_ATTEMPTS;
    const delayMs = deps.delayMs ?? MONTHLY_ATTENDANCE_RECHECK_DELAY_MS;
    let currentSnapshot = afterSnapshot;
    let currentDiff = diff;

    for (let attempt = 1; attempt <= attempts && hasMonthlyAttendanceVerificationIssue(currentDiff); attempt++) {
        await wait(delayMs);
        const snapshot = await capture();
        if (snapshot?.missions?.success === false) continue;
        currentSnapshot = snapshot;
        currentDiff = compare(snapshot);
        writeLog(`월간출석 재확인 ${attempt}/${attempts}: ${formatMonthlyAttendanceProgress(currentDiff.monthlyAttendanceProgress)}`,
            hasMonthlyAttendanceVerificationIssue(currentDiff) ? 'warning' : 'success');
    }

    // 리워드샵을 열고 재확인해도 그대로면 오늘 이미 출석이 반영됐을 가능성이 높으므로
    // 실패 대신 경고로 남긴다. 값을 읽지 못한 미션(확인불가)은 그대로 실패로 둔다.
    const unverified = currentDiff.monthlyAttendanceProgress?.notIncreasedMissionNos || [];
    if (unverified.length > 0) {
        currentDiff = markMonthlyAttendanceUnverified(currentDiff);
        writeLog(`월간출석 +1을 확인하지 못했습니다. 오늘 이미 출석했을 수 있어 실패로 처리하지 않습니다 (미션 ${unverified.join(', ')})`, 'warning');
    }

    return { afterSnapshot: currentSnapshot, diff: currentDiff };
}

function isFailedTask(result) {
    return Boolean(result.status === 'rejected' || result.value?.error ||
        result.value?.success === false || result.value?.errors?.length > 0);
}

export function getAutomationOutcome({ snapshot, diff, plan, groupResults = [],
    preRegistrationResult,
    rouletteEnabled = CONFIG.roulette.enabled }) {
    const issues = [];
    const failedTasks = flattenTaskResults(groupResults).filter(isFailedTask);
    if (failedTasks.length > 0) issues.push(`작업 실패 ${failedTasks.length}개`);
    if (snapshot?.degraded) issues.push('최종 상태 확인 불가');
    if (hasSafeRepairableItems(diff)) issues.push('미션·보상 미완료');
    if (hasMonthlyAttendanceVerificationIssue(diff)) issues.push('월간출석 확인 필요');
    const roulettePlanned = plan?.groups?.some(group =>
        group.tasks?.some(task => task.kind === 'rouletteDraws'));
    if (rouletteEnabled && roulettePlanned && diff?.rouletteStillRemaining) {
        issues.push('룰렛 미완료');
    }
    if (preRegistrationResult?.success === false) issues.push('사전등록 확인 필요');
    return { success: issues.length === 0, issues };
}

function describeFailedTask(result) {
    const reason = result.reason || result.value?.message || result.value?.error ||
        result.value?.errors?.[0]?.message || '작업 결과 확인 필요';
    const message = reason?.message || String(reason);
    return `${result.groupId}/${result.id}: ${message}`;
}

function logFailedTasks(groupResults) {
    const rejected = flattenTaskResults(groupResults)
        .filter(isFailedTask);

    for (const result of rejected) {
        log(`\uC791\uC5C5 \uC2E4\uD328: ${describeFailedTask(result)}`, 'error');
    }
}

function logSnapshotSummary(label, snapshot) {
    const summary = getSnapshotSummary(snapshot);
    log(
        `${label}: \uB8F0\uB81B ${summary.rouletteRemaining}\uD68C, \uBBF8\uC158 \uC644\uB8CC ${summary.missions.complete}/\uC218\uB839\uAC00\uB2A5 ${summary.missions.receivable}/\uBBF8\uC644\uB8CC ${summary.missions.incomplete}`,
        'info'
    );
}

function formatMonthlyAttendanceProgress(progress = {}) {
    const checked = progress.checked || 0;
    if (checked === 0) return '\uC6D4\uAC04\uCD9C\uC11D +1 \uB300\uC0C1\uC5C6\uC74C';

    const notIncreased = progress.notIncreasedMissionNos?.length || 0;
    const unknown = progress.unknownMissionNos?.length || 0;
    const alreadyCounted = progress.alreadyCountedMissionNos?.length || 0;
    const unverified = progress.unverifiedMissionNos?.length || 0;
    const suffix = (notIncreased > 0 || unknown > 0
        ? ` (\uBBF8\uC99D\uAC00 ${notIncreased}\uAC1C, \uD655\uC778\uBD88\uAC00 ${unknown}\uAC1C)`
        : '') + (alreadyCounted > 0 ? ` (오늘 이미 반영 ${alreadyCounted}개)` : '') +
        (unverified > 0 ? ` (리워드샵 확인 후에도 미증가 ${unverified}개: 오늘 이미 출석했을 수 있음)` : '');

    return `\uC6D4\uAC04\uCD9C\uC11D +1 ${progress.increased || 0}/${checked}${suffix}`;
}

function logSnapshotDiff(label, diff) {
    log(
        `${label}: \uBBF8\uC158 ${diff.incompleteMissionNos.length}\uAC1C, \uB370\uC77C\uB9AC ${diff.unclaimedDailyShop}\uAC1C, \uB9C8\uC791 ${diff.unclaimedMajakShop}\uAC1C, EXTRA ${diff.claimableExtra}\uAC1C, ${formatMonthlyAttendanceProgress(diff.monthlyAttendanceProgress)}`,
        hasSnapshotDiffWarning(diff) ? 'warning' : 'success'
    );
}

const SNAPSHOT_SECTION_ORDER = ['missions', 'roulette', 'rouletteExtra', 'shop', 'majak',
    'flakeTotal', 'flakeMonthly'];

// The component-id read runs first; the other sections run in parallel, so the slowest few decide.
function addSnapshotDetail(timing, label, sections) {
    const lead = sections.find(section => section.label === 'missionComponents');
    const order = name => SNAPSHOT_SECTION_ORDER.indexOf(name);
    const slowest = sections
        .filter(section => section !== lead)
        .sort((a, b) => b.ms - a.ms || order(a.label) - order(b.label))
        .slice(0, 4);
    timing.addDetail(label, slowest, lead ? `missionComponents ${formatSeconds(lead.ms)} → ` : '');
}

function snapshotSectionRecorder() {
    const sections = [];
    return { sections, onSectionTime: (label, ms) => sections.push({ label, ms }) };
}

export async function runAutomation() {
    if (state.isRunning) {
        log('이미 자동화가 실행 중입니다', 'warning');
        return;
    }

    state.isRunning = true;
    setAutomationSignal(AUTOMATION_SIGNAL.running, '전체 자동화 실행 중');
    setButtonState(true);
    resetRunProgress();
    const timing = createRunTiming();
    const allTabs = [];

    try {
        log('🚀 전체 자동화 시작', 'info');
        log('헤더 정보 추출 중...', 'info');
        const headers = extractHeaders();
        log('✓ 헤더 정보 추출 완료', 'success');
        let rewardShopFocusedForMonthlyAttendance = false;

        const focusRewardShopAfterDiff = (currentDiff) => {
            if (rewardShopFocusedForMonthlyAttendance) return;
            const tab = focusRewardShopForMonthlyAttendanceIfNeeded(currentDiff);
            if (tab) rewardShopFocusedForMonthlyAttendance = true;
        };

        log('', 'info');
        log('\uCD08\uAE30 \uC2A4\uB0C5\uC0F7 \uC218\uC9D1 \uC911...', 'info');
        const endBeforeSnapshot = timing.start('준비', '초기 스냅샷');
        const beforeSections = snapshotSectionRecorder();
        const beforeSnapshotTask = captureAutomationSnapshot(headers, { onSectionTime: beforeSections.onSectionTime })
            .then(snapshot => {
                endBeforeSnapshot();
                return snapshot;
            });

        log('', 'info');
        log('월간 출석 기록 불러오는 중...', 'info');
        const endMonthlyContext = timing.start('준비', '월간 출석 기록');
        let monthlyAttendanceContext;
        try {
            monthlyAttendanceContext = await loadMonthlyAttendanceContext(headers).then(context => {
                endMonthlyContext();
                return context;
            });
        } catch (error) {
            await beforeSnapshotTask; // never end the run with the snapshot reads still in flight
            throw error;
        }

        const beforeSnapshot = await beforeSnapshotTask;
        logSnapshotSummary('\uCD08\uAE30 \uC2A4\uB0C5\uC0F7', beforeSnapshot);
        addSnapshotDetail(timing, '초기 스냅샷 세부', beforeSections.sections);
        const compareWithAttendanceRecord = snapshot => applyMonthlyAttendanceRecord(
            compareSnapshots(beforeSnapshot, snapshot, plan), snapshot, monthlyAttendanceContext);

        const plan = buildAutomationPlan(beforeSnapshot);
        if (plan.skippedDone.length > 0) {
            // The snapshot proved these categories complete, as the skipped tasks would have found.
            for (const kind of plan.skippedDone) state.completed[kind] = true;
            log(`오늘 이미 완료되어 건너뜀: ${plan.skippedDone.join(', ')}`, 'info');
        }
        const handlers = createAutomationTaskHandlers({ headers, allTabs });
        const executablePlan = timing.timeTasks(bindTaskHandlers(plan, handlers));

        log('', 'info');
        log(`\uC790\uB3D9\uD654 \uADF8\uB8F9 ${executablePlan.groups.length}\uAC1C \uC2E4\uD589`, 'info');
        const groupResults = await runTaskGroups(executablePlan.groups, {
            onGroupStart: (group) => {
                timing.startGroup(group.id);
                log(`\uADF8\uB8F9 \uC2DC\uC791: ${group.id}`, 'info');
            },
            onGroupDone: (group, results) => {
                const rejectedCount = results.filter(isFailedTask).length;
                const backgroundCount = results.filter(result => result.status === 'background').length;
                const foregroundCount = results.length - backgroundCount;
                const suffix = backgroundCount > 0 ? `, \uBC31\uADF8\uB77C\uC6B4\uB4DC ${backgroundCount}\uAC1C` : '';
                const elapsed = timingText(timing.groupSuffix(timing.endGroup('그룹', group.id), results));
                log(`\uADF8\uB8F9 \uC644\uB8CC: ${group.id} (${foregroundCount - rejectedCount}/${foregroundCount}${suffix})${elapsed}`, rejectedCount > 0 ? 'warning' : 'success');
            }
        });
        logFailedTasks(groupResults);

        const backgroundResults = await waitForBackgroundTasks(groupResults, {
            onGroupStart: (groupResult, results) => {
                timing.startGroup(`background:${groupResult.groupId}`);
                log(`\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uB300\uAE30: ${groupResult.groupId} (${results.length}\uAC1C)`, 'info');
            },
            onGroupDone: (groupResult, results) => {
                const rejectedCount = results.filter(isFailedTask).length;
                // Waiting starts after the foreground groups; each task's own time starts at its launch.
                const waitedMs = timing.endGroup(null, `background:${groupResult.groupId}`);
                const timedTasks = results.filter(result => timing.taskMs(result.id) !== undefined);
                for (const result of timedTasks) timing.record('백그라운드', result.id, timing.taskMs(result.id));
                timing.record('백그라운드', '종료 대기', waitedMs);
                const taskTimes = timedTasks.map(result => `${result.id.split(':').pop()} ${formatSeconds(timing.taskMs(result.id))}`);
                const detail = taskTimes.length > 0 ? ` (${taskTimes.join(' · ')})` : '';
                log(`\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC644\uB8CC: ${groupResult.groupId} (${results.length - rejectedCount}/${results.length}) · 대기 ${formatSeconds(waitedMs)}${detail}`, rejectedCount > 0 ? 'warning' : 'success');
            }
        });
        logFailedTasks(backgroundResults);
        const allGroupResults = [...groupResults, ...backgroundResults];

        log('', 'info');
        log('\uCD5C\uC885 \uC2A4\uB0C5\uC0F7 \uC218\uC9D1 \uC911...', 'info');
        // The panel refresh reads the same endpoints, so it runs alongside the final snapshot and is
        // repeated at the end only if something changed after this snapshot.
        const statusRefreshTask = checkAllStatus();
        let changedAfterSnapshot = false;
        const endAfterSnapshot = timing.start('마무리', '최종 스냅샷');
        const afterSections = snapshotSectionRecorder();
        let afterSnapshot = await captureAutomationSnapshot(headers, { onSectionTime: afterSections.onSectionTime });
        endAfterSnapshot();
        addSnapshotDetail(timing, '최종 스냅샷 세부', afterSections.sections);
        logSnapshotSummary('\uCD5C\uC885 \uC2A4\uB0C5\uC0F7', afterSnapshot);
        let diff = compareWithAttendanceRecord(afterSnapshot);
        logSnapshotDiff('\uC2A4\uB0C5\uC0F7 \uBE44\uAD50', diff);
        focusRewardShopAfterDiff(diff);

        if (hasSafeRepairableItems(diff)) {
            changedAfterSnapshot = true;
            const endRepair = timing.start('마무리', '복구');
            log('\uC548\uC804 \uBCF5\uAD6C \uB300\uC0C1 \uD655\uC778 \uC911...', 'warning');
            await delay(CONFIG.delays.betweenActions);
            afterSnapshot = await captureAutomationSnapshot(headers);
            diff = compareWithAttendanceRecord(afterSnapshot);
            logSnapshotDiff('\uC7AC\uD655\uC778 \uACB0\uACFC', diff);
            focusRewardShopAfterDiff(diff);

            if (hasSafeRepairableItems(diff)) {
                const repairPlan = buildRepairPlan(diff);
                const executableRepairPlan = timing.timeTasks(bindTaskHandlers(repairPlan, handlers));

                if (executableRepairPlan.groups.length > 0) {
                    log(`\uBCF5\uAD6C \uADF8\uB8F9 ${executableRepairPlan.groups.length}\uAC1C \uC2E4\uD589`, 'warning');
                    const repairResults = await runTaskGroups(executableRepairPlan.groups, {
                        onGroupStart: (group) => {
                            timing.startGroup(`repair:${group.id}`);
                            log(`\uBCF5\uAD6C \uC2DC\uC791: ${group.id}`, 'info');
                        },
                        onGroupDone: (group, results) => {
                            const rejectedCount = results.filter(isFailedTask).length;
                            const elapsed = timingText(timing.groupSuffix(timing.endGroup(null, `repair:${group.id}`), results));
                            log(`\uBCF5\uAD6C \uC644\uB8CC: ${group.id} (${results.length - rejectedCount}/${results.length})${elapsed}`, rejectedCount > 0 ? 'warning' : 'success');
                        }
                    });
                    logFailedTasks(repairResults);
                    allGroupResults.push(...repairResults);

                    afterSnapshot = await captureAutomationSnapshot(headers);
                    logSnapshotSummary('\uBCF5\uAD6C \uD6C4 \uC2A4\uB0C5\uC0F7', afterSnapshot);
                    diff = compareWithAttendanceRecord(afterSnapshot);
                    logSnapshotDiff('\uBCF5\uAD6C \uD6C4 \uBE44\uAD50', diff);
                    focusRewardShopAfterDiff(diff);
                }
            }
            endRepair();
        }

        if (rewardShopFocusedForMonthlyAttendance && hasMonthlyAttendanceVerificationIssue(diff)) {
            changedAfterSnapshot = true;
            const endRecheck = timing.start('마무리', '월간 출석 재확인');
            ({ afterSnapshot, diff } = await recheckMonthlyAttendance({
                afterSnapshot, diff,
                capture: () => captureAutomationSnapshot(headers),
                compare: compareWithAttendanceRecord
            }));
            endRecheck();
        }
        saveMonthlyAttendanceRecord(monthlyAttendanceContext, beforeSnapshot, afterSnapshot, diff);

        const endPreRegistration = timing.start('마무리', '사전등록');
        const preRegistrationResult = await runPreRegistrations(headers);
        endPreRegistration();
        if ((preRegistrationResult.results || []).some(result => result.registered || result.error)) {
            changedAfterSnapshot = true;
        }
        const outcome = getAutomationOutcome({ snapshot: afterSnapshot, diff, plan,
            groupResults: allGroupResults, preRegistrationResult });
        const dailyAccumulatedFlake = state.earnings.dailyAccumulated || 0;

        // Calculate earnings summary
        let totalEarnings = (state.earnings.roulette || 0) +
            (state.earnings.rouletteExtra || 0) +
            (state.earnings.dailyShop || 0) +
            (state.earnings.majak || 0) +
            (state.earnings.dailyMissions || 0) +
            (state.earnings.visitMissions || 0) +
            (state.earnings.contentMissions || 0) +
            (state.earnings.weeklyMissions || 0) +
            (state.earnings.bannerMissions || 0) +
            (state.earnings.attendanceMissions || 0) +
            (state.earnings.surveyMissions || 0) +
            (state.earnings.prizeEntry || 0) +
            (dailyAccumulatedFlake || 0);

        if (isNaN(totalEarnings)) {
            log('⚠️ 수익 계산 오류 발생 - 일부 값이 유효하지 않음', 'warning');
            totalEarnings = 0;
        }

        const profitSign = totalEarnings >= 0 ? '+' : '';

        log('', 'info');
        log(outcome.success ? '🎉 전체 자동화 완료!' : `전체 자동화 종료 · 확인 필요: ${outcome.issues.join(', ')}`, outcome.success ? 'success' : 'warning');
        log('', 'info');
        log('═══════════════════════════════════════', 'info');
        log('💰 최종 FLAKE 수익 요약', 'success');
        log('═══════════════════════════════════════', 'info');
        log(`  📋 데일리 미션: ${state.earnings.dailyMissions} FLAKE`, state.earnings.dailyMissions > 0 ? 'success' : 'info');
        const visitMissionFlake = state.earnings.visitMissions || 0;
        log(`  🚶 방문 미션: ${visitMissionFlake} FLAKE`, visitMissionFlake > 0 ? 'success' : 'info');
        log(`  📰 컨텐츠 미션: ${state.earnings.contentMissions} FLAKE`, state.earnings.contentMissions > 0 ? 'success' : 'info');
        log(`  📅 위클리 미션: ${state.earnings.weeklyMissions} FLAKE`, state.earnings.weeklyMissions > 0 ? 'success' : 'info');
        log(`  🎨 배너 미션: ${state.earnings.bannerMissions} FLAKE`, state.earnings.bannerMissions > 0 ? 'success' : 'info');
        log(`  📆 출석 미션: ${state.earnings.attendanceMissions} FLAKE`, state.earnings.attendanceMissions > 0 ? 'success' : 'info');
        log(`  📊 설문조사: ${state.earnings.surveyMissions} FLAKE`, state.earnings.surveyMissions > 0 ? 'success' : 'info');
        const prizeEntrySign = state.earnings.prizeEntry >= 0 ? '+' : '';
        log(`  🎁 경품 응모: ${prizeEntrySign}${state.earnings.prizeEntry} FLAKE`, state.earnings.prizeEntry >= 0 ? 'success' : 'warning');
        log(`  🎰 룰렛 순수익: ${state.earnings.roulette >= 0 ? '+' : ''}${state.earnings.roulette} FLAKE`, state.earnings.roulette >= 0 ? 'success' : 'warning');
        log(`  🎁 룰렛 EXTRA: ${state.earnings.rouletteExtra} FLAKE`, state.earnings.rouletteExtra > 0 ? 'success' : 'info');
        log(`  💝 데일리 보상: ${state.earnings.dailyShop} FLAKE`, state.earnings.dailyShop > 0 ? 'success' : 'info');
        log(`  🎁 데일리 누적 보상: ${dailyAccumulatedFlake} FLAKE`, dailyAccumulatedFlake > 0 ? 'success' : 'info');
        log(`  🀄 마작 리워드: ${state.earnings.majak} FLAKE`, state.earnings.majak > 0 ? 'success' : 'info');
        log('───────────────────────────────────────', 'info');
        log(`  📊 총 순수익: ${profitSign}${totalEarnings} FLAKE`, totalEarnings >= 0 ? 'success' : 'warning');
        log('═══════════════════════════════════════', 'info');

        if (outcome.success) playCompletionSound();

        state.completed.roulette = afterSnapshot.roulette?.success === true &&
            (!CONFIG.roulette.enabled || !diff.rouletteStillRemaining);
        state.completed.dailyShop = afterSnapshot.shop?.success === true && diff.unclaimedDailyShop === 0;
        state.completed.majak = afterSnapshot.majak?.success === true && diff.unclaimedMajakShop === 0;
        log('', 'info');
        log('📊 상태 업데이트 중...', 'info');
        const endStatusUpdate = timing.start('마무리', '상태 업데이트');
        await statusRefreshTask;
        if (changedAfterSnapshot) await checkAllStatus();
        endStatusUpdate();
        log('✅ 상태 업데이트 완료!', 'success');

        log('', 'info');
        if (!preRegistrationResult.success) {
            log(`사전등록 확인 필요: ${preRegistrationResult.error}`, 'warning');
        }
        if (outcome.success) {
            log('🎊 모든 작업이 완료되었습니다!', 'success');
            setAutomationSignal(AUTOMATION_SIGNAL.done, '전체 자동화 완료');
        } else {
            log(`일부 작업이 실패했거나 확인이 필요합니다: ${outcome.issues.join(', ')}`, 'warning');
            setAutomationSignal(AUTOMATION_SIGNAL.error, outcome.issues.join(', '));
        }

    } catch (error) {
        setAutomationSignal(AUTOMATION_SIGNAL.error, error.message || '자동화 실패');
        log(`✗ 오류 발생: ${error.message}`, 'error');
    } finally {
        if (allTabs.length > 0) {
            log(`🔒 열린 탭 ${allTabs.length}개 닫는 중...`, 'info');
            closeTab(allTabs);
            log('✓ 모든 탭 닫힘', 'success');
        }
        log('', 'info', { timing: true });
        for (const line of timing.summaryLines()) log(line, 'info', { timing: true });
        state.isRunning = false;
        setButtonState(false);
    }
}
