// Per-account capsule draw setting: the bot (SGManager) answers on 127.0.0.1, the script reads it
// with GM_xmlhttpRequest. Any failure must fall back to the 100뽑기 default, which is the old behavior.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetState } from '../helpers/gmHarness.js';
import { state } from '../../src/state.js';
import {
    CAPSULE_TIER_URL, memberNoFromPath, parseCapsuleTier, requestCapsuleTier,
    resolveCapsuleTier, capsuleDrawSpec
} from '../../src/api/capsuleTier.js';
import { runRouletteDraws } from '../../src/workflows/roulette.js';

beforeEach(() => resetState());

// A fake GM_xmlhttpRequest that answers synchronously through the callbacks it is given.
function fakeGm(respond) {
    const calls = [];
    const gm = config => {
        calls.push(config);
        respond(config);
    };
    return { gm, calls };
}

test('memberNoFromPath reads the trailing number of the profile path', () => {
    assert.equal(memberNoFromPath('/ko/100000001'), '100000001');
    assert.equal(memberNoFromPath('/ko/100000001/'), '100000001');
    assert.equal(memberNoFromPath('/ko/'), null);
    assert.equal(memberNoFromPath(''), null);
    assert.equal(memberNoFromPath(undefined), null);
});

test('parseCapsuleTier accepts only the three known tiers', () => {
    assert.equal(parseCapsuleTier('off'), 'off');
    assert.equal(parseCapsuleTier('100'), '100');
    assert.equal(parseCapsuleTier('1000'), '1000');
    assert.equal(parseCapsuleTier(1000), null);
    assert.equal(parseCapsuleTier('fast'), null);
    assert.equal(parseCapsuleTier(undefined), null);
});

test('requestCapsuleTier asks the bot for the member number and returns its tier', async () => {
    const { gm, calls } = fakeGm(config => config.onload({ status: 200, responseText: '{"tier":"1000"}' }));

    assert.equal(await requestCapsuleTier('100000001', { gmRequest: gm }), '1000');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, `${CAPSULE_TIER_URL}?member_no=100000001`);
    assert.equal(calls[0].timeout, 2000);
});

test('requestCapsuleTier returns null when the bot has no value for the account', async () => {
    const { gm } = fakeGm(config => config.onload({ status: 200, responseText: '{"tier":null}' }));
    assert.equal(await requestCapsuleTier('1', { gmRequest: gm }), null);
});

test('requestCapsuleTier returns null on HTTP errors, network errors, timeouts, and bad JSON', async () => {
    const httpError = fakeGm(config => config.onload({ status: 400, responseText: '{"error":"bad_member_no"}' }));
    assert.equal(await requestCapsuleTier('x', { gmRequest: httpError.gm }), null);

    const networkError = fakeGm(config => config.onerror({}));
    assert.equal(await requestCapsuleTier('1', { gmRequest: networkError.gm }), null);

    const timeout = fakeGm(config => config.ontimeout({}));
    assert.equal(await requestCapsuleTier('1', { gmRequest: timeout.gm }), null);

    const badJson = fakeGm(config => config.onload({ status: 200, responseText: 'not json' }));
    assert.equal(await requestCapsuleTier('1', { gmRequest: badJson.gm }), null);

    const throwing = fakeGm(() => { throw new Error('boom'); });
    assert.equal(await requestCapsuleTier('1', { gmRequest: throwing.gm }), null);
});

test('requestCapsuleTier returns null when GM_xmlhttpRequest is unavailable', async () => {
    assert.equal(await requestCapsuleTier('1', { gmRequest: undefined }), null);
});

test('resolveCapsuleTier falls back to 100뽑기 without a profile number or without the bot', async () => {
    assert.equal(await resolveCapsuleTier('/', {}), '100');

    const { gm } = fakeGm(config => config.onerror({}));
    assert.equal(await resolveCapsuleTier('/ko/100000001', { gmRequest: gm }), '100');
});

test('resolveCapsuleTier uses the bot value when it is available', async () => {
    const { gm } = fakeGm(config => config.onload({ status: 200, responseText: '{"tier":"off"}' }));
    assert.equal(await resolveCapsuleTier('/ko/100000001', { gmRequest: gm }), 'off');
});

test('capsuleDrawSpec maps tiers to the draw option and cost seen in the HAR captures', () => {
    assert.deepEqual(capsuleDrawSpec('100'), { typeNo: 1, cost: 100, label: '100뽑기' });
    assert.deepEqual(capsuleDrawSpec('1000'), { typeNo: 2, cost: 1000, label: '1000뽑기' });
});

// ------------------------------------------------------------------ roulette workflow

const participation = count => ({ code: 0, message: 'OK', value: { participation_cnt: count } });
const drawWon = (gift, price) => ({
    code: 0, message: 'OK', value: { gift_info: { gift_name: gift, gift_price: price } }
});

// Starts one draw short of the daily cap so each test runs exactly one draw.
function fakeIo(tier, draws = [], startCount = 29) {
    const logs = [];
    const drawCalls = [];
    let count = startCount;
    return {
        logs,
        drawCalls,
        io: {
            resolveCapsuleTier: async () => tier,
            getRouletteParticipationCount: async () => participation(count),
            executeRouletteDraw: async (headers, subEventNo, typeNo) => {
                drawCalls.push({ subEventNo, typeNo });
                count++;
                return draws.shift() ?? drawWon('10 플레이크', 10);
            },
            getRouletteExtra: async () => null,
            claimRouletteExtra: async () => null,
            delay: async () => {},
            log: (message, level) => logs.push(`[${level}] ${message}`),
        },
    };
}

test('a 끔 setting draws nothing and marks the roulette done', async () => {
    const { io, drawCalls, logs } = fakeIo('off');
    const result = await runRouletteDraws({}, io);

    assert.equal(result, 0);
    assert.deepEqual(drawCalls, []);
    assert.equal(state.completed.roulette, true);
    assert.ok(logs.some(line => line.includes('캡슐 뽑기 끔')));
});

test('a 1000뽑기 setting sends type_no 2 and charges 1000 per draw in the net profit', async () => {
    const { io, drawCalls, logs } = fakeIo('1000', [drawWon('2,000 플레이크', 2000)]);
    const result = await runRouletteDraws({}, io);

    assert.equal(drawCalls.length, 1);
    assert.equal(drawCalls[0].typeNo, 2);
    assert.equal(result, 2000 - 1000);
    assert.ok(logs.some(line => line.includes('캡슐 뽑기: 1000뽑기')));
});

test('the default 100뽑기 keeps sending type_no 1 and charging 100 per draw', async () => {
    const { io, drawCalls } = fakeIo('100', [drawWon('50 플레이크', 50)]);
    const result = await runRouletteDraws({}, io);

    assert.deepEqual(drawCalls.map(call => call.typeNo), [1]);
    assert.equal(result, 50 - 100);
});
