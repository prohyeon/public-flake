import { CONFIG } from '../config.js';
import { apiRequest } from './request.js';

function id(value) {
    if (!/^\d+$/.test(String(value ?? ''))) throw new Error('게임 리뷰 ID가 올바르지 않습니다');
    return String(value);
}

export function makeReviewHeaders(headers, eventHub = false) {
    const common = {
        'caller-id': eventHub ? 'event-hub' : 'storee-cp',
        'X-Lang': 'KO', 'X-Nation': 'KR', 'X-Device-Type': 'P01',
        Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json',
        Origin: eventHub ? 'https://event.onstove.com' : 'https://page.onstove.com',
        Referer: eventHub ? 'https://event.onstove.com/' : 'https://page.onstove.com/'
    };
    // The public event catalogue does not need account credentials.
    if (eventHub) return common;
    const uuid = headers['X-UUID'] || headers['caller-detail'];
    if (!headers.Authorization || !uuid) throw new Error('게임 리뷰 인증 정보가 없습니다');
    return { ...common, Authorization: headers.Authorization, 'X-UUID': uuid };
}

async function request(headers, path, method = 'GET', body = null, eventHub = false) {
    const query = method === 'GET' ? `${path.includes('?') ? '&' : '?'}timestemp=${Date.now()}` : '';
    const response = await apiRequest(`${CONFIG.api.baseUrl}/${path}${query}`, method,
        makeReviewHeaders(headers, eventHub), body, { timeout: 10000 });
    if (response?.code !== 0 || response.value == null) {
        throw new Error(response?.message || '게임 리뷰 API 응답을 확인할 수 없습니다');
    }
    return response.value;
}

export async function getReviewEvents(headers) {
    const events = new Map();
    for (let page = 0; page < CONFIG.reviewEvent.maxEventPages; page++) {
        const value = await request(headers,
            `eventhub/v1.0/promotion/events/ON?page=${page}&service_id=STOVEINDIE`, 'GET', null, true);
        if (!Number.isInteger(value.total_event_cnt) || value.total_event_cnt < 0 ||
            !Array.isArray(value.promotion_events)) throw new Error('이벤트 목록 응답이 올바르지 않습니다');
        const before = events.size;
        for (const event of value.promotion_events) events.set(id(event?.event_no), event);
        if (events.size >= value.total_event_cnt) return [...events.values()];
        if (events.size === before) throw new Error('이벤트 목록 전체를 확인하지 못했습니다');
    }
    throw new Error('이벤트 조회 페이지 한도를 초과했습니다');
}

export async function getReviewArticle(headers, articleId) {
    const value = await request(headers, `cwms/v3.0/article?article_id=${id(articleId)}&request_id=CM`);
    if (String(value.article_id) !== String(articleId) || value.community_key !== 'quarter' ||
        value.channel_key !== 'kr' || value.article_status_code !== 'PUBLISHED' ||
        value.coverage_code !== 'PUBLIC' || !/^\d+$/.test(String(value.board_seq ?? '')) ||
        !/^\d+$/.test(String(value.channel_seq ?? '')) || typeof value.title !== 'string') {
        throw new Error('공개 게임 리뷰 게시글을 확인할 수 없습니다');
    }
    return value;
}

export async function getReviewMember(headers, channelSeq) {
    const value = await request(headers, `cwms/v1.0/user/CHANNEL/${id(channelSeq)}`);
    return id(value.user_info?.member_no);
}

export async function canWriteReviewComment(headers, boardSeq) {
    const value = await request(headers, `cwms/v1.0/user/board/permission?board_seq_list=${id(boardSeq)}`);
    const permission = Array.isArray(value) && value.find(board => String(board.board_seq) === String(boardSeq));
    const allowed = permission?.user_permission_info?.comment?.write;
    if (typeof allowed !== 'boolean') throw new Error('게임 리뷰 댓글 작성 권한을 확인할 수 없습니다');
    return allowed;
}

export async function getReviewCommentPage(headers, articleId, page) {
    if (!Number.isInteger(page) || page < 1) throw new Error('댓글 페이지가 올바르지 않습니다');
    const value = await request(headers,
        `cwms/v1.1/article/${id(articleId)}/comment/list?size=20&page=${page}&sort_type_code=LATEST&request_id=CM`);
    if (!Number.isInteger(value.total) || value.total < 0 || !Number.isInteger(value.display_total) ||
        value.display_total < 0 || value.display_total > value.total || value.page !== page || value.size !== 20 ||
        !['Y', 'N'].includes(value.next_yn) || !(Array.isArray(value.list) || (value.total === 0 && value.list == null))) {
        throw new Error('게임 리뷰 댓글 목록을 확인할 수 없습니다');
    }
    const list = value.list || [];
    if (list.some(comment => !/^\d+$/.test(String(comment?.comment_id ?? '')) ||
        !/^\d+$/.test(String(comment.user_info?.member_no ?? '')) ||
        typeof comment.comment_status_code !== 'string')) throw new Error('댓글 작성자를 확인할 수 없습니다');
    return { ...value, list };
}

export async function postReviewSticker(headers, articleId) {
    const image = CONFIG.reviewEvent.stickerUrl;
    if (!/^https:\/\/d2x8kymwjom7h7\.cloudfront\.net\/live\/application_no\/10009\/partners-sns-api\/[A-Za-z0-9_-]+\.png$/.test(image)) {
        throw new Error('게임 리뷰 스티커 주소가 올바르지 않습니다');
    }
    const value = await request(headers, `cwms/v1.0/article/${id(articleId)}/comment`, 'POST', {
        comment: `<p><img src="${image}" class="js-is-emoji emoji__img emoji-wrap" data-sticker=""><br></p>`,
        attach_info: { media_info: null, poll_info: null, quote_info: null },
        request_id: 'CM', view_mode: 'EDITOR'
    });
    return { commentId: id(value.comment_id) };
}
