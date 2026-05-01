import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { apiRequest } from './request.js';

export function makeMissionHeaders(headers) {
    return {
        'Authorization': headers['Authorization'],
        'caller-id': 'flake-fe',
        'caller-detail': headers['X-UUID'] || headers['caller-detail'],
        'x-lang': 'ko',
        'x-nation': 'KR',
        'Accept': '*/*',
        'Origin': 'https://reward.onstove.com',
        'Referer': 'https://reward.onstove.com/'
    };
}

export function isWeeklyAccumulation(startDt, endDt) {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    return diffDays <= 14;
}

export function isComponentActive(startDt, endDt) {
    const now = new Date();
    return now >= new Date(startDt) && now <= new Date(endDt);
}

export async function getMissionComponentIds(headers) {
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/page?page_type=MISSION`;
    const missionHeaders = makeMissionHeaders(headers);

    console.log('[미션 컴포넌트 로드] URL:', url);

    try {
        const response = await apiRequest(url, 'GET', missionHeaders);

        if (response && response.code === 0 && response.value?.component_list) {
            const componentList = response.value.component_list;
            const components = {
                daily: null, content: null, weekly: null,
                survey: null, banner: null, attendance: null
            };

            for (const comp of componentList) {
                if (!isComponentActive(comp.start_dt, comp.end_dt)) {
                    console.log(`[미션 컴포넌트] ⏭️ ${comp.type} (${comp.component_no}) - 비활성 기간`);
                    continue;
                }

                switch (comp.type) {
                    case 'SINGLE':
                        components.daily = comp.component_no;
                        console.log(`[미션 컴포넌트] ✓ SINGLE → daily: ${comp.component_no}`);
                        break;
                    case 'CONTENT1':
                        components.content = comp.component_no;
                        console.log(`[미션 컴포넌트] ✓ CONTENT1 → content: ${comp.component_no}`);
                        break;
                    case 'SURVEY':
                        components.survey = comp.component_no;
                        console.log(`[미션 컴포넌트] ✓ SURVEY → survey: ${comp.component_no}`);
                        break;
                    case 'BANNER':
                        components.banner = comp.component_no;
                        console.log(`[미션 컴포넌트] ✓ BANNER → banner: ${comp.component_no}`);
                        break;
                    case 'ACCUMULATION':
                        if (isWeeklyAccumulation(comp.start_dt, comp.end_dt)) {
                            components.weekly = comp.component_no;
                            const weekInfo = `${comp.start_dt.slice(5, 10)} ~ ${comp.end_dt.slice(5, 10)}`;
                            console.log(`[미션 컴포넌트] ✓ ACCUMULATION (주간) → weekly: ${comp.component_no} (${weekInfo})`);
                        } else {
                            components.attendance = comp.component_no;
                            console.log(`[미션 컴포넌트] ✓ ACCUMULATION (월간) → attendance: ${comp.component_no}`);
                        }
                        break;
                    case 'ACHIEVEMENT':
                        console.log(`[미션 컴포넌트] ⏭️ ACHIEVEMENT (${comp.component_no}) - 제외됨`);
                        break;
                    default:
                        console.log(`[미션 컴포넌트] ⚠️ 알 수 없는 타입: ${comp.type} (${comp.component_no})`);
                }
            }

            state.missionComponents = components;
            console.log('[미션 컴포넌트 로드] ✓ 완료:', components);
            return components;
        } else {
            console.error('[미션 컴포넌트 로드] ✗ API 오류:', response);
            return null;
        }
    } catch (e) {
        console.error('[미션 컴포넌트 로드] ✗ 실패:', e.message);
        return null;
    }
}

export async function getDailyMissions(headers) {
    const componentNo = state.missionComponents.daily;
    if (!componentNo) {
        console.error('[데일리 미션 조회] ✗ componentNo가 로드되지 않음');
        return null;
    }

    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
    const missionHeaders = makeMissionHeaders(headers);

    console.log(`[데일리 미션 조회] URL: ${url} (componentNo: ${componentNo})`);

    try {
        const response = await apiRequest(url, 'GET', missionHeaders);
        if (response && response.code === 0 && response.value) {
            console.log(`[데일리 미션 조회] ✓ 미션 ${response.value.missions?.length || 0}개 조회 완료`);
            return response.value;
        } else {
            console.error('[데일리 미션 조회] ✗ API 오류:', response);
            return null;
        }
    } catch (e) {
        console.error('[데일리 미션 조회] ✗ 실패:', e.message);
        return null;
    }
}

export async function receiveMissionReward(headers, missionNo, componentNo) {
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;
    const missionHeaders = {
        ...makeMissionHeaders(headers),
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    };
    const body = { mission_no: missionNo, component_no: componentNo };

    console.log(`[미션 보상 수령] mission_no: ${missionNo}`);

    try {
        const response = await apiRequest(url, 'POST', missionHeaders, body);
        if (response && response.code === 0 && response.value) {
            const reward = response.value.reward_amount || 0;
            console.log(`[미션 보상 수령] ✓ ${response.value.title}: ${reward} FLAKE`);
            return response.value;
        } else {
            console.error('[미션 보상 수령] ✗ API 오류:', response);
            return null;
        }
    } catch (e) {
        console.error('[미션 보상 수령] ✗ 실패:', e.message);
        return null;
    }
}

export async function getDailyMissionStatus(headers, componentNo = 1) {
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
    const rewardHeaders = makeMissionHeaders(headers);
    const response = await apiRequest(url, 'GET', rewardHeaders);
    return response;
}

export async function getAllDailyMissions(headers) {
    const componentNos = Object.values(state.missionComponents).filter(Boolean);

    if (componentNos.length === 0) {
        console.log('[전체 미션 조회] 동적 ID 없음, 로드 시도...');
        await getMissionComponentIds(headers);
        const reloaded = Object.values(state.missionComponents).filter(Boolean);
        if (reloaded.length === 0) {
            console.error('[전체 미션 조회] 동적 component ID를 로드할 수 없습니다');
            return [];
        }
        componentNos.push(...reloaded);
    }

    console.log(`[전체 미션 조회] ${componentNos.length}개 component 조회 시작:`, componentNos);

    try {
        const results = await Promise.all(
            componentNos.map(no => getDailyMissionStatus(headers, no).catch(err => {
                console.error(`[전체 미션 조회] Component ${no} 실패:`, err);
                return null;
            }))
        );

        return results
            .map((result, index) => {
                if (result && result.value) {
                    return { componentNo: componentNos[index], ...result.value };
                }
                return null;
            })
            .filter(r => r !== null);
    } catch (error) {
        console.error('[전체 미션 조회] 오류:', error);
        return [];
    }
}

export async function participateMission(headers, missionNo, componentNo) {
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;
    const rewardHeaders = {
        ...makeMissionHeaders(headers),
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    };
    const body = { mission_no: missionNo, component_no: componentNo };

    console.log(`[미션 참여] mission_no: ${missionNo}, component_no: ${componentNo}`);
    const response = await apiRequest(url, 'POST', rewardHeaders, body);

    if (response && response.value) {
        console.log(`[미션 참여] ${response.value.title} - 상태: ${response.value.status}`);
    }

    return response;
}

export async function checkGameOwnership(headers, gameId) {
    const url = `${CONFIG.api.baseUrl}/ownership/v1/check_ownership_by_bgameid?game_id=${gameId}`;
    const eventHeaders = {
        'Authorization': headers['Authorization'],
        'caller-id': 'event-hub',
        'caller-detail': headers['X-UUID'] || headers['caller-detail'],
        'X-Client-Lang': 'ko',
        'X-Timezone': 'Asia/Seoul',
        'X-Utc-Offset': '540',
        'X-Nation': 'KR',
        'X-Lang': 'ko',
        'X-Device-Type': 'pc',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://event.onstove.com',
        'Referer': 'https://event.onstove.com/'
    };

    const response = await apiRequest(url, 'GET', eventHeaders);
    return response;
}
