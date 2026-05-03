import test from 'node:test';
import assert from 'node:assert/strict';

import {
    pickRandomComment,
    postCommentsSerially
} from '../../src/workflows/comments.js';

test('pickRandomComment chooses from the configured pool', () => {
    assert.equal(pickRandomComment(['굿', 'ㅋㅋㅋㅋ', '좋네요'], () => 0), '굿');
    assert.equal(pickRandomComment(['굿', 'ㅋㅋㅋㅋ', '좋네요'], () => 0.5), 'ㅋㅋㅋㅋ');
    assert.equal(pickRandomComment(['굿', 'ㅋㅋㅋㅋ', '좋네요'], () => 0.999), '좋네요');
});

test('pickRandomComment falls back to the legacy single comment when the pool is empty', () => {
    assert.equal(pickRandomComment([], () => 0.5, 'Nice!'), 'Nice!');
});

test('postCommentsSerially writes one comment at a time with the configured delay between attempts', async () => {
    let elapsed = 0;
    const callTimes = [];
    const contents = [];
    const stateRef = { progress: { comments: 0 }, createdCommentIds: [] };

    const result = await postCommentsSerially({
        headers: { Authorization: 'token' },
        articles: [
            { article_id: 11 },
            { article_id: 12 },
            { article_id: 13 }
        ],
        targetComments: 3,
        delayMs: 11000,
        commentPool: ['굿', 'ㅋㅋㅋㅋ', '좋네요'],
        randomFn: () => 0,
        stateRef,
        postCommentFn: async (_headers, articleId, content) => {
            callTimes.push(elapsed);
            contents.push([articleId, content]);
            return `comment-${articleId}`;
        },
        delayFn: async ms => {
            elapsed += ms;
        },
        logFn: () => {},
        updateProgressFn: () => {}
    });

    assert.deepEqual(callTimes, [0, 11000, 22000]);
    assert.deepEqual(contents, [
        [11, '굿'],
        [12, '굿'],
        [13, '굿']
    ]);
    assert.deepEqual(stateRef.createdCommentIds, ['comment-11', 'comment-12', 'comment-13']);
    assert.equal(stateRef.progress.comments, 3);
    assert.deepEqual(result, {
        attempted: 3,
        commentIds: ['comment-11', 'comment-12', 'comment-13'],
        errors: []
    });
});

test('postCommentsSerially keeps going after a failed comment attempt', async () => {
    const attempted = [];
    const stateRef = { progress: { comments: 0 }, createdCommentIds: [] };

    const result = await postCommentsSerially({
        articles: [{ article_id: 21 }, { article_id: 22 }],
        targetComments: 2,
        delayMs: 11000,
        commentPool: ['ㅋㅋㅋㅋ'],
        stateRef,
        postCommentFn: async (_headers, articleId) => {
            attempted.push(articleId);
            if (articleId === 21) throw new Error('rate limited');
            return `comment-${articleId}`;
        },
        delayFn: async () => {},
        logFn: () => {},
        updateProgressFn: () => {}
    });

    assert.deepEqual(attempted, [21, 22]);
    assert.deepEqual(result.commentIds, ['comment-22']);
    assert.deepEqual(result.errors, [{ articleId: 21, message: 'rate limited' }]);
    assert.equal(stateRef.progress.comments, 1);
});
