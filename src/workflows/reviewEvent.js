import { CONFIG } from '../config.js';
import { getReviewEvents, getReviewArticle, getReviewMember, canWriteReviewComment,
    getReviewCommentPage, postReviewSticker } from '../api/reviewEvent.js';
import { delay } from '../utils/time.js';
import { openTabInBackground, closeTab } from '../utils/tabs.js';
import { log } from '../ui/logger.js';
import { updateStatusUI } from '../ui/status.js';

const day = timestamp => new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function reviewEventWindow(event, now = Date.now()) {
    if (!validDate(event?.startDate) || !validDate(event?.endDate) || event.startDate > event.endDate) {
        throw new Error('게임 리뷰 이벤트 날짜를 확인할 수 없습니다');
    }
    const today = day(now);
    if (today < event.startDate) return 'upcoming';
    if (today > event.endDate) return 'expired';
    return event.status === 'ONGOING' ? 'active' : 'inactive';
}

export function selectReviewEvent(events, now = Date.now()) {
    const matching = events.filter(event => {
        const title = String(event?.title ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return event?.service_id === 'STOVEINDIE' && event.language === 'ko' &&
            Array.isArray(event.benefits) && event.benefits.includes('FLAKE') &&
            title.includes('게임 리뷰 읽고') && title.includes('댓글 달면 플레이크 GET!');
    });
    if (!matching.length) return null;
    if (matching.length !== 1) throw new Error('게임 리뷰 이벤트 대상이 여러 개입니다');
    const raw = matching[0];
    const url = new URL(raw.link_url);
    const match = /^\/quarter\/kr\/view\/(\d+)\/?$/.exec(url.pathname);
    if (url.origin !== 'https://page.onstove.com' || url.username || url.password || !match ||
        !/^\d+$/.test(String(raw.event_no ?? ''))) throw new Error('게임 리뷰 이벤트 링크가 올바르지 않습니다');
    const event = { eventNo: String(raw.event_no), articleId: match[1],
        url: `${url.origin}/quarter/kr/view/${match[1]}`, title: '게임 리뷰 댓글 이벤트',
        startDate: raw.expose_start_at, endDate: raw.expose_end_at, status: raw.status };
    return { ...event, window: reviewEventWindow(event, now) };
}

export const reviewRecordKey = (memberNo, articleId) => `stove-review-v1:${memberNo}:${articleId}`;

function readRecord(storage, key) {
    if (!storage) throw new Error('게임 리뷰 참여 기록을 저장할 수 없습니다');
    const text = storage.getItem(key);
    if (!text) return null;
    const value = JSON.parse(text);
    if (!value || !['pending', 'confirmed'].includes(value.status) ||
        !Number.isFinite(value.attemptedAt) || !/^\d+$/.test(String(value.eventNo ?? '')) ||
        (value.status === 'confirmed' && !/^\d+$/.test(String(value.commentId ?? ''))) ||
        (value.commentId != null && !/^\d+$/.test(String(value.commentId)))) {
        throw new Error('게임 리뷰 참여 기록을 확인할 수 없습니다');
    }
    return value;
}

function save(io, key, record) {
    const text = JSON.stringify(record);
    io.storage.setItem(key, text);
    if (io.storage.getItem(key) !== text) throw new Error('게임 리뷰 참여 기록 저장에 실패했습니다');
}

function services(deps) {
    return { getReviewEvents, getReviewArticle, getReviewMember, canWriteReviewComment,
        getReviewCommentPage, postReviewSticker, delay, openTabInBackground, closeTab, log,
        now: () => Date.now(), storage: globalThis.localStorage,
        publish: status => { if (typeof document !== 'undefined') updateStatusUI({ reviewEvent: status }); },
        withLock: async (key, work) => {
            if (!globalThis.navigator?.locks?.request) throw new Error('게임 리뷰 중복 실행 잠금을 사용할 수 없습니다');
            return globalThis.navigator.locks.request(key, { ifAvailable: true }, lock =>
                lock ? work() : { success: false, reason: 'alreadyRunning' });
        }, ...deps };
}

export async function findOwnReviewComment(headers, articleId, memberNo, io) {
    const seen = new Set();
    for (let page = 1; page <= CONFIG.reviewEvent.maxCommentPages; page++) {
        const value = await io.getReviewCommentPage(headers, articleId, page);
        const own = value.list.find(comment => String(comment.user_info.member_no) === String(memberNo));
        if (own) return String(own.comment_id);
        const before = seen.size;
        for (const comment of value.list) seen.add(String(comment.comment_id));
        if (value.next_yn === 'N') {
            // A truncated or concurrently shifted list cannot authorize a new comment.
            if (seen.size < value.display_total) throw new Error('댓글 목록 전체를 확인하지 못했습니다');
            return null;
        }
        if (seen.size === before) throw new Error('댓글 조회 페이지가 반복되었습니다');
    }
    throw new Error('댓글 조회 페이지 한도를 초과했습니다');
}

export async function checkReviewEventStatus(headers, deps = {}) {
    const io = services(deps);
    try {
        if (!CONFIG.reviewEvent.enabled) return { success: true, reason: 'disabled', actionable: false };
        const event = selectReviewEvent(await io.getReviewEvents(headers), io.now());
        if (!event) return { success: true, reason: 'noEvent', actionable: false };
        if (event.window !== 'active') return { success: true, event, reason: event.window, actionable: false };
        const article = await io.getReviewArticle(headers, event.articleId);
        const [memberNo, allowed] = await Promise.all([
            io.getReviewMember(headers, article.channel_seq), io.canWriteReviewComment(headers, article.board_seq)
        ]);
        const key = reviewRecordKey(memberNo, event.articleId);
        const record = readRecord(io.storage, key);
        const context = { success: true, event, articleTitle: article.title, channelSeq: article.channel_seq,
            memberNo, key, record, actionable: false, rewardVerified: false };
        if (record?.status === 'confirmed') return { ...context, reason: 'completed', commentId: record.commentId };
        const commentId = await findOwnReviewComment(headers, event.articleId, memberNo, io);
        if (commentId) return { ...context, reason: 'completed', commentId };
        if (record) return { ...context, reason: 'pending' };
        if (!allowed) return { ...context, reason: 'noPermission' };
        // Date may change during a long comment scan.
        const window = reviewEventWindow(event, io.now());
        return { ...context, reason: window === 'active' ? 'ready' : window, actionable: window === 'active' };
    } catch (error) {
        return { success: false, unknown: true, actionable: false, error: error.message };
    }
}

function requireStatus(status) {
    if (!status.success) throw new Error(status.error || '게임 리뷰 상태 확인 실패');
    return status;
}

export async function executeReviewEvent(headers, deps = {}) {
    const io = services(deps);
    let tab;
    let context;
    try {
        const initial = requireStatus(await checkReviewEventStatus(headers, io));
        io.publish(initial);
        if (!initial.actionable) return { ...initial, skipped: true };
        return await io.withLock(initial.key, async () => {
            context = requireStatus(await checkReviewEventStatus(headers, io));
            if (!context.actionable) { io.publish(context); return { ...context, skipped: true }; }
            if (context.key !== initial.key || context.event.eventNo !== initial.event.eventNo) {
                throw new Error('게임 리뷰 계정 또는 대상 이벤트가 변경되었습니다');
            }
            io.log(`게임 리뷰 방문: ${context.articleTitle}`, 'info');
            tab = io.openTabInBackground(context.event.url, false);
            if (!tab) throw new Error('게임 리뷰 방문 탭을 열지 못했습니다');
            await io.delay(CONFIG.reviewEvent.visitDelay);
            // Reload catalogue, permission and all comments after the visit, immediately before writing.
            const fresh = requireStatus(await checkReviewEventStatus(headers, io));
            io.publish(fresh);
            if (!fresh.actionable) return { ...fresh, skipped: true };
            if (fresh.key !== context.key || fresh.event.eventNo !== context.event.eventNo) {
                throw new Error('게임 리뷰 계정 또는 대상 이벤트가 변경되었습니다');
            }
            context = fresh;
            const memberNo = await io.getReviewMember(headers, context.channelSeq);
            if (String(memberNo) !== String(context.memberNo)) throw new Error('게임 리뷰 계정이 변경되었습니다');
            if (reviewEventWindow(context.event, io.now()) !== 'active') {
                const expired = { ...context, actionable: false, reason: reviewEventWindow(context.event, io.now()) };
                io.publish(expired);
                return { ...expired, skipped: true };
            }
            if (readRecord(io.storage, context.key)) throw new Error('게임 리뷰 참여 기록이 변경되었습니다');
            const record = { status: 'pending', eventNo: context.event.eventNo, attemptedAt: io.now() };
            save(io, context.key, record);
            io.publish({ ...context, record, actionable: false, reason: 'pending' });
            let accepted = false;
            let failure;
            try {
                const result = await io.postReviewSticker(headers, context.event.articleId);
                accepted = true;
                record.commentId = result.commentId;
                save(io, context.key, record);
            } catch (error) {
                failure = error.message;
                io.log(`게임 리뷰 댓글 결과 확인 대기: ${error.message}`, 'warning');
            }
            // Reconcile accepted and uncertain requests using server comments, never another POST.
            for (let i = 0; i < CONFIG.reviewEvent.verifyAttempts; i++) {
                try {
                    if (i > 0) await io.delay(CONFIG.reviewEvent.verifyDelay);
                    const commentId = await findOwnReviewComment(headers, context.event.articleId, context.memberNo, io);
                    if (commentId) {
                        save(io, context.key, { ...record, status: 'confirmed', commentId });
                        io.publish({ ...context, reason: 'completed', actionable: false, commentId });
                        io.log('게임 리뷰 스티커 댓글 등록 완료 · 플레이크 지급 여부는 별도 확인이 필요합니다', 'success');
                        return { success: true, accepted, commented: true, commentId, rewardVerified: false };
                    }
                } catch { /* Failed reads never authorize another POST. */ }
            }
            io.publish({ ...context, record, actionable: false, reason: 'pending' });
            return { success: false, accepted, reason: 'pending', error: failure || '댓글 등록 결과 반영 확인 대기' };
        });
    } catch (error) {
        io.log(`게임 리뷰 자동화 중단: ${error.message}`, 'warning');
        io.publish({ success: false, unknown: true, actionable: false, error: error.message });
        return { success: false, reason: 'unknown', error: error.message };
    } finally {
        if (tab) io.closeTab(tab);
    }
}
