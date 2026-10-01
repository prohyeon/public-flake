import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpecialForceShop, claimSpecialForceReward } from '../../src/api/specialForce.js';
import { specialForceShop } from '../helpers/specialForceFixture.js';

test('service month discovery and claim match the captured route/body and strict response checks', async t => {
    const original = globalThis.GM_xmlhttpRequest;
    t.after(() => { globalThis.GM_xmlhttpRequest = original; });
    const calls = [];
    let malformed = false;
    globalThis.GM_xmlhttpRequest = config => {
        calls.push(config);
        const value = config.url.endsWith('family-links') ? [{ service_id: 'specialforce', progress_month: '202610' }] :
            config.method === 'POST' ? { item_no: 25, category: 'ACCUMULATE_PLAY', flake_amount: 1000 } : specialForceShop();
        config.onload({ status: 200, responseText: malformed ? '<html>login</html>' : JSON.stringify({ code: 0, value }) });
    };
    const headers = { Authorization: 'Bearer fake', 'X-UUID': 'fake-device' };
    const shop = await getSpecialForceShop(headers);
    assert.equal(shop.month, '202610');
    assert.match(calls[1].url, /202610\/services\/specialforce$/);
    await claimSpecialForceReward(headers, shop.accumulated_plays.rewards[0]);
    assert.match(calls[2].url, /attendances\/accumulate-play\/flake\?item_no=25$/);
    assert.deepEqual(JSON.parse(calls[2].data), { item_no: 25 });
    assert.equal(calls[2].headers['caller-id'], 'event-hub');
    assert.equal(calls[2].anonymous, true);
    assert.equal(calls[2].timeout, 15000);
    malformed = true;
    await assert.rejects(() => getSpecialForceShop(headers), /API 확인 실패/);
});
