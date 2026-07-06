import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('userscript runs on the profile app before locale routing', () => {
    const userscript = readFileSync('stove-quest-automation.user.js', 'utf8');

    assert.match(
        userscript,
        /^\/\/ @match\s+https:\/\/profile\.onstove\.com\/\*$/m
    );
    assert.doesNotMatch(
        userscript,
        /^\/\/ @match\s+https:\/\/profile\.onstove\.com\/ko\*$/m
    );
});
