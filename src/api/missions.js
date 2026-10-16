import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { apiRequest } from './request.js';
import { makeRewardPageHeaders, makeRewardPageJsonHeaders, makeEventHubHeaders } from './headers.js';
import { debugLog } from '../utils/debug.js';

// Missions are served by the reward page; writes (participate, vote, prize apply) send JSON.
export const makeMissionHeaders = makeRewardPageHeaders;
export const makeMissionJsonHeaders = makeRewardPageJsonHeaders;

export function missionComponentUrl(componentNo) {
    return `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
}

export function missionParticipateUrl() {
    return `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;
}

export function isWeeklyAccumulation(startDt, endDt) {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    return diffDays <= 14;
}

export function isComponentActive(startDt, endDt, now = new Date()) {
    return now >= new Date(startDt) && now <= new Date(endDt);
}

function pushUniqueComponentNo(componentNos, componentNo) {
    if (Array.isArray(componentNo)) {
        componentNo.forEach(no => pushUniqueComponentNo(componentNos, no));
        return;
    }

    if (componentNo != null && !componentNos.includes(componentNo)) {
        componentNos.push(componentNo);
    }
}

export function getDailyComponentNos(missionComponents = state.missionComponents) {
    const componentNos = [];
    pushUniqueComponentNo(componentNos, missionComponents.dailyComponents);
    pushUniqueComponentNo(componentNos, missionComponents.daily);
    return componentNos;
}

export function getMissionComponentNos(missionComponents = state.missionComponents) {
    const componentNos = [];
    getDailyComponentNos(missionComponents).forEach(componentNo => pushUniqueComponentNo(componentNos, componentNo));
    pushUniqueComponentNo(componentNos, missionComponents.content);
    pushUniqueComponentNo(componentNos, missionComponents.weekly);
    pushUniqueComponentNo(componentNos, missionComponents.survey);
    pushUniqueComponentNo(componentNos, missionComponents.banner);
    pushUniqueComponentNo(componentNos, missionComponents.attendance);
    return componentNos;
}

export function mapMissionComponentIds(componentList = [], options = {}) {
    const now = options.now || new Date();
    const components = {
        daily: null,
        dailyComponents: [],
        content: null,
        weekly: null,
        survey: null,
        banner: null,
        attendance: null
    };

    for (const comp of componentList) {
        if (!isComponentActive(comp.start_dt, comp.end_dt, now)) {
            continue;
        }

        switch (comp.type) {
            case 'SINGLE':
                components.daily = comp.component_no;
                pushUniqueComponentNo(components.dailyComponents, comp.component_no);
                break;
            case 'CONTENT1':
                components.content = comp.component_no;
                break;
            case 'SURVEY':
                components.survey = comp.component_no;
                break;
            case 'BANNER':
                components.banner = comp.component_no;
                break;
            case 'ACCUMULATION':
                if (isWeeklyAccumulation(comp.start_dt, comp.end_dt)) {
                    components.weekly = comp.component_no;
                } else {
                    components.attendance = comp.component_no;
                }
                break;
            default:
                break;
        }
    }

    return components;
}

export async function getMissionComponentIds(headers) {
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/page?page_type=MISSION`;
    const missionHeaders = makeMissionHeaders(headers);

    debugLog('[미션 컴포넌트 로드] URL:', url);

    try {
        const response = await apiRequest(url, 'GET', missionHeaders);

        if (response && response.code === 0 && response.value?.component_list) {
            const components = mapMissionComponentIds(response.value.component_list);

            state.missionComponents = components;
            debugLog('[미션 컴포넌트 로드] ✓ 완료:', components);
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
    const componentNos = getDailyComponentNos();
    if (componentNos.length === 0) {
        console.error('[데일리 미션 조회] ✗ componentNo가 로드되지 않음');
        return null;
    }

    const missionHeaders = makeMissionHeaders(headers);

    debugLog(`[데일리 미션 조회] componentNos: ${componentNos.join(', ')}`);

    try {
        const values = [];

        for (const componentNo of componentNos) {
            const response = await apiRequest(missionComponentUrl(componentNo), 'GET', missionHeaders);

            if (response && response.code === 0 && response.value) {
                values.push({
                    componentNo,
                    ...response.value,
                    missions: (response.value.missions || []).map(mission => ({
                        ...mission,
                        component_no: mission.component_no || componentNo
                    }))
                });
            } else {
                console.error(`[데일리 미션 조회] ✗ API 오류 (componentNo: ${componentNo}):`, response);
            }
        }

        if (values.length === 0) {
            return null;
        }

        const missions = values.flatMap(value => value.missions || []);
        debugLog(`[데일리 미션 조회] ✓ 미션 ${missions.length}개 조회 완료`);

        return values.length === 1
            ? values[0]
            : {
                componentNo: state.missionComponents.daily,
                component_info: {
                    component_no: state.missionComponents.daily,
                    component_type: 'SINGLE'
                },
                components: values,
                missions
            };
    } catch (e) {
        console.error('[데일리 미션 조회] ✗ 실패:', e.message);
        return null;
    }
}

export async function receiveMissionReward(headers, missionNo, componentNo) {
    const body = { mission_no: missionNo, component_no: componentNo };

    debugLog(`[미션 보상 수령] mission_no: ${missionNo}`);

    try {
        const response = await apiRequest(missionParticipateUrl(), 'POST', makeMissionJsonHeaders(headers), body);
        if (response && response.code === 0 && response.value) {
            const reward = response.value.reward_amount || 0;
            debugLog(`[미션 보상 수령] ✓ ${response.value.title}: ${reward} FLAKE`);
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
    return apiRequest(missionComponentUrl(componentNo), 'GET', makeMissionHeaders(headers));
}

export async function getAllDailyMissions(headers) {
    const componentNos = getMissionComponentNos();

    if (componentNos.length === 0) {
        debugLog('[전체 미션 조회] 동적 ID 없음, 로드 시도...');
        await getMissionComponentIds(headers);
        const reloaded = getMissionComponentNos();
        if (reloaded.length === 0) {
            console.error('[전체 미션 조회] 동적 component ID를 로드할 수 없습니다');
            return [];
        }
        componentNos.push(...reloaded);
    }

    debugLog(`[전체 미션 조회] ${componentNos.length}개 component 조회 시작:`, componentNos);

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
    const body = { mission_no: missionNo, component_no: componentNo };

    debugLog(`[미션 참여] mission_no: ${missionNo}, component_no: ${componentNo}`);
    const response = await apiRequest(missionParticipateUrl(), 'POST', makeMissionJsonHeaders(headers), body);

    if (response && response.value) {
        debugLog(`[미션 참여] ${response.value.title} - 상태: ${response.value.status}`);
    }

    return response;
}

export async function checkGameOwnership(headers, gameId) {
    const url = `${CONFIG.api.baseUrl}/ownership/v1/check_ownership_by_bgameid?game_id=${gameId}`;
    return apiRequest(url, 'GET', makeEventHubHeaders(headers));
}
