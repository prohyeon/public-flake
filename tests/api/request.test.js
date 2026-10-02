import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../../src/api/request.js';

const originalRequest = globalThis.GM_xmlhttpRequest;
test.afterEach(() => { globalThis.GM_xmlhttpRequest = originalRequest; });

test('body requests survive Tampermonkey fetch timeout handling when no positive timeout is supplied', async () => {
    const requests = [];
    globalThis.GM_xmlhttpRequest = config => {
        requests.push(config);
        // Reproduce Tampermonkey 5.5.0: a defined timeout, including 0, arms
        // an abort timer only when data is non-null.
        let abortTimer;
        const responseTimer = setTimeout(() => {
            clearTimeout(abortTimer);
            config.onload({ status: 200, responseText: '{"code":0}' });
        }, 10);
        if (config.timeout !== undefined && config.data !== null) {
            abortTimer = setTimeout(() => {
                clearTimeout(responseTimer);
                config.ontimeout();
            }, config.timeout);
        }
    };

    for (const timeout of [undefined, null, 0, -1, NaN, Infinity, '100']) {
        const result = await apiRequest('https://example.invalid/test', 'POST',
            { Authorization: 'test-token' }, { mission_no: 3 }, { timeout });
        assert.equal(result.code, 0);
    }
    for (const request of requests) {
        assert.equal(Object.hasOwn(request, 'timeout'), false);
        assert.equal(request.anonymous, true, 'cookie exclusion stays enabled');
        assert.equal(request.headers.Authorization, 'test-token');
        assert.equal(request.data, '{"mission_no":3}');
    }
});

test('explicit positive timeouts remain available and reject on expiry', async () => {
    let request;
    globalThis.GM_xmlhttpRequest = config => {
        request = config;
        config.ontimeout();
    };
    await assert.rejects(apiRequest('https://example.invalid/test', 'POST', {},
        { type_no: 1 }, { timeout: 15000 }), /API request timed out/);
    assert.equal(request.timeout, 15000);
    assert.equal(request.anonymous, true);
});
