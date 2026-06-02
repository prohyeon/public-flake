import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getMonthlyFlakeTotal } from '../../src/api/profile.js';

const originalGmXmlhttpRequest = globalThis.GM_xmlhttpRequest;

afterEach(() => {
    if (originalGmXmlhttpRequest === undefined) {
        delete globalThis.GM_xmlhttpRequest;
    } else {
        globalThis.GM_xmlhttpRequest = originalGmXmlhttpRequest;
    }
});

test('getMonthlyFlakeTotal queries monthly deposit total with yyyyMM and timezone offset', async () => {
    let requestConfig = null;
    globalThis.GM_xmlhttpRequest = config => {
        requestConfig = config;
        config.onload({
            status: 200,
            statusText: 'OK',
            responseText: JSON.stringify({
                code: 0,
                message: 'OK',
                value: { total_deposit_amount: 14950 }
            })
        });
    };

    const total = await getMonthlyFlakeTotal({
        Authorization: 'Bearer test-token',
        'X-UUID': 'test-uuid'
    });

    assert.equal(total, 14950);
    assert.ok(requestConfig);

    const url = new URL(requestConfig.url);
    assert.equal(url.origin, 'https://api.onstove.com');
    assert.equal(url.pathname, '/mileage/v2.0/master/deposit/total');
    assert.equal(url.searchParams.get('client_id'), 'M_STOVE_COMMUNITY');
    assert.equal(url.searchParams.get('use_rule_id'), 'ML_STOVE_COMMUNITY_MILE_PLAY');
    assert.match(url.searchParams.get('yyyyMM'), /^\d{6}$/);
    assert.match(url.searchParams.get('tz_offset'), /^-?\d+$/);
    assert.equal(url.searchParams.has('start_date'), false);
    assert.equal(url.searchParams.has('end_date'), false);
    assert.equal(requestConfig.headers['caller-id'], 'flake-fe');
    assert.equal(requestConfig.headers['caller-detail'], 'test-uuid');
});
