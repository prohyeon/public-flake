import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUNDLE_NAME = 'stove-quest-automation.user.js';

// The committed bundle is the auto-updating release artifact; it only changes at release time.
export const COMMITTED_BUNDLE_PATH = join(ROOT, BUNDLE_NAME);

let builtBundle;

function buildBundleFromSource() {
    const outDir = mkdtempSync(join(tmpdir(), 'stove-test-bundle-'));
    try {
        const result = spawnSync(process.execPath, [
            join(ROOT, 'node_modules/vite/bin/vite.js'), 'build',
            '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'
        ], { cwd: ROOT, encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(`vite build failed:\n${result.stdout}${result.stderr}`);
        }
        return readFileSync(join(outDir, BUNDLE_NAME), 'utf8');
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
}

/**
 * The userscript built from the current src (once per test process), so bundle-level tests check
 * the code under development rather than the last release. BUNDLE_PATH overrides it with a file.
 */
export function readUserscriptBundle() {
    if (process.env.BUNDLE_PATH) return readFileSync(process.env.BUNDLE_PATH, 'utf8');
    builtBundle ??= buildBundleFromSource();
    return builtBundle;
}

export function readCommittedBundle() {
    return readFileSync(COMMITTED_BUNDLE_PATH, 'utf8');
}
