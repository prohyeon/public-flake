import { readFileSync } from 'node:fs';

// Bundle-level tests read the committed userscript by default. `npm run verify` points
// BUNDLE_PATH at a fresh build so src changes are tested before the bundle is committed.
export const BUNDLE_PATH = process.env.BUNDLE_PATH ||
    new URL('../../stove-quest-automation.user.js', import.meta.url);

export function readUserscriptBundle() {
    return readFileSync(BUNDLE_PATH, 'utf8');
}
