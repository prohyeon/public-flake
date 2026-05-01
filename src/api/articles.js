import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';
import { getTimestamp } from '../utils/time.js';

export async function getArticleList(headers, size = 30) {
    const url = `${CONFIG.api.baseUrl}/postie/v2.0/interest/article/list?size=${size}&timestemp=${getTimestamp()}`;
    const response = await apiRequest(url, 'GET', headers);
    return response.value?.list || [];
}

export async function likeArticle(headers, articleId) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/interaction/LIKE`;
    await apiRequest(url, 'PUT', headers);
}

export async function checkArticleLikeStatus(headers, articleIds) {
    if (!articleIds || articleIds.length === 0) return {};
    const ids = articleIds.join(',');
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${ids}/interaction/LIKE?timestemp=${getTimestamp()}`;
    const response = await apiRequest(url, 'GET', headers);
    return response.value || {};
}

export async function postComment(headers, articleId, content) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/comment`;
    const body = {
        article_id: articleId,
        content: `<p>${content}</p>`,
        attached: { media_ids: [] }
    };
    const response = await apiRequest(url, 'POST', headers, body);
    return response.value?.comment_id;
}

export async function createArticle(headers, title, content, tags = []) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article`;
    const body = {
        title,
        content: `<p>${content}</p>`,
        attached: { media_ids: [], file_ids: [], poll_ids: [] },
        status: 'PUBLISHED',
        category: null,
        coverage: 'PUBLIC',
        learning_data: true,
        reservation: null,
        tags: tags.length > 0 ? tags : ['자유주제', '출석체크']
    };
    console.log('[게시글 작성] URL:', url);
    const response = await apiRequest(url, 'POST', headers, body);
    return response.value?.article_id;
}

