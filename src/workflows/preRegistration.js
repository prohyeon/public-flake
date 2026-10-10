import { CONFIG } from '../config.js';
import { addIndieWishlist, registerPreRegistration } from '../api/preRegistration.js';
import { log } from '../ui/logger.js';
import { getTodayKSTString } from '../utils/time.js';

// 캠페인 월(KST)에만, endDate(KST YYYY-MM-DD, 당일 포함 안 함) 전까지만 동작한다.
export function isPreRegistrationActive(campaign, today = getTodayKSTString()) {
    if (today.slice(0, 7).replace('-', '') !== String(campaign?.month)) return false;
    return !campaign.endDate || today < campaign.endDate;
}

// 기간이 끝난 캠페인은 요청도 로그도 남기지 않는다. 사이트처럼 신규 등록에 성공했을 때만 찜하기를 함께 보낸다.
export async function runPreRegistrations(headers, deps = {}) {
    const settings = deps.config || CONFIG.preRegistration;
    const register = deps.register || registerPreRegistration;
    const addWishlist = deps.addWishlist || addIndieWishlist;
    const writeLog = deps.writeLog || log;
    const today = deps.today || getTodayKSTString();
    const results = [];

    if (!settings?.enabled) return { success: true, results };

    for (const campaign of settings.campaigns || []) {
        const name = campaign.title || campaign.key;
        if (!isPreRegistrationActive(campaign, today)) {
            results.push({ key: campaign.key, skipped: true });
            continue;
        }
        try {
            const result = await register(headers, campaign);
            if (result.alreadyJoined) {
                writeLog(`사전등록 이미 완료: ${name}`, 'info');
                results.push({ key: campaign.key, alreadyJoined: true });
                continue;
            }
            writeLog(`✓ 사전등록 완료: ${name} (등록번호 ${result.registrationNo})`, 'success');
            const entry = { key: campaign.key, registered: true, registrationNo: result.registrationNo };
            if (campaign.shopItemId) {
                try {
                    await addWishlist(headers, campaign.shopItemId);
                    entry.wishlisted = true;
                } catch (error) {
                    // 찜하기는 사이트가 등록 뒤 덧붙이는 부가 동작이라 사전등록 결과를 바꾸지 않는다.
                    writeLog(`사전등록 찜하기 실패: ${name} - ${error.message}`, 'warning');
                    entry.wishlistError = error.message;
                }
            }
            results.push(entry);
        } catch (error) {
            writeLog(`✗ 사전등록 실패: ${name} - ${error.message}`, 'error');
            results.push({ key: campaign.key, error: error.message });
        }
    }

    const failed = results.filter(result => result.error);
    return {
        success: failed.length === 0,
        results,
        error: failed.map(result => `${result.key}: ${result.error}`).join(', ') || undefined
    };
}
