import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { apiRequest } from './request.js';

function makeRewardHeaders(headers) {
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

export function getRouletteSubEventNo() {
    return state.rouletteEvents.draw || CONFIG.roulette.subEventNo;
}

export function getRouletteExtraSubEventNo() {
    return state.rouletteEvents.extra || CONFIG.roulette.extraSubEventNo;
}

export function getPrizeEventNo() {
    return state.prizeInfo.eventNo || state.rouletteEvents.apply || CONFIG.prizeEntry.eventNo;
}

export function getPrizeGiftNo() {
    return state.prizeInfo.giftNo || CONFIG.prizeEntry.giftNo;
}

export function getPrizeFlakeCost() {
    return state.prizeInfo.flakeCost || CONFIG.prizeEntry.flakeCost;
}

export async function getRouletteEventIds(headers) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/events?service_id1=STOVE_WEB&service_id2=FLAKE_WEB`;
    const eventHeaders = { ...makeRewardHeaders(headers), 'Accept': 'application/json' };

    console.log('[룰렛 이벤트 ID 로드] URL:', url);

    try {
        const response = await apiRequest(url, 'GET', eventHeaders);

        if (response && response.code === 0 && response.value) {
            const value = response.value;
            const events = { draw: null, extra: null, apply: null, checkIn: null };

            if (value.draw_info?.sub_event_no) {
                events.draw = String(value.draw_info.sub_event_no);
            }
            if (value.extra_info?.sub_event_no) {
                events.extra = String(value.extra_info.sub_event_no);
            }
            if (value.apply_info?.sub_event_no) {
                events.apply = String(value.apply_info.sub_event_no);
            }
            if (value.check_in_info?.sub_event_no) {
                events.checkIn = String(value.check_in_info.sub_event_no);
            }

            state.rouletteEvents = events;
            console.log('[룰렛 이벤트 ID 로드] ✓ 완료:', events);
            return events;
        } else {
            console.error('[룰렛 이벤트 ID 로드] ✗ API 오류:', response);
            return null;
        }
    } catch (e) {
        console.error('[룰렛 이벤트 ID 로드] ✗ 실패:', e.message);
        return null;
    }
}

export async function getPrizeInfo(headers) {
    const eventNo = state.rouletteEvents.apply || CONFIG.prizeEntry.eventNo;
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/apply?sub_event_no=${eventNo}`;
    const prizeHeaders = makeRewardHeaders(headers);

    console.log('[경품 정보 로드] URL:', url);

    try {
        const response = await apiRequest(url, 'GET', prizeHeaders);

        if (response && response.code === 0 && response.value) {
            const value = response.value;
            state.prizeInfo.eventNo = String(value.sub_event_no);

            if (value.participation_method_list?.length > 0) {
                state.prizeInfo.flakeCost = value.participation_method_list[0].participation_amount;
            }

            if (value.gift_list?.length > 0) {
                const targetGift = value.gift_list.find(gift =>
                    gift.gift_name?.includes('5,000') && gift.gift_name?.includes('포인트')
                );
                if (targetGift) {
                    state.prizeInfo.giftNo = targetGift.gift_no;
                    state.prizeInfo.giftName = targetGift.gift_name;
                    console.log(`[경품 정보] ✓ 타겟 경품 발견: ${targetGift.gift_name}`);
                }
            }

            console.log('[경품 정보 로드] ✓ 완료:', state.prizeInfo);
            return state.prizeInfo;
        } else {
            console.error('[경품 정보 로드] ✗ API 오류:', response);
            return null;
        }
    } catch (e) {
        console.error('[경품 정보 로드] ✗ 실패:', e.message);
        return null;
    }
}

export async function getRouletteParticipationCount(headers, subEventNo) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/participationCnt?sub_event_no=${subEventNo}`;
    const rewardHeaders = makeRewardHeaders(headers);

    console.log(`[룰렛 참여 횟수 조회] sub_event_no: ${subEventNo}`);

    try {
        const response = await apiRequest(url, 'GET', rewardHeaders);
        console.log('[룰렛 참여 횟수 조회] ✅ Response received:', response);
        return response;
    } catch (error) {
        console.error('[룰렛 참여 횟수 조회] ❌ API 호출 실패:', error.message);
        throw error;
    }
}

export async function executeRouletteDraw(headers, subEventNo) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/draw/${subEventNo}`;
    const rewardHeaders = {
        ...makeRewardHeaders(headers),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };
    const body = { type_no: 1 };

    console.log(`[룰렛 뽑기 실행] sub_event_no: ${subEventNo}`);

    try {
        const response = await apiRequest(url, 'POST', rewardHeaders, body);
        console.log('[룰렛 뽑기 실행] ✅ Response received:', response);

        if (response && response.code !== 0) {
            const errorCode = response.code;
            const errorMessage = response.message || '알 수 없는 오류';
            if (errorCode === 7019) {
                console.warn(`[룰렛 뽑기 실행] ⚠️ 이벤트 기간이 아닙니다: code=${errorCode}`);
            } else {
                console.error(`[룰렛 뽑기 실행] ❌ API 에러: code=${errorCode}, message=${errorMessage}`);
            }
        }

        return response;
    } catch (error) {
        console.error('[룰렛 뽑기 실행] ❌ API 호출 실패:', error.message);
        throw error;
    }
}

export async function getRouletteExtra(headers, subEventNo) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/extra?sub_event_no=${subEventNo}`;
    const rewardHeaders = makeRewardHeaders(headers);

    console.log(`[룰렛 EXTRA 조회] sub_event_no: ${subEventNo}`);
    const response = await apiRequest(url, 'GET', rewardHeaders);
    console.log('[룰렛 EXTRA 조회] Response:', response);
    return response;
}

export async function claimRouletteExtra(headers, subEventNo, giftNo, currentCycle) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/extra/${subEventNo}`;
    const rewardHeaders = {
        ...makeRewardHeaders(headers),
        'Content-Type': 'application/json',
    };
    const body = { gift_no: giftNo, current_cycle: currentCycle };

    const response = await apiRequest(url, 'POST', rewardHeaders, body);
    console.log('[룰렛 EXTRA 수령] Response:', response);
    return response;
}
