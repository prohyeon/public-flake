import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { delay, getTodayString } from '../utils/time.js';
import { getDailyShopRewards, claimDailyReward, getMajakDailyShopRewards, claimMajakAccumulatedReward, claimDailyAccumulatedReward } from '../api/shop.js';
import { checkGameOwnership } from '../api/missions.js';
import { log } from '../ui/logger.js';
import { updateProgress } from '../ui/progress.js';

const REWARD_SHOP_URL = 'https://reward.onstove.com/ko';

function services(deps = {}) {
    return {
        getDailyShopRewards,
        claimDailyReward,
        getMajakDailyShopRewards,
        claimMajakAccumulatedReward,
        claimDailyAccumulatedReward,
        checkGameOwnership,
        getTodayString,
        delay,
        log,
        updateProgress,
        ...deps
    };
}

function toDailyRewardType(itemType) {
    if (itemType === 'FLAKE') return 'flake';
    if (itemType === 'INDIE_SALE_COUPON') return 'indie_sale_coupon';
    return 'coupon';
}

function todayUnclaimedRewards(rewards, todayString) {
    return rewards.filter(reward => reward.attendance_date === todayString && !reward.is_received);
}

// The daily shop and majak share the same daily attendance claim; only the log label differs.
async function claimTodayAttendanceRewards(io, headers, rewards, label) {
    let earned = 0;
    let successCount = 0;

    for (const reward of rewards) {
        try {
            const result = await io.claimDailyReward(headers, reward.item_no, toDailyRewardType(reward.item_type));

            if (result && result.code === 0) {
                const rewardAmount = reward.flake_amount || 0;
                const rewardName = reward.item_name || reward.item_type;
                earned += rewardAmount;
                successCount++;
                io.log(`✓ ${label} 수령 완료: ${rewardName} (${rewardAmount} FLAKE)`, 'success');
            } else {
                io.log(`✗ ${label} 수령 실패 (item_no: ${reward.item_no})`, 'error');
            }

            await io.delay(CONFIG.delays.betweenActions);
        } catch (e) {
            io.log(`✗ ${label} 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, 'error');
        }
    }

    return { earned, successCount };
}

export async function claimDailyShopRewards(headers, deps = {}) {
    const io = services(deps);
    io.log('데일리 보상 확인 중...', 'info');
    let dailyFlakeEarned = 0;

    try {
        const dailyShopData = await io.getDailyShopRewards(headers);

        if (dailyShopData?.value?.daily_attendances) {
            const rewards = dailyShopData.value.daily_attendances.rewards || [];
            const todayString = io.getTodayString();

            io.log(`오늘 날짜: ${todayString}`, 'info');

            const unclaimedRewards = todayUnclaimedRewards(rewards, todayString);

            io.log(`✓ 오늘 수령 가능한 보상: ${unclaimedRewards.length}개`, 'success');

            if (unclaimedRewards.length === 0) {
                io.log('오늘 수령 가능한 데일리 보상이 없습니다', 'info');
                state.earnings.dailyShop = 0;
                state.completed.dailyShop = true;
                io.updateProgress();
                io.log('✅ 데일리 보상 처리 완료!', 'success');
                return 0;
            }

            const { earned, successCount } = await claimTodayAttendanceRewards(io, headers, unclaimedRewards, '보상');
            dailyFlakeEarned += earned;

            if (successCount > 0) {
                io.log(`💰 총 ${successCount}개 보상 수령 완료: ${dailyFlakeEarned} FLAKE`, 'success');
            }
        } else {
            io.log('⚠️ 데일리 보상 정보를 가져올 수 없습니다', 'warning');
        }
    } catch (e) {
        io.log(`✗ 데일리 보상 확인 실패: ${e.message}`, 'error');
    }

    state.earnings.dailyShop = dailyFlakeEarned;
    state.completed.dailyShop = true;
    io.updateProgress();
    io.log('✅ 데일리 보상 처리 완료!', 'success');
    return dailyFlakeEarned;
}

export async function claimMajakDailyShopRewards(headers, deps = {}) {
    const io = services(deps);
    io.log('마작 리워드 확인 중...', 'info');
    let majakFlakeEarned = 0;

    try {
        let majakShopData = await io.getMajakDailyShopRewards(headers);

        if (majakShopData?.value) {
            if (majakShopData.value.daily_attendances) {
                const rewards = majakShopData.value.daily_attendances.rewards || [];
                const todayString = io.getTodayString();

                io.log(`오늘 날짜: ${todayString}`, 'info');

                const unclaimedRewards = todayUnclaimedRewards(rewards, todayString);

                io.log(`✓ 오늘 수령 가능한 마작 리워드: ${unclaimedRewards.length}개`, 'success');

                if (unclaimedRewards.length > 0) {
                    const { earned, successCount } = await claimTodayAttendanceRewards(io, headers, unclaimedRewards, '마작 리워드');
                    majakFlakeEarned += earned;

                    // A daily claim can unlock accumulated rewards, so read the attendance totals again.
                    if (successCount > 0) {
                        io.log(`🀄 총 ${successCount}개 마작 일일 리워드 수령 완료`, 'success');
                        io.log('', 'info');
                        io.log('📋 일일 리워드 수령 후 누적 출석 정보 재조회 중...', 'info');
                        majakShopData = await io.getMajakDailyShopRewards(headers);
                        if (!majakShopData?.value) {
                            io.log('⚠️ 누적 출석 정보 재조회 실패', 'warning');
                        }
                    }
                } else {
                    io.log('오늘 수령 가능한 마작 일일 리워드가 없습니다', 'info');
                }
            }

            if (majakShopData?.value?.accumulated_attendances) {
                const accumulatedRewards = majakShopData.value.accumulated_attendances.rewards || [];
                const totalDays = majakShopData.value.accumulated_attendances.total_attendance_days || 0;

                io.log('', 'info');
                io.log(`현재 누적 출석일: ${totalDays}일`, 'info');

                const claimableAccumulated = accumulatedRewards.filter(reward =>
                    totalDays >= reward.rewardable_days && !reward.is_received
                );

                if (claimableAccumulated.length > 0) {
                    io.log(`✓ 수령 가능한 누적 보상: ${claimableAccumulated.length}개`, 'success');

                    let accumulatedSuccessCount = 0;

                    for (const reward of claimableAccumulated) {
                        try {
                            const result = await io.claimMajakAccumulatedReward(headers, reward.item_no, reward.item_type);

                            if (result && result.code === 0) {
                                const rewardAmount = reward.flake_amount || 0;
                                majakFlakeEarned += rewardAmount;
                                accumulatedSuccessCount++;

                                if (reward.item_type === 'FLAKE') {
                                    io.log(`✓ 마작 누적 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name} (${rewardAmount} FLAKE)`, 'success');
                                } else {
                                    io.log(`✓ 마작 누적 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name}`, 'success');
                                }
                            } else {
                                const errorCode = result?.code || 'N/A';
                                io.log(`✗ 마작 누적 보상 수령 실패 (item_no: ${reward.item_no}, 코드: ${errorCode})`, 'error');
                            }

                            await io.delay(CONFIG.delays.betweenActions);
                        } catch (e) {
                            io.log(`✗ 마작 누적 보상 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, 'error');
                        }
                    }

                    if (accumulatedSuccessCount > 0) {
                        io.log(`🎁 총 ${accumulatedSuccessCount}개 마작 누적 보상 수령 완료`, 'success');
                    }
                } else {
                    io.log('수령 가능한 마작 누적 보상이 없습니다', 'info');
                }
            }
        } else {
            io.log('⚠️ 마작 리워드 정보를 가져올 수 없습니다', 'warning');
        }
    } catch (e) {
        io.log(`✗ 마작 리워드 확인 실패: ${e.message}`, 'error');
    }

    state.earnings.majak = majakFlakeEarned;
    state.completed.majak = true;
    io.updateProgress();
    io.log('✅ 마작 리워드 처리 완료!', 'success');
    return majakFlakeEarned;
}

export async function claimDailyAccumulatedRewards(headers, deps = {}) {
    const io = services(deps);
    io.log('🎁 데일리 누적 보상 수령 시작...', 'info');
    let dailyAccumulatedFlake = 0;

    try {
        const dailyShopData = await io.getDailyShopRewards(headers);

        if (dailyShopData?.value?.accumulated_attendances) {
            const accumulatedRewards = dailyShopData.value.accumulated_attendances.rewards || [];
            const totalDays = dailyShopData.value.accumulated_attendances.total_attendance_days || 0;

            io.log(`현재 누적 출석일: ${totalDays}일`, 'info');

            const claimableRewards = accumulatedRewards.filter(reward =>
                totalDays >= reward.rewardable_days && !reward.is_received
            );

            if (claimableRewards.length > 0) {
                io.log(`✓ 수령 가능한 누적 보상: ${claimableRewards.length}개`, 'success');

                for (const reward of claimableRewards) {
                    try {
                        io.log(`📦 보상 정보: ${reward.item_name} (타입: ${reward.item_type}, ${reward.rewardable_days}일)`, 'info');

                        // An indie game coupon is useless for a game the user already owns.
                        if (reward.item_type === 'INDIE_GAME_COUPON' && reward.game_id) {
                            const ownershipData = await io.checkGameOwnership(headers, reward.game_id);
                            if (ownershipData?.value?.owner_list?.length > 0) {
                                io.log(`⚠️ 이미 소유한 게임: ${reward.item_name} - 수령 건너뜀`, 'warning');
                                continue;
                            }
                        }

                        const result = await io.claimDailyAccumulatedReward(headers, reward.item_no, reward.item_type);

                        if (result && result.code === 0) {
                            if (reward.item_type === 'FLAKE') {
                                const rewardAmount = reward.flake_amount || 0;
                                dailyAccumulatedFlake += rewardAmount;
                                io.log(`✓ FLAKE 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name} (${rewardAmount.toLocaleString()} FLAKE)`, 'success');
                            } else {
                                io.log(`✓ 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name}`, 'success');
                            }
                        } else {
                            const errorCode = result?.code || 'N/A';
                            const errorMsg = result?.message || result?.msg || 'N/A';
                            io.log(`✗ 보상 수령 실패: ${reward.item_name} (코드: ${errorCode}, 메시지: ${errorMsg})`, 'error');
                        }

                        await io.delay(CONFIG.delays.betweenActions);
                    } catch (e) {
                        io.log(`✗ 보상 수령 오류 (${reward.item_name}): ${e.message}`, 'error');
                    }
                }
            } else {
                io.log('수령 가능한 누적 보상이 없습니다', 'info');
            }
        } else {
            io.log('⚠️ 누적 보상 정보를 가져올 수 없습니다', 'warning');
        }
    } catch (e) {
        io.log(`✗ 데일리 누적 보상 처리 실패: ${e.message}`, 'error');
    }

    state.earnings.dailyAccumulated = dailyAccumulatedFlake;
    return dailyAccumulatedFlake;
}

// Bound directly to a panel button, so it takes no parameters (the click event would arrive first).
export function openRewardShop() {
    log('🏪 리워드샵 페이지를 새 탭에서 엽니다...', 'info');
    try {
        GM_openInTab(REWARD_SHOP_URL, { active: true, insert: true });
        log('✅ 리워드샵 탭이 열렸습니다!', 'success');
    } catch (error) {
        log(`❌ 탭 열기 실패: ${error.message}`, 'error');
    }
}
