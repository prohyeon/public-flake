import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';
import { getTimestamp } from '../utils/time.js';
import { makeBillHistoryHeaders, makeMileageHeaders } from './headers.js';

export async function getMyProfile(headers) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/user/me?timestemp=${getTimestamp()}`;
    const profileHeaders = {
        ...headers,
        'caller-id': 'indie-web-my',
        'Origin': 'https://profile.onstove.com',
        'Referer': 'https://profile.onstove.com/'
    };
    if (profileHeaders['X-UUID']) {
        profileHeaders['caller-detail'] = profileHeaders['X-UUID'];
        delete profileHeaders['X-UUID'];
    }
    const response = await apiRequest(url, 'GET', profileHeaders);
    return response;
}

export async function getMonthlyFlakeTotal(headers) {
    try {
        const now = new Date();
        const yyyyMM = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        const tzOffset = now.getTimezoneOffset() * -1;
        const url = `${CONFIG.api.baseUrl}/mileage/v2.0/master/deposit/total?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY&tz_offset=${tzOffset}&yyyyMM=${yyyyMM}`;

        const response = await apiRequest(url, 'GET', makeMileageHeaders(headers));
        if (response && response.code === 0 && response.value) {
            return response.value.total_deposit_amount || 0;
        }
        return 0;
    } catch (error) {
        console.warn('[FLAKE] 월간 플레이크 조회 실패:', error.message);
        return 0;
    }
}

const HISTORY_PAGE_SIZE = 1000;
const HISTORY_MAX_PAGES = 20;
const NET_TYPE_CODES = new Set(['ADD', 'USE']);

// Trading FLAKE for a shop voucher cashes earnings out, so it is not spending against the net.
// Shops name them 상품권 (GS25), 금액권 (메가커피 모바일 금액권) or 교환권 (a gifticon for one item).
const VOUCHER_KEYWORDS = ['상품권', '금액권', '교환권'];

function isVoucherExchange(row) {
    if (row.service_name !== 'SHOP_PRODUCT') return false;
    const descriptions = String(row.descriptions ?? '');
    return VOUCHER_KEYWORDS.some(keyword => descriptions.includes(keyword));
}

// This month's earned minus spent FLAKE from the signed history rows. Only ADD and USE count for
// now, without voucher exchanges. A failure returns { error: true } because a wrong or partial sum must not read as a real value.
export async function getMonthlyFlakeNet(headers) {
    try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime();
        let net = 0;
        let previousOldest = Infinity;

        for (let page = 1; page <= HISTORY_MAX_PAGES; page++) {
            const params = new URLSearchParams({
                page_size: HISTORY_PAGE_SIZE,
                page_index: page,
                request_type: 'ALL',
                attribute_code_list: 'STOVE_MILE_PLAY_B,STOVE_MILE_PLAY_S',
                start_date: start,
                end_date: end
            });
            const url = `${CONFIG.api.baseUrl}/mileage/v1.0/master/myinfo?${params.toString()}`;
            const response = await apiRequest(url, 'GET', makeBillHistoryHeaders(headers));
            if (response?.code !== 0 || !Array.isArray(response.value)) {
                throw new Error('unexpected history response');
            }

            const rows = response.value;
            // Rows run newest first, so a later page starting newer than the last one ended means
            // the pages overlap and the sum would double count.
            if (rows.length > 0 && rows[0].reg_datetime > previousOldest) {
                throw new Error('history pages overlap');
            }
            for (const row of rows) {
                if (!NET_TYPE_CODES.has(row.type_code) || row.reg_datetime < start || isVoucherExchange(row)) continue;
                if (!Number.isFinite(row.mileage_amount)) throw new Error('invalid history amount');
                net += row.mileage_amount;
            }
            if (rows.length < HISTORY_PAGE_SIZE) return net;
            previousOldest = rows[rows.length - 1].reg_datetime;
        }
        throw new Error('too many history pages');
    } catch (error) {
        console.warn('[FLAKE] 월간 순이익 조회 실패:', error.message);
        return { error: true };
    }
}

export async function getTotalFlakeBalance(headers) {
    try {
        const url = `${CONFIG.api.baseUrl}/mileage/v1.0/balance?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY`;

        const response = await apiRequest(url, 'GET', makeMileageHeaders(headers));
        if (response && response.code === 0 && response.value) {
            return response.value.mileage_amount || 0;
        }
        return 0;
    } catch (error) {
        console.error('[FLAKE] 총 플레이크 조회 실패:', error);
        return 0;
    }
}
