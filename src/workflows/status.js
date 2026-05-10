import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { extractHeaders } from '../utils/auth.js';
import { getTodayString } from '../utils/time.js';
import { openTabInBackground } from '../utils/tabs.js';
import { getRouletteParticipationCount, getRouletteSubEventNo } from '../api/roulette.js';
import { getDailyShopRewards, getMajakDailyShopRewards } from '../api/shop.js';
import { apiRequest } from '../api/request.js';
import { getAllDailyMissions, getMissionComponentIds } from '../api/missions.js';
import { getMyProfile, getMyArticles, getMonthlyFlakeTotal, getTotalFlakeBalance } from '../api/profile.js';
import { log } from '../ui/logger.js';
import { updateStatusUI } from '../ui/status.js';
import { updatePointCashChargeButtonAvailability } from '../ui/pointCashCharge.js';

export async function checkRouletteStatus(headers) {
    try {
        const participationInfo = await getRouletteParticipationCount(headers, getRouletteSubEventNo());
        if (participationInfo?.value) {
            const maxDraws = CONFIG.roulette.maxDraws;
            const current = participationInfo.value.participation_cnt || 0;
            const remaining = Math.max(0, maxDraws - current);
            return { success: true, current, limit: maxDraws, remaining };
        }
        return { success: false, error: '데이터 없음' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function checkDailyShopStatus(headers) {
    try {
        const dailyShopData = await getDailyShopRewards(headers);

        if (dailyShopData?.value?.daily_attendances) {
            const rewards = dailyShopData.value.daily_attendances.rewards || [];
            const todayString = getTodayString();

            const todayReward = rewards.find(reward => reward.attendance_date === todayString);

            if (todayReward) {
                return { success: true, received: todayReward.is_received, notReceived: !todayReward.is_received };
            } else {
                return { success: true, received: false, notReceived: false, noRewardToday: true };
            }
        }
        return { success: false, error: '데이터 없음' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function checkMajakShopStatus(headers) {
    try {
        const majakShopData = await getMajakDailyShopRewards(headers);

        if (majakShopData?.value?.daily_attendances) {
            const rewards = majakShopData.value.daily_attendances.rewards || [];
            const todayString = getTodayString();

            const todayReward = rewards.find(reward => reward.attendance_date === todayString);

            if (todayReward) {
                return { success: true, received: todayReward.is_received, notReceived: !todayReward.is_received };
            } else {
                return { success: true, received: false, notReceived: false, noRewardToday: true };
            }
        }
        return { success: false, error: '데이터 없음' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function checkSurveyStatus(headers) {
    try {
        if (!CONFIG.surveyMissions.enabled) return { success: true, notAvailable: true };

        const componentNo = state.missionComponents.survey;
        if (!componentNo) return { success: true, notAvailable: true };

        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
        const response = await apiRequest(url, 'GET', headers);

        if (response?.code === 0 && response.value?.missions) {
            const missions = response.value.missions;
            if (missions.length === 0) return { success: true, noMissions: true };

            let completed = 0;
            let receivable = 0;
            const total = missions.length;

            missions.forEach(mission => {
                if (mission.status === 'COMPLETE' || mission.status === 'COMPLETED') completed++;
                else if (mission.status === 'RECEIVABLE') receivable++;
            });

            return { success: true, completed, receivable, total, allCompleted: completed === total };
        }

        return { success: false, error: '데이터 없음' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function checkDailyMissionStatus(headers) {
    try {
        const allMissions = await getAllDailyMissions(headers);
        if (!allMissions || allMissions.length === 0) {
            return { success: false, error: '데이터 없음' };
        }

        const categories = {
            daily: { components: [], missions: [] },
            weekly: { components: [], missions: [] },
            content: { components: [], missions: [] },
            attendance: { components: [], missions: [] }
        };

        allMissions.forEach(comp => {
            const type = comp.component_info?.component_type;
            const componentNo = comp.componentNo;
            const missions = comp.missions || [];

            if (type === 'SINGLE') {
                categories.daily.components.push(comp.component_info);
                categories.daily.missions.push(...missions);
            } else if (type === 'ACCUMULATION') {
                const bucket = componentNo === state.missionComponents.weekly ? 'weekly' : 'attendance';
                categories[bucket].components.push(comp.component_info);
                categories[bucket].missions.push(...missions);
            } else if (type === 'CONTENT1') {
                categories.content.components.push(comp.component_info);
                categories.content.missions.push(...missions);
            }
        });

        const result = {};
        Object.keys(categories).forEach(key => {
            const missions = categories[key].missions;
            if (missions.length > 0) {
                result[key] = {
                    total: missions.length,
                    completed: missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED').length,
                    receivable: missions.filter(m => m.status === 'RECEIVABLE').length,
                    incomplete: missions.filter(m => m.status === 'INCOMPLETE').length,
                    components: categories[key].components,
                    missions
                };
            }
        });

        return { success: true, categories: result };
    } catch (e) {
        console.error('[데일리 미션 상태 체크 오류]', e);
        return { success: false, error: e.message };
    }
}

export async function checkArticleWriteStatus(headers) {
    try {
        const profileData = await getMyProfile(headers);
        if (!profileData?.value?.user_id) {
            return { success: false, error: '프로필 정보 없음' };
        }

        const userId = profileData.value.user_id;
        const articlesData = await getMyArticles(headers, userId, 10);
        if (!articlesData?.value?.list) {
            return { success: false, error: '게시글 목록 없음' };
        }

        const articles = articlesData.value.list;
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const todayEnd = todayStart + 24 * 60 * 60 * 1000;

        const todayArticles = articles.filter(article => {
            const articleTime = article.datetime;
            return articleTime >= todayStart && articleTime < todayEnd;
        });

        return { success: true, hasWrittenToday: todayArticles.length > 0, todayCount: todayArticles.length };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function visitRequiredPages() {
    log('🌐 필수 페이지 탭 열기...', 'info');
    const tabs = [];
    try {
        log('  📋 리워드샵 페이지 방문 중...', 'info');
        tabs.push(openTabInBackground('https://reward.onstove.com/ko', false));
        log('  🏠 스토브 메인 페이지 방문 중...', 'info');
        tabs.push(openTabInBackground('https://www.onstove.com/ko', false));
        log('✓ 필수 페이지 탭 열림', 'success');
    } catch (error) {
        log(`⚠️ 페이지 방문 중 오류: ${error.message}`, 'warning');
    }
    return tabs;
}

export async function checkAllStatus() {
    console.log('[상태 확인 시작]');
    try {
        const headers = extractHeaders();

        updateStatusUI({
            articleWrite: { loading: true },
            dailyMission: { loading: true },
            roulette: { loading: true },
            dailyShop: { loading: true },
            majakShop: { loading: true },
            survey: { loading: true },
            totalFlake: { loading: true },
            monthlyFlake: { loading: true }
        });

        // Load mission component IDs if not loaded
        if (!Object.values(state.missionComponents).some(Boolean)) {
            await getMissionComponentIds(headers);
        }

        const [articleWriteStatus, dailyMissionStatus, rouletteStatus, dailyShopStatus, majakShopStatus, surveyStatus, totalFlake, monthlyFlake] = await Promise.all([
            checkArticleWriteStatus(headers),
            checkDailyMissionStatus(headers),
            checkRouletteStatus(headers),
            checkDailyShopStatus(headers),
            checkMajakShopStatus(headers),
            checkSurveyStatus(headers),
            getTotalFlakeBalance(headers),
            getMonthlyFlakeTotal(headers)
        ]);

        updateStatusUI({
            articleWrite: articleWriteStatus,
            dailyMission: dailyMissionStatus,
            roulette: rouletteStatus,
            dailyShop: dailyShopStatus,
            majakShop: majakShopStatus,
            survey: surveyStatus,
            totalFlake,
            monthlyFlake
        });
        updatePointCashChargeButtonAvailability(totalFlake);

        console.log('[상태 확인] ✅ 완료');
    } catch (error) {
        console.error('[상태 확인 오류]', error);
        alert(`상태 확인 실패: ${error.message}`);
        updateStatusUI({
            articleWrite: { success: false, error: '확인 실패' },
            dailyMission: { success: false, error: '확인 실패' },
            roulette: { success: false, error: '확인 실패' },
            dailyShop: { success: false, error: '확인 실패' },
            majakShop: { success: false, error: '확인 실패' },
            survey: { success: false, error: '확인 실패' },
            totalFlake: { error: true },
            monthlyFlake: { error: true }
        });
        updatePointCashChargeButtonAvailability(null);
    }
}
