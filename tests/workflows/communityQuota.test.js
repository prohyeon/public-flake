import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../../src/config.js';
import { communityQuotaKey, createCommunityQuota, readCommunityQuota } from '../../src/workflows/communityQuota.js';

const TODAY = '2026-10-17';
const KEY = communityQuotaKey('100');

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); }
    };
}

test('without a resolved account every run does the full like and comment targets', () => {
    for (const context of [null, undefined, { storage: memoryStorage(), today: TODAY }, { storage: null, userId: '100', today: TODAY },
        { storage: memoryStorage(), userId: 'abc', today: TODAY }]) {
        const quota = createCommunityQuota(context);
        assert.equal(quota.remaining('likes'), CONFIG.targets.articleLikes);
        assert.equal(quota.remaining('comments'), CONFIG.targets.comments);
        quota.add('comments');
        assert.equal(quota.remaining('comments'), CONFIG.targets.comments, 'nothing is recorded');
    }
});

test("today's record leaves only the remainder and every success is saved immediately", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ date: TODAY, likes: 10, comments: 3 }) });
    const quota = createCommunityQuota({ storage, userId: '100', today: TODAY });

    assert.deepEqual(quota.done, { likes: 10, comments: 3 });
    assert.equal(quota.remaining('likes'), 0);
    assert.equal(quota.remaining('comments'), 2);
    quota.add('comments');
    assert.equal(quota.remaining('comments'), 1);
    assert.deepEqual(JSON.parse(storage.values.get(KEY)), { date: TODAY, likes: 10, comments: 4 });
    quota.add('comments');
    quota.add('comments');
    assert.equal(quota.remaining('comments'), 0, 'never negative');
});

test('records from another day, other accounts or malformed values count as nothing done', () => {
    const cases = [
        JSON.stringify({ date: '2026-10-16', likes: 10, comments: 5 }),
        JSON.stringify({ date: TODAY, likes: -1, comments: 2.5 }),
        JSON.stringify(null),
        '{not json'
    ];
    for (const text of cases) {
        assert.deepEqual(readCommunityQuota(memoryStorage({ [KEY]: text }), KEY, TODAY), { likes: 0, comments: 0 }, text);
    }
    const other = memoryStorage({ [communityQuotaKey('200')]: JSON.stringify({ date: TODAY, likes: 10, comments: 5 }) });
    assert.equal(createCommunityQuota({ storage: other, userId: '100', today: TODAY }).remaining('comments'), CONFIG.targets.comments);
    assert.deepEqual(readCommunityQuota({ getItem() { throw new Error('blocked'); } }, KEY, TODAY), { likes: 0, comments: 0 });
});

test('a storage write failure keeps counting in memory and never throws', () => {
    const storage = { getItem: () => null, setItem() { throw new Error('quota exceeded'); } };
    const quota = createCommunityQuota({ storage, userId: '100', today: TODAY });
    quota.add('likes');
    assert.equal(quota.remaining('likes'), CONFIG.targets.articleLikes - 1);
});
