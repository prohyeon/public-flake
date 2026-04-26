import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';

function makeEventHeaders(headers) {
    return {
        'Authorization': headers['Authorization'],
        'caller-id': 'event-hub',
        'caller-detail': headers['X-UUID'] || headers['caller-detail'],
        'X-Client-Lang': 'ko',
        'X-Timezone': 'Asia/Seoul',
        'X-Utc-Offset': '540',
        'X-Nation': 'KR',
        'X-Lang': 'ko',
        'X-Device-Type': 'pc',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://event.onstove.com',
        'Referer': 'https://event.onstove.com/'
    };
}

export async function getDailyShopRewards(headers) {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/${yearMonth}/services/STOVEINDIE`;
    console.log('[데일리 보상 목록 조회] URL:', url);

    const response = await apiRequest(url, 'GET', makeEventHeaders(headers));
    return response;
}

export async function claimDailyReward(headers, itemNo, rewardType) {
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/daily/${rewardType}?item_no=${itemNo}&reward_type=${rewardType}`;
    const eventHeaders = {
        ...makeEventHeaders(headers),
        'Content-Type': 'application/json',
    };
    const body = { item_no: itemNo, reward_type: rewardType };

    const response = await apiRequest(url, 'POST', eventHeaders, body);
    return response;
}

export async function getMajakDailyShopRewards(headers) {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/${yearMonth}/services/RIICHICITY_IND`;
    console.log('[마작 리워드 목록 조회] URL:', url);

    const response = await apiRequest(url, 'GET', makeEventHeaders(headers));
    return response;
}

export async function claimDailyAccumulatedReward(headers, itemNo, itemType = 'LIBRARY', guid = null, characterSeq = null) {
    let endpointType;
    if (itemType === 'ITEMBOX') endpointType = 'itembox';
    else if (itemType === 'INDIE_GAME_COUPON') endpointType = 'LIBRARY';
    else if (itemType === 'FLAKE') endpointType = 'flake';
    else if (itemType === 'INDIE_SALE_COUPON') endpointType = 'coupon';
    else endpointType = 'LIBRARY';

    let queryParams = `item_no=${itemNo}`;
    if (guid && characterSeq) queryParams += `&guid=${guid}&character_seq=${characterSeq}`;

    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/accumulate/${endpointType}?${queryParams}`;
    const eventHeaders = { ...makeEventHeaders(headers), 'Content-Type': 'application/json' };

    const body = { item_no: itemNo };
    if (guid && characterSeq) {
        body.guid = guid;
        body.character_seq = characterSeq;
    }

    const response = await apiRequest(url, 'POST', eventHeaders, body);
    return response;
}

export async function claimMajakAccumulatedReward(headers, itemNo, itemType = 'COUPON') {
    let endpointType;
    if (itemType === 'INDIE_GAME_COUPON') endpointType = 'LIBRARY';
    else if (itemType === 'FLAKE') endpointType = 'flake';
    else if (itemType === 'COUPON' || itemType === 'INDIE_SALE_COUPON') endpointType = 'coupon';
    else endpointType = 'coupon';

    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/accumulate/${endpointType}?item_no=${itemNo}`;
    const eventHeaders = { ...makeEventHeaders(headers), 'Content-Type': 'application/json' };
    const body = { item_no: itemNo };

    const response = await apiRequest(url, 'POST', eventHeaders, body);
    return response;
}
