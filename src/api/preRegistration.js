import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';
import { withEventHubOrigin as eventHeaders } from './headers.js';

// 2026-10-10 사전등록 캡처 기준: 등록 성공 code 0, 이미 참여 code 90605.
export const PRE_REGISTRATION_ALREADY_JOINED = 90605;

export async function registerPreRegistration(headers, campaign) {
    if (!/^\d{6}$/.test(String(campaign?.month)) || !/^[a-z0-9-]+$/i.test(String(campaign?.key))) {
        throw new Error('사전등록 캠페인 설정 확인 실패');
    }
    const response = await apiRequest(
        `${CONFIG.api.baseUrl}/dailyshop/v1.0/campaigns/${campaign.month}/${campaign.key}/register`,
        'POST', eventHeaders(headers), null, { timeout: 15000 });
    if (response?.code === 0 && Number.isSafeInteger(response.value?.registration_no)) {
        return { registered: true, registrationNo: response.value.registration_no };
    }
    if (response?.code === PRE_REGISTRATION_ALREADY_JOINED) return { alreadyJoined: true };
    throw new Error(`사전등록 응답 확인 실패 (code=${response?.code ?? '없음'})`);
}

export async function addIndieWishlist(headers, shopItemId) {
    if (!Number.isSafeInteger(shopItemId) || shopItemId <= 0) throw new Error('찜하기 상품 번호 확인 실패');
    const ids = [{ shop_item_id: shopItemId }];
    const response = await apiRequest(`${CONFIG.api.baseUrl}/shop/v2.0/indie/wishlist/add`, 'POST',
        { ...eventHeaders(headers), 'Content-Type': 'application/json' },
        { shop_key: 'indie', shop_item_ids: ids, shop_item_ids_str: JSON.stringify(ids) },
        { timeout: 15000 });
    if (response?.response_code !== 0) {
        throw new Error(`찜하기 응답 확인 실패 (code=${response?.response_code ?? '없음'})`);
    }
    return true;
}
