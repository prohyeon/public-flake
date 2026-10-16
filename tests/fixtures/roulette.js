// Roulette (reward.onstove.com / emsbackapi) fixtures for src/workflows/roulette.js and src/api/roulette.js.

const EMS = 'https://api.onstove.com/emsbackapi/v3.0';
export const DRAW_EVENT = '1000000353'; // CONFIG.roulette.subEventNo
export const EXTRA_EVENT = '1000000357'; // CONFIG.roulette.extraSubEventNo

export const participationUrl = (subEventNo = DRAW_EVENT) => `${EMS}/participationCnt?sub_event_no=${subEventNo}`;
export const drawUrl = (subEventNo = DRAW_EVENT) => `${EMS}/draw/${subEventNo}`;
export const extraUrl = (subEventNo = EXTRA_EVENT) => `${EMS}/extra?sub_event_no=${subEventNo}`;
export const extraClaimUrl = (subEventNo = EXTRA_EVENT) => `${EMS}/extra/${subEventNo}`;
export const EVENTS_URL = `${EMS}/events?service_id1=STOVE_WEB&service_id2=FLAKE_WEB`;
export const applyUrl = subEventNo => `${EMS}/apply?sub_event_no=${subEventNo}`;

// What makeRewardHeaders(TEST_HEADERS) must produce.
export const REWARD_HEADERS = Object.freeze({
    'Authorization': 'Bearer test-suat',
    'caller-id': 'flake-fe',
    'caller-detail': 'test-uuid',
    'x-lang': 'ko',
    'x-nation': 'KR',
    'Accept': '*/*',
    'Origin': 'https://reward.onstove.com',
    'Referer': 'https://reward.onstove.com/'
});

export const participation = count => ({
    code: 0,
    message: 'OK',
    value: { sub_event_no: Number(DRAW_EVENT), participation_cnt: count }
});

/**
 * runRouletteDraws re-polls the participation count after every round and only stops when the
 * count reaches maxDraws, the response has no value, or the GET throws. Always pass a sequence
 * whose LAST entry terminates the loop (it repeats forever otherwise).
 */
export function participationSequence(...counts) {
    return counts.map(count => (typeof count === 'number' ? participation(count) : count));
}

export const NO_PARTICIPATION_INFO = Object.freeze({ code: 40001, message: '이벤트 정보 없음', value: null });

export const drawWon = (giftName, giftPrice, giftNo = 9000 + giftPrice) => ({
    code: 0,
    message: 'OK',
    value: { gift_info: { gift_no: giftNo, gift_name: giftName, gift_price: giftPrice } }
});
export const drawError = (code, message = '룰렛 오류') => ({ code, message, value: null });
export const EVENT_NOT_ACTIVE = Object.freeze(drawError(7019, '이벤트 기간이 아닙니다'));

export function milestone(overrides = {}) {
    return {
        milestone_no: 1,
        milestone: 10,
        gift_no: 5001,
        gift_name: '100 플레이크',
        received_yn: false,
        ...overrides
    };
}

export const extraStatus = ({ currentCnt, currentCycle = 1, milestones }) => ({
    code: 0,
    message: 'OK',
    value: { current_cnt: currentCnt, current_cycle: currentCycle, milestones }
});

export const EXTRA_CLAIM_OK = Object.freeze({ code: 0, message: 'OK', value: null });
