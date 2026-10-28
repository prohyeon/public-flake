import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { extractHeaders } from '../utils/auth.js';
import { getTodayString } from '../utils/time.js';
import { openTabInBackground } from '../utils/tabs.js';
import { getRouletteParticipationCount, getRouletteSubEventNo } from '../api/roulette.js';
import { getDailyShopRewards, getMajakDailyShopRewards } from '../api/shop.js';
import { apiRequest } from '../api/request.js';
import { getAllDailyMissions, getMissionComponentIds, getMissionComponentNos, missionComponentUrl } from '../api/missions.js';
import { getMonthlyFlakeTotal, getTotalFlakeBalance } from '../api/profile.js';
import { log } from '../ui/logger.js';
import { updateStatusUI } from '../ui/status.js';
import { updatePointCashChargeButtonAvailability } from '../ui/pointCashCharge.js';

const STATUS_KEYS = ['dailyMission', 'roulette', 'dailyShop', 'majakShop', 'survey'];
const BALANCE_KEYS = ['totalFlake', 'monthlyFlake'];

function services(deps = {}) {
    return {
        getRouletteParticipationCount,
        getDailyShopRewards,
        getMajakDailyShopRewards,
        apiRequest,
        getAllDailyMissions,
        getTodayString,
        ...deps
    };
}

// Daily shop and majak report today's attendance reward the same way.
async function checkTodayAttendanceStatus(io, readShop) {
    try {
        const shopData = await readShop();

        if (shopData?.value?.daily_attendances) {
            const rewards = shopData.value.daily_attendances.rewards || [];
            const todayString = io.getTodayString();

            const todayReward = rewards.find(reward => reward.attendance_date === todayString);

            if (todayReward) {
                return { success: true, received: todayReward.is_received, notReceived: !todayReward.is_received };
            }
            return { success: true, received: false, notReceived: false, noRewardToday: true };
        }
        return { success: false, error: '데이터 없음' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function checkRouletteStatus(headers, deps = {}) {
    const io = services(deps);
    try {
        const participationInfo = await io.getRouletteParticipationCount(headers, getRouletteSubEventNo());
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

export async function checkDailyShopStatus(headers, deps = {}) {
    const io = services(deps);
    return checkTodayAttendanceStatus(io, () => io.getDailyShopRewards(headers));
}

export async function checkMajakShopStatus(headers, deps = {}) {
    const io = services(deps);
    return checkTodayAttendanceStatus(io, () => io.getMajakDailyShopRewards(headers));
}

export async function checkSurveyStatus(headers, deps = {}) {
    const io = services(deps);
    try {
        if (!CONFIG.surveyMissions.enabled) return { success: true, notAvailable: true };

        const componentNo = state.missionComponents.survey;
        if (!componentNo) return { success: true, notAvailable: true };

        // Unlike the mission steps this read sends the lounge headers as-is (see bug-candidates doc).
        const response = await io.apiRequest(missionComponentUrl(componentNo), 'GET', headers);

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

export async function checkDailyMissionStatus(headers, deps = {}) {
    const io = services(deps);
    try {
        const allMissions = await io.getAllDailyMissions(headers);
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

export async function visitRequiredPages() {
    log('🌐 필수 페이지 탭 열기...', 'info');
    const tabs = [];
    try {
        log('  📋 리워드샵 페이지 방문 중...', 'info');
        tabs.push(openTabInBackground('https://reward.onstove.com/ko', false));
        log('  🏠 스토브 메인 페이지 방문 중...', 'info');
        tabs.push(openTabInBackground('https://store.onstove.com/', false));
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

        updateStatusUI(Object.fromEntries([...STATUS_KEYS, ...BALANCE_KEYS].map(key => [key, { loading: true }])));

        // Load mission component IDs if not loaded
        if (getMissionComponentNos().length === 0) {
            await getMissionComponentIds(headers);
        }

        const [dailyMissionStatus, rouletteStatus, dailyShopStatus, majakShopStatus, surveyStatus, totalFlake, monthlyFlake] = await Promise.all([
            checkDailyMissionStatus(headers),
            checkRouletteStatus(headers),
            checkDailyShopStatus(headers),
            checkMajakShopStatus(headers),
            checkSurveyStatus(headers),
            getTotalFlakeBalance(headers),
            getMonthlyFlakeTotal(headers)
        ]);

        updateStatusUI({
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
        updateStatusUI(Object.fromEntries([
            ...STATUS_KEYS.map(key => [key, { success: false, error: '확인 실패' }]),
            ...BALANCE_KEYS.map(key => [key, { error: true }])
        ]));
        updatePointCashChargeButtonAvailability(null);
    }
}
