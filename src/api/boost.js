import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';

export function makeBoostHeaders(headers) {
    const uuid = headers['X-UUID'] || headers['caller-detail'];
    if (!headers.Authorization || !uuid) throw new Error('부스트 인증 정보가 없습니다');
    return {
        Authorization: headers.Authorization,
        'caller-id': 'lounge',
        'X-UUID': uuid,
        'x-device-type': 'P01',
        'x-lang': 'KO',
        'x-nation': 'KR',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://lounge.onstove.com',
        Referer: 'https://lounge.onstove.com/'
    };
}

async function request(headers, path, method = 'GET') {
    const query = method === 'GET' ? `${path.includes('?') ? '&' : '?'}timestemp=${Date.now()}` : '';
    const response = await apiRequest(
        `${CONFIG.api.baseUrl}/stadium-api/v1.0/${path}${query}`,
        method, makeBoostHeaders(headers), null, { timeout: 10000 }
    );
    if (response?.code !== 0 || !response.value || typeof response.value !== 'object') {
        const error = new Error(response?.message || '부스트 API 응답을 확인할 수 없습니다');
        error.code = response?.code;
        error.definiteFailure = Number.isFinite(response?.code) && response.code !== 0;
        throw error;
    }
    return response.value;
}

function articleId(value) {
    if (!/^\d+$/.test(String(value ?? ''))) throw new Error('잘못된 게시글 ID');
    return String(value);
}

function balance(value) {
    if (!Number.isInteger(value.remaining_count) || value.remaining_count < 0 ||
        (value.next_charge_at != null && !Number.isFinite(value.next_charge_at))) {
        throw new Error('부스트 잔여 횟수 응답이 올바르지 않습니다');
    }
    return { remainingCount: value.remaining_count, nextChargeAt: value.next_charge_at ?? null };
}

export async function getBoostMissions(headers) {
    const value = await request(headers, 'missions');
    if (!Array.isArray(value.missions)) throw new Error('부스트 미션 목록이 없습니다');
    return value.missions;
}

export async function getBoostBalance(headers) {
    return balance(await request(headers, 'boost/balance'));
}

export async function getBoostRanking(headers) {
    const value = await request(headers, 'recommend/articles/realtime-ranking');
    if (!Array.isArray(value.articles) || !Number.isFinite(value.generated_at) || value.generated_at <= 0) {
        throw new Error('실시간 후보 또는 집계 시각이 없습니다');
    }
    return { articles: value.articles, generatedAt: value.generated_at };
}

export async function getArticleBoostStatuses(headers, ids) {
    if (ids.length === 0) return {};
    const validated = ids.map(articleId);
    const value = await request(headers, `article/${validated.join(',')}/interaction/BOOST`);
    if (validated.some(id => typeof value[id]?.BOOST !== 'boolean')) {
        throw new Error('게시글 부스트 여부를 확인할 수 없습니다');
    }
    return value;
}

export async function boostArticle(headers, id) {
    return balance(await request(headers, `boost/${articleId(id)}`, 'PUT'));
}

export async function receiveBoostMissionReward(headers, missionId) {
    const value = await request(headers, `missions/${articleId(missionId)}/reward`, 'POST');
    if (String(value.mission_id) !== String(missionId) || !Array.isArray(value.rewards) ||
        value.rewards.some(reward => !Number.isFinite(reward.amount) || reward.amount < 0)) {
        throw new Error('부스트 미션 보상 응답이 올바르지 않습니다');
    }
    const amount = value.rewards.filter(reward => reward.type === 'FLAKE').reduce((sum, reward) => sum + reward.amount, 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('수령한 플레이크 금액을 확인할 수 없습니다');
    return amount;
}
