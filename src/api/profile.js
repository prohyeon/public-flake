import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';
import { getTimestamp, getCurrentMonthDateRange } from '../utils/time.js';

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

export async function getMyArticles(headers, userId, size = 10) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/interest/user/${userId}/article/list?user_id=${userId}&sort=LATEST&size=${size}&type=WRITE&timestemp=${getTimestamp()}`;
    const myHeaders = {
        ...headers,
        'caller-id': 'indie-my',
        'x-lang': 'ko',
        'x-nation': 'KR',
        'x-device-type': 'P01',
        'Origin': 'https://profile.onstove.com',
        'Referer': 'https://profile.onstove.com/'
    };
    const response = await apiRequest(url, 'GET', myHeaders);
    return response;
}

export async function getMonthlyFlakeTotal(headers) {
    try {
        const dateRange = getCurrentMonthDateRange();
        const url = `${CONFIG.api.baseUrl}/mileage/v2.0/master/deposit/total?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY&start_date=${dateRange.startDate}&end_date=${dateRange.endDate}`;

        const mileageHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'Content-Type': 'application/json;charset=utf-8',
            'Accept': '*/*',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        const response = await apiRequest(url, 'GET', mileageHeaders);
        if (response && response.code === 0 && response.value) {
            return response.value.total_deposit_amount || 0;
        }
        return 0;
    } catch (error) {
        console.warn('[FLAKE] 월간 플레이크 조회 실패:', error.message);
        return 0;
    }
}

export async function getTotalFlakeBalance(headers) {
    try {
        const url = `${CONFIG.api.baseUrl}/mileage/v1.0/balance?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY`;

        const mileageHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'Content-Type': 'application/json;charset=utf-8',
            'Accept': '*/*',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        const response = await apiRequest(url, 'GET', mileageHeaders);
        if (response && response.code === 0 && response.value) {
            return response.value.mileage_amount || 0;
        }
        return 0;
    } catch (error) {
        console.error('[FLAKE] 총 플레이크 조회 실패:', error);
        return 0;
    }
}
