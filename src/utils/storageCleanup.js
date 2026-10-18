import { CONFIG } from '../config.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Removes `${prefix}*` localStorage records whose newest timestamp is older than
 * CONFIG.storageRetentionDays, or that hold no readable timestamp at all. Keys for which `keep`
 * returns true (the mission or event still being worked on) are never touched. Best effort:
 * cleanup never fails the caller. Returns the removed keys.
 */
export function pruneOldRecords(storage, prefix, { now, timestamps, keep = () => false }) {
    try {
        if (!storage || typeof storage.key !== 'function') return [];
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key);
        }
        const maxAge = CONFIG.storageRetentionDays * DAY;
        const removed = [];
        for (const key of keys) {
            if (keep(key)) continue;
            let record = null;
            try { record = JSON.parse(storage.getItem(key)); } catch { /* unreadable: no timestamp */ }
            const times = record && typeof record === 'object' ? timestamps(record).filter(Number.isFinite) : [];
            const newest = times.length > 0 ? Math.max(...times) : -Infinity;
            if (now - newest > maxAge) {
                storage.removeItem(key);
                removed.push(key);
            }
        }
        return removed;
    } catch {
        return [];
    }
}
