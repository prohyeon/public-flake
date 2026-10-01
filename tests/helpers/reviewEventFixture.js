export const REVIEW_NOW = Date.parse('2026-10-04T14:59:00Z');
export function reviewEventFixture() {
    const event = { event_no: 1914, service_id: 'STOVEINDIE', language: 'ko', benefits: ['FLAKE'],
        title: '게임 리뷰 읽고,<br>댓글 달면 플레이크 GET!', status: 'ONGOING',
        expose_start_at: '2026-10-01', expose_end_at: '2026-10-04',
        link_url: 'https://page.onstove.com/quarter/kr/view/14523486' };
    const article = { article_id: '14523486', title: '게임 리뷰', channel_seq: 73, board_seq: 134147 };
    const metrics = { posts: [], visits: [], closes: 0, scans: [], published: [], catalogues: 0 };
    const comments = [];
    const records = new Map();
    let locked = false;
    const deps = {
        now: () => REVIEW_NOW,
        storage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) },
        withLock: async (key, work) => {
            if (locked) return { success: false, reason: 'alreadyRunning' };
            locked = true;
            try { return await work(); } finally { locked = false; }
        },
        getReviewEvents: async () => { metrics.catalogues++; return [structuredClone(event)]; },
        getReviewArticle: async () => structuredClone(article),
        getReviewMember: async () => '100',
        canWriteReviewComment: async () => true,
        getReviewCommentPage: async (headers, articleId, page) => {
            metrics.scans.push(page);
            return { total: comments.length, display_total: comments.length, page, size: 20,
                list: structuredClone(comments.slice((page - 1) * 20, page * 20)),
                next_yn: comments.length > page * 20 ? 'Y' : 'N' };
        },
        postReviewSticker: async (headers, articleId) => {
            metrics.posts.push(articleId);
            comments.unshift({ comment_id: '900', comment_status_code: 'NORMAL', user_info: { member_no: 100 } });
            return { commentId: '900' };
        },
        delay: async () => {},
        openTabInBackground: (url, active) => { metrics.visits.push({ url, active }); return { close() {} }; },
        closeTab: () => { metrics.closes++; },
        log: () => {}, publish: status => metrics.published.push(status)
    };
    return { event, article, metrics, comments, records, deps };
}
