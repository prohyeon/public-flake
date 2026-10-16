// Dailyshop (event.onstove.com) fixtures for src/workflows/shop.js and src/api/shop.js.
// Shapes follow what the src code reads (see also claudedocs/game-dailyshop-reward-design.md).
// Dates assume the harness clock (2026-10-16 10:00 KST) with TZ pinned to Asia/Seoul.

export const TODAY = '2026-10-16';
export const YESTERDAY = '2026-10-15';

const DAILYSHOP = 'https://api.onstove.com/dailyshop/v1.0';
export const DAILY_SHOP_URL = `${DAILYSHOP}/202610/services/STOVEINDIE`;
export const MAJAK_SHOP_URL = `${DAILYSHOP}/202610/services/RIICHICITY_IND`;

export const dailyClaimUrl = (rewardType, itemNo) =>
    `${DAILYSHOP}/attendances/daily/${rewardType}?item_no=${itemNo}&reward_type=${rewardType}`;
export const accumulateClaimUrl = (endpoint, itemNo) =>
    `${DAILYSHOP}/attendances/accumulate/${endpoint}?item_no=${itemNo}`;
export const ownershipUrl = gameId =>
    `https://api.onstove.com/ownership/v1/check_ownership_by_bgameid?game_id=${gameId}`;

// What makeEventHeaders(TEST_HEADERS) must produce (GET); claims add Content-Type.
export const EVENT_HEADERS = Object.freeze({
    'Authorization': 'Bearer test-suat',
    'caller-id': 'event-hub',
    'caller-detail': 'test-uuid',
    'X-Client-Lang': 'ko',
    'X-Timezone': 'Asia/Seoul',
    'X-Utc-Offset': '540',
    'X-Nation': 'KR',
    'X-Lang': 'ko',
    'X-Device-Type': 'pc',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://event.onstove.com',
    'Referer': 'https://event.onstove.com/'
});
export const EVENT_POST_HEADERS = Object.freeze({ ...EVENT_HEADERS, 'Content-Type': 'application/json' });

export function dailyReward(overrides = {}) {
    return {
        item_type: 'FLAKE',
        attendance_date: TODAY,
        item_no: 1001,
        item_name: '데일리 플레이크',
        flake_amount: 50,
        is_received: false,
        ...overrides
    };
}

export function accumulatedReward(overrides = {}) {
    return {
        item_type: 'FLAKE',
        rewardable_days: 5,
        item_no: 2001,
        item_name: '누적 5일 플레이크',
        flake_amount: 300,
        is_received: false,
        ...overrides
    };
}

// dailyShop({ daily: [...], accumulated: [...], totalDays }) — omit a list to omit that section.
export function dailyShop({ daily, accumulated, totalDays = 0 } = {}) {
    const value = { game_info: { game_id: 'STOVEINDIE' } };
    if (daily) value.daily_attendances = { rewards: daily };
    if (accumulated) value.accumulated_attendances = { total_attendance_days: totalDays, rewards: accumulated };
    return { code: 0, message: 'OK', value };
}

export const CLAIM_OK = Object.freeze({ code: 0, message: 'OK', value: { total_attendance_days: 16 } });
export const claimFailed = (code, message = '보상 수령 실패') => ({ code, message, value: null });

export const notOwned = { code: 0, message: 'OK', value: { owner_list: [] } };
export const owned = gameId => ({ code: 0, message: 'OK', value: { owner_list: [{ game_id: gameId }] } });
