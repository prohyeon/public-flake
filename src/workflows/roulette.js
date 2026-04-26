import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { delay } from '../utils/time.js';
import {
    getRouletteParticipationCount, executeRouletteDraw,
    getRouletteExtra, claimRouletteExtra,
    getRouletteSubEventNo, getRouletteExtraSubEventNo
} from '../api/roulette.js';
import { extractHeaders } from '../utils/auth.js';
import { log } from '../ui/logger.js';
import { updateProgress, setButtonState } from '../ui/progress.js';

export async function runRouletteDraws(headers) {
    if (!CONFIG.roulette.enabled) {
        log('⚠️ 룰렛 기능이 비활성화되어 있습니다', 'warning');
        state.completed.roulette = true;
        updateProgress();
        return 0;
    }

    log('룰렛 확인 중...', 'info');

    try {
        let totalRewards = 0;
        let totalSuccessCount = 0;
        let roundCount = 0;

        while (true) {
            roundCount++;
            console.log(`\n[룰렛 실행 루프] ===== Round ${roundCount} 시작 =====`);

            const participationInfo = await getRouletteParticipationCount(headers, getRouletteSubEventNo());

            if (!participationInfo || !participationInfo.value) {
                log('⚠️ 룰렛 정보를 가져올 수 없습니다', 'warning');
                break;
            }

            const maxDraws = CONFIG.roulette.maxDraws;
            const current = participationInfo.value.participation_cnt || 0;
            const remaining = Math.max(0, maxDraws - current);

            if (roundCount === 1) {
                log(`✓ 룰렛 참여 가능 횟수: ${remaining}/${maxDraws} (현재: ${current})`, 'success');
            } else {
                log(`✓ [${roundCount}차] 남은 횟수 재확인: ${remaining}/${maxDraws}`, 'info');
            }

            if (current >= maxDraws) {
                log(roundCount === 1 ? '오늘의 룰렛 참여 횟수를 모두 사용했습니다' : '모든 룰렛 횟수를 소진했습니다', 'info');
                break;
            }

            log(`룰렛 ${remaining}회 실행 시작...`, 'info');

            let roundSuccessCount = 0;
            let shouldStopRoulette = false;

            for (let i = 1; i <= remaining; i++) {
                let drawSuccess = false;
                let retryCount = 0;

                while (!drawSuccess && retryCount <= CONFIG.roulette.maxRetries) {
                    try {
                        if (retryCount > 0) {
                            log(`🔄 룰렛 ${i}/${remaining} 재시도 (${retryCount}/${CONFIG.roulette.maxRetries})...`, 'warning');
                            await delay(CONFIG.roulette.retryDelay);
                        }

                        const drawResult = await executeRouletteDraw(headers, getRouletteSubEventNo());

                        if (drawResult && drawResult.code !== 0) {
                            const errorCode = drawResult.code;
                            if (errorCode === 7019) {
                                log(`⚠️ 룰렛 이벤트 기간이 아닙니다`, 'warning');
                                shouldStopRoulette = true;
                                break;
                            } else {
                                log(`✗ 룰렛 ${i}/${remaining} API 오류 (코드: ${errorCode})`, 'error');
                                retryCount++;
                                continue;
                            }
                        }

                        if (drawResult && drawResult.value) {
                            const giftPrice = drawResult.value.gift_info?.gift_price || 0;
                            const giftName = drawResult.value.gift_info?.gift_name || '알 수 없음';
                            totalRewards += giftPrice;
                            roundSuccessCount++;
                            totalSuccessCount++;
                            log(`✓ 룰렛 ${i}/${remaining} 완료: ${giftName} (${giftPrice} FLAKE)`, 'success');
                            drawSuccess = true;
                        }

                        await delay(CONFIG.delays.betweenActions);
                    } catch (e) {
                        log(`✗ 룰렛 ${i}/${remaining} 실패: ${e.message}`, 'error');
                        retryCount++;
                        if (retryCount > CONFIG.roulette.maxRetries) {
                            log(`❌ 룰렛 ${i}/${remaining} 최대 재시도 횟수 초과`, 'error');
                            shouldStopRoulette = true;
                            break;
                        }
                    }
                }

                if (shouldStopRoulette) {
                    log('🛑 룰렛 프로세스를 중단합니다', 'warning');
                    break;
                }
            }

            log(`[${roundCount}차] ${roundSuccessCount}/${remaining} 성공`, 'info');

            if (shouldStopRoulette) break;

            await delay(CONFIG.delays.betweenActions);
        }

        if (totalSuccessCount > 0) {
            const totalCost = totalSuccessCount * CONFIG.roulette.drawCost;
            const netProfit = totalRewards - totalCost;
            const profitSign = netProfit >= 0 ? '+' : '';

            log('', 'info');
            log(`🎰 최종 룰렛 결과 (${roundCount}차 실행)`, 'success');
            log(`  🎯 총 실행: ${totalSuccessCount}회 성공`, 'success');
            log(`  💰 총 획득: ${totalRewards} FLAKE`, 'success');
            log(`  💸 총 비용: ${totalCost} FLAKE`, 'info');
            log(`  📊 순수익: ${profitSign}${netProfit} FLAKE`, netProfit >= 0 ? 'success' : 'warning');

            state.earnings.roulette = netProfit;
            state.completed.roulette = true;
            updateProgress();
            return netProfit;
        }
    } catch (e) {
        log(`✗ 룰렛 실행 실패: ${e.message}`, 'error');
    }

    state.completed.roulette = true;
    updateProgress();
    log('✅ 룰렛 실행 완료!', 'success');
    return 0;
}

export async function claimRouletteExtraRewards(headers) {
    log('룰렛 EXTRA 확인 중...', 'info');
    let extraFlakeEarned = 0;

    try {
        const extraData = await getRouletteExtra(headers, getRouletteExtraSubEventNo());
        console.log('[룰렛 EXTRA] API Response:', extraData);

        if (!extraData) {
            log('⚠️ 룰렛 EXTRA API 응답이 없습니다', 'warning');
            return extraFlakeEarned;
        }

        if (extraData.code !== 0) {
            log(`⚠️ 룰렛 EXTRA API 오류: ${extraData.message || 'Unknown error'}`, 'warning');
            return extraFlakeEarned;
        }

        if (extraData.value?.milestones) {
            const currentCnt = extraData.value.current_cnt || 0;
            const currentCycle = extraData.value.current_cycle || 0;
            const milestones = extraData.value.milestones || [];

            log(`현재 카운트: ${currentCnt}`, 'info');
            log(`총 마일스톤: ${milestones.length}개`, 'info');

            const claimableMilestones = milestones.filter(m =>
                currentCnt >= m.milestone && m.received_yn === false
            );

            if (claimableMilestones.length === 0) {
                log('수령 가능한 룰렛 EXTRA가 없습니다', 'info');
                return extraFlakeEarned;
            }

            log(`✓ 수령 가능한 EXTRA: ${claimableMilestones.length}개`, 'success');

            for (const milestone of claimableMilestones) {
                try {
                    const result = await claimRouletteExtra(
                        headers, getRouletteExtraSubEventNo(), milestone.gift_no, currentCycle
                    );

                    if (result && result.code === 0) {
                        const giftName = milestone.gift_name || '';
                        const flakeMatch = giftName.match(/([0-9,]+)\s*플레이크/);
                        const flakeAmount = flakeMatch ? parseInt(flakeMatch[1].replace(/,/g, '')) : 0;

                        extraFlakeEarned += flakeAmount;
                        log(`✓ EXTRA 수령 완료: ${milestone.gift_name} (${flakeAmount} FLAKE)`, 'success');
                    } else {
                        log(`✗ EXTRA 수령 실패 (milestone_no: ${milestone.milestone_no})`, 'error');
                    }

                    await delay(CONFIG.delays.betweenActions);
                } catch (e) {
                    log(`✗ EXTRA 수령 오류: ${e.message}`, 'error');
                }
            }

            if (extraFlakeEarned > 0) {
                log(`💰 총 EXTRA 수령: ${extraFlakeEarned} FLAKE`, 'success');
            }
        } else {
            log('⚠️ 룰렛 EXTRA 정보 구조가 올바르지 않습니다', 'warning');
        }
    } catch (e) {
        log(`✗ 룰렛 EXTRA 확인 실패: ${e.message}`, 'error');
    }

    state.earnings.rouletteExtra = extraFlakeEarned;
    log('✅ 룰렛 EXTRA 처리 완료!', 'success');
    return extraFlakeEarned;
}

export async function runRoulette() {
    if (state.isRunning) {
        log('⚠️ 이미 실행 중입니다', 'warning');
        return;
    }

    state.isRunning = true;
    setButtonState(true);

    try {
        log('🎰 룰렛 실행 시작...', 'info');
        const headers = extractHeaders();
        await runRouletteDraws(headers);
    } catch (error) {
        log(`✗ 오류 발생: ${error.message}`, 'error');
    } finally {
        state.isRunning = false;
        setButtonState(false);
    }
}
