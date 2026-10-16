import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { delay, getKSTDate } from '../utils/time.js';
import { openTabInBackground } from '../utils/tabs.js';
import {
    getDailyMissions, receiveMissionReward, getAllDailyMissions, participateMission,
    makeMissionHeaders, makeMissionJsonHeaders, missionComponentUrl, missionParticipateUrl
} from '../api/missions.js';
import { apiRequest } from '../api/request.js';
import {
    getPrizeEventNo, getPrizeGiftNo, getPrizeFlakeCost
} from '../api/roulette.js';
import { log } from '../ui/logger.js';

const COMPLETE_STATUSES = new Set(['COMPLETE', 'COMPLETED']);

// Every mission step takes optional deps so tests can replace I/O; defaults are the real modules.
function services(deps = {}) {
    return {
        apiRequest,
        getDailyMissions,
        getAllDailyMissions,
        participateMission,
        receiveMissionReward,
        openTabInBackground,
        delay,
        log,
        ...deps
    };
}

function isMissionStepEnabled(stepConfig, label, io) {
    if (stepConfig.enabled) return true;
    io.log(`⏭️ ${label}이 비활성화되어 있습니다`, 'info');
    return false;
}

// Content, banner, attendance and survey steps cannot run before the mission page loaded their component.
function requireMissionComponent(io, componentKey, stepKey, label) {
    const componentNo = state.missionComponents[componentKey];
    if (!componentNo) {
        io.log(`⚠️ ${label} componentNo가 로드되지 않음`, 'warning');
        state.completed[stepKey] = true;
    }
    return componentNo;
}

function finishMissionStep(stepKey, earned) {
    state.earnings[stepKey] = earned;
    state.completed[stepKey] = true;
}

// Returns the component's missions, or null when the response is unusable. Banner and attendance
// accept a response without `code: 0` as long as it carries missions.
async function readComponentMissions(io, headers, componentNo, { requireOk = true } = {}) {
    const response = await io.apiRequest(missionComponentUrl(componentNo), 'GET', makeMissionHeaders(headers));
    if (requireOk && response?.code !== 0) return null;
    return response?.value?.missions || null;
}

// Claims rewards one by one; a falsy reward_amount counts as a failed claim.
async function claimMissionRewards(io, headers, missions, { componentNo, delayMs, onClaimed, onFailed }) {
    let earned = 0;
    for (const mission of missions) {
        const result = await io.receiveMissionReward(headers, mission.mission_no, componentNo(mission));
        if (result && result.reward_amount) {
            earned += result.reward_amount;
            onClaimed?.(mission, result);
        } else {
            onFailed?.(mission, result);
        }
        await io.delay(delayMs);
    }
    return earned;
}

function countCompleted(missions) {
    return missions.filter(mission => COMPLETE_STATUSES.has(mission.status)).length;
}

const contentTitle = mission => `${mission.title.substring(0, 30)}...`;
const bannerTitle = mission => mission.title.replace(/<br>/g, ' ');

function isPrizeEntryMission(mission) {
    return mission.mission_no === CONFIG.prizeEntry.missionNo ||
        mission.title === CONFIG.prizeEntry.missionTitle;
}

function getSingleMissionSkipReason(mission) {
    if (isPrizeEntryMission(mission)) return '경품 응모 전용 단계에서 처리';
    if (mission.title?.includes('앱 로그인')) return '스토브 앱 로그인 필요';
    return '방문형 자동 참여 대상 아님';
}

async function getPrizeEntryMission(headers, io) {
    try {
        const missionData = await io.getDailyMissions(headers);
        const mission = missionData?.missions?.find(isPrizeEntryMission);

        if (mission) {
            io.log(`  ✓ 경품 응모 미션 확인: ${mission.mission_no} (${mission.status})`, 'info');
            return { ...mission, component_no: mission.component_no || state.missionComponents.daily };
        }
    } catch (error) {
        io.log(`  ⚠️ 경품 응모 미션 조회 실패: ${error.message}`, 'warning');
    }

    io.log(`  ⚠️ 경품 응모 미션을 찾지 못해 fallback mission_no ${CONFIG.prizeEntry.missionNo} 사용`, 'warning');
    return {
        mission_no: CONFIG.prizeEntry.missionNo,
        component_no: state.missionComponents.daily,
        title: CONFIG.prizeEntry.missionTitle,
        reward_amount: 0,
        status: null
    };
}

export async function executeVisitMission(mission, deps = {}) {
    const io = services(deps);
    const { title, button_url } = mission;
    try {
        io.log(`🌐 ${title} 방문 중...`, 'info');
        const tab = io.openTabInBackground(button_url, false);
        io.log(`✓ ${title} 탭 열림`, 'success');
        return { success: true, tab };
    } catch (e) {
        io.log(`✗ ${title} 방문 실패: ${e.message}`, 'error');
        return { success: false, tab: null };
    }
}

export async function executeDailyMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.dailyMissions, '데일리 미션', io)) return;

    io.log('📋 데일리 미션 시작...', 'info');
    const openedTabs = [];

    try {
        const missionData = await io.getDailyMissions(headers);
        if (!missionData || !missionData.missions) {
            io.log('✗ 미션 목록 조회 실패', 'error');
            finishMissionStep('dailyMissions', 0);
            return;
        }

        const missions = missionData.missions;
        io.log(`📝 총 ${missions.length}개 미션 확인`, 'info');

        const visitMissions = missions.filter(m =>
            m.is_visit_mission === true && m.status === 'INCOMPLETE' && m.button_url?.trim()
        );

        if (visitMissions.length > 0) {
            io.log(`🌐 방문 미션 ${visitMissions.length}개 탭 열기 시작...`, 'info');
            for (const mission of visitMissions) {
                const result = await executeVisitMission(mission, deps);
                if (result.tab) openedTabs.push(result.tab);
                await io.delay(CONFIG.delays.betweenActions);
            }
            io.log('✅ 방문 미션 탭 열기 완료', 'success');
            await io.delay(CONFIG.dailyMissions.visitDelay);
        } else {
            io.log('ℹ️ 수행할 방문 미션이 없습니다', 'info');
        }

        const updatedMissionData = await io.getDailyMissions(headers);
        if (!updatedMissionData || !updatedMissionData.missions) {
            io.log('✗ 미션 상태 재조회 실패', 'error');
            finishMissionStep('dailyMissions', 0);
            return;
        }

        const receivableMissions = updatedMissionData.missions.filter(m =>
            m.status === 'RECEIVABLE' && !CONFIG.dailyMissions.skipMissions.includes(m.mission_no)
        );

        let totalEarned = 0;
        if (receivableMissions.length > 0) {
            io.log(`🎁 수령 가능한 보상 ${receivableMissions.length}개 발견`, 'info');
            totalEarned = await claimMissionRewards(io, headers, receivableMissions, {
                componentNo: mission => mission.component_no || state.missionComponents.daily,
                delayMs: CONFIG.delays.betweenActions
            });
            io.log(`✅ 데일리 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
        } else {
            io.log('ℹ️ 수령 가능한 보상이 없습니다', 'info');
        }

        finishMissionStep('dailyMissions', totalEarned);

        const completedCount = updatedMissionData.missions.filter(m => m.status === 'COMPLETE').length;
        io.log(`📊 미션 진행 상황: ${completedCount}/${updatedMissionData.missions.length} 완료`, 'info');

    } catch (error) {
        io.log(`✗ 데일리 미션 오류: ${error.message}`, 'error');
    }

    io.log('✅ 데일리 미션 처리 완료!', 'success');
    return openedTabs;
}

export async function executeContentMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.contentMissions, '컨텐츠 미션', io)) return;

    io.log('📰 컨텐츠 미션 시작...', 'info');
    const openedTabs = [];

    const componentNo = requireMissionComponent(io, 'content', 'contentMissions', '컨텐츠 미션');
    if (!componentNo) return;

    try {
        const missions = await readComponentMissions(io, headers, componentNo);
        if (!missions) {
            io.log('✗ 컨텐츠 미션 목록 조회 실패', 'error');
            finishMissionStep('contentMissions', 0);
            return;
        }

        io.log(`📝 총 ${missions.length}개 컨텐츠 미션 확인`, 'info');

        const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE' && m.url?.trim());
        if (incompleteMissions.length > 0) {
            io.log(`🌐 미완료 컨텐츠 미션 ${incompleteMissions.length}개 탭 열기 시작...`, 'info');
            for (const mission of incompleteMissions) {
                try {
                    io.log(`  🌐 "${contentTitle(mission)}" 방문 중...`, 'info');
                    openedTabs.push(io.openTabInBackground(mission.url, false));
                    io.log(`  ✓ "${contentTitle(mission)}" 탭 열림`, 'success');
                } catch (e) {
                    io.log(`  ✗ 방문 실패: ${e.message}`, 'error');
                }
                await io.delay(CONFIG.delays.betweenActions);
            }
            io.log('✅ 컨텐츠 미션 탭 열기 완료', 'success');
            await io.delay(3000);
        } else {
            io.log('ℹ️ 방문할 미완료 컨텐츠 미션이 없습니다', 'info');
        }

        // A failed reread leaves the step unfinished (unlike daily missions); the repair pass retries it.
        const updatedMissions = await readComponentMissions(io, headers, componentNo);
        if (!updatedMissions) {
            io.log('✗ 컨텐츠 미션 상태 재조회 실패', 'error');
            return;
        }

        const receivableMissions = updatedMissions.filter(m => m.status === 'RECEIVABLE');

        let totalEarned = 0;
        if (receivableMissions.length > 0) {
            io.log(`🎁 수령 가능한 컨텐츠 미션 ${receivableMissions.length}개 발견`, 'info');
            totalEarned = await claimMissionRewards(io, headers, receivableMissions, {
                componentNo: () => componentNo,
                delayMs: CONFIG.delays.betweenActions,
                onClaimed: (mission, result) =>
                    io.log(`  ✓ "${contentTitle(mission)}": +${result.reward_amount} FLAKE`, 'success')
            });
            io.log(`✅ 컨텐츠 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
        } else {
            io.log('ℹ️ 수령 가능한 컨텐츠 미션이 없습니다', 'info');
        }

        finishMissionStep('contentMissions', totalEarned);
        io.log(`📊 컨텐츠 미션 진행 상황: ${countCompleted(updatedMissions)}/${updatedMissions.length} 완료`, 'info');

    } catch (error) {
        io.log(`✗ 컨텐츠 미션 오류: ${error.message}`, 'error');
    }

    io.log('✅ 컨텐츠 미션 처리 완료!', 'success');
    return openedTabs;
}

export async function executeWeeklyMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.weeklyMissions, '위클리 미션', io)) return;

    io.log('📅 위클리 미션 시작...', 'info');

    // Weekly missions are often absent, so every failure is reported as "unavailable", not as an error.
    const componentNo = state.missionComponents.weekly;
    if (!componentNo) {
        io.log('ℹ️ 위클리 미션: 현재 이용 불가 (API 응답 없음)', 'info');
        finishMissionStep('weeklyMissions', 0);
        return;
    }

    try {
        const missions = await readComponentMissions(io, headers, componentNo);
        if (!missions) {
            io.log('ℹ️ 위클리 미션: 현재 이용 불가', 'info');
            finishMissionStep('weeklyMissions', 0);
            return;
        }

        io.log(`📝 총 ${missions.length}개 위클리 미션 확인`, 'info');

        const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

        let totalEarned = 0;
        if (receivableMissions.length > 0) {
            io.log(`🎁 수령 가능한 위클리 미션 ${receivableMissions.length}개 발견`, 'info');
            totalEarned = await claimMissionRewards(io, headers, receivableMissions, {
                componentNo: () => componentNo,
                delayMs: CONFIG.delays.betweenActions,
                onClaimed: (mission, result) =>
                    io.log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success')
            });
            io.log(`✅ 위클리 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
        } else {
            io.log('ℹ️ 수령 가능한 위클리 미션이 없습니다', 'info');
        }

        finishMissionStep('weeklyMissions', totalEarned);
        io.log(`📊 위클리 미션 진행 상황: ${countCompleted(missions)}/${missions.length} 완료`, 'info');

        const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
        if (incompleteMissions.length > 0) {
            io.log('ℹ️ 진행 중인 미션:', 'info');
            for (const mission of incompleteMissions) {
                const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_total_cnt || 0}`;
                io.log(`  📌 ${mission.title}: ${progress}`, 'info');
            }
        }

    } catch (error) {
        io.log('ℹ️ 위클리 미션: 현재 이용 불가', 'info');
        finishMissionStep('weeklyMissions', 0);
    }

    io.log('✅ 위클리 미션 처리 완료!', 'success');
}

export async function executeBannerMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.bannerMissions, '배너 미션', io)) return;

    io.log('🎨 배너 미션 시작...', 'info');
    const openedTabs = [];

    const componentNo = requireMissionComponent(io, 'banner', 'bannerMissions', '배너 미션');
    if (!componentNo) return;

    try {
        const missions = await readComponentMissions(io, headers, componentNo, { requireOk: false });
        if (!missions) {
            io.log('⚠️ 배너 미션 데이터를 찾을 수 없습니다', 'warning');
            finishMissionStep('bannerMissions', 0);
            return;
        }

        let latestMissions = missions;
        io.log(`📋 배너 미션 ${missions.length}개 발견`, 'info');

        const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
        const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');
        const completedCount = countCompleted(missions);

        if (completedCount > 0) io.log(`  ✓ 이미 완료됨: ${completedCount}개`, 'info');

        if (incompleteMissions.length === 0 && receivableMissions.length === 0) {
            io.log('ℹ️ 수령 가능하거나 진행 필요한 배너 미션이 없습니다', 'info');
            finishMissionStep('bannerMissions', 0);
            return;
        }

        if (incompleteMissions.length > 0) {
            io.log(`🌐 배너 URL ${incompleteMissions.length}개 방문 중...`, 'info');
            for (const mission of incompleteMissions) {
                if (mission.button_url?.trim()) {
                    io.log(`  ⏳ "${bannerTitle(mission)}" 방문 중...`, 'info');
                    openedTabs.push(io.openTabInBackground(mission.button_url, false));
                    io.log(`  ✓ "${bannerTitle(mission)}" 탭 열림`, 'success');
                } else {
                    io.log(`  ⚠️ "${bannerTitle(mission)}" - URL 없음, 스킵`, 'warning');
                }
                await io.delay(200);
            }

            if (openedTabs.length > 0) {
                io.log(`⏳ ${CONFIG.bannerMissions.visitDelay}ms 동안 배너 방문 반영 대기...`, 'info');
                await io.delay(CONFIG.bannerMissions.visitDelay);

                // Fall back to the first read when the reread fails; its RECEIVABLE items are still claimable.
                try {
                    const updatedMissions = await readComponentMissions(io, headers, componentNo, { requireOk: false });
                    if (updatedMissions) {
                        latestMissions = updatedMissions;
                        io.log('✓ 배너 미션 상태 재조회 완료', 'success');
                    } else {
                        io.log('⚠️ 배너 미션 상태 재조회 실패 - 기존 수령 가능 항목만 처리합니다', 'warning');
                    }
                } catch (error) {
                    io.log(`⚠️ 배너 미션 상태 재조회 실패: ${error.message} - 기존 수령 가능 항목만 처리합니다`, 'warning');
                }
            }
        }

        const claimableMissions = latestMissions.filter(m => m.status === 'RECEIVABLE');

        let totalEarned = 0;
        if (claimableMissions.length > 0) {
            io.log(`💰 배너 미션 보상 수령 중... (${claimableMissions.length}개)`, 'info');
            totalEarned = await claimMissionRewards(io, headers, claimableMissions, {
                componentNo: () => componentNo,
                delayMs: 500,
                onClaimed: (mission, result) =>
                    io.log(`  ✓ "${bannerTitle(mission)}": +${result.reward_amount} FLAKE`, 'success'),
                onFailed: mission => io.log(`  ✗ "${bannerTitle(mission)}" 수령 실패`, 'error')
            });
        } else {
            io.log('ℹ️ 수령 가능한 배너 미션이 없습니다', 'info');
        }

        finishMissionStep('bannerMissions', totalEarned);

        if (totalEarned > 0) {
            io.log(`✅ 배너 미션 ${missions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, 'success');
        }

    } catch (error) {
        io.log(`✗ 배너 미션 오류: ${error.message}`, 'error');
    }

    io.log('✅ 배너 미션 처리 완료!', 'success');
    return openedTabs;
}

export async function executeAttendanceMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.attendanceMissions, '출석 미션', io)) return;

    io.log('📅 출석 미션 시작...', 'info');

    const componentNo = requireMissionComponent(io, 'attendance', 'attendanceMissions', '출석 미션');
    if (!componentNo) return;

    try {
        const missions = await readComponentMissions(io, headers, componentNo, { requireOk: false });
        if (!missions) {
            io.log('⚠️ 출석 미션 데이터를 찾을 수 없습니다', 'warning');
            finishMissionStep('attendanceMissions', 0);
            return;
        }

        io.log(`📋 출석 미션 ${missions.length}개 발견`, 'info');

        const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

        let totalEarned = 0;
        if (receivableMissions.length === 0) {
            io.log('ℹ️ 수령 가능한 출석 미션이 없습니다', 'info');
            const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
            for (const mission of incompleteMissions) {
                const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_per_cnt || 0}`;
                io.log(`  📌 ${mission.title}: ${progress} (목표: ${mission.milestone_total_cnt}회)`, 'info');
            }
        } else {
            io.log(`💰 수령 가능한 미션: ${receivableMissions.length}개`, 'info');
            totalEarned = await claimMissionRewards(io, headers, receivableMissions, {
                componentNo: () => componentNo,
                delayMs: 500,
                onClaimed: (mission, result) =>
                    io.log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success'),
                onFailed: mission => io.log(`  ✗ "${mission.title}" 수령 실패`, 'error')
            });
        }

        finishMissionStep('attendanceMissions', totalEarned);

        if (totalEarned > 0) {
            io.log(`✅ 출석 미션 ${receivableMissions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, 'success');
        }

    } catch (error) {
        io.log(`✗ 출석 미션 오류: ${error.message}`, 'error');
    }

    io.log('✅ 출석 미션 처리 완료!', 'success');
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

async function voteSurveyMission(io, headers, mission, componentNo) {
    io.log(`📊 "${mission.title}" 투표 중...`, 'info');

    const selectedContentNo = selectSurveyOption(mission.survey_infos, CONFIG.surveyMissions.voteStrategy);
    const selectedOption = mission.survey_infos.find(info => info.content_no === selectedContentNo);

    if (!selectedContentNo) {
        io.log('  ⚠️ 투표할 항목을 찾을 수 없습니다', 'warning');
        return { voted: false };
    }

    io.log(`  🎯 선택: "${selectedOption.content}" (${selectedOption.percent}%)`, 'info');

    const voteBody = {
        mission_no: mission.mission_no,
        component_no: componentNo,
        content_nos: [selectedContentNo]
    };
    const voteResult = await io.apiRequest(missionParticipateUrl(), 'POST', makeMissionJsonHeaders(headers), voteBody);

    if (voteResult && voteResult.code === 0 && voteResult.value) {
        const reward = voteResult.value.reward_amount || 0;
        io.log(`  ✓ 투표 완료: +${reward} FLAKE`, 'success');
        return { voted: true, reward };
    }

    io.log('  ✗ 투표 실패', 'error');
    return { voted: true, reward: 0 };
}

export async function executeSurveyMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.surveyMissions, '설문조사 미션', io)) return;

    io.log('📊 설문조사 미션 시작...', 'info');

    const componentNo = requireMissionComponent(io, 'survey', 'surveyMissions', '설문조사 미션');
    if (!componentNo) return;

    try {
        const missions = await readComponentMissions(io, headers, componentNo);
        if (!missions) {
            io.log('✗ 설문조사 미션 목록 조회 실패', 'error');
            finishMissionStep('surveyMissions', 0);
            return;
        }

        io.log(`📝 총 ${missions.length}개 설문조사 확인`, 'info');

        const votableMissions = missions.filter(m => m.status === 'RECEIVABLE' && m.mission_type === 'SURVEY');

        let totalEarned = 0;
        if (votableMissions.length === 0) {
            io.log('ℹ️ 투표 가능한 설문조사가 없습니다', 'info');
            const completedCount = countCompleted(missions);
            if (completedCount > 0) io.log(`  ✓ 이미 완료됨: ${completedCount}개`, 'info');
        } else {
            io.log(`🗳️ 투표 가능한 설문조사 ${votableMissions.length}개 발견`, 'info');

            for (const mission of votableMissions) {
                try {
                    const vote = await voteSurveyMission(io, headers, mission, componentNo);
                    // A survey without options is skipped without the usual pause.
                    if (!vote.voted) continue;
                    totalEarned += vote.reward;
                } catch (error) {
                    io.log(`  ✗ "${mission.title}" 투표 실패: ${error.message}`, 'error');
                }

                await io.delay(CONFIG.delays.betweenActions);
            }

            io.log(`✅ 설문조사 투표 완료: +${totalEarned} FLAKE`, 'success');
        }

        finishMissionStep('surveyMissions', totalEarned);
        io.log(`📊 설문조사 진행 상황: ${countCompleted(missions)}/${missions.length} 완료`, 'info');

    } catch (error) {
        io.log(`✗ 설문조사 미션 오류: ${error.message}`, 'error');
    }

    io.log('✅ 설문조사 미션 처리 완료!', 'success');
}

export async function executePrizeEntry(headers, deps = {}) {
    const io = services(deps);
    if (!CONFIG.prizeEntry.enabled) {
        io.log('⏭️ 경품 응모가 비활성화되어 있습니다', 'info');
        finishMissionStep('prizeEntry', 0);
        return;
    }

    io.log('🎁 경품 응모 시작...', 'info');
    let netEarnings = 0;

    try {
        // One FLAKE-spending entry per KST day and browser session.
        const today = getKSTDate();
        const lastEntryDate = sessionStorage.getItem('prize_entry_last_date');

        if (lastEntryDate === today) {
            io.log('ℹ️ 오늘 이미 경품 응모를 완료했습니다', 'info');
            finishMissionStep('prizeEntry', 0);
            return;
        }

        const eventNo = getPrizeEventNo();
        const giftNo = getPrizeGiftNo();
        const flakeCost = getPrizeFlakeCost();
        const giftName = state.prizeInfo.giftName || CONFIG.prizeEntry.targetGiftName || '스토브 5,000 포인트';
        const prizeMission = await getPrizeEntryMission(headers, io);

        io.log(`⏳ 경품 응모 진행 중... (${giftName}, 비용: ${flakeCost} FLAKE)`, 'info');

        const applyUrl = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/apply/${eventNo}`;
        const applyBody = { gift_no: giftNo, req_cnt: 1 };

        const applyResult = await io.apiRequest(applyUrl, 'POST', makeMissionJsonHeaders(headers), applyBody);

        if (!applyResult || applyResult.code !== 0) {
            io.log(`✗ 경품 응모 실패: ${applyResult?.message || '알 수 없는 오류'}`, 'error');
            return;
        }

        io.log(`  ✓ 경품 응모 완료! (응모 번호: ${applyResult.value.user_apply_cnt})`, 'success');
        io.log(`  💰 잔여 FLAKE: ${applyResult.value.residue_flake}`, 'info');
        netEarnings -= flakeCost;

        sessionStorage.setItem('prize_entry_last_date', today);
        io.log(`  📅 응모 날짜 기록: ${today} (KST)`, 'info');

        io.log('⏳ 경품 응모 미션 보상 확인 중...', 'info');
        const result = await io.receiveMissionReward(headers, prizeMission.mission_no, prizeMission.component_no);

        if (result && result.reward_amount) {
            netEarnings += result.reward_amount;
            io.log(`  ✓ 미션 보상 수령 완료: +${result.reward_amount} FLAKE`, 'success');
        }

        finishMissionStep('prizeEntry', netEarnings);

        const profitSign = netEarnings >= 0 ? '+' : '';
        if (netEarnings !== 0) {
            io.log(`✅ 경품 응모 완료! 순수익: ${profitSign}${netEarnings} FLAKE`, netEarnings >= 0 ? 'success' : 'info');
        }

    } catch (error) {
        io.log(`✗ 경품 응모 오류: ${error.message}`, 'error');
    }

    io.log('✅ 경품 응모 처리 완료!', 'success');
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

function getMissionResultStatus(result) {
    return result?.value?.status || result?.status || result?.missionInfo?.status || null;
}

function isRewardClaimResult(result) {
    const status = getMissionResultStatus(result);
    return COMPLETE_STATUSES.has(status) ||
        result?.reward_amount !== undefined ||
        result?.value?.reward_amount !== undefined;
}

export async function autoParticipateVisitMissions(headers, options = {}) {
    const missionOptions = normalizeSingleVisitMissionOptions(options);
    const { targeted, targetMissionNos } = missionOptions;
    const io = services(options.deps);

    try {
        log('[SINGLE 미션] 자동 참여 시작', 'info');

        if (targeted) {
            log(`[SINGLE 미션] Target missionNo filter active: ${targetMissionNos.length}`, 'info');
        }

        const allMissions = await io.getAllDailyMissions(headers);
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
                    const claimResult = await io.receiveMissionReward(headers, mission.mission_no, mission.component_no);
                    if (isRewardClaimResult(claimResult)) completed++;
                    await io.delay(1000);
                    continue;
                }

                const result = await io.participateMission(headers, mission.mission_no, mission.component_no);

                if (mission.button_url?.trim()) {
                    io.openTabInBackground(mission.button_url, false);
                }

                if (result?.value) {
                    const status = result.value.status;
                    if (status === 'RECEIVABLE') {
                        log(`[SINGLE 미션] ✅ "${mission.title}" 참여 완료 (수령 가능)`, 'success');
                        const claimResult = await io.receiveMissionReward(headers, mission.mission_no, mission.component_no);
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
                    const claimResult = await io.receiveMissionReward(headers, mission.mission_no, mission.component_no);
                    if (isRewardClaimResult(claimResult)) completed++;
                }

                await io.delay(1000);
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
