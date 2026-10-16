// Characterization tests for src/workflows/roulette.js and src/api/roulette.js: they lock in
// today's behavior (quirks included) at the HTTP/GM boundary so refactors can be checked against it.
// Every roulette draw POST spends FLAKE (CONFIG.roulette.drawCost), so draw counts are asserted exactly.
import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, httpError, rawText, TEST_HEADERS } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';
import { runRouletteDraws, claimRouletteExtraRewards, runRoulette } from '../../src/workflows/roulette.js';
import {
    getRouletteSubEventNo, getRouletteExtraSubEventNo, getPrizeEventNo, getPrizeGiftNo, getPrizeFlakeCost,
    getRouletteEventIds, getPrizeInfo, getRouletteParticipationCount, executeRouletteDraw,
    getRouletteExtra, claimRouletteExtra
} from '../../src/api/roulette.js';
import {
    DRAW_EVENT, REWARD_HEADERS, EVENTS_URL,
    participationUrl, drawUrl, extraUrl, extraClaimUrl, applyUrl,
    participation, participationSequence, NO_PARTICIPATION_INFO,
    drawWon, drawError, EVENT_NOT_ACTIVE, milestone, extraStatus, EXTRA_CLAIM_OK
} from '../fixtures/roulette.js';

// Nothing here reads the local calendar, but keep the zone identical to the shop tests.
process.env.TZ = 'Asia/Seoul';

const DRAW_HEADERS = { ...REWARD_HEADERS, 'Content-Type': 'application/json', 'Accept': 'application/json' };
const EXTRA_CLAIM_HEADERS = { ...REWARD_HEADERS, 'Content-Type': 'application/json' };

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const writes = h => h.requests.filter(request => WRITE_METHODS.has(request.method));
const drawPosts = (h, subEventNo = DRAW_EVENT) =>
    h.requests.filter(request => request.method === 'POST' && request.url === drawUrl(subEventNo));
const participationGets = (h, subEventNo = DRAW_EVENT) =>
    h.requests.filter(request => request.method === 'GET' && request.url === participationUrl(subEventNo));

// ---------------------------------------------------------------------------------------------
// runRouletteDraws
// ---------------------------------------------------------------------------------------------

test('runRouletteDraws draws exactly the remaining count, re-checks, and records net profit', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(27, 30));
    h.on('POST', drawUrl(), [drawWon('50 플레이크', 50), drawWon('100 플레이크', 100), drawWon('300 플레이크', 300)]);

    const net = await runRouletteDraws(TEST_HEADERS);

    assert.equal(drawPosts(h).length, 3, 'never more draws than maxDraws - participation_cnt');
    assert.equal(writes(h).length, 3);
    assert.equal(participationGets(h).length, 2);
    assert.equal(net, 450 - 3 * CONFIG.roulette.drawCost);
    assert.equal(state.earnings.roulette, 150);
    assert.equal(state.completed.roulette, true);
    assert.deepEqual(participationGets(h)[0].headers, REWARD_HEADERS);
    for (const request of drawPosts(h)) {
        assert.deepEqual(request.headers, DRAW_HEADERS);
        assert.deepEqual(request.body, { type_no: 1 });
    }
    assert.deepEqual(h.delays, [200, 200, 200, 200]);
    assertGolden('roulette/draws-happy-path', h.snapshot());
});

test('runRouletteDraws reports a negative net profit as a warning', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(28, 30));
    h.on('POST', drawUrl(), [drawWon('10 플레이크', 10), drawWon('20 플레이크', 20)]);

    const net = await runRouletteDraws(TEST_HEADERS);

    assert.equal(drawPosts(h).length, 2);
    assert.equal(net, -170);
    assert.equal(state.earnings.roulette, -170);
    assert.equal(state.completed.roulette, true);
    assert.ok(h.logs().includes('[warning]   📊 순수익: -170 FLAKE'));
    assertGolden('roulette/draws-net-loss', h.snapshot());
});

test('runRouletteDraws sends no draw when today\'s participation is used up', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(30));

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assert.equal(state.earnings.roulette, 0);
    assert.equal(state.completed.roulette, true);
    assertGolden('roulette/draws-already-used-up', h.snapshot());
});

test('runRouletteDraws sends no draw when the server count is above maxDraws', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(35));

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);
    assert.deepEqual(writes(h), []);
    assert.ok(h.logs().includes('[success] ✓ 룰렛 참여 가능 횟수: 0/30 (현재: 35)'));
});

test('runRouletteDraws does nothing over HTTP when roulette is disabled', async t => {
    const h = useHarness(t);
    CONFIG.roulette.enabled = false;

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.deepEqual(h.requests, []);
    assert.equal(state.completed.roulette, true);
    assert.equal(state.earnings.roulette, 0);
    assertGolden('roulette/draws-disabled', h.snapshot());
});

test('runRouletteDraws honors a lowered CONFIG.roulette.maxDraws and treats a missing count as 0', async t => {
    const h = useHarness(t);
    CONFIG.roulette.maxDraws = 5;
    h.on('GET', participationUrl(), participationSequence({ code: 0, message: 'OK', value: {} }, 5));
    h.on('POST', drawUrl(), [
        drawWon('100 플레이크', 100),
        { code: 0, message: 'OK', value: {} },
        drawWon('100 플레이크', 100),
        drawWon('50 플레이크', 50),
        drawWon('1,000 플레이크', 1000)
    ]);

    const net = await runRouletteDraws(TEST_HEADERS);

    assert.equal(drawPosts(h).length, 5);
    // A draw without gift_info still counts as a success worth 0 FLAKE.
    assert.equal(net, 1250 - 5 * 100);
    assert.equal(state.earnings.roulette, 750);
    assert.ok(h.logs().includes('[success] ✓ 룰렛 2/5 완료: 알 수 없음 (0 FLAKE)'));
    assertGolden('roulette/draws-limited-by-config-max-draws', h.snapshot());
});

test('runRouletteDraws with the default config draws at most 30 times from a fresh count', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(0, 30));
    h.on('POST', drawUrl(), drawWon('100 플레이크', 100));

    const net = await runRouletteDraws(TEST_HEADERS);

    assert.equal(drawPosts(h).length, 30);
    assert.equal(net, 0);
    assert.equal(state.earnings.roulette, 0);
    assert.equal(state.completed.roulette, true);
    assert.ok(h.logs().includes('[success]   📊 순수익: +0 FLAKE'));
});

test('runRouletteDraws retries a thrown or non-JSON draw after retryDelay and stops retrying on success', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(29, 30));
    h.on('POST', drawUrl(), [httpError(500), rawText('<html>busy</html>'), drawWon('500 플레이크', 500)]);

    const net = await runRouletteDraws(TEST_HEADERS);

    assert.equal(drawPosts(h).length, 3);
    assert.equal(net, 400);
    assert.equal(state.earnings.roulette, 400);
    assert.deepEqual(h.delays, [1000, 1000, 200, 200]);
    assert.ok(h.logs().includes('[error] ✗ 룰렛 1/1 API 오류 (코드: undefined)'));
    assertGolden('roulette/draws-retry-then-success', h.snapshot());
});

test('runRouletteDraws stops the whole run after maxRetries+1 thrown draws', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(28, 30));
    h.on('POST', drawUrl(), httpError(500));

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.equal(drawPosts(h).length, CONFIG.roulette.maxRetries + 1);
    assert.equal(participationGets(h).length, 1);
    assert.deepEqual(h.delays, [1000, 1000, 1000]);
    assert.equal(state.earnings.roulette, 0);
    assert.equal(state.completed.roulette, true);
    assertGolden('roulette/draws-exception-exhausts-retries-and-stops', h.snapshot());
});

test('runRouletteDraws with maxRetries 0 makes a single attempt before stopping', async t => {
    const h = useHarness(t);
    CONFIG.roulette.maxRetries = 0;
    h.on('GET', participationUrl(), participationSequence(28, 30));
    h.on('POST', drawUrl(), httpError(500));

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);
    assert.equal(drawPosts(h).length, 1);
    assert.deepEqual(h.delays, []);
});

test('runRouletteDraws gives up on a draw after maxRetries error codes but continues with the next draw', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(28, 29, 30));
    h.on('POST', drawUrl(), [
        drawError(9999), drawError(9999), drawError(9999), drawError(9999),
        drawWon('100 플레이크', 100),
        drawWon('200 플레이크', 200)
    ]);

    const net = await runRouletteDraws(TEST_HEADERS);

    assert.equal(drawPosts(h).length, 6);
    assert.equal(net, 300 - 2 * 100);
    assert.equal(state.earnings.roulette, 100);
    // Error codes skip the betweenActions delay; the retry delay applies before each retry.
    assert.deepEqual(h.delays, [1000, 1000, 1000, 200, 200, 200, 200]);
    assertGolden('roulette/draws-error-code-exhausts-retries-then-next-draw', h.snapshot());
});

test('runRouletteDraws keeps re-polling and re-drawing while draws return an error code (bounded only by the server)', async t => {
    // Current behavior: an error code (other than 7019) never stops the run, so the outer loop
    // re-reads the unchanged count and starts over. Here the third participation read ends it.
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(29, 29, NO_PARTICIPATION_INFO));
    h.on('POST', drawUrl(), drawError(9999, '플레이크가 부족합니다'));

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.equal(participationGets(h).length, 3);
    assert.equal(drawPosts(h).length, 2 * (CONFIG.roulette.maxRetries + 1));
    assert.equal(state.earnings.roulette, 0);
    assert.equal(state.completed.roulette, true);
    assertGolden('roulette/draws-persistent-error-code-rerounds', h.snapshot());
});

test('runRouletteDraws re-POSTs a code-0 draw without value and does not count it as a retry', async t => {
    // Current behavior: such a response neither succeeds nor increments retryCount, so the same
    // draw is re-sent until a value arrives (unbounded in src; bounded here by the fixture).
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(29, 30));
    h.on('POST', drawUrl(), [
        { code: 0, message: 'OK', value: null },
        { code: 0, message: 'OK', value: null },
        drawWon('100 플레이크', 100)
    ]);

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.equal(drawPosts(h).length, 3);
    assert.deepEqual(h.delays, [200, 200, 200, 200]);
    assert.ok(!h.logs().some(line => line.includes('재시도')));
    assertGolden('roulette/draws-code0-without-value-reposts', h.snapshot());
});

test('runRouletteDraws stops at the first 7019 (event not active) without retrying', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(0, 30));
    h.on('POST', drawUrl(), EVENT_NOT_ACTIVE);

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.equal(drawPosts(h).length, 1);
    assert.equal(participationGets(h).length, 1);
    assert.deepEqual(h.delays, []);
    assert.equal(state.completed.roulette, true);
    assertGolden('roulette/draws-event-not-active-7019', h.snapshot());
});

test('runRouletteDraws keeps the profit of draws made before a 7019 stop', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(28, 30));
    h.on('POST', drawUrl(), [drawWon('200 플레이크', 200), EVENT_NOT_ACTIVE]);

    const net = await runRouletteDraws(TEST_HEADERS);

    assert.equal(drawPosts(h).length, 2);
    assert.equal(net, 100);
    assert.equal(state.earnings.roulette, 100);
    assert.equal(state.completed.roulette, true);
    assertGolden('roulette/draws-7019-after-success-keeps-net', h.snapshot());
});

test('runRouletteDraws sends no draw when participation info is unavailable', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), NO_PARTICIPATION_INFO);

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assert.equal(state.completed.roulette, true);
    assertGolden('roulette/draws-participation-unavailable', h.snapshot());
});

test('runRouletteDraws logs a failure and completes when the participation request fails', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), httpError(500));

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assert.equal(state.completed.roulette, true);
    assert.ok(h.logs().includes('[error] ✗ 룰렛 실행 실패: API Error: 500 Error'));
    assertGolden('roulette/draws-participation-http-error', h.snapshot());
});

test('runRouletteDraws drops the profit of completed draws when the re-check request fails', async t => {
    // Current behavior: FLAKE was spent on two draws, but the outer catch skips the summary and
    // state.earnings.roulette stays 0.
    const h = useHarness(t);
    h.on('GET', participationUrl(), [participation(28), httpError(500)]);
    h.on('POST', drawUrl(), drawWon('300 플레이크', 300));

    assert.equal(await runRouletteDraws(TEST_HEADERS), 0);

    assert.equal(drawPosts(h).length, 2);
    assert.equal(state.earnings.roulette, 0);
    assert.equal(state.completed.roulette, true);
    assertGolden('roulette/draws-recheck-http-error-drops-earnings', h.snapshot());
});

test('runRouletteDraws trusts the server count: a lagging count leads to extra draws', async t => {
    // 28 -> 2 draws; the server then reports 29 (not 30) -> one more draw. The draw budget is
    // re-derived from the server each round, not tallied locally.
    const h = useHarness(t);
    h.on('GET', participationUrl(), participationSequence(28, 29, 30));
    h.on('POST', drawUrl(), drawWon('100 플레이크', 100));

    const net = await runRouletteDraws(TEST_HEADERS);

    assert.equal(drawPosts(h).length, 3);
    assert.equal(participationGets(h).length, 3);
    assert.equal(net, 0);
    assert.equal(state.earnings.roulette, 0);
    assertGolden('roulette/draws-lagging-server-count-draws-again', h.snapshot());
});

test('runRouletteDraws uses the event id loaded into state over CONFIG.roulette.subEventNo', async t => {
    const h = useHarness(t);
    state.rouletteEvents.draw = '1000000999';
    h.on('GET', participationUrl('1000000999'), participationSequence(29, 30));
    h.on('POST', drawUrl('1000000999'), drawWon('100 플레이크', 100));

    await runRouletteDraws(TEST_HEADERS);

    assert.deepEqual(h.calls(), [
        `GET ${participationUrl('1000000999')}`,
        `POST ${drawUrl('1000000999')} {"type_no":1}`,
        `GET ${participationUrl('1000000999')}`
    ]);
});

// ---------------------------------------------------------------------------------------------
// claimRouletteExtraRewards
// ---------------------------------------------------------------------------------------------

test('claimRouletteExtraRewards claims each reached milestone with received_yn === false exactly once', async t => {
    const h = useHarness(t);
    h.on('GET', extraUrl(), extraStatus({
        currentCnt: 25,
        currentCycle: 2,
        milestones: [
            milestone({ milestone_no: 1, milestone: 5, gift_no: 501, gift_name: '100 플레이크', received_yn: true }),
            milestone({ milestone_no: 2, milestone: 10, gift_no: 502, gift_name: '1,000 플레이크' }),
            milestone({ milestone_no: 3, milestone: 15, gift_no: 503, gift_name: '200 플레이크', received_yn: 'N' }),
            milestone({ milestone_no: 4, milestone: 20, gift_no: 504, gift_name: '스토브 포인트 500P' }),
            milestone({ milestone_no: 5, milestone: 30, gift_no: 505, gift_name: '3,000 플레이크' })
        ]
    }));
    h.on('POST', extraClaimUrl(), EXTRA_CLAIM_OK);

    const earned = await claimRouletteExtraRewards(TEST_HEADERS);

    assert.equal(earned, 1000);
    assert.equal(state.earnings.rouletteExtra, 1000);
    assert.deepEqual(writes(h).map(request => request.body), [
        { gift_no: 502, current_cycle: 2 },
        { gift_no: 504, current_cycle: 2 }
    ]);
    assert.deepEqual(h.requests[0].headers, REWARD_HEADERS);
    for (const request of writes(h)) assert.deepEqual(request.headers, EXTRA_CLAIM_HEADERS);
    assertGolden('roulette/extra-claims-reached-unreceived-milestones', h.snapshot());
});

test('claimRouletteExtraRewards with nothing claimable returns early without touching earnings', async t => {
    const h = useHarness(t);
    state.earnings.rouletteExtra = 777;
    h.on('GET', extraUrl(), extraStatus({
        currentCnt: 12,
        milestones: [
            milestone({ milestone_no: 1, milestone: 10, gift_no: 501, received_yn: true }),
            milestone({ milestone_no: 2, milestone: 20, gift_no: 502 })
        ]
    }));

    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assert.equal(state.earnings.rouletteExtra, 777);
    assertGolden('roulette/extra-nothing-claimable-leaves-state', h.snapshot());
});

test('claimRouletteExtraRewards returns early on an API error code', async t => {
    const h = useHarness(t);
    h.on('GET', extraUrl(), { code: 40100, message: 'Unauthorized', value: null });

    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assertGolden('roulette/extra-api-error-code', h.snapshot());
});

test('claimRouletteExtraRewards reports "Unknown error" for an error without message and for non-JSON', async t => {
    const h = useHarness(t);
    h.on('GET', extraUrl(), [{ code: 500 }, rawText('<html>maintenance</html>')]);

    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 0);
    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assert.deepEqual(h.logs().filter(line => line.startsWith('[warning]')), [
        '[warning] ⚠️ 룰렛 EXTRA API 오류: Unknown error',
        '[warning] ⚠️ 룰렛 EXTRA API 오류: Unknown error'
    ]);
});

test('claimRouletteExtraRewards returns early on a null response', async t => {
    const h = useHarness(t);
    h.on('GET', extraUrl(), rawText('null'));

    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assertGolden('roulette/extra-null-response', h.snapshot());
});

test('claimRouletteExtraRewards warns about a response without milestones and records 0', async t => {
    const h = useHarness(t);
    state.earnings.rouletteExtra = 777;
    h.on('GET', extraUrl(), { code: 0, message: 'OK', value: { current_cnt: 3 } });

    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assert.equal(state.earnings.rouletteExtra, 0);
    assertGolden('roulette/extra-response-without-milestones', h.snapshot());
});

test('claimRouletteExtraRewards counts only successful claims and continues after failures', async t => {
    const h = useHarness(t);
    h.on('GET', extraUrl(), extraStatus({
        currentCnt: 30,
        milestones: [
            milestone({ milestone_no: 11, milestone: 10, gift_no: 601, gift_name: '500 플레이크' }),
            milestone({ milestone_no: 12, milestone: 20, gift_no: 602, gift_name: '700 플레이크' }),
            milestone({ milestone_no: 13, milestone: 30, gift_no: 603, gift_name: '900 플레이크' })
        ]
    }));
    h.on('POST', extraClaimUrl(), [EXTRA_CLAIM_OK, { code: 7020, message: '이미 수령' }, httpError(500)]);

    const earned = await claimRouletteExtraRewards(TEST_HEADERS);

    assert.equal(earned, 500);
    assert.equal(state.earnings.rouletteExtra, 500);
    assert.deepEqual(writes(h).map(request => request.body.gift_no), [601, 602, 603]);
    assert.deepEqual(h.delays, [200, 200]);
    assertGolden('roulette/extra-claim-failures', h.snapshot());
});

test('claimRouletteExtraRewards logs a failure and records 0 when the status request fails', async t => {
    const h = useHarness(t);
    h.on('GET', extraUrl(), httpError(500));

    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 0);

    assert.deepEqual(writes(h), []);
    assert.equal(state.earnings.rouletteExtra, 0);
    assertGolden('roulette/extra-fetch-http-error', h.snapshot());
});

test('claimRouletteExtraRewards defaults missing current_cnt/current_cycle to 0 and a missing gift_name to 0 FLAKE', async t => {
    const h = useHarness(t);
    h.on('GET', extraUrl(), {
        code: 0,
        message: 'OK',
        value: {
            milestones: [
                { milestone_no: 1, milestone: 0, gift_no: 700, received_yn: false },
                milestone({ milestone_no: 2, milestone: 1, gift_no: 701 })
            ]
        }
    });
    h.on('POST', extraClaimUrl(), EXTRA_CLAIM_OK);

    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 0);

    assert.deepEqual(h.calls().slice(1), [`POST ${extraClaimUrl()} {"gift_no":700,"current_cycle":0}`]);
    assert.ok(h.logs().includes('[success] ✓ EXTRA 수령 완료: undefined (0 FLAKE)'));
    assert.equal(state.earnings.rouletteExtra, 0);
});

test('claimRouletteExtraRewards uses the extra event id loaded into state', async t => {
    const h = useHarness(t);
    state.rouletteEvents.extra = '1000000998';
    h.on('GET', extraUrl('1000000998'), extraStatus({ currentCnt: 10, milestones: [milestone()] }));
    h.on('POST', extraClaimUrl('1000000998'), EXTRA_CLAIM_OK);

    assert.equal(await claimRouletteExtraRewards(TEST_HEADERS), 100);
    assert.deepEqual(h.calls(), [
        `GET ${extraUrl('1000000998')}`,
        `POST ${extraClaimUrl('1000000998')} {"gift_no":5001,"current_cycle":1}`
    ]);
});

// ---------------------------------------------------------------------------------------------
// runRoulette
// ---------------------------------------------------------------------------------------------

const PANEL_WITH_BUTTONS = `
    <div id="stove-quest-automation">
        <div class="stove-progress-section">
            <div class="stove-progress-fill"></div>
            <div id="stove-progress-text"></div>
        </div>
        <button id="stove-btn-start">시작</button>
        <button id="stove-btn-reward-shop">리워드샵</button>
        <div class="stove-log-section"><div id="stove-log-content"></div></div>
    </div>`;

test('runRoulette runs the draws with cookie headers while the buttons are disabled', async t => {
    const h = useHarness(t, { body: PANEL_WITH_BUTTONS });
    const duringRun = [];
    h.on('GET', participationUrl(), (request, callIndex) => {
        duringRun.push({
            isRunning: state.isRunning,
            startDisabled: h.document.getElementById('stove-btn-start').disabled
        });
        return callIndex === 0 ? participation(29) : participation(30);
    });
    h.on('POST', drawUrl(), drawWon('100 플레이크', 100));

    assert.equal(await runRoulette(), undefined);

    assert.deepEqual(duringRun, [{ isRunning: true, startDisabled: true }, { isRunning: true, startDisabled: true }]);
    assert.equal(state.isRunning, false);
    assert.equal(h.document.getElementById('stove-btn-start').disabled, false);
    assert.equal(h.document.getElementById('stove-btn-start').style.opacity, '1');
    assert.equal(drawPosts(h).length, 1);
    assert.deepEqual(h.requests[0].headers, REWARD_HEADERS);
    assert.equal(state.completed.roulette, true);
    assertGolden('roulette/run-roulette', h.snapshot());
});

test('runRoulette does nothing while another run is in progress', async t => {
    const h = useHarness(t);
    state.isRunning = true;

    assert.equal(await runRoulette(), undefined);

    assert.deepEqual(h.requests, []);
    assert.equal(state.isRunning, true);
    assertGolden('roulette/run-roulette-already-running', h.snapshot());
});

test('runRoulette logs the error and resets isRunning when the auth cookie is missing', async t => {
    const h = useHarness(t, { cookies: {} });

    await runRoulette();

    assert.deepEqual(h.requests, []);
    assert.equal(state.isRunning, false);
    assert.ok(h.logs().includes('[error] ✗ 오류 발생: Authorization token (SUAT) not found'));
    assertGolden('roulette/run-roulette-missing-auth', h.snapshot());
});

// ---------------------------------------------------------------------------------------------
// api/roulette.js: id getters
// ---------------------------------------------------------------------------------------------

test('event id getters prefer ids loaded into state over CONFIG', t => {
    useHarness(t);
    assert.equal(getRouletteSubEventNo(), '1000000353');
    assert.equal(getRouletteExtraSubEventNo(), '1000000357');
    assert.equal(getPrizeEventNo(), 1000000354);
    assert.equal(getPrizeGiftNo(), 1000001776);
    assert.equal(getPrizeFlakeCost(), 500);

    state.rouletteEvents = { draw: '1', extra: '2', apply: '3', checkIn: '4' };
    assert.equal(getRouletteSubEventNo(), '1');
    assert.equal(getRouletteExtraSubEventNo(), '2');
    assert.equal(getPrizeEventNo(), '3');

    state.prizeInfo.eventNo = '30';
    state.prizeInfo.giftNo = 31;
    state.prizeInfo.flakeCost = 32;
    assert.equal(getPrizeEventNo(), '30');
    assert.equal(getPrizeGiftNo(), 31);
    assert.equal(getPrizeFlakeCost(), 32);
});

// ---------------------------------------------------------------------------------------------
// api/roulette.js: getRouletteEventIds
// ---------------------------------------------------------------------------------------------

test('getRouletteEventIds GETs the FLAKE_WEB events and replaces state.rouletteEvents with string ids', async t => {
    const h = useHarness(t);
    const previous = state.rouletteEvents;
    h.on('GET', EVENTS_URL, {
        code: 0,
        message: 'OK',
        value: {
            draw_info: { sub_event_no: 1000000400 },
            extra_info: { sub_event_no: 1000000401 },
            apply_info: { sub_event_no: 1000000402 },
            check_in_info: { sub_event_no: 1000000403 }
        }
    });

    const events = await getRouletteEventIds(TEST_HEADERS);

    const expected = { draw: '1000000400', extra: '1000000401', apply: '1000000402', checkIn: '1000000403' };
    assert.deepEqual(events, expected);
    assert.equal(state.rouletteEvents, events, 'state.rouletteEvents is replaced by the returned object');
    assert.notEqual(state.rouletteEvents, previous);
    assert.deepEqual(h.requests, [{
        method: 'GET',
        url: EVENTS_URL,
        headers: { ...REWARD_HEADERS, 'Accept': 'application/json' },
        body: null
    }]);
});

test('getRouletteEventIds leaves missing event sections null', async t => {
    const h = useHarness(t);
    h.on('GET', EVENTS_URL, { code: 0, message: 'OK', value: { draw_info: { sub_event_no: 1000000400 }, extra_info: {} } });

    assert.deepEqual(await getRouletteEventIds(TEST_HEADERS),
        { draw: '1000000400', extra: null, apply: null, checkIn: null });
    assert.deepEqual(state.rouletteEvents, { draw: '1000000400', extra: null, apply: null, checkIn: null });
});

test('getRouletteEventIds returns null and keeps state on error code, missing value, or HTTP failure', async t => {
    const h = useHarness(t);
    h.on('GET', EVENTS_URL, [
        { code: 40100, message: 'Unauthorized' },
        { code: 0, message: 'OK', value: null },
        httpError(500)
    ]);
    state.rouletteEvents.draw = 'kept';

    assert.equal(await getRouletteEventIds(TEST_HEADERS), null);
    assert.equal(await getRouletteEventIds(TEST_HEADERS), null);
    assert.equal(await getRouletteEventIds(TEST_HEADERS), null);

    assert.deepEqual(state.rouletteEvents, { draw: 'kept', extra: null, apply: null, checkIn: null });
    assert.equal(h.requests.length, 3);
});

// ---------------------------------------------------------------------------------------------
// api/roulette.js: getPrizeInfo
// ---------------------------------------------------------------------------------------------

test('getPrizeInfo reads the apply event and picks the "5,000 ... 포인트" gift', async t => {
    const h = useHarness(t);
    const prizeInfo = state.prizeInfo;
    state.rouletteEvents.apply = '1000000402';
    h.on('GET', applyUrl('1000000402'), {
        code: 0,
        message: 'OK',
        value: {
            sub_event_no: 1000000402,
            participation_method_list: [{ participation_amount: 300 }, { participation_amount: 900 }],
            gift_list: [
                { gift_no: 1, gift_name: '스토브 1,000 포인트' },
                { gift_no: 2, gift_name: '5,000 플레이크' },
                { gift_no: 3, gift_name: '스토브 5,000 포인트' },
                { gift_no: 4, gift_name: '스토브 5,000 포인트 (추가)' }
            ]
        }
    });

    const result = await getPrizeInfo(TEST_HEADERS);

    assert.equal(result, prizeInfo, 'returns the state.prizeInfo object, updated in place');
    assert.deepEqual(result, { eventNo: '1000000402', giftNo: 3, giftName: '스토브 5,000 포인트', flakeCost: 300 });
    assert.deepEqual(h.requests, [{ method: 'GET', url: applyUrl('1000000402'), headers: REWARD_HEADERS, body: null }]);
});

test('getPrizeInfo falls back to CONFIG.prizeEntry.eventNo and only sets what the response has', async t => {
    const h = useHarness(t);
    h.on('GET', applyUrl(1000000354), [
        { code: 0, message: 'OK', value: { sub_event_no: 1000000354, gift_list: [{ gift_no: 9, gift_name: '스토브 1,000 포인트' }] } },
        { code: 0, message: 'OK', value: {} }
    ]);

    assert.deepEqual(await getPrizeInfo(TEST_HEADERS), { eventNo: '1000000354', giftNo: null, giftName: null, flakeCost: null });
    // A value without sub_event_no stores the string "undefined" as the event number.
    assert.deepEqual(await getPrizeInfo(TEST_HEADERS), { eventNo: 'undefined', giftNo: null, giftName: null, flakeCost: null });
    assert.equal(getPrizeEventNo(), 'undefined');
    assert.equal(h.requests.length, 2);
});

test('getPrizeInfo returns null and keeps state on error code or HTTP failure', async t => {
    const h = useHarness(t);
    h.on('GET', applyUrl(1000000354), [{ code: 40100, message: 'Unauthorized' }, httpError(500)]);

    assert.equal(await getPrizeInfo(TEST_HEADERS), null);
    assert.equal(await getPrizeInfo(TEST_HEADERS), null);
    assert.deepEqual(state.prizeInfo, { eventNo: null, giftNo: null, giftName: null, flakeCost: null });
    assert.equal(h.requests.length, 2);
});

// ---------------------------------------------------------------------------------------------
// api/roulette.js: request contracts
// ---------------------------------------------------------------------------------------------

test('getRouletteParticipationCount GETs the count with flake-fe headers and rethrows failures', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl('42'), [participation(3), httpError(503)]);

    assert.deepEqual(await getRouletteParticipationCount(TEST_HEADERS, '42'), participation(3));
    await assert.rejects(getRouletteParticipationCount(TEST_HEADERS, '42'), /API Error: 503/);

    assert.deepEqual(h.requests[0], { method: 'GET', url: participationUrl('42'), headers: REWARD_HEADERS, body: null });
});

test('executeRouletteDraw POSTs type_no 1 and returns error-code responses unchanged', async t => {
    const h = useHarness(t);
    const unknownError = { code: 1234 };
    h.on('POST', drawUrl('42'), [drawWon('100 플레이크', 100), EVENT_NOT_ACTIVE, unknownError, httpError(500)]);

    assert.deepEqual(await executeRouletteDraw(TEST_HEADERS, '42'), drawWon('100 플레이크', 100));
    assert.deepEqual(await executeRouletteDraw(TEST_HEADERS, '42'), EVENT_NOT_ACTIVE);
    assert.deepEqual(await executeRouletteDraw(TEST_HEADERS, '42'), unknownError);
    await assert.rejects(executeRouletteDraw(TEST_HEADERS, '42'), /API Error: 500/);

    assert.equal(h.requests.length, 4, 'no retries inside the API function');
    assert.deepEqual(h.requests[0], { method: 'POST', url: drawUrl('42'), headers: DRAW_HEADERS, body: { type_no: 1 } });
});

test('getRouletteExtra and claimRouletteExtra contracts', async t => {
    const h = useHarness(t);
    const status = extraStatus({ currentCnt: 1, milestones: [] });
    h.on('GET', extraUrl('42'), [status, httpError(500)])
        .on('POST', extraClaimUrl('42'), EXTRA_CLAIM_OK);

    assert.deepEqual(await getRouletteExtra(TEST_HEADERS, '42'), status);
    await assert.rejects(getRouletteExtra(TEST_HEADERS, '42'), /API Error: 500/);
    assert.deepEqual(await claimRouletteExtra(TEST_HEADERS, '42', 777, 3), EXTRA_CLAIM_OK);

    assert.deepEqual(h.requests[0], { method: 'GET', url: extraUrl('42'), headers: REWARD_HEADERS, body: null });
    assert.deepEqual(h.requests[2], {
        method: 'POST',
        url: extraClaimUrl('42'),
        headers: EXTRA_CLAIM_HEADERS,
        body: { gift_no: 777, current_cycle: 3 }
    });
});

test('flake-fe headers fall back to the caller-detail header when X-UUID is absent', async t => {
    const h = useHarness(t);
    h.on('GET', participationUrl(), participation(0));

    await getRouletteParticipationCount({ 'Authorization': 'Bearer other', 'caller-detail': 'detail-from-caller' }, DRAW_EVENT);

    assert.deepEqual(h.requests[0].headers, {
        ...REWARD_HEADERS,
        'Authorization': 'Bearer other',
        'caller-detail': 'detail-from-caller'
    });
});
