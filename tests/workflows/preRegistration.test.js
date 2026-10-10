import test from 'node:test';
import assert from 'node:assert/strict';

import { addIndieWishlist, registerPreRegistration } from '../../src/api/preRegistration.js';
import { isPreRegistrationActive, runPreRegistrations } from '../../src/workflows/preRegistration.js';
import { CONFIG } from '../../src/config.js';
import { getAutomationOutcome } from '../../src/workflows/automation.js';

const headers = { Authorization: 'Bearer fake', 'X-UUID': 'fake-device' };
const campaign = { month: '202610', key: 'luvplace', title: 'luvplace', shopItemId: 14203, endDate: '2026-10-15' };

function mockGM(t, respond) {
    const original = globalThis.GM_xmlhttpRequest;
    t.after(() => { globalThis.GM_xmlhttpRequest = original; });
    const calls = [];
    globalThis.GM_xmlhttpRequest = config => {
        calls.push(config);
        config.onload({ status: 200, responseText: JSON.stringify(respond(config)) });
    };
    return calls;
}

test('register and wishlist requests match the captured route, headers and body', async t => {
    const calls = mockGM(t, config => config.url.endsWith('/register')
        ? { code: 0, message: 'OK', value: { registration_no: 29231 } }
        : { value: { cart_id: '0', extra_data: null }, response_code: 0, response_message: 'OK' });

    assert.deepEqual(await registerPreRegistration(headers, campaign), { registered: true, registrationNo: 29231 });
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].url, /\/dailyshop\/v1\.0\/campaigns\/202610\/luvplace\/register$/);
    assert.equal(calls[0].data, null);
    assert.equal(calls[0].headers['caller-id'], 'event-hub');
    assert.equal(calls[0].headers['caller-detail'], 'fake-device');
    assert.equal(calls[0].headers.Origin, 'https://event.onstove.com');

    assert.equal(await addIndieWishlist(headers, 14203), true);
    assert.match(calls[1].url, /\/shop\/v2\.0\/indie\/wishlist\/add$/);
    assert.deepEqual(JSON.parse(calls[1].data), {
        shop_key: 'indie',
        shop_item_ids: [{ shop_item_id: 14203 }],
        shop_item_ids_str: '[{"shop_item_id":14203}]'
    });
});

test('already joined response is not an error and unexpected codes are', async t => {
    let code = 90605;
    mockGM(t, () => ({ code, message: '사용자가 이미 참여함.' }));
    assert.deepEqual(await registerPreRegistration(headers, campaign), { alreadyJoined: true });
    code = 500;
    await assert.rejects(() => registerPreRegistration(headers, campaign), /code=500/);
    await assert.rejects(() => registerPreRegistration(headers, { month: '2026-10', key: 'x' }), /설정 확인 실패/);
});

test('new registration adds the wishlist item; already joined skips it', async () => {
    const wishlisted = [];
    const deps = {
        config: { enabled: true, campaigns: [campaign] },
        today: '2026-10-10',
        writeLog: () => {},
        addWishlist: async (_headers, id) => wishlisted.push(id)
    };

    const first = await runPreRegistrations(headers, {
        ...deps, register: async () => ({ registered: true, registrationNo: 1 })
    });
    assert.equal(first.success, true);
    assert.deepEqual(wishlisted, [14203]);

    const second = await runPreRegistrations(headers, {
        ...deps, register: async () => ({ alreadyJoined: true })
    });
    assert.equal(second.success, true);
    assert.deepEqual(second.results, [{ key: 'luvplace', alreadyJoined: true }]);
    assert.deepEqual(wishlisted, [14203]);
});

test('past campaigns are skipped and failures surface in the automation outcome', async () => {
    let calls = 0;
    const skipped = await runPreRegistrations(headers, {
        config: { enabled: true, campaigns: [campaign] },
        today: '2026-11-01',
        writeLog: () => {},
        register: async () => { calls += 1; }
    });
    assert.equal(calls, 0);
    assert.equal(skipped.success, true);

    const failed = await runPreRegistrations(headers, {
        config: { enabled: true, campaigns: [campaign] },
        today: '2026-10-10',
        writeLog: () => {},
        register: async () => { throw new Error('network'); }
    });
    assert.equal(failed.success, false);
    assert.match(failed.error, /luvplace: network/);

    const outcome = getAutomationOutcome({
        snapshot: { degraded: false }, diff: {}, plan: { groups: [] },
        specialForceResult: { success: true }, preRegistrationResult: failed
    });
    assert.deepEqual(outcome.issues, ['사전등록 확인 필요']);
});

test('wishlist failure is a warning and keeps the registration successful', async () => {
    const logs = [];
    const result = await runPreRegistrations(headers, {
        config: { enabled: true, campaigns: [campaign] },
        today: '2026-10-10',
        writeLog: (message, type) => logs.push({ message, type }),
        register: async () => ({ registered: true, registrationNo: 7 }),
        addWishlist: async () => { throw new Error('wishlist down'); }
    });
    assert.equal(result.success, true);
    assert.equal(result.results[0].wishlistError, 'wishlist down');
    assert.equal(logs.at(-1).type, 'warning');
});

test('campaign stops on its end date without requests or log output', async () => {
    assert.equal(isPreRegistrationActive(campaign, '2026-10-14'), true);
    assert.equal(isPreRegistrationActive(campaign, '2026-10-15'), false);
    assert.equal(isPreRegistrationActive(campaign, '2026-09-30'), false);

    const logs = [];
    let calls = 0;
    const result = await runPreRegistrations(headers, {
        config: { enabled: true, campaigns: [campaign] },
        today: '2026-10-15',
        writeLog: message => logs.push(message),
        register: async () => { calls += 1; }
    });
    assert.equal(calls, 0);
    assert.deepEqual(logs, []);
    assert.deepEqual(result, { success: true, results: [{ key: 'luvplace', skipped: true }], error: undefined });
});

test('configured luvplace campaign ends on 2026-10-15', () => {
    const luvplace = CONFIG.preRegistration.campaigns.find(item => item.key === 'luvplace');
    assert.equal(luvplace.endDate, '2026-10-15');
    assert.equal(isPreRegistrationActive(luvplace, '2026-10-15'), false);
});
