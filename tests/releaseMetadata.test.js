import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CONFIG } from '../src/config.js';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const capture = (source, expression, description) => {
    const match = source.match(expression);
    assert.ok(match, `${description} is present`);
    return match[1];
};

test('source, package lock, build metadata, and deployed bundle use one release version', () => {
    const packageJson = readJson('../package.json');
    const packageLock = readJson('../package-lock.json');
    const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
    const userscript = readFileSync(new URL('../stove-quest-automation.user.js', import.meta.url), 'utf8');

    const viteVersion = capture(
        viteConfig,
        /userscript:\s*\{[\s\S]*?\bversion:\s*['"]([^'"]+)['"]/,
        'vite userscript version'
    );
    const bundleMetadataVersion = capture(
        userscript,
        /^\/\/ @version\s+([^\s]+)$/m,
        'deployed userscript metadata version'
    );
    const bundleConfigVersion = capture(
        userscript,
        /const CONFIG = \{\s*version:\s*["']([^"']+)["']/,
        'deployed CONFIG version'
    );

    const versions = {
        packageJson: packageJson.version,
        packageLock: packageLock.version,
        packageLockRoot: packageLock.packages?.['']?.version,
        sourceConfig: CONFIG.version,
        viteConfig: viteVersion,
        bundleMetadata: bundleMetadataVersion,
        bundleConfig: bundleConfigVersion
    };

    assert.ok(Object.values(versions).every(version => typeof version === 'string' && version.length > 0));
    for (const [source, version] of Object.entries(versions)) {
        assert.equal(version, packageJson.version, `${source} must match package.json`);
    }

    const sourceDate = CONFIG.lastUpdated;
    const bundleDate = capture(
        userscript,
        /lastUpdated:\s*["']([^"']+)["']/,
        'deployed CONFIG lastUpdated date'
    );
    assert.equal(bundleDate, sourceDate, 'deployed CONFIG lastUpdated must match src/config.js');
});
