import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { delay } from '../utils/time.js';
import { getKSTDate } from '../utils/time.js';
import { openTabInBackground } from '../utils/tabs.js';
import {
    getDailyMissions, receiveMissionReward, getAllDailyMissions, participateMission,
    makeMissionHeaders
} from '../api/missions.js';
import { apiRequest } from '../api/request.js';
import {
    getPrizeEventNo, getPrizeGiftNo, getPrizeFlakeCost
} from '../api/roulette.js';
import { log } from '../ui/logger.js';

function isPrizeEntryMission(mission) {
    return mission.mission_no === CONFIG.prizeEntry.missionNo ||
        mission.title === CONFIG.prizeEntry.missionTitle;
}

function getSingleMissionSkipReason(mission) {
    if (isPrizeEntryMission(mission)) return '경품 응모 전용 단계에서 처리';
    if (mission.title?.includes('앱 로그인')) return '스토브 앱 로그인 필요';
    return '방문형 자동 참여 대상 아님';
}

async function getPrizeEntryMission(headers) {
    try {
        const missionData = await getDailyMissions(headers);
        const mission = missionData?.missions?.find(isPrizeEntryMission);

        if (mission) {
            log(`  ✓ 경품 응모 미션 확인: ${mission.mission_no} (${mission.status})`, 'info');
            return { ...mission, component_no: mission.component_no || state.missionComponents.daily };
        }
    } catch (error) {
        log(`  ⚠️ 경품 응모 미션 조회 실패: ${error.message}`, 'warning');
    }

    log(`  ⚠️ 경품 응모 미션을 찾지 못해 fallback mission_no ${CONFIG.prizeEntry.missionNo} 사용`, 'warning');
    return {
        mission_no: CONFIG.prizeEntry.missionNo,
        component_no: state.missionComponents.daily,
        title: CONFIG.prizeEntry.missionTitle,
        reward_amount: 0,
        status: null
    };
}

export async function executeVisitMission(mission) {
    const { title, button_url } = mission;
    try {
        log(`🌐 ${title} 방문 중...`, 'info');
        const tab = openTabInBackground(button_url, false);
        log(`✓ ${title} 탭 열림`, 'success');
        return { success: true, tab };
    } catch (e) {
        log(`✗ ${title} 방문 실패: ${e.message}`, 'error');
        return { success: false, tab: null };
    }
}

export async function executeDailyMissions(headers) {
    if (!CONFIG.dailyMissions.enabled) {
        log('⏭️ 데일리 미션이 비활성화되어 있습니다', 'info');
        return;
    }

    log('📋 데일리 미션 시작...', 'info');
    let totalEarned = 0;
    const openedTabs = [];

    try {
        const missionData = await getDailyMissions(headers);
        if (!missionData || !missionData.missions) {
            log('✗ 미션 목록 조회 실패', 'error');
            state.earnings.dailyMissions = 0;
            state.completed.dailyMissions = true;
            return;
        }

        const missions = missionData.missions;
        log(`📝 총 ${missions.length}개 미션 확인`, 'info');

        const visitMissions = missions.filter(m =>
            m.is_visit_mission === true && m.status === 'INCOMPLETE' && m.button_url?.trim()
        );

        if (visitMissions.length > 0) {
            log(`🌐 방문 미션 ${visitMissions.length}개 탭 열기 시작...`, 'info');
            for (const mission of visitMissions) {
                const result = await executeVisitMission(mission);
                if (result.tab) openedTabs.push(result.tab);
                await delay(CONFIG.delays.betweenActions);
            }
            log('✅ 방문 미션 탭 열기 완료', 'success');
            await delay(CONFIG.dailyMissions.visitDelay);
        } else {
            log('ℹ️ 수행할 방문 미션이 없습니다', 'info');
        }

        const updatedMissionData = await getDailyMissions(headers);
        if (!updatedMissionData || !updatedMissionData.missions) {
            log('✗ 미션 상태 재조회 실패', 'error');
            state.earnings.dailyMissions = 0;
            state.completed.dailyMissions = true;
            return;
        }

        const receivableMissions = updatedMissionData.missions.filter(m =>
            m.status === 'RECEIVABLE' && !CONFIG.dailyMissions.skipMissions.includes(m.mission_no)
        );

        if (receivableMissions.length > 0) {
            log(`🎁 수령 가능한 보상 ${receivableMissions.length}개 발견`, 'info');
            for (const mission of receivableMissions) {
                const result = await receiveMissionReward(headers, mission.mission_no, mission.component_no || state.missionComponents.daily);
                if (result && result.reward_amount) totalEarned += result.reward_amount;
                await delay(CONFIG.delays.betweenActions);
            }
            log(`✅ 데일리 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
        } else {
            log('ℹ️ 수령 가능한 보상이 없습니다', 'info');
        }

        state.earnings.dailyMissions = totalEarned;
        state.completed.dailyMissions = true;

        const completedCount = updatedMissionData.missions.filter(m => m.status === 'COMPLETE').length;
        log(`📊 미션 진행 상황: ${completedCount}/${updatedMissionData.missions.length} 완료`, 'info');

    } catch (error) {
        log(`✗ 데일리 미션 오류: ${error.message}`, 'error');
    }

    log('✅ 데일리 미션 처리 완료!', 'success');
    return openedTabs;
}

export async function executeContentMissions(headers) {
    if (!CONFIG.contentMissions.enabled) {
        log('⏭️ 컨텐츠 미션이 비활성화되어 있습니다', 'info');
        return;
    }

    log('📰 컨텐츠 미션 시작...', 'info');
    let totalEarned = 0;
    const openedTabs = [];

    const componentNo = state.missionComponents.content;
    if (!componentNo) {
        log('⚠️ 컨텐츠 미션 componentNo가 로드되지 않음', 'warning');
        state.completed.contentMissions = true;
        return;
    }

    try {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
        const missionHeaders = makeMissionHeaders(headers);

        const missionData = await apiRequest(url, 'GET', missionHeaders);

        if (!missionData || missionData.code !== 0 || !missionData.value?.missions) {
            log('✗ 컨텐츠 미션 목록 조회 실패', 'error');
            state.earnings.contentMissions = 0;
            state.completed.contentMissions = true;
            return;
        }

        const missions = missionData.value.missions;
        log(`📝 총 ${missions.length}개 컨텐츠 미션 확인`, 'info');

        const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE' && m.url?.trim());
        if (incompleteMissions.length > 0) {
            log(`🌐 미완료 컨텐츠 미션 ${incompleteMissions.length}개 탭 열기 시작...`, 'info');
            for (const mission of incompleteMissions) {
                try {
                    log(`  🌐 "${mission.title.substring(0, 30)}..." 방문 중...`, 'info');
                    const tab = openTabInBackground(mission.url, false);
                    openedTabs.push(tab);
                    log(`  ✓ "${mission.title.substring(0, 30)}..." 탭 열림`, 'success');
                } catch (e) {
                    log(`  ✗ 방문 실패: ${e.message}`, 'error');
                }
                await delay(CONFIG.delays.betweenActions);
            }
            log('✅ 컨텐츠 미션 탭 열기 완료', 'success');
            await delay(3000);
        } else {
            log('ℹ️ 방문할 미완료 컨텐츠 미션이 없습니다', 'info');
        }

        const updatedMissionData = await apiRequest(url, 'GET', missionHeaders);
        if (!updatedMissionData || updatedMissionData.code !== 0 || !updatedMissionData.value?.missions) {
            log('✗ 컨텐츠 미션 상태 재조회 실패', 'error');
            return;
        }

        const receivableMissions = updatedMissionData.value.missions.filter(m => m.status === 'RECEIVABLE');

        if (receivableMissions.length > 0) {
            log(`🎁 수령 가능한 컨텐츠 미션 ${receivableMissions.length}개 발견`, 'info');
            for (const mission of receivableMissions) {
                const result = await receiveMissionReward(headers, mission.mission_no, componentNo);
                if (result && result.reward_amount) {
                    totalEarned += result.reward_amount;
                    log(`  ✓ "${mission.title.substring(0, 30)}...": +${result.reward_amount} FLAKE`, 'success');
                }
                await delay(CONFIG.delays.betweenActions);
            }
            log(`✅ 컨텐츠 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
        } else {
            log('ℹ️ 수령 가능한 컨텐츠 미션이 없습니다', 'info');
        }

        state.earnings.contentMissions = totalEarned;
        state.completed.contentMissions = true;

        const completedCount = updatedMissionData.value.missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED').length;
        log(`📊 컨텐츠 미션 진행 상황: ${completedCount}/${updatedMissionData.value.missions.length} 완료`, 'info');

    } catch (error) {
        log(`✗ 컨텐츠 미션 오류: ${error.message}`, 'error');
    }

    log('✅ 컨텐츠 미션 처리 완료!', 'success');
    return openedTabs;
}

export async function executeWeeklyMissions(headers) {
    if (!CONFIG.weeklyMissions.enabled) {
        log('⏭️ 위클리 미션이 비활성화되어 있습니다', 'info');
        return;
    }

    log('📅 위클리 미션 시작...', 'info');
    let totalEarned = 0;

    const componentNo = state.missionComponents.weekly;
    if (!componentNo) {
        log('ℹ️ 위클리 미션: 현재 이용 불가 (API 응답 없음)', 'info');
        state.completed.weeklyMissions = true;
        state.earnings.weeklyMissions = 0;
        return;
    }

    try {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
        const missionHeaders = makeMissionHeaders(headers);

        const missionData = await apiRequest(url, 'GET', missionHeaders);

        if (!missionData || missionData.code !== 0 || !missionData.value?.missions) {
            log('ℹ️ 위클리 미션: 현재 이용 불가', 'info');
            state.earnings.weeklyMissions = 0;
            state.completed.weeklyMissions = true;
            return;
        }

        const missions = missionData.value.missions;
        log(`📝 총 ${missions.length}개 위클리 미션 확인`, 'info');

        const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

        if (receivableMissions.length > 0) {
            log(`🎁 수령 가능한 위클리 미션 ${receivableMissions.length}개 발견`, 'info');
            for (const mission of receivableMissions) {
                const result = await receiveMissionReward(headers, mission.mission_no, componentNo);
                if (result && result.reward_amount) {
                    totalEarned += result.reward_amount;
                    log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success');
                }
                await delay(CONFIG.delays.betweenActions);
            }
            log(`✅ 위클리 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
        } else {
            log('ℹ️ 수령 가능한 위클리 미션이 없습니다', 'info');
        }

        state.earnings.weeklyMissions = totalEarned;
        state.completed.weeklyMissions = true;

        const completedCount = missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED').length;
        log(`📊 위클리 미션 진행 상황: ${completedCount}/${missions.length} 완료`, 'info');

        const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
        if (incompleteMissions.length > 0) {
            log('ℹ️ 진행 중인 미션:', 'info');
            for (const mission of incompleteMissions) {
                const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_total_cnt || 0}`;
                log(`  📌 ${mission.title}: ${progress}`, 'info');
            }
        }

    } catch (error) {
        log('ℹ️ 위클리 미션: 현재 이용 불가', 'info');
        state.earnings.weeklyMissions = 0;
        state.completed.weeklyMissions = true;
    }

    log('✅ 위클리 미션 처리 완료!', 'success');
}

export async function executeBannerMissions(headers) {
    if (!CONFIG.bannerMissions.enabled) {
        log('⏭️ 배너 미션이 비활성화되어 있습니다', 'info');
        return;
    }

    log('🎨 배너 미션 시작...', 'info');
    let totalEarned = 0;
    const openedTabs = [];

    const componentNo = state.missionComponents.banner;
    if (!componentNo) {
        log('⚠️ 배너 미션 componentNo가 로드되지 않음', 'warning');
        state.completed.bannerMissions = true;
        return;
    }

    try {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
        const missionHeaders = makeMissionHeaders(headers);
        const missionData = await apiRequest(url, 'GET', missionHeaders);

        if (!missionData?.value?.missions) {
            log('⚠️ 배너 미션 데이터를 찾을 수 없습니다', 'warning');
            state.earnings.bannerMissions = 0;
            state.completed.bannerMissions = true;
            return;
        }

        const missions = missionData.value.missions;
        let latestMissions = missions;
        log(`📋 배너 미션 ${missions.length}개 발견`, 'info');

        const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
        const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');
        const completedMissions = missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED');

        if (completedMissions.length > 0) log(`  ✓ 이미 완료됨: ${completedMissions.length}개`, 'info');

        if (incompleteMissions.length === 0 && receivableMissions.length === 0) {
            log('ℹ️ 수령 가능하거나 진행 필요한 배너 미션이 없습니다', 'info');
            state.earnings.bannerMissions = 0;
            state.completed.bannerMissions = true;
            return;
        }

        if (incompleteMissions.length > 0) {
            log(`🌐 배너 URL ${incompleteMissions.length}개 방문 중...`, 'info');
            for (const mission of incompleteMissions) {
                if (mission.button_url?.trim()) {
                    log(`  ⏳ "${mission.title.replace(/<br>/g, ' ')}" 방문 중...`, 'info');
                    const tab = openTabInBackground(mission.button_url, false);
                    openedTabs.push(tab);
                    log(`  ✓ "${mission.title.replace(/<br>/g, ' ')}" 탭 열림`, 'success');
                } else {
                    log(`  ⚠️ "${mission.title.replace(/<br>/g, ' ')}" - URL 없음, 스킵`, 'warning');
                }
                await delay(200);
            }

            if (openedTabs.length > 0) {
                log(`⏳ ${CONFIG.bannerMissions.visitDelay}ms 동안 배너 방문 반영 대기...`, 'info');
                await delay(CONFIG.bannerMissions.visitDelay);

                try {
                    const updatedMissionData = await apiRequest(url, 'GET', missionHeaders);
                    if (updatedMissionData?.value?.missions) {
                        latestMissions = updatedMissionData.value.missions;
                        log('✓ 배너 미션 상태 재조회 완료', 'success');
                    } else {
                        log('⚠️ 배너 미션 상태 재조회 실패 - 기존 수령 가능 항목만 처리합니다', 'warning');
                    }
                } catch (error) {
                    log(`⚠️ 배너 미션 상태 재조회 실패: ${error.message} - 기존 수령 가능 항목만 처리합니다`, 'warning');
                }
            }
        }

        const claimableMissions = latestMissions.filter(m => m.status === 'RECEIVABLE');

        if (claimableMissions.length > 0) {
            log(`💰 배너 미션 보상 수령 중... (${claimableMissions.length}개)`, 'info');
            for (const mission of claimableMissions) {
                const result = await receiveMissionReward(headers, mission.mission_no, componentNo);
                if (result && result.reward_amount) {
                    totalEarned += result.reward_amount;
                    log(`  ✓ "${mission.title.replace(/<br>/g, ' ')}": +${result.reward_amount} FLAKE`, 'success');
                } else {
                    log(`  ✗ "${mission.title.replace(/<br>/g, ' ')}" 수령 실패`, 'error');
                }
                await delay(500);
            }
        } else {
            log('ℹ️ 수령 가능한 배너 미션이 없습니다', 'info');
        }

        state.earnings.bannerMissions = totalEarned;
        state.completed.bannerMissions = true;

        if (totalEarned > 0) {
            log(`✅ 배너 미션 ${missions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, 'success');
        }

    } catch (error) {
        log(`✗ 배너 미션 오류: ${error.message}`, 'error');
    }

    log('✅ 배너 미션 처리 완료!', 'success');
    return openedTabs;
}

export async function executeAttendanceMissions(headers) {
    if (!CONFIG.attendanceMissions.enabled) {
        log('⏭️ 출석 미션이 비활성화되어 있습니다', 'info');
        return;
    }

    log('📅 출석 미션 시작...', 'info');
    let totalEarned = 0;

    const componentNo = state.missionComponents.attendance;
    if (!componentNo) {
        log('⚠️ 출석 미션 componentNo가 로드되지 않음', 'warning');
        state.completed.attendanceMissions = true;
        return;
    }

    try {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
        const missionData = await apiRequest(url, 'GET', makeMissionHeaders(headers));

        if (!missionData?.value?.missions) {
            log('⚠️ 출석 미션 데이터를 찾을 수 없습니다', 'warning');
            state.earnings.attendanceMissions = 0;
            state.completed.attendanceMissions = true;
            return;
        }

        const missions = missionData.value.missions;
        log(`📋 출석 미션 ${missions.length}개 발견`, 'info');

        const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

        if (receivableMissions.length === 0) {
            log('ℹ️ 수령 가능한 출석 미션이 없습니다', 'info');
            const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
            for (const mission of incompleteMissions) {
                const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_per_cnt || 0}`;
                log(`  📌 ${mission.title}: ${progress} (목표: ${mission.milestone_total_cnt}회)`, 'info');
            }
        } else {
            log(`💰 수령 가능한 미션: ${receivableMissions.length}개`, 'info');
            for (const mission of receivableMissions) {
                const result = await receiveMissionReward(headers, mission.mission_no, componentNo);
                if (result && result.reward_amount) {
                    totalEarned += result.reward_amount;
                    log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success');
                } else {
                    log(`  ✗ "${mission.title}" 수령 실패`, 'error');
                }
                await delay(500);
            }
        }

        state.earnings.attendanceMissions = totalEarned;
        state.completed.attendanceMissions = true;

        if (totalEarned > 0) {
            log(`✅ 출석 미션 ${receivableMissions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, 'success');
        }

    } catch (error) {
        log(`✗ 출석 미션 오류: ${error.message}`, 'error');
    }

    log('✅ 출석 미션 처리 완료!', 'success');
}

export function selectSurveyOption(surveyInfos, strategy = 'highest') {
    if (!surveyInfos || surveyInfos.length === 0) return null;

    switch (strategy) {
        case 'highest':
            return surveyInfos.reduce((max, info) => info.percent > max.percent ? info : max).content_no;
        case 'lowest':
            return surveyInfos.reduce((min, info) => info.percent < min.percent ? info : min).content_no;
        case 'random':
            return surveyInfos[Math.floor(Math.random() * surveyInfos.length)].content_no;
        default:
            return surveyInfos.reduce((max, info) => info.percent > max.percent ? info : max).content_no;
    }
}

export async function executeSurveyMissions(headers) {
    if (!CONFIG.surveyMissions.enabled) {
        log('⏭️ 설문조사 미션이 비활성화되어 있습니다', 'info');
        return;
    }

    log('📊 설문조사 미션 시작...', 'info');
    let totalEarned = 0;

    const componentNo = state.missionComponents.survey;
    if (!componentNo) {
        log('⚠️ 설문조사 미션 componentNo가 로드되지 않음', 'warning');
        state.completed.surveyMissions = true;
        return;
    }

    try {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
        const missionHeaders = makeMissionHeaders(headers);

        const missionData = await apiRequest(url, 'GET', missionHeaders);

        if (!missionData || missionData.code !== 0 || !missionData.value?.missions) {
            log('✗ 설문조사 미션 목록 조회 실패', 'error');
            state.earnings.surveyMissions = 0;
            state.completed.surveyMissions = true;
            return;
        }

        const missions = missionData.value.missions;
        log(`📝 총 ${missions.length}개 설문조사 확인`, 'info');

        const votableMissions = missions.filter(m => m.status === 'RECEIVABLE' && m.mission_type === 'SURVEY');

        if (votableMissions.length === 0) {
            log('ℹ️ 투표 가능한 설문조사가 없습니다', 'info');
            const completedMissions = missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED');
            if (completedMissions.length > 0) log(`  ✓ 이미 완료됨: ${completedMissions.length}개`, 'info');
        } else {
            log(`🗳️ 투표 가능한 설문조사 ${votableMissions.length}개 발견`, 'info');

            for (const mission of votableMissions) {
                try {
                    log(`📊 "${mission.title}" 투표 중...`, 'info');

                    const selectedContentNo = selectSurveyOption(mission.survey_infos, CONFIG.surveyMissions.voteStrategy);
                    const selectedOption = mission.survey_infos.find(info => info.content_no === selectedContentNo);

                    if (!selectedContentNo) {
                        log('  ⚠️ 투표할 항목을 찾을 수 없습니다', 'warning');
                        continue;
                    }

                    log(`  🎯 선택: "${selectedOption.content}" (${selectedOption.percent}%)`, 'info');

                    const voteHeaders = {
                        ...makeMissionHeaders(headers),
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    };

                    const voteBody = {
                        mission_no: mission.mission_no,
                        component_no: componentNo,
                        content_nos: [selectedContentNo]
                    };

                    const voteUrl = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;
                    const voteResult = await apiRequest(voteUrl, 'POST', voteHeaders, voteBody);

                    if (voteResult && voteResult.code === 0 && voteResult.value) {
                        const reward = voteResult.value.reward_amount || 0;
                        totalEarned += reward;
                        log(`  ✓ 투표 완료: +${reward} FLAKE`, 'success');
                    } else {
                        log('  ✗ 투표 실패', 'error');
                    }

                } catch (error) {
                    log(`  ✗ "${mission.title}" 투표 실패: ${error.message}`, 'error');
                }

                await delay(CONFIG.delays.betweenActions);
            }

            log(`✅ 설문조사 투표 완료: +${totalEarned} FLAKE`, 'success');
        }

        state.earnings.surveyMissions = totalEarned;
        state.completed.surveyMissions = true;

        const completedCount = missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED').length;
        log(`📊 설문조사 진행 상황: ${completedCount}/${missions.length} 완료`, 'info');

    } catch (error) {
        log(`✗ 설문조사 미션 오류: ${error.message}`, 'error');
    }

    log('✅ 설문조사 미션 처리 완료!', 'success');
}

export async function executePrizeEntry(headers) {
    if (!CONFIG.prizeEntry.enabled) {
        log('⏭️ 경품 응모가 비활성화되어 있습니다', 'info');
        state.earnings.prizeEntry = 0;
        state.completed.prizeEntry = true;
        return;
    }

    log('🎁 경품 응모 시작...', 'info');
    let netEarnings = 0;

    try {
        const today = getKSTDate();
        const lastEntryDate = sessionStorage.getItem('prize_entry_last_date');

        if (lastEntryDate === today) {
            log('ℹ️ 오늘 이미 경품 응모를 완료했습니다', 'info');
            state.earnings.prizeEntry = 0;
            state.completed.prizeEntry = true;
            return;
        }

        const eventNo = getPrizeEventNo();
        const giftNo = getPrizeGiftNo();
        const flakeCost = getPrizeFlakeCost();
        const giftName = state.prizeInfo.giftName || CONFIG.prizeEntry.targetGiftName || '스토브 5,000 포인트';
        const prizeMission = await getPrizeEntryMission(headers);

        log(`⏳ 경품 응모 진행 중... (${giftName}, 비용: ${flakeCost} FLAKE)`, 'info');

        const applyHeaders = {
            ...makeMissionHeaders(headers),
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        const applyUrl = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/apply/${eventNo}`;
        const applyBody = { gift_no: giftNo, req_cnt: 1 };

        const applyResult = await apiRequest(applyUrl, 'POST', applyHeaders, applyBody);

        if (!applyResult || applyResult.code !== 0) {
            log(`✗ 경품 응모 실패: ${applyResult?.message || '알 수 없는 오류'}`, 'error');
            return;
        }

        log(`  ✓ 경품 응모 완료! (응모 번호: ${applyResult.value.user_apply_cnt})`, 'success');
        log(`  💰 잔여 FLAKE: ${applyResult.value.residue_flake}`, 'info');
        netEarnings -= flakeCost;

        sessionStorage.setItem('prize_entry_last_date', today);
        log(`  📅 응모 날짜 기록: ${today} (KST)`, 'info');

        log('⏳ 경품 응모 미션 보상 확인 중...', 'info');
        const result = await receiveMissionReward(headers, prizeMission.mission_no, prizeMission.component_no);

        if (result && result.reward_amount) {
            netEarnings += result.reward_amount;
            log(`  ✓ 미션 보상 수령 완료: +${result.reward_amount} FLAKE`, 'success');
        }

        state.earnings.prizeEntry = netEarnings;
        state.completed.prizeEntry = true;

        const profitSign = netEarnings >= 0 ? '+' : '';
        if (netEarnings !== 0) {
            log(`✅ 경품 응모 완료! 순수익: ${profitSign}${netEarnings} FLAKE`, netEarnings >= 0 ? 'success' : 'info');
        }

    } catch (error) {
        log(`✗ 경품 응모 오류: ${error.message}`, 'error');
    }

    log('✅ 경품 응모 처리 완료!', 'success');
}

export function normalizeSingleVisitMissionOptions(options = {}) {
    const source = Array.isArray(options?.missionNos)
        ? options
        : (Array.isArray(options?.meta?.missionNos) ? options.meta : {});
    const targetMissionNos = [...new Set((source.missionNos || [])
        .filter(missionNo => missionNo !== null && missionNo !== undefined))];
    const targetMissionNoSet = new Set(targetMissionNos.map(missionNo => String(missionNo)));

    return {
        targeted: targetMissionNos.length > 0,
        targetMissionNos,
        targetMissionNoSet
    };
}

export function isTargetedSingleVisitMission(mission, options) {
    if (!options?.targeted) return true;
    return options.targetMissionNoSet.has(String(mission.mission_no));
}

const ACTIONABLE_SINGLE_VISIT_STATUSES = new Set(['INCOMPLETE', 'RECEIVABLE']);
const COMPLETE_SINGLE_VISIT_STATUSES = new Set(['COMPLETE', 'COMPLETED']);

function getSingleVisitMissionDeps(options = {}) {
    return {
        getAllDailyMissions,
        participateMission,
        receiveMissionReward,
        openTabInBackground,
        delay,
        log,
        ...(options.deps || {})
    };
}

function getMissionResultStatus(result) {
    return result?.value?.status || result?.status || result?.missionInfo?.status || null;
}

function isRewardClaimResult(result) {
    const status = getMissionResultStatus(result);
    return COMPLETE_SINGLE_VISIT_STATUSES.has(status) ||
        result?.reward_amount !== undefined ||
        result?.value?.reward_amount !== undefined;
}

export async function autoParticipateVisitMissions(headers, options = {}) {
    const missionOptions = normalizeSingleVisitMissionOptions(options);
    const { targeted, targetMissionNos } = missionOptions;
    const services = getSingleVisitMissionDeps(options);

    try {
        log('[SINGLE 미션] 자동 참여 시작', 'info');

        if (targeted) {
            log(`[SINGLE 미션] Target missionNo filter active: ${targetMissionNos.length}`, 'info');
        }

        const allMissions = await services.getAllDailyMissions(headers);
        if (!allMissions || allMissions.length === 0) {
            log('[SINGLE 미션] 조회된 미션 없음', 'warning');
            return { success: false, participated: 0, completed: 0, skipped: 0, total: 0, targeted, targetMissionNos };
        }

        const singleMissions = [];
        const skippedMissions = [];
        allMissions.forEach(comp => {
            const missions = comp.missions || [];
            missions.forEach(mission => {
                if (!isTargetedSingleVisitMission(mission, missionOptions)) return;

                if (mission.mission_type === 'SINGLE' &&
                    ACTIONABLE_SINGLE_VISIT_STATUSES.has(mission.status) &&
                    !CONFIG.dailyMissions.skipMissions.includes(mission.mission_no)) {
                    const normalizedMission = {
                        mission_no: mission.mission_no,
                        component_no: comp.componentNo,
                        title: mission.title,
                        status: mission.status,
                        reward_amount: mission.reward_amount,
                        is_visit_mission: mission.is_visit_mission,
                        button_url: mission.button_url
                    };

                    if (mission.is_visit_mission === true) {
                        singleMissions.push(normalizedMission);
                    } else {
                        skippedMissions.push({
                            ...normalizedMission,
                            reason: getSingleMissionSkipReason(mission)
                        });
                    }
                }
            });
        });

        skippedMissions.forEach(mission => {
            log(`[SINGLE 미션] ⏭️ "${mission.title}" 스킵 (${mission.reason})`, 'info');
        });

        if (singleMissions.length === 0) {
            log('[SINGLE 미션] 자동 참여 가능한 방문형 미션 없음', 'info');
            return { success: true, participated: 0, completed: 0, skipped: skippedMissions.length, total: 0, targeted, targetMissionNos };
        }

        log(`[SINGLE 미션] ${singleMissions.length}개 발견`, 'info');

        let participated = 0;
        let completed = 0;

        for (const mission of singleMissions) {
            try {
                log(`[SINGLE 미션] "${mission.title}" 참여 중...`, 'info');
                if (mission.status === 'RECEIVABLE') {
                    const claimResult = await services.receiveMissionReward(headers, mission.mission_no, mission.component_no);
                    if (isRewardClaimResult(claimResult)) completed++;
                    await services.delay(1000);
                    continue;
                }

                const result = await services.participateMission(headers, mission.mission_no, mission.component_no);

                if (mission.button_url?.trim()) {
                    services.openTabInBackground(mission.button_url, false);
                }

                if (result?.value) {
                    const status = result.value.status;
                    if (status === 'RECEIVABLE') {
                        log(`[SINGLE 미션] ✅ "${mission.title}" 참여 완료 (수령 가능)`, 'success');
                        const claimResult = await services.receiveMissionReward(headers, mission.mission_no, mission.component_no);
                        if (isRewardClaimResult(claimResult)) completed++;
                        participated++;
                    } else if (status === 'COMPLETE' || status === 'COMPLETED') {
                        log(`[SINGLE 미션] 🎁 "${mission.title}" 보상 수령 완료 (+${mission.reward_amount} 플레이크)`, 'success');
                        completed++;
                    } else {
                        log(`[SINGLE 미션] ⚠️ "${mission.title}" 참여 실패 (상태: ${status})`, 'warning');
                    }
                } else {
                    log(`[SINGLE 미션] ⚠️ "${mission.title}" 응답 없음`, 'warning');
                }

                if (!result?.value) {
                    const claimResult = await services.receiveMissionReward(headers, mission.mission_no, mission.component_no);
                    if (isRewardClaimResult(claimResult)) completed++;
                }

                await services.delay(1000);
            } catch (error) {
                log(`[SINGLE 미션] ❌ "${mission.title}" 오류: ${error.message}`, 'error');
            }
        }

        log(`[SINGLE 미션] 총 참여: ${participated}개, 즉시 완료: ${completed}개, 스킵: ${skippedMissions.length}개`, 'success');
        return { success: true, participated, completed, skipped: skippedMissions.length, total: singleMissions.length, targeted, targetMissionNos };

    } catch (error) {
        log(`[SINGLE 미션] 오류: ${error.message}`, 'error');
        return { success: false, participated: 0, completed: 0, skipped: 0, total: 0, targeted, targetMissionNos, error: error.message };
    }
}
