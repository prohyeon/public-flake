import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeReviewHeaders, getReviewEvents, getReviewArticle, getReviewMember,
    canWriteReviewComment, getReviewCommentPage, postReviewSticker } from '../../src/api/reviewEvent.js';
import { reviewEventFixture } from '../helpers/reviewEventFixture.js';

const headers = { Authorization: 'Bearer test-token', 'X-UUID': 'test-uuid', 'caller-id': 'storee-lounge' };
const original = globalThis.GM_xmlhttpRequest;
afterEach(() => { globalThis.GM_xmlhttpRequest = original; });
function respond(fn) {
    const calls = [];
    globalThis.GM_xmlhttpRequest = config => {
        calls.push(config);
        const value = typeof fn === 'function' ? fn(config) : fn;
        config.onload({ status: 200, responseText: JSON.stringify({ code: 0, value }) });
    };
    return calls;
}

test('sticker POST matches the captured CWMS body and headers, without favorite or reward mutations', async () => {
    const calls = respond({ comment_id: '81598225' });
    assert.equal((await postReviewSticker(headers, '14523486')).commentId, '81598225');
    const request = calls[0];
    assert.equal(new URL(request.url).pathname, '/cwms/v1.0/article/14523486/comment');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['caller-id'], 'storee-cp');
    assert.equal(request.headers.Referer, 'https://page.onstove.com/');
    assert.equal(request.headers.Authorization, headers.Authorization);
    assert.equal(request.anonymous, true);
    assert.equal(request.timeout, 10000);
    assert.deepEqual(JSON.parse(request.data), {
        comment: '<p><img src="https://d2x8kymwjom7h7.cloudfront.net/live/application_no/10009/partners-sns-api/sp7HsnbTri6Q.png" class="js-is-emoji emoji__img emoji-wrap" data-sticker=""><br></p>',
        attach_info: { media_info: null, poll_info: null, quote_info: null }, request_id: 'CM', view_mode: 'EDITOR'
    });
    assert.equal(calls.length, 1);
});

test('event catalogue scans all pages including a target after the first page and omits credentials', async () => {
    const target = reviewEventFixture().event;
    const calls = respond(config => ({ total_event_cnt: 2,
        promotion_events: [new URL(config.url).searchParams.get('page') === '0' ? { event_no: 1 } : target] }));
    const events = await getReviewEvents(headers);
    assert.equal(events.length, 2);
    assert.equal(events[1].event_no, 1914);
    for (const request of calls) {
        assert.equal(request.method, 'GET');
        assert.equal(request.headers['caller-id'], 'event-hub');
        assert.equal(request.headers.Authorization, undefined);
        assert.equal(request.headers['X-UUID'], undefined);
        assert.ok(new URL(request.url).searchParams.has('timestemp'));
    }
});

test('captured article, member, permission and comment read shapes are validated', async () => {
    respond({ ...reviewEventFixture().article, community_key: 'quarter', channel_key: 'kr',
        article_status_code: 'PUBLISHED', coverage_code: 'PUBLIC' });
    assert.equal((await getReviewArticle(headers, '14523486')).board_seq, 134147);
    respond({ user_info: { member_no: 242838815 } });
    assert.equal(await getReviewMember(headers, 73), '242838815');
    respond([{ board_seq: 134147, user_permission_info: { comment: { write: false } } }]);
    assert.equal(await canWriteReviewComment(headers, 134147), false);
    const calls = respond({ total: 0, display_total: 0, page: 1, size: 20, list: null, next_yn: 'N' });
    assert.deepEqual((await getReviewCommentPage(headers, '14523486', 1)).list, []);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/cwms/v1.1/article/14523486/comment/list');
    assert.equal(url.searchParams.get('sort_type_code'), 'LATEST');
});

test('malformed or repeated catalogue pages and unidentifiable comments fail closed', async () => {
    respond({ total_event_cnt: 2, promotion_events: [{ event_no: 1 }] });
    await assert.rejects(getReviewEvents(headers), /전체/);
    for (const [fn, value] of [
        [() => getReviewEvents(headers), { promotion_events: [] }],
        [() => getReviewArticle(headers, '14523486'), { ...reviewEventFixture().article, coverage_code: 'PRIVATE' }],
        [() => getReviewMember(headers, 73), { user_info: {} }],
        [() => canWriteReviewComment(headers, 134147), []],
        [() => postReviewSticker(headers, '14523486'), {}],
        [() => getReviewCommentPage(headers, '14523486', 1), { total: 1, display_total: 1,
            page: 1, size: 20, next_yn: 'N', list: [{ comment_id: '1' }] }]
    ]) { respond(value); await assert.rejects(fn()); }
    globalThis.GM_xmlhttpRequest = config => config.onload({ status: 200, responseText: '<html>login</html>' });
    await assert.rejects(postReviewSticker(headers, '14523486'));
    globalThis.GM_xmlhttpRequest = config => config.onload({ status: 200, responseText: JSON.stringify({ code: 403, message: 'denied', value: {} }) });
    await assert.rejects(postReviewSticker(headers, '14523486'), /denied/);
    globalThis.GM_xmlhttpRequest = config => config.ontimeout();
    await assert.rejects(postReviewSticker(headers, '14523486'), /timed out/);
});

test('invalid IDs or missing auth cause no network traffic; catalogue headers are public', async () => {
    const calls = respond({});
    await assert.rejects(postReviewSticker(headers, '../other'));
    await assert.rejects(postReviewSticker({}, '14523486'));
    assert.equal(calls.length, 0);
    assert.equal(makeReviewHeaders({}, true).Authorization, undefined);
});
