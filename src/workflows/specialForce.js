import { getSpecialForceShop, claimSpecialForceReward, SPECIAL_FORCE_GAME_ID } from '../api/specialForce.js';
import { extractHeaders } from '../utils/auth.js';
import { state } from '../state.js';
import { log } from '../ui/logger.js';
import { renderSpecialForce } from '../ui/specialForce.js';

const DAY = 86400000;
export function normalizeSpecialForce(value, now = new Date()) {
    if (value?.notAvailable) return { success: true, notAvailable: true };
    const dates = value?.date_info;
    const parse = date => new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(date || '') ? date : `${date}+09:00`);
    const start = parse(dates?.attend_start_dt), end = parse(dates?.attend_end_dt);
    const plays = value?.accumulated_plays;
    if (value?.service_id !== SPECIAL_FORCE_GAME_ID || value.attendance_type !== 'ACCUMULATED_PLAY_SYSTEM' ||
        !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start ||
        !Number.isSafeInteger(plays?.total_play_days) || plays.total_play_days < 0 || !Array.isArray(plays.rewards) ||
        ![value.event_not_started, value.event_ended, value.exchange_condition].every(flag => typeof flag === 'boolean')) {
        throw new Error('스페셜포스 상태 형식 확인 실패');
    }
    const seen = new Set();
    const rewards = plays.rewards.map(reward => {
        if (!Number.isSafeInteger(reward.item_no) || reward.item_no <= 0 || seen.has(reward.item_no) ||
            !Number.isSafeInteger(reward.rewardable_days) || reward.rewardable_days <= 0 ||
            ![reward.eligible, reward.is_received, reward.sold_out].every(flag => typeof flag === 'boolean')) {
            throw new Error('스페셜포스 보상 형식 확인 실패');
        }
        seen.add(reward.item_no);
        return { ...reward };
    }).sort((a, b) => a.rewardable_days - b.rewardable_days);
    const active = !value.event_not_started && !value.event_ended && now >= start && now <= end;
    const claimable = rewards.filter(r => active && value.exchange_condition && r.eligible &&
        !r.is_received && !r.sold_out && r.item_type === 'FLAKE');
    return { success: true, month: value.month, start: start.toISOString(), end: end.toISOString(),
        periodDays: Math.floor((end - start) / DAY) + 1,
        remainingDays: active ? Math.max(1, Math.ceil((end - now) / DAY)) : 0,
        active, notStarted: value.event_not_started || now < start, ended: value.event_ended || now > end,
        exchangeCondition: value.exchange_condition, totalPlayDays: plays.total_play_days,
        rewardCount: rewards.length, targetDays: Math.max(0, ...rewards.map(r => r.rewardable_days)),
        receivedCount: rewards.filter(r => r.is_received).length, rewards, claimable,
        checkedAt: now.toISOString() };
}

export async function checkSpecialForce(headers, deps = {}) {
    try {
        return normalizeSpecialForce(await (deps.getShop || getSpecialForceShop)(headers), deps.now || new Date());
    } catch (error) {
        return { success: false, error: error.message };
    }
}

let busy = false;
export async function collectSpecialForceRewards(headers, deps = {}) {
    if (busy) return { success: false, error: '스페셜포스 작업이 진행 중입니다' };
    busy = true;
    const check = () => checkSpecialForce(headers, deps);
    const assertSession = () => {
        const current = (deps.getHeaders || extractHeaders)();
        if (current.Authorization !== headers.Authorization) throw new Error('로그인 계정이 변경되어 작업을 중단했습니다');
    };
    let earned = 0;
    const claimed = [];
    try {
        assertSession();
        const before = await check();
        if (!before.success) throw new Error(before.error);
        for (const candidate of before.claimable || []) {
            assertSession();
            const fresh = await check();
            if (!fresh.success) throw new Error(fresh.error);
            const reward = fresh.claimable?.find(r => r.item_no === candidate.item_no);
            if (!reward) continue;
            assertSession();
            const response = await (deps.claim || claimSpecialForceReward)(headers, reward);
            // Never retry an ambiguous POST; a later refresh determines receipt.
            earned += response.flake_amount;
            claimed.push(reward.item_no);
            state.earnings.specialForce = (state.earnings.specialForce || 0) + response.flake_amount;
            log(`스페셜포스 ${reward.rewardable_days}일차: ${response.flake_amount.toLocaleString()} F 수령`, 'success');
        }
        assertSession();
        const after = await check();
        renderSpecialForce(after);
        if (!after.success || claimed.some(id => !after.rewards?.find(r => r.item_no === id)?.is_received) ||
            (after.claimable?.length || 0) > 0) {
            throw new Error('스페셜포스 보상 반영 확인 대기 — 새로고침 후 확인해 주세요');
        }
        if (!claimed.length) log('스페셜포스: 현재 수령 가능한 보상 없음 (실행 반영은 종료 후 최대 5분)', 'info');
        return { success: true, earned, claimed, before, after };
    } catch (error) {
        renderSpecialForce({ success: false, error: error.message });
        log(`스페셜포스: ${error.message}`, 'warning');
        return { success: false, earned, claimed, error: error.message };
    } finally { busy = false; }
}

export async function refreshSpecialForce() {
    renderSpecialForce({ loading: true });
    try {
        const headers = extractHeaders();
        const result = await checkSpecialForce(headers);
        if (extractHeaders().Authorization !== headers.Authorization) throw new Error('로그인 계정 변경 — 다시 조회해 주세요');
        renderSpecialForce(result);
        return result;
    } catch (error) {
        renderSpecialForce({ success: false, error: error.message });
    }
}

export async function receiveSpecialForce() {
    if (state.isRunning) { log('전체 자동화 완료 후 이용해 주세요', 'warning'); return; }
    const button = document.getElementById('stove-btn-special-force-claim');
    if (button) button.disabled = true;
    try { await collectSpecialForceRewards(extractHeaders()); }
    catch (error) { renderSpecialForce({ success: false, error: error.message }); }
}
