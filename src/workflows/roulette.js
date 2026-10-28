import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { delay } from '../utils/time.js';
import {
    getRouletteParticipationCount, executeRouletteDraw,
    getRouletteExtra, claimRouletteExtra,
    getRouletteSubEventNo, getRouletteExtraSubEventNo
} from '../api/roulette.js';
import { log } from '../ui/logger.js';
import { debugLog } from '../utils/debug.js';

function services(deps = {}) {
    return {
        getRouletteParticipationCount,
        executeRouletteDraw,
        getRouletteExtra,
        claimRouletteExtra,
        delay,
        log,
        ...deps
    };
}

export async function runRouletteDraws(headers, deps = {}) {
    const io = services(deps);
    if (!CONFIG.roulette.enabled) {
        io.log('⚠️ 룰렛 기능이 비활성화되어 있습니다', 'warning');
        state.completed.roulette = true;
        return 0;
    }

    io.log('룰렛 확인 중...', 'info');

    try {
        let totalRewards = 0;
        let totalSuccessCount = 0;
        let roundCount = 0;
        let previousCount = null;

        while (true) {
            roundCount++;
            debugLog(`\n[룰렛 실행 루프] ===== Round ${roundCount} 시작 =====`);

            const participationInfo = await io.getRouletteParticipationCount(headers, getRouletteSubEventNo());

            if (!participationInfo || !participationInfo.value) {
                io.log('⚠️ 룰렛 정보를 가져올 수 없습니다', 'warning');
                break;
            }

            const maxDraws = CONFIG.roulette.maxDraws;
            const current = participationInfo.value.participation_cnt || 0;
            const remaining = Math.max(0, maxDraws - current);

            if (roundCount === 1) {
                io.log(`✓ 룰렛 참여 가능 횟수: ${remaining}/${maxDraws} (현재: ${current})`, 'success');
            } else {
                io.log(`✓ [${roundCount}차] 남은 횟수 재확인: ${remaining}/${maxDraws}`, 'info');
            }

            if (current >= maxDraws) {
                io.log(roundCount === 1 ? '오늘의 룰렛 참여 횟수를 모두 사용했습니다' : '모든 룰렛 횟수를 소진했습니다', 'info');
                break;
            }

            // Failed draws (e.g. an error code for missing FLAKE) leave the server count unchanged, so a
            // round without progress would only repeat them. This bounds the run by maxDraws rounds.
            if (previousCount !== null && current <= previousCount) {
                io.log(`⚠️ 직전 라운드 후 참여 횟수가 늘지 않아 룰렛을 중단합니다 (현재: ${current})`, 'warning');
                break;
            }
            previousCount = current;

            io.log(`룰렛 ${remaining}회 실행 시작...`, 'info');

            let roundSuccessCount = 0;
            let shouldStopRoulette = false;
            let outcomeUnknown = false;

            for (let i = 1; i <= remaining; i++) {
                let drawSuccess = false;
                let retryCount = 0;

                while (!drawSuccess && retryCount <= CONFIG.roulette.maxRetries) {
                    try {
                        if (retryCount > 0) {
                            io.log(`🔄 룰렛 ${i}/${remaining} 재시도 (${retryCount}/${CONFIG.roulette.maxRetries})...`, 'warning');
                            await io.delay(CONFIG.roulette.retryDelay);
                        }

                        const drawResult = await io.executeRouletteDraw(headers, getRouletteSubEventNo());

                        if (drawResult && drawResult.code !== 0) {
                            const errorCode = drawResult.code;
                            if (errorCode === 7019) {
                                io.log(`⚠️ 룰렛 이벤트 기간이 아닙니다`, 'warning');
                                shouldStopRoulette = true;
                                break;
                            } else {
                                io.log(`✗ 룰렛 ${i}/${remaining} API 오류 (코드: ${errorCode})`, 'error');
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
                            io.log(`✓ 룰렛 ${i}/${remaining} 완료: ${giftName} (${giftPrice} FLAKE)`, 'success');
                            drawSuccess = true;
                        } else {
                            // code 0 (or an empty body) without a result: the server may already have drawn
                            // and charged FLAKE, so never re-send it. End the round; the next one re-reads
                            // the server count and stops if it did not move.
                            io.log(`⚠️ 룰렛 ${i}/${remaining} 결과를 확인할 수 없어 참여 횟수를 다시 확인합니다`, 'warning');
                            outcomeUnknown = true;
                            break;
                        }

                        await io.delay(CONFIG.delays.betweenActions);
                    } catch (e) {
                        io.log(`✗ 룰렛 ${i}/${remaining} 실패: ${e.message}`, 'error');
                        retryCount++;
                        if (retryCount > CONFIG.roulette.maxRetries) {
                            io.log(`❌ 룰렛 ${i}/${remaining} 최대 재시도 횟수 초과`, 'error');
                            shouldStopRoulette = true;
                            break;
                        }
                    }
                }

                if (shouldStopRoulette) {
                    io.log('🛑 룰렛 프로세스를 중단합니다', 'warning');
                    break;
                }
                if (outcomeUnknown) break;
            }

            io.log(`[${roundCount}차] ${roundSuccessCount}/${remaining} 성공`, 'info');

            if (shouldStopRoulette) break;

            await io.delay(CONFIG.delays.betweenActions);
        }

        if (totalSuccessCount > 0) {
            const totalCost = totalSuccessCount * CONFIG.roulette.drawCost;
            const netProfit = totalRewards - totalCost;
            const profitSign = netProfit >= 0 ? '+' : '';

            io.log('', 'info');
            io.log(`🎰 최종 룰렛 결과 (${roundCount}차 실행)`, 'success');
            io.log(`  🎯 총 실행: ${totalSuccessCount}회 성공`, 'success');
            io.log(`  💰 총 획득: ${totalRewards} FLAKE`, 'success');
            io.log(`  💸 총 비용: ${totalCost} FLAKE`, 'info');
            io.log(`  📊 순수익: ${profitSign}${netProfit} FLAKE`, netProfit >= 0 ? 'success' : 'warning');

            state.earnings.roulette = netProfit;
            state.completed.roulette = true;
            return netProfit;
        }
    } catch (e) {
        io.log(`✗ 룰렛 실행 실패: ${e.message}`, 'error');
    }

    state.completed.roulette = true;
    io.log('✅ 룰렛 실행 완료!', 'success');
    return 0;
}

export async function claimRouletteExtraRewards(headers, deps = {}) {
    const io = services(deps);
    io.log('룰렛 EXTRA 확인 중...', 'info');
    let extraFlakeEarned = 0;

    try {
        const extraData = await io.getRouletteExtra(headers, getRouletteExtraSubEventNo());
        debugLog('[룰렛 EXTRA] API Response:', extraData);

        if (!extraData) {
            io.log('⚠️ 룰렛 EXTRA API 응답이 없습니다', 'warning');
            return extraFlakeEarned;
        }

        if (extraData.code !== 0) {
            io.log(`⚠️ 룰렛 EXTRA API 오류: ${extraData.message || 'Unknown error'}`, 'warning');
            return extraFlakeEarned;
        }

        if (extraData.value?.milestones) {
            const currentCnt = extraData.value.current_cnt || 0;
            const currentCycle = extraData.value.current_cycle || 0;
            const milestones = extraData.value.milestones || [];

            io.log(`현재 카운트: ${currentCnt}`, 'info');
            io.log(`총 마일스톤: ${milestones.length}개`, 'info');

            const claimableMilestones = milestones.filter(m =>
                currentCnt >= m.milestone && m.received_yn === false
            );

            if (claimableMilestones.length === 0) {
                io.log('수령 가능한 룰렛 EXTRA가 없습니다', 'info');
                return extraFlakeEarned;
            }

            io.log(`✓ 수령 가능한 EXTRA: ${claimableMilestones.length}개`, 'success');

            for (const milestone of claimableMilestones) {
                try {
                    const result = await io.claimRouletteExtra(
                        headers, getRouletteExtraSubEventNo(), milestone.gift_no, currentCycle
                    );

                    if (result && result.code === 0) {
                        const giftName = milestone.gift_name || '';
                        const flakeMatch = giftName.match(/([0-9,]+)\s*플레이크/);
                        const flakeAmount = flakeMatch ? parseInt(flakeMatch[1].replace(/,/g, '')) : 0;

                        extraFlakeEarned += flakeAmount;
                        io.log(`✓ EXTRA 수령 완료: ${milestone.gift_name} (${flakeAmount} FLAKE)`, 'success');
                    } else {
                        io.log(`✗ EXTRA 수령 실패 (milestone_no: ${milestone.milestone_no})`, 'error');
                    }

                    await io.delay(CONFIG.delays.betweenActions);
                } catch (e) {
                    io.log(`✗ EXTRA 수령 오류: ${e.message}`, 'error');
                }
            }

            if (extraFlakeEarned > 0) {
                io.log(`💰 총 EXTRA 수령: ${extraFlakeEarned} FLAKE`, 'success');
            }
        } else {
            io.log('⚠️ 룰렛 EXTRA 정보 구조가 올바르지 않습니다', 'warning');
        }
    } catch (e) {
        io.log(`✗ 룰렛 EXTRA 확인 실패: ${e.message}`, 'error');
    }

    state.earnings.rouletteExtra = extraFlakeEarned;
    io.log('✅ 룰렛 EXTRA 처리 완료!', 'success');
    return extraFlakeEarned;
}
