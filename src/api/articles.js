import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';
import { getTimestamp } from '../utils/time.js';

export async function getArticleList(headers, size = 30) {
    const url = `${CONFIG.api.baseUrl}/postie/v2.0/interest/article/list?size=${size}&timestemp=${getTimestamp()}`;
    const response = await apiRequest(url, 'GET', headers);
    return response.value?.list || [];
}

export async function getCommentList(headers, articleId, size = 10) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/comment/list?size=${size}&timestemp=${getTimestamp()}`;
    console.log(`[댓글 목록 조회] articleId: ${articleId}`);
    try {
        const response = await apiRequest(url, 'GET', headers);
        const comments = response.value?.comments || response.value?.list || [];
        console.log(`[댓글 목록 조회] Found ${comments.length} comments`);
        return comments;
    } catch (e) {
        console.error('[댓글 목록 조회] Error:', e);
        return [];
    }
}

export async function likeArticle(headers, articleId) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/interaction/LIKE`;
    await apiRequest(url, 'PUT', headers);
}

export async function likeComment(headers, commentId) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/comment/${commentId}/interaction/LIKE`;
    const response = await apiRequest(url, 'PUT', headers);
    return response;
}

export async function checkArticleLikeStatus(headers, articleIds) {
    if (!articleIds || articleIds.length === 0) return {};
    const ids = articleIds.join(',');
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${ids}/interaction/LIKE?timestemp=${getTimestamp()}`;
    const response = await apiRequest(url, 'GET', headers);
    return response.value || {};
}

export async function checkCommentLikeStatus(headers, commentIds) {
    if (!commentIds || commentIds.length === 0) return {};
    const ids = commentIds.join(',');
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/comment/${ids}/interaction/LIKE?timestemp=${getTimestamp()}`;
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

export async function unfollowTag(headers, tagName) {
    const encodedTag = encodeURIComponent(tagName);
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/favorite/TAG/${encodedTag}`;
    await apiRequest(url, 'DELETE', headers);
}

export async function followTag(headers, tagName) {
    const encodedTag = encodeURIComponent(tagName);
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/favorite/TAG/${encodedTag}`;
    await apiRequest(url, 'PUT', headers);
}
