// 좋아요·댓글은 서버에서 오늘 한 횟수를 확인할 수 없다. 같은 날 다시 실행할 때 다시 쓰지 않도록
// 이 브라우저에서 성공한 횟수를 계정·KST 날짜별로 기록하고, 남은 횟수만 진행한다.
// 다른 브라우저나 기록 이전 버전에서 한 활동은 알 수 없으므로 그때는 기존처럼 목표만큼 진행한다.
import { CONFIG } from '../config.js';

export const communityQuotaKey = userId => `stove-community-quota-v1:${userId}`;

const KINDS = ['likes', 'comments'];

function targets() {
    return { likes: CONFIG.targets.articleLikes, comments: CONFIG.targets.comments };
}

export function readCommunityQuota(storage, key, today) {
    const empty = { likes: 0, comments: 0 };
    try {
        const text = storage?.getItem(key);
        if (!text) return empty;
        const record = JSON.parse(text);
        if (!record || record.date !== today) return empty;
        return Object.fromEntries(KINDS.map(kind => [
            kind, Number.isInteger(record[kind]) && record[kind] > 0 ? record[kind] : 0
        ]));
    } catch {
        return empty;
    }
}

/**
 * Today's like/comment progress for the signed-in account, from the monthly-attendance context
 * (which already resolved the user id and storage). Without a context every run does the full target.
 */
export function createCommunityQuota(context) {
    const goal = targets();
    if (!context?.storage || !/^\d+$/.test(String(context.userId ?? ''))) {
        return { done: { likes: 0, comments: 0 }, remaining: kind => goal[kind], add() {} };
    }
    const key = communityQuotaKey(context.userId);
    const done = readCommunityQuota(context.storage, key, context.today);
    return {
        done,
        remaining: kind => Math.max(0, goal[kind] - done[kind]),
        add(kind) {
            done[kind] += 1;
            try {
                context.storage.setItem(key, JSON.stringify({ date: context.today, ...done }));
            } catch {
                // A lost record only means the next same-day run repeats the remaining actions.
            }
        }
    };
}
