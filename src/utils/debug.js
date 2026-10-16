import { CONFIG } from '../config.js';

export const DEBUG_STORAGE_KEY = 'stove-quest-automation:debug';

// Request-level tracing is off by default. Turn it on with CONFIG.debug, or without editing the
// script: localStorage.setItem('stove-quest-automation:debug', '1') in the profile page console.
export function isDebugEnabled() {
    if (CONFIG.debug) return true;
    try {
        return globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function debugLog(...args) {
    if (isDebugEnabled()) console.log(...args);
}
