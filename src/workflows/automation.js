import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { delay } from '../utils/time.js';
import { extractHeaders } from '../utils/auth.js';
import { playCompletionSound } from '../utils/audio.js';
import { getArticleList, likeArticle, createArticle, checkArticleLikeStatus } from '../api/articles.js';
import { getMissionComponentIds } from '../api/missions.js';
import { getRouletteEventIds, getPrizeInfo } from '../api/roulette.js';
import { log } from '../ui/logger.js';
import { updateProgress, setButtonState } from '../ui/progress.js';
import { captureAutomationSnapshot, compareSnapshots, getSnapshotSummary } from './snapshot.js';
import { buildAutomationPlan, buildRepairPlan } from './automationPlan.js';
import { runTaskGroups, flattenTaskResults, waitForBackgroundTasks } from './taskRunner.js';
import { postCommentsSerially } from './comments.js';
import { runRouletteDraws, claimRouletteExtraRewards } from './roulette.js';
import { claimDailyShopRewards, claimMajakDailyShopRewards, claimDailyAccumulatedRewards } from './shop.js';
import {
    executeDailyMissions, executeContentMissions, executeWeeklyMissions,
    executeBannerMissions, executeAttendanceMissions, executeSurveyMissions,
    executePrizeEntry, autoParticipateVisitMissions
} from './missions.js';
import { visitRequiredPages, checkAllStatus, checkArticleWriteStatus } from './status.js';
import { closeTab } from '../utils/tabs.js';
import { AUTOMATION_SIGNAL, setAutomationSignal } from '../utils/automationSignal.js';

export function createAutomationTaskHandlers({ headers, articles = [], allTabs = [] }) {
    return {
        requiredPages: async () => {
            const tabs = await visitRequiredPages();
            if (tabs?.length) allTabs.push(...tabs);
            return { tabCount: tabs?.length || 0 };
        },

        componentRefresh: async () => getMissionComponentIds(headers),

        eventRefresh: async () => {
            const events = await getRouletteEventIds(headers);
            if (CONFIG.prizeEntry.enabled) {
                await getPrizeInfo(headers);
            }
            return events;
        },

        articleWrite: async () => {
            const writeStatus = await checkArticleWriteStatus(headers);

            if (writeStatus.success && writeStatus.hasWrittenToday) {
                return { skipped: true, reason: 'alreadyWritten', writeStatus };
            }

            try {
                const articleId = await createArticle(headers, '출석', '출석');
                if (articleId) {
                    state.progress.newArticle++;
                    updateProgress('new-article', state.progress.newArticle, CONFIG.targets.newArticle);
                    return { articleId };
                }
                return { error: true, message: 'Article creation returned no article id' };
            } catch (e) {
                log(`새글 작성 실패: ${e.message}`, 'error');
                log('새글 작성 실패했지만 자동화를 계속 진행합니다', 'warning');
                return { error: true, message: e.message };
            }
        },

        articleLikes: async () => {
            const targetArticleLikes = CONFIG.targets.articleLikes;
            const candidateCount = Math.min(targetArticleLikes * 3, articles.length);
            const candidateArticles = articles.slice(0, candidateCount);
            const candidateArticleIds = candidateArticles.map(a => a.article_id);

            if (candidateArticleIds.length === 0) {
                return { attempted: 0, liked: 0, errors: [] };
            }

            const articleLikeStatuses = await checkArticleLikeStatus(headers, candidateArticleIds);
            const unlikedArticles = candidateArticles.filter(article =>
                articleLikeStatuses[article.article_id]?.LIKE !== true
            );
            const articlesToLike = unlikedArticles.slice(0, targetArticleLikes);
            const errors = [];
            let liked = 0;

            for (let i = 0; i < articlesToLike.length; i++) {
                const articleId = articlesToLike[i].article_id;
                try {
                    await likeArticle(headers, articleId);
                    state.progress.articleLikes++;
                    liked++;
                    updateProgress('article-likes', state.progress.articleLikes, CONFIG.targets.articleLikes);
                    log(`게시글 ${articleId} 좋아요 완료 (${state.progress.articleLikes}/${targetArticleLikes})`, 'success');
                } catch (e) {
                    errors.push({ articleId, message: e.message });
                    log(`게시글 ${articleId} 좋아요 실패: ${e.message}`, 'error');
                }
                if (i < articlesToLike.length - 1) await delay(CONFIG.delays.betweenActions);
            }

            return { attempted: articlesToLike.length, liked, errors };
        },

        comments: async () => postCommentsSerially({ headers, articles }),

        singleVisits: async (task) => autoParticipateVisitMissions(headers, task),

        dailyMissions: async () => {
            const tabs = await executeDailyMissions(headers);
            if (tabs?.length) allTabs.push(...tabs);
            return { tabCount: tabs?.length || 0 };
        },

        contentMissions: async () => {
            const tabs = await executeContentMissions(headers);
            if (tabs?.length) allTabs.push(...tabs);
            return { tabCount: tabs?.length || 0 };
        },

        bannerMissions: async () => {
            const tabs = await executeBannerMissions(headers);
            if (tabs?.length) allTabs.push(...tabs);
            return { tabCount: tabs?.length || 0 };
        },

        weeklyMissions: async () => executeWeeklyMissions(headers),
        attendanceMissions: async () => executeAttendanceMissions(headers),
        surveyMissions: async () => executeSurveyMissions(headers),
        rouletteDraws: async () => runRouletteDraws(headers),
        prizeEntry: async () => executePrizeEntry(headers),
        rouletteExtra: async () => claimRouletteExtraRewards(headers),
        dailyShop: async () => claimDailyShopRewards(headers),
        dailyAccumulatedShop: async () => claimDailyAccumulatedRewards(headers),
        majakShop: async () => claimMajakDailyShopRewards(headers)
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
        diff.articleStillMissing ||
        (diff.incompleteMissionNos || []).length > 0 ||
        diff.unclaimedDailyShop > 0 ||
        diff.unclaimedMajakShop > 0 ||
        diff.claimableExtra > 0
    );
}

function describeRejectedTask(result) {
    const reason = result.reason;
    const message = reason?.message || String(reason);
    return `${result.groupId}/${result.id}: ${message}`;
}

function logRejectedTasks(groupResults) {
    const rejected = flattenTaskResults(groupResults)
        .filter(result => result.status === 'rejected');

    for (const result of rejected) {
        log(`\uC791\uC5C5 \uC2E4\uD328: ${describeRejectedTask(result)}`, 'error');
    }
}

function logSnapshotSummary(label, snapshot) {
    const summary = getSnapshotSummary(snapshot);
    log(
        `${label}: \uAE00\uC791\uC131 ${summary.articleWritten ? '\uC644\uB8CC' : '\uBBF8\uC644\uB8CC'}, \uB8F0\uB81B ${summary.rouletteRemaining}\uD68C, \uBBF8\uC158 \uC644\uB8CC ${summary.missions.complete}/\uC218\uB839\uAC00\uB2A5 ${summary.missions.receivable}/\uBBF8\uC644\uB8CC ${summary.missions.incomplete}`,
        'info'
    );
}

function logSnapshotDiff(label, diff) {
    log(
        `${label}: \uAE00 ${diff.articleStillMissing ? '\uBBF8\uC644\uB8CC' : '\uD655\uC778'}, \uBBF8\uC158 ${diff.incompleteMissionNos.length}\uAC1C, \uB370\uC77C\uB9AC ${diff.unclaimedDailyShop}\uAC1C, \uB9C8\uC791 ${diff.unclaimedMajakShop}\uAC1C, EXTRA ${diff.claimableExtra}\uAC1C`,
        hasSafeRepairableItems(diff) ? 'warning' : 'success'
    );
}

export async function runAutomation() {
    if (state.isRunning) {
        log('이미 자동화가 실행 중입니다', 'warning');
        return;
    }

    state.isRunning = true;
    setAutomationSignal(AUTOMATION_SIGNAL.running, '전체 자동화 실행 중');
    setButtonState(true);
    state.progress = { articleLikes: 0, comments: 0, newArticle: 0 };
    state.createdCommentIds = [];
    state.completed = {
        roulette: false,
        dailyShop: false,
        majak: false,
        dailyMissions: false,
        contentMissions: false,
        weeklyMissions: false,
        bannerMissions: false,
        attendanceMissions: false,
        surveyMissions: false,
        prizeEntry: false
    };
    const allTabs = [];

    const progressSection = document.querySelector('.stove-progress-section');
    if (progressSection) {
        const rect = progressSection.getBoundingClientRect();
        const offsetTop = window.pageYOffset + rect.top - (window.innerHeight * 0.3) + (rect.height / 2);
        window.scrollTo({ top: offsetTop, behavior: 'smooth' });
    }

    state.earnings = {
        roulette: 0, rouletteExtra: 0, dailyShop: 0, majak: 0,
        dailyMissions: 0, contentMissions: 0, weeklyMissions: 0, bannerMissions: 0,
        attendanceMissions: 0, surveyMissions: 0, prizeEntry: 0, dailyAccumulated: 0
    };

    try {
        log('🚀 전체 자동화 시작', 'info');
        log('헤더 정보 추출 중...', 'info');
        const headers = extractHeaders();
        log('✓ 헤더 정보 추출 완료', 'success');

        log('', 'info');
        log('\uCD08\uAE30 \uC2A4\uB0C5\uC0F7 \uC218\uC9D1 \uC911...', 'info');
        const beforeSnapshot = await captureAutomationSnapshot(headers);
        logSnapshotSummary('\uCD08\uAE30 \uC2A4\uB0C5\uC0F7', beforeSnapshot);

        log('', 'info');
        log('\uAC8C\uC2DC\uAE00 \uBAA9\uB85D \uAC00\uC838\uC624\uB294 \uC911...', 'info');
        const articles = await getArticleList(headers, 30);
        log(`\uAC8C\uC2DC\uAE00 ${articles.length}\uAC1C \uBC1C\uACAC`, 'success');

        if (articles.length === 0) {
            setAutomationSignal(AUTOMATION_SIGNAL.error, '게시글 없음');
            log('\uAC8C\uC2DC\uAE00\uC774 \uC5C6\uC2B5\uB2C8\uB2E4', 'error');
            return;
        }

        const plan = buildAutomationPlan(beforeSnapshot);
        const handlers = createAutomationTaskHandlers({ headers, articles, allTabs });
        const executablePlan = bindTaskHandlers(plan, handlers);

        log('', 'info');
        log(`\uC790\uB3D9\uD654 \uADF8\uB8F9 ${executablePlan.groups.length}\uAC1C \uC2E4\uD589`, 'info');
        const groupResults = await runTaskGroups(executablePlan.groups, {
            onGroupStart: (group) => log(`\uADF8\uB8F9 \uC2DC\uC791: ${group.id}`, 'info'),
            onGroupDone: (group, results) => {
                const rejectedCount = results.filter(result => result.status === 'rejected').length;
                const backgroundCount = results.filter(result => result.status === 'background').length;
                const foregroundCount = results.length - backgroundCount;
                const suffix = backgroundCount > 0 ? `, \uBC31\uADF8\uB77C\uC6B4\uB4DC ${backgroundCount}\uAC1C` : '';
                log(`\uADF8\uB8F9 \uC644\uB8CC: ${group.id} (${foregroundCount - rejectedCount}/${foregroundCount}${suffix})`, rejectedCount > 0 ? 'warning' : 'success');
            }
        });
        logRejectedTasks(groupResults);

        const backgroundResults = await waitForBackgroundTasks(groupResults, {
            onGroupStart: (groupResult, results) => log(`\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uB300\uAE30: ${groupResult.groupId} (${results.length}\uAC1C)`, 'info'),
            onGroupDone: (groupResult, results) => {
                const rejectedCount = results.filter(result => result.status === 'rejected').length;
                log(`\uBC31\uADF8\uB77C\uC6B4\uB4DC \uC791\uC5C5 \uC644\uB8CC: ${groupResult.groupId} (${results.length - rejectedCount}/${results.length})`, rejectedCount > 0 ? 'warning' : 'success');
            }
        });
        logRejectedTasks(backgroundResults);

        log('', 'info');
        log('\uCD5C\uC885 \uC2A4\uB0C5\uC0F7 \uC218\uC9D1 \uC911...', 'info');
        let afterSnapshot = await captureAutomationSnapshot(headers);
        logSnapshotSummary('\uCD5C\uC885 \uC2A4\uB0C5\uC0F7', afterSnapshot);
        let diff = compareSnapshots(beforeSnapshot, afterSnapshot, plan);
        logSnapshotDiff('\uC2A4\uB0C5\uC0F7 \uBE44\uAD50', diff);

        if (hasSafeRepairableItems(diff)) {
            log('\uC548\uC804 \uBCF5\uAD6C \uB300\uC0C1 \uD655\uC778 \uC911...', 'warning');
            await delay(CONFIG.delays.betweenActions);
            afterSnapshot = await captureAutomationSnapshot(headers);
            diff = compareSnapshots(beforeSnapshot, afterSnapshot, plan);
            logSnapshotDiff('\uC7AC\uD655\uC778 \uACB0\uACFC', diff);

            if (hasSafeRepairableItems(diff)) {
                const repairPlan = buildRepairPlan(diff);
                const executableRepairPlan = bindTaskHandlers(repairPlan, handlers);

                if (executableRepairPlan.groups.length > 0) {
                    log(`\uBCF5\uAD6C \uADF8\uB8F9 ${executableRepairPlan.groups.length}\uAC1C \uC2E4\uD589`, 'warning');
                    const repairResults = await runTaskGroups(executableRepairPlan.groups, {
                        onGroupStart: (group) => log(`\uBCF5\uAD6C \uC2DC\uC791: ${group.id}`, 'info'),
                        onGroupDone: (group, results) => {
                            const rejectedCount = results.filter(result => result.status === 'rejected').length;
                            log(`\uBCF5\uAD6C \uC644\uB8CC: ${group.id} (${results.length - rejectedCount}/${results.length})`, rejectedCount > 0 ? 'warning' : 'success');
                        }
                    });
                    logRejectedTasks(repairResults);

                    const repairedSnapshot = await captureAutomationSnapshot(headers);
                    logSnapshotSummary('\uBCF5\uAD6C \uD6C4 \uC2A4\uB0C5\uC0F7', repairedSnapshot);
                    logSnapshotDiff('\uBCF5\uAD6C \uD6C4 \uBE44\uAD50', compareSnapshots(beforeSnapshot, repairedSnapshot, plan));
                }
            }
        }

        const dailyAccumulatedFlake = state.earnings.dailyAccumulated || 0;

        // Calculate earnings summary
        const articleWriteFlake = state.progress.newArticle > 0 ? 200 : 0;
        const articleLikeFlake = state.progress.articleLikes * 3;
        const commentFlake = state.progress.comments * 30;
        const questActivityFlake = articleWriteFlake + articleLikeFlake + commentFlake;

        let totalEarnings = (questActivityFlake || 0) +
            (state.earnings.roulette || 0) +
            (state.earnings.rouletteExtra || 0) +
            (state.earnings.dailyShop || 0) +
            (state.earnings.majak || 0) +
            (state.earnings.dailyMissions || 0) +
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
        log('🎉 전체 자동화 완료!', 'success');
        log('', 'info');
        log('═══════════════════════════════════════', 'info');
        log('💰 최종 FLAKE 수익 요약', 'success');
        log('═══════════════════════════════════════', 'info');
        log(`  ✍️  글쓰기: ${articleWriteFlake} FLAKE`, 'success');
        log(`  👍 게시글 좋아요: ${articleLikeFlake} FLAKE (${state.progress.articleLikes}회 × 3)`, articleLikeFlake > 0 ? 'success' : 'info');
        log(`  💬 댓글 쓰기: ${commentFlake} FLAKE (${state.progress.comments}회 × 30)`, commentFlake > 0 ? 'success' : 'info');
        log(`  📋 데일리 미션: ${state.earnings.dailyMissions} FLAKE`, state.earnings.dailyMissions > 0 ? 'success' : 'info');
        log(`  📰 컨텐츠 미션: ${state.earnings.contentMissions} FLAKE`, state.earnings.contentMissions > 0 ? 'success' : 'info');
        log(`  📅 위클리 미션: ${state.earnings.weeklyMissions} FLAKE`, state.earnings.weeklyMissions > 0 ? 'success' : 'info');
        log(`  🎨 배너 미션: ${state.earnings.bannerMissions} FLAKE`, state.earnings.bannerMissions > 0 ? 'success' : 'info');
        log(`  📆 출석 미션: ${state.earnings.attendanceMissions} FLAKE`, state.earnings.attendanceMissions > 0 ? 'success' : 'info');
        log(`  📊 설문조사: ${state.earnings.surveyMissions} FLAKE`, state.earnings.surveyMissions > 0 ? 'success' : 'info');
        const prizeEntrySign = state.earnings.prizeEntry >= 0 ? '+' : '';
        log(`  🎁 경품 응모: ${prizeEntrySign}${state.earnings.prizeEntry} FLAKE`, state.earnings.prizeEntry >= 0 ? 'success' : 'warning');
        log(`  🎰 룰렛 순수익: ${profitSign}${state.earnings.roulette} FLAKE`, state.earnings.roulette >= 0 ? 'success' : 'warning');
        log(`  🎁 룰렛 EXTRA: ${state.earnings.rouletteExtra} FLAKE`, state.earnings.rouletteExtra > 0 ? 'success' : 'info');
        log(`  💝 데일리 보상: ${state.earnings.dailyShop} FLAKE`, state.earnings.dailyShop > 0 ? 'success' : 'info');
        log(`  🎁 데일리 누적 보상: ${dailyAccumulatedFlake} FLAKE`, dailyAccumulatedFlake > 0 ? 'success' : 'info');
        log(`  🀄 마작 리워드: ${state.earnings.majak} FLAKE`, state.earnings.majak > 0 ? 'success' : 'info');
        log('───────────────────────────────────────', 'info');
        log(`  📊 총 순수익: ${profitSign}${totalEarnings} FLAKE`, totalEarnings >= 0 ? 'success' : 'warning');
        log('═══════════════════════════════════════', 'info');

        playCompletionSound();

        state.completed.roulette = true;
        state.completed.dailyShop = true;
        state.completed.majak = true;

        const progressFill = document.querySelector('.stove-progress-fill');
        if (progressFill) progressFill.style.width = '100%';

        const progressText = document.getElementById('stove-progress-text');
        if (progressText) {
            progressText.style.display = 'block';
            progressText.textContent = '100%';
        }

        log('', 'info');
        log('📊 상태 업데이트 중...', 'info');
        await checkAllStatus();
        log('✅ 상태 업데이트 완료!', 'success');

        log('', 'info');
        log('🎊 모든 작업이 완료되었습니다!', 'success');
        setAutomationSignal(AUTOMATION_SIGNAL.done, '전체 자동화 완료');

    } catch (error) {
        setAutomationSignal(AUTOMATION_SIGNAL.error, error.message || '자동화 실패');
        log(`✗ 오류 발생: ${error.message}`, 'error');
    } finally {
        if (allTabs.length > 0) {
            log(`🔒 열린 탭 ${allTabs.length}개 닫는 중...`, 'info');
            closeTab(allTabs);
            log('✓ 모든 탭 닫힘', 'success');
        }
        state.isRunning = false;
        setButtonState(false);
    }
}
