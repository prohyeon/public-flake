import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { delay } from '../utils/time.js';
import { extractHeaders } from '../utils/auth.js';
import { playCompletionSound } from '../utils/audio.js';
import { getArticleList, likeArticle, postComment, createArticle, checkArticleLikeStatus } from '../api/articles.js';
import { getMissionComponentIds } from '../api/missions.js';
import { getRouletteEventIds, getPrizeInfo } from '../api/roulette.js';
import { log } from '../ui/logger.js';
import { updateProgress, setButtonState } from '../ui/progress.js';
import { captureAutomationSnapshot, compareSnapshots, getSnapshotSummary } from './snapshot.js';
import { buildAutomationPlan, buildRepairPlan } from './automationPlan.js';
import { runTaskGroups, flattenTaskResults } from './taskRunner.js';
import { runRouletteDraws, claimRouletteExtraRewards } from './roulette.js';
import { claimDailyShopRewards, claimMajakDailyShopRewards, claimDailyAccumulatedRewards } from './shop.js';
import {
    executeDailyMissions, executeContentMissions, executeWeeklyMissions,
    executeBannerMissions, executeAttendanceMissions, executeSurveyMissions,
    executePrizeEntry, autoParticipateVisitMissions
} from './missions.js';
import { visitRequiredPages, checkAllStatus, checkArticleWriteStatus } from './status.js';
import { closeTab } from '../utils/tabs.js';

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
                state.progress.newArticle = CONFIG.targets.newArticle;
                updateProgress('new-article', state.progress.newArticle, CONFIG.targets.newArticle);
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

        comments: async () => {
            const maxComments = Math.min(CONFIG.targets.comments, articles.length);
            const errors = [];
            const commentIds = [];

            for (let i = 0; i < maxComments; i++) {
                const articleId = articles[i].article_id;
                try {
                    const commentId = await postComment(headers, articleId, CONFIG.comment);
                    log(`댓글 작성 완료: ${commentId}`, 'success');
                    state.createdCommentIds.push(commentId);
                    state.progress.comments++;
                    commentIds.push(commentId);
                    updateProgress('comments', state.progress.comments, CONFIG.targets.comments);
                } catch (e) {
                    errors.push({ articleId, message: e.message });
                    log(`댓글 작성 실패: ${e.message}`, 'error');
                }
                if (i < maxComments - 1) await delay(CONFIG.delays.afterComment);
            }

            return { attempted: maxComments, commentIds, errors };
        },

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

export async function runAutomation() {
    if (state.isRunning) {
        log('이미 자동화가 실행 중입니다', 'warning');
        return;
    }

    state.isRunning = true;
    setButtonState(true);
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
        attendanceMissions: 0, surveyMissions: 0, prizeEntry: 0
    };

    try {
        log('🚀 전체 자동화 시작', 'info');
        log('헤더 정보 추출 중...', 'info');
        const headers = extractHeaders();
        log('✓ 헤더 정보 추출 완료', 'success');

        log('', 'info');
        const requiredPageTabs = await visitRequiredPages();
        allTabs.push(...requiredPageTabs);

        log('', 'info');
        log('📰 게시글 목록 가져오는 중...', 'info');
        const articles = await getArticleList(headers, 30);
        log(`✓ 게시글 ${articles.length}개 발견`, 'success');

        if (articles.length === 0) {
            log('❌ 게시글이 없습니다', 'error');
            state.isRunning = false;
            setButtonState(false);
            return;
        }

        await delay(CONFIG.delays.betweenActions);

        // Step 0: Comment posting (비동기 처리)
        log('💬 Step 0: 댓글 작성 시작 (10초 딜레이)...', 'info');
        const maxComments = Math.min(CONFIG.targets.comments, articles.length);
        const commentPromise = (async () => {
            for (let i = 0; i < maxComments; i++) {
                try {
                    const commentId = await postComment(headers, articles[i].article_id, CONFIG.comment);
                    log(`✓ 댓글 작성 완료: ${commentId}`, 'success');
                    state.createdCommentIds.push(commentId);
                    state.progress.comments++;
                    updateProgress('comments', state.progress.comments, CONFIG.targets.comments);
                } catch (e) {
                    log(`✗ 댓글 작성 실패: ${e.message}`, 'error');
                }
                if (i < maxComments - 1) await delay(CONFIG.delays.afterComment);
            }
            log('✓ Step 0 완료: 모든 댓글 작성 완료', 'success');
        })();

        // Step 1: Create article
        log('', 'info');
        log('✍️ Step 1: 새글 작성 시작...', 'info');
        const writeStatus = await checkArticleWriteStatus(headers);

        if (writeStatus.success && writeStatus.hasWrittenToday) {
            log(`⏩ 오늘 이미 ${writeStatus.todayCount}개 글 작성 완료, 새글 작성 스킵`, 'info');
            state.progress.newArticle = CONFIG.targets.newArticle;
            updateProgress('new-article', state.progress.newArticle, CONFIG.targets.newArticle);
        } else {
            try {
                const articleId = await createArticle(headers, '출석', '출석');
                if (articleId) {
                    state.progress.newArticle++;
                    updateProgress('new-article', state.progress.newArticle, CONFIG.targets.newArticle);
                    log(`✓ Step 1 완료: 새글 작성 완료! 게시글 ID: ${articleId}`, 'success');
                }
            } catch (e) {
                log(`✗ 새글 작성 실패: ${e.message}`, 'error');
                log('⚠️ 새글 작성 실패했지만 자동화를 계속 진행합니다', 'warning');
            }
        }

        await delay(CONFIG.delays.betweenActions);

        // Step 2: Like articles
        log('👍 Step 2: 게시글 추천 시작...', 'info');

        const targetArticleLikes = CONFIG.targets.articleLikes;
        const candidateCount = Math.min(targetArticleLikes * 3, articles.length);
        const candidateArticles = articles.slice(0, candidateCount);
        const candidateArticleIds = candidateArticles.map(a => a.article_id);

        const articleLikeStatuses = await checkArticleLikeStatus(headers, candidateArticleIds);
        const unlikedArticles = candidateArticles.filter(article =>
            articleLikeStatuses[article.article_id]?.LIKE !== true
        );

        log(`✓ 좋아요 안 누른 게시글 ${unlikedArticles.length}개 발견`, 'success');
        const articlesToLike = unlikedArticles.slice(0, targetArticleLikes);

        for (let i = 0; i < articlesToLike.length; i++) {
            const articleId = articlesToLike[i].article_id;
            try {
                await likeArticle(headers, articleId);
                state.progress.articleLikes++;
                updateProgress('article-likes', state.progress.articleLikes, CONFIG.targets.articleLikes);
                log(`✓ 게시글 ${articleId} 좋아요 완료 (${state.progress.articleLikes}/${targetArticleLikes})`, 'success');
            } catch (e) {
                log(`✗ 게시글 ${articleId} 좋아요 실패: ${e.message}`, 'error');
            }
            if (i < articlesToLike.length - 1) await delay(CONFIG.delays.betweenActions);
        }

        while (state.progress.articleLikes < targetArticleLikes) {
            state.progress.articleLikes++;
            updateProgress('article-likes', state.progress.articleLikes, CONFIG.targets.articleLikes);
        }
        log('✓ Step 2 완료: 게시글 추천 완료', 'success');

        await delay(CONFIG.delays.betweenActions);

        // Step 3: SINGLE 미션 자동 참여
        log('', 'info');
        log('🎯 Step 3: SINGLE 미션 자동 참여 시작...', 'info');
        await autoParticipateVisitMissions(headers);

        await delay(CONFIG.delays.betweenActions);

        log('✅ 퀘스트 주요 작업 완료!', 'success');

        // Step 4.4: Load mission component IDs
        log('', 'info');
        log('🔄 미션 컴포넌트 ID 로드 중...', 'info');
        const missionComponents = await getMissionComponentIds(headers);
        if (!missionComponents) log('⚠️ 미션 컴포넌트 로드 실패 - 미션 기능이 제한될 수 있습니다', 'warning');

        // Step 4.4.1: Load roulette event IDs
        log('🎰 룰렛 이벤트 ID 로드 중...', 'info');
        const rouletteEvents = await getRouletteEventIds(headers);
        if (!rouletteEvents) {
            log('⚠️ 룰렛 이벤트 ID 로드 실패 - CONFIG 값 사용', 'warning');
        } else {
            log(`✓ 룰렛 ID: ${rouletteEvents.draw}, EXTRA ID: ${rouletteEvents.extra}`, 'success');
        }

        // Step 4.4.2: Load prize info
        if (CONFIG.prizeEntry.enabled) {
            log('🎁 경품 정보 로드 중...', 'info');
            const prizeInfo = await getPrizeInfo(headers);
            if (!prizeInfo) {
                log('⚠️ 경품 정보 로드 실패 - CONFIG 값 사용', 'warning');
            } else {
                log(`✓ 경품: ${prizeInfo.giftName || CONFIG.prizeEntry.targetGiftName}`, 'success');
            }
        }

        // Step 4.5 ~ 4.11: All mission types
        log('', 'info');
        await executePrizeEntry(headers);
        log('', 'info');
        const dailyTabs = await executeDailyMissions(headers);
        if (dailyTabs?.length) allTabs.push(...dailyTabs);
        log('', 'info');
        const contentTabs = await executeContentMissions(headers);
        if (contentTabs?.length) allTabs.push(...contentTabs);
        log('', 'info');
        await executeWeeklyMissions(headers);
        log('', 'info');
        const bannerTabs = await executeBannerMissions(headers);
        if (bannerTabs?.length) allTabs.push(...bannerTabs);
        log('', 'info');
        await executeAttendanceMissions(headers);
        log('', 'info');
        await executeSurveyMissions(headers);

        // Step 5: Roulette
        log('', 'info');
        await runRouletteDraws(headers);

        // Wait for comments
        log('', 'info');
        log('📝 댓글 작성 완료 확인 중...', 'info');
        await commentPromise;

        // Step 7: Daily shop
        log('', 'info');
        log('💝 데일리 보상 수령 시작...', 'info');
        await claimDailyShopRewards(headers);

        // Step 8: Majak rewards
        log('', 'info');
        log('🀄 마작 리워드 수령 시작...', 'info');
        await claimMajakDailyShopRewards(headers);

        // Step 9: Roulette extra
        log('', 'info');
        await claimRouletteExtraRewards(headers);

        // Step 10: Daily accumulated rewards
        log('', 'info');
        const dailyAccumulatedFlake = await claimDailyAccumulatedRewards(headers);

        // Calculate earnings summary
        const articleWriteFlake = 200;
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

    } catch (error) {
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
