import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, rawText, httpError, TEST_HEADERS } from '../helpers/gmHarness.js';
import { CONFIG } from '../../src/config.js';
import { DEBUG_STORAGE_KEY, isDebugEnabled } from '../../src/utils/debug.js';
import { apiRequest } from '../../src/api/request.js';

const traced = h => h.consoleCalls.filter(call => call.method === 'log' && String(call.args[0]).startsWith('[API Request]'));

test('request tracing is silent by default', async t => {
    const h = useHarness(t);
    h.on('GET', 'https://api.onstove.com/x', { code: 0 });
    await apiRequest('https://api.onstove.com/x', 'GET', TEST_HEADERS);
    assert.equal(isDebugEnabled(), false);
    assert.deepEqual(traced(h), []);
});

test('the localStorage switch enables request tracing without editing the script', async t => {
    const h = useHarness(t);
    h.on('GET', 'https://api.onstove.com/x', { code: 0 });
    localStorage.setItem(DEBUG_STORAGE_KEY, '1');
    await apiRequest('https://api.onstove.com/x', 'GET', TEST_HEADERS);
    assert.equal(traced(h).length, 2);
});

test('CONFIG.debug enables request tracing', async t => {
    const h = useHarness(t);
    h.on('GET', 'https://api.onstove.com/x', { code: 0 });
    CONFIG.debug = true;
    await apiRequest('https://api.onstove.com/x', 'GET', TEST_HEADERS);
    assert.equal(traced(h).length, 2);
});

test('warnings and errors are never gated', async t => {
    const h = useHarness(t);
    h.on('GET', 'https://api.onstove.com/html', rawText('<html>login</html>'));
    h.on('GET', 'https://api.onstove.com/500', httpError(500));
    await apiRequest('https://api.onstove.com/html', 'GET', TEST_HEADERS);
    await apiRequest('https://api.onstove.com/500', 'GET', TEST_HEADERS).catch(() => {});
    assert.deepEqual(h.consoleCalls.map(call => call.method), ['warn', 'error']);
});
