import test from 'node:test';
import assert from 'node:assert/strict';
import { readUserscriptBundle } from './helpers/bundle.js';

test('userscript runs on the profile app before locale routing', () => {
    const userscript = readUserscriptBundle();

    assert.match(
        userscript,
        /^\/\/ @match\s+https:\/\/profile\.onstove\.com\/\*$/m
    );
    assert.doesNotMatch(
        userscript,
        /^\/\/ @match\s+https:\/\/profile\.onstove\.com\/ko\*$/m
    );
});
