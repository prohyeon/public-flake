import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { postComment } from '../api/articles.js';
import { delay } from '../utils/time.js';
import { log } from '../ui/logger.js';
import { updateProgress } from '../ui/progress.js';

function getCommentPool(pool, fallbackComment) {
    const candidates = Array.isArray(pool) ? pool : [];
    const normalized = candidates
        .map(comment => String(comment || '').trim())
        .filter(Boolean);

    return normalized.length > 0 ? normalized : [fallbackComment || 'Nice!'];
}

export function pickRandomComment(pool = CONFIG.commentPool, randomFn = Math.random, fallbackComment = CONFIG.comment) {
    const comments = getCommentPool(pool, fallbackComment);
    const rawIndex = Math.floor(randomFn() * comments.length);
    const index = Math.min(comments.length - 1, Math.max(0, rawIndex));

    return comments[index];
}

export async function postCommentsSerially(options = {}) {
    const {
        headers,
        articles = [],
        targetComments = CONFIG.targets.comments,
        delayMs = CONFIG.delays.afterComment,
        commentPool = CONFIG.commentPool,
        fallbackComment = CONFIG.comment,
        randomFn = Math.random,
        stateRef = state,
        postCommentFn = postComment,
        delayFn = delay,
        logFn = log,
        updateProgressFn = updateProgress
    } = options;

    const maxComments = Math.min(targetComments, articles.length);
    const errors = [];
    const commentIds = [];

    for (let i = 0; i < maxComments; i++) {
        const articleId = articles[i].article_id;
        const content = pickRandomComment(commentPool, randomFn, fallbackComment);

        try {
            const commentId = await postCommentFn(headers, articleId, content);
            logFn(`댓글 작성 완료: ${commentId}`, 'success');
            stateRef.createdCommentIds.push(commentId);
            stateRef.progress.comments++;
            commentIds.push(commentId);
            updateProgressFn('comments', stateRef.progress.comments, CONFIG.targets.comments);
        } catch (e) {
            errors.push({ articleId, message: e.message });
            logFn(`댓글 작성 실패: ${e.message}`, 'error');
        }

        if (i < maxComments - 1) await delayFn(delayMs);
    }

    return { attempted: maxComments, commentIds, errors };
}
