import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { visitRequiredPages } from '../../src/workflows/status.js';

const originalDocument = globalThis.document;
const originalGmOpenInTab = globalThis.GM_openInTab;

afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.GM_openInTab = originalGmOpenInTab;
});

test('visitRequiredPages opens reward shop and the store main page used by the STOVE mission', async () => {
    const opened = [];
    globalThis.document = {
        getElementById: () => null,
        querySelector: () => null
    };
    globalThis.GM_openInTab = (url, options) => {
        opened.push({ url, active: options.active });
        return { url, options };
    };

    const tabs = await visitRequiredPages();

    assert.deepEqual(opened, [
        { url: 'https://reward.onstove.com/ko', active: false },
        { url: 'https://store.onstove.com/', active: false }
    ]);
    assert.equal(tabs.length, 2);
});
