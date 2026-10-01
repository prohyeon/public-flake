import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';

export const SPECIAL_FORCE_GAME_ID = 'GM-2A26-6A4CAF50_IND';

function eventHeaders(headers) {
    return { ...headers, 'caller-id': 'event-hub', 'caller-detail': headers['X-UUID'],
        Origin: 'https://event.onstove.com', Referer: 'https://event.onstove.com/',
        'X-Timezone': 'Asia/Seoul', 'X-Utc-Offset': '540' };
}

function requireOK(response) {
    if (response?.code !== 0 || !response.value) {
        throw new Error(`스페셜포스 API 확인 실패 (code=${response?.code ?? '없음'})`);
    }
    return response.value;
}

export async function getSpecialForceShop(headers) {
    const links = requireOK(await apiRequest(`${CONFIG.api.baseUrl}/dailyshop/v1.0/services/family-links`,
        'GET', eventHeaders(headers), null, { timeout: 15000 }));
    if (!Array.isArray(links)) throw new Error('행사 목록 형식 확인 실패');
    const month = links.find(link => link.service_id === 'specialforce')?.progress_month;
    if (!month) return { notAvailable: true };
    if (!/^\d{6}$/.test(String(month))) throw new Error('행사 월 형식 확인 실패');
    const value = requireOK(await apiRequest(`${CONFIG.api.baseUrl}/dailyshop/v1.0/${month}/services/specialforce`,
        'GET', eventHeaders(headers), null, { timeout: 15000 }));
    return { ...value, month: String(month) };
}

export async function claimSpecialForceReward(headers, reward) {
    // Only the FLAKE route was observed in the successful capture.
    if (reward.item_type !== 'FLAKE' || !Number.isSafeInteger(reward.item_no) || reward.item_no <= 0) {
        throw new Error('지원하지 않는 스페셜포스 보상');
    }
    const value = requireOK(await apiRequest(
        `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/accumulate-play/flake?item_no=${reward.item_no}`,
        'POST', eventHeaders(headers), { item_no: reward.item_no }, { timeout: 15000 }));
    if (value.item_no !== reward.item_no || value.category !== 'ACCUMULATE_PLAY' ||
        !Number.isFinite(value.flake_amount) || value.flake_amount < 0) {
        throw new Error('보상 응답 일치 확인 실패; 상태를 새로고침해 주세요');
    }
    return value;
}
