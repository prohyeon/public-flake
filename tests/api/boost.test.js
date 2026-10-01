import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeBoostHeaders, getBoostMissions, getBoostBalance, getBoostRanking,
    getArticleBoostStatuses, boostArticle, receiveBoostMissionReward } from '../../src/api/boost.js';

const originalRequest = globalThis.GM_xmlhttpRequest;
const headers = { Authorization: 'Bearer test-token', 'X-UUID': 'test-uuid', 'caller-id': 'storee-lounge' };
afterEach(() => { globalThis.GM_xmlhttpRequest = originalRequest; });

function respond(value, code = 0) {
    const calls = [];
    globalThis.GM_xmlhttpRequest = config => {
        calls.push(config);
        config.onload({ status: 200, responseText: JSON.stringify({ code, message: 'test', value }) });
    };
    return calls;
}

test('boost and reward match captured bodyless PUT/POST and authenticated lounge headers', async () => {
    let calls = respond({ remaining_count: 4, next_charge_at: 1790851826000 });
    assert.deepEqual(await boostArticle(headers, '14559004'), { remainingCount: 4, nextChargeAt: 1790851826000 });
    assert.equal(calls[0].method, 'PUT');
    assert.equal(new URL(calls[0].url).pathname, '/stadium-api/v1.0/boost/14559004');
    assert.equal(calls[0].data, null);
    assert.equal(calls[0].anonymous, true);
    assert.equal(calls[0].timeout, 10000);
    assert.equal(calls[0].headers['caller-id'], 'lounge');
    assert.equal(calls[0].headers['X-UUID'], 'test-uuid');
    assert.equal(calls[0].headers['x-lang'], 'KO');
    calls = respond({ mission_id: 1, rewards: [{ type: 'FLAKE', amount: 3000 }] });
    assert.equal(await receiveBoostMissionReward(headers, 1), 3000);
    assert.equal(calls[0].method, 'POST');
    assert.equal(new URL(calls[0].url).pathname, '/stadium-api/v1.0/missions/1/reward');
    assert.equal(calls[0].data, null);
});

test('read APIs validate captured fields and add a cache-busting timestamp', async () => {
    let calls = respond({ remaining_count: 5 });
    assert.equal((await getBoostBalance(headers)).remainingCount, 5);
    assert.equal(calls[0].method, 'GET');
    assert.ok(new URL(calls[0].url).searchParams.has('timestemp'));
    respond({ missions: [] });
    assert.deepEqual(await getBoostMissions(headers), []);
    respond({ articles: [], generated_at: 1790851500011 });
    assert.equal((await getBoostRanking(headers)).generatedAt, 1790851500011);
    respond({ '11': { BOOST: false }, '12': { BOOST: true } });
    assert.equal((await getArticleBoostStatuses(headers, ['11', '12']))['12'].BOOST, true);
});

test('HTTP 200 with nonzero application code is a definite failure', async () => {
    respond({}, 82500);
    await assert.rejects(boostArticle(headers, '11'), error => error.code === 82500 && error.definiteFailure === true);
});

test('malformed success responses and omitted boost states fail closed', async () => {
    for (const [fn, value] of [
        [() => getBoostMissions(headers), {}], [() => getBoostBalance(headers), { remaining_count: '5' }],
        [() => getBoostRanking(headers), { articles: [] }],
        [() => getArticleBoostStatuses(headers, ['11', '12']), { '11': { BOOST: false } }],
        [() => receiveBoostMissionReward(headers, 1), { mission_id: 2, rewards: [] }]
    ]) {
        respond(value);
        await assert.rejects(fn());
    }
    globalThis.GM_xmlhttpRequest = config => config.onload({ status: 200, responseText: '<html>login</html>' });
    await assert.rejects(boostArticle(headers, '11'));
});

test('timeouts and aborts reject without being treated as a definite failed mutation', async () => {
    for (const event of ['ontimeout', 'onabort']) {
        globalThis.GM_xmlhttpRequest = config => config[event]();
        await assert.rejects(boostArticle(headers, '11'), error => error.definiteFailure !== true);
    }
});

test('invalid IDs and missing authentication do not send requests', async () => {
    const calls = respond({});
    await assert.rejects(boostArticle(headers, '11/other'));
    await assert.rejects(boostArticle({}, '11'));
    assert.equal(calls.length, 0);
    assert.equal(makeBoostHeaders({ Authorization: 'Bearer test-token', 'caller-detail': 'test-uuid' })['X-UUID'], 'test-uuid');
});
