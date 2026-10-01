import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { checkReviewEventStatus, executeReviewEvent, reviewEventWindow, selectReviewEvent,
    reviewRecordKey } from '../../src/workflows/reviewEvent.js';
import { reviewEventFixture, REVIEW_NOW } from '../helpers/reviewEventFixture.js';

test('KST period is inclusive through October 4 and skips at October 5 midnight', async () => {
    const f = reviewEventFixture();
    const event = selectReviewEvent([f.event]);
    assert.equal(reviewEventWindow(event, Date.parse('2026-09-30T14:59:59Z')), 'upcoming');
    assert.equal(reviewEventWindow(event, Date.parse('2026-09-30T15:00:00Z')), 'active');
    assert.equal(reviewEventWindow(event, Date.parse('2026-10-04T14:59:59Z')), 'active');
    assert.equal(reviewEventWindow(event, Date.parse('2026-10-04T15:00:00Z')), 'expired');
    for (const [timestamp, reason] of [['2026-09-30T14:59:59Z', 'upcoming'], ['2026-10-04T15:00:00Z', 'expired']]) {
        const result = await executeReviewEvent({}, { ...f.deps, now: () => Date.parse(timestamp),
            getReviewArticle: async () => { throw new Error('should not load expired review'); } });
        assert.equal(result.reason, reason);
        assert.equal(result.skipped, true);
    }
    assert.equal(f.metrics.posts.length, 0);
    assert.equal(f.metrics.visits.length, 0);
});

test('dashboard is read-only; execution visits and posts exactly once across repeats and deleted comments', async () => {
    const f = reviewEventFixture();
    const before = await checkReviewEventStatus({}, f.deps);
    assert.equal(before.actionable, true);
    assert.equal(f.records.size, 0);
    assert.equal(f.metrics.visits.length, 0);
    const result = await executeReviewEvent({}, f.deps);
    assert.equal(result.commented, true);
    assert.equal(result.rewardVerified, false);
    assert.equal(JSON.parse(f.records.get(reviewRecordKey('100', '14523486'))).status, 'confirmed');
    assert.equal(f.metrics.posts.length, 1);
    assert.equal(f.metrics.visits[0].url, f.event.link_url);
    assert.equal(f.metrics.closes, 1);
    f.comments.length = 0;
    assert.equal((await executeReviewEvent({}, f.deps)).reason, 'completed');
    assert.equal(f.metrics.posts.length, 1);
});

test('a prior own comment on page two prevents writing without local records', async () => {
    const f = reviewEventFixture();
    f.comments.push(...Array.from({ length: 20 }, (_, i) => ({ comment_id: String(i + 1), user_info: { member_no: 200 } })));
    f.comments.push({ comment_id: '77', user_info: { member_no: 100 } });
    const result = await executeReviewEvent({}, f.deps);
    assert.equal(result.reason, 'completed');
    assert.equal(result.commentId, '77');
    assert.deepEqual(f.metrics.scans, [1, 2]);
    assert.equal(f.metrics.posts.length, 0);
    assert.equal(f.metrics.visits.length, 0);
});

test('timeout persists a pending record across reload and reconciles without resend', async () => {
    const f = reviewEventFixture();
    f.deps.postReviewSticker = async () => { f.metrics.posts.push('uncertain'); throw new Error('timeout'); };
    assert.equal((await executeReviewEvent({}, f.deps)).reason, 'pending');
    assert.equal((await executeReviewEvent({}, { ...f.deps })).reason, 'pending');
    assert.equal(f.metrics.posts.length, 1);
    f.comments.push({ comment_id: '901', user_info: { member_no: 100 } });
    assert.equal((await checkReviewEventStatus({}, f.deps)).reason, 'completed');
    assert.equal((await executeReviewEvent({}, f.deps)).reason, 'completed');
    assert.equal(f.metrics.posts.length, 1);
});

test('server accepted comment survives a lost POST response', async () => {
    const f = reviewEventFixture();
    const post = f.deps.postReviewSticker;
    f.deps.postReviewSticker = async (...args) => { await post(...args); throw new Error('lost response'); };
    assert.equal((await executeReviewEvent({}, f.deps)).commented, true);
    assert.equal(f.metrics.posts.length, 1);
});

test('a successful POST with delayed visibility remains pending and is never sent again', async () => {
    const f = reviewEventFixture();
    f.deps.postReviewSticker = async () => { f.metrics.posts.push('accepted'); return { commentId: '901' }; };
    assert.equal((await executeReviewEvent({}, f.deps)).accepted, true);
    assert.equal((await executeReviewEvent({}, f.deps)).reason, 'pending');
    assert.equal(f.metrics.posts.length, 1);
});

test('midnight or an early server finish during the visit cancels the POST and closes the tab', async () => {
    for (const kind of ['midnight', 'finished']) {
        const f = reviewEventFixture();
        let now = REVIEW_NOW;
        f.deps.now = () => now;
        f.deps.delay = async () => { if (kind === 'midnight') now += 60000; else f.event.status = 'FINISHED'; };
        const result = await executeReviewEvent({}, f.deps);
        assert.equal(result.reason, kind === 'midnight' ? 'expired' : 'inactive');
        assert.equal(f.metrics.posts.length, 0);
        assert.equal(f.metrics.closes, 1);
    }
});

test('a manual comment added during the visit cancels automatic commenting', async () => {
    const f = reviewEventFixture();
    f.deps.delay = async () => f.comments.push({ comment_id: '902', user_info: { member_no: 100 } });
    assert.equal((await executeReviewEvent({}, f.deps)).reason, 'completed');
    assert.equal(f.metrics.posts.length, 0);
});

test('midnight during the final asynchronous account check still prevents the POST', async () => {
    const f = reviewEventFixture();
    let now = REVIEW_NOW;
    let memberReads = 0;
    f.deps.now = () => now;
    f.deps.getReviewMember = async () => {
        if (++memberReads === 4) now = Date.parse('2026-10-04T15:00:00Z');
        return '100';
    };
    assert.equal((await executeReviewEvent({}, f.deps)).reason, 'expired');
    assert.equal(f.metrics.posts.length, 0);
    assert.equal(f.records.size, 0);
    assert.equal(f.metrics.closes, 1);
});

test('account or target changes before posting stop the run', async () => {
    for (const kind of ['account', 'article', 'event']) {
        const f = reviewEventFixture();
        let memberNo = '100';
        f.deps.getReviewMember = async () => memberNo;
        f.deps.delay = async () => {
            if (kind === 'account') memberNo = '101';
            else if (kind === 'article') f.event.link_url = 'https://page.onstove.com/quarter/kr/view/222';
            else f.event.event_no = 1915;
        };
        assert.equal((await executeReviewEvent({}, f.deps)).success, false);
        assert.equal(f.metrics.posts.length, 0);
        assert.equal(f.metrics.closes, 1);
    }
});

test('two tabs use one account/article lock and write only once', async () => {
    const f = reviewEventFixture();
    const results = await Promise.all([executeReviewEvent({}, f.deps), executeReviewEvent({}, f.deps)]);
    assert.equal(f.metrics.posts.length, 1);
    assert.ok(results.some(result => result.commented));
    assert.ok(results.some(result => result.reason === 'alreadyRunning'));
});

test('storage, lock, comment scan or catalogue failures never permit mutation', async () => {
    for (const deps of [
        { storage: null }, { storage: { getItem: () => '{bad' } },
        { storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } },
        { withLock: async () => { throw new Error('no lock'); } },
        { getReviewCommentPage: async () => { throw new Error('offline'); } },
        { getReviewCommentPage: async () => ({ list: [], display_total: 1, next_yn: 'N' }) },
        { getReviewEvents: async () => { throw new Error('offline'); } }
    ]) {
        const f = reviewEventFixture();
        assert.equal((await executeReviewEvent({}, { ...f.deps, ...deps })).success, false);
        assert.equal(f.metrics.posts.length, 0);
    }
});

test('missing event, permission or disabled feature is skipped without visiting', async () => {
    for (const deps of [{ getReviewEvents: async () => [] }, { canWriteReviewComment: async () => false }]) {
        const f = reviewEventFixture();
        assert.equal((await executeReviewEvent({}, { ...f.deps, ...deps })).skipped, true);
        assert.equal(f.metrics.visits.length, 0);
    }
    const enabled = CONFIG.reviewEvent.enabled;
    try {
        CONFIG.reviewEvent.enabled = false;
        assert.equal((await executeReviewEvent({}, reviewEventFixture().deps)).reason, 'disabled');
    } finally { CONFIG.reviewEvent.enabled = enabled; }
});

test('new targets and extended dates are read dynamically; malformed or ambiguous metadata fail closed', () => {
    const f = reviewEventFixture();
    f.event.link_url = 'https://page.onstove.com/quarter/kr/view/222';
    f.event.expose_end_at = '2026-10-08';
    assert.equal(selectReviewEvent([f.event], Date.parse('2026-10-05T00:00:00Z')).articleId, '222');
    for (const changes of [{ expose_end_at: null }, { expose_end_at: '2026-02-30' },
        { expose_start_at: '2026-11-01' }, { link_url: 'https://evil.example/quarter/kr/view/222' },
        { link_url: 'https://page.onstove.com/other/kr/view/222' }]) {
        assert.throws(() => selectReviewEvent([{ ...f.event, ...changes }]));
    }
    assert.throws(() => selectReviewEvent([f.event, { ...f.event, event_no: 1915 }]));
});
