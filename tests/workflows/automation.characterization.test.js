// Characterization tests for src/workflows/automation.js (runAutomation end-to-end and the task
// handlers) and src/utils/audio.js. They lock in CURRENT behavior, quirks
// included, so the planned refactors (mission runner dedupe, deps injection, header/URL dedupe,
// state helpers, dead-code removal) can be checked against them. Everything is driven through
// public exports and observed at the HTTP/tab/title/log/storage boundary.
//
// runAutomation runs task groups with bounded concurrency, so whole-run goldens compare sorted
// multisets; order is asserted only where it is serial by design.

// The shop "today" filters and the monthly-flake tz_offset use LOCAL time.
// Pin the zone so the goldens do not depend on the machine running them.
process.env.TZ = 'Asia/Seoul';

import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, httpError, TEST_HEADERS, DEFAULT_NOW } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import {
    installAutomationWorld, failFirst,
    REWARD_SHOP_TAB, SINGLE_VISIT_URL, PRIZE_MISSION_NO, USER_ID
} from '../fixtures/automationWorld.js';
import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';
import { runAutomation, createAutomationTaskHandlers, bindTaskHandlers } from '../../src/workflows/automation.js';
import { playCompletionSound } from '../../src/utils/audio.js';

const API = 'https://api.onstove.com';
const RUNNING_TITLE = '[SG_RUNNING] 전체 자동화 실행 중 | STOVE';
const DONE_TITLE = '[SG_DONE] 전체 자동화 완료 | STOVE';

// The same account after a complete run earlier today (monthly attendance already recorded).
const DONE_WORLD = Object.freeze({
    missions: 'done',
    rouletteUsed: 30, rouletteExtraReceived: [10, 20, 30], dailyShopClaimed: true, majakClaimed: true,
    attendanceTrigger: 'never'
});
const MONTHLY_RECORD_KEY = `stove-monthly-attendance-v1:${USER_ID}`;

const pathOf = url => new URL(url).pathname;
const isWrite = request => request.method !== 'GET';
const isDraw = request => request.method === 'POST' && /^\/emsbackapi\/v3\.0\/draw\//.test(pathOf(request.url));
const isPrizeApply = request => request.method === 'POST' && /^\/emsbackapi\/v3\.0\/apply\//.test(pathOf(request.url));
const isExtraClaim = request => request.method === 'POST' && /^\/emsbackapi\/v3\.0\/extra\//.test(pathOf(request.url));
const isParticipate = request => request.method === 'POST' && pathOf(request.url) === '/flake-shop/v1/mission/participate';
const describe = request => `${request.method} ${pathOf(request.url)}${request.body ? ` ${JSON.stringify(request.body)}` : ''}`;

function assertTimezonePinned() {
    assert.equal(new Date(DEFAULT_NOW).getTimezoneOffset(), -540, 'tests must run in Asia/Seoul');
}
// Fail the whole file loudly (instead of with a tz_offset golden diff) if the pin did not apply.
assertTimezonePinned();

// FLAKE-spending endpoints: roulette draws (100 each), prize entry (500), point/cash exchange.
function assertFlakeSpendingWithinLimits(h, world, rouletteUsedBefore) {
    const draws = h.requests.filter(isDraw).length;
    assert.ok(draws <= CONFIG.roulette.maxDraws - rouletteUsedBefore,
        `roulette draws ${draws} exceed the remaining ${CONFIG.roulette.maxDraws - rouletteUsedBefore}`);
    assert.equal(world.audit.overDraws, 0, 'no draw beyond the daily limit');
    assert.ok(h.requests.filter(isPrizeApply).length <= 1, 'at most one prize entry per run');
    assert.deepEqual(h.requests.filter(request =>
        /^\/(mileage\/v1\.0\/exchange|pay\/|point\/)/.test(pathOf(request.url))).map(describe), [],
    'automation never exchanges points or charges cash');
}

function assertNoRewardClaimedTwice(world) {
    assert.deepEqual(world.audit.duplicateClaims, [], 'no reward is claimed after it was already received');
    assert.deepEqual(world.audit.prematureClaims, [], 'no reward is claimed before it is earned');
    assert.equal(new Set(world.audit.missionClaims).size, world.audit.missionClaims.length);
}

// The summary block printed after every completed run, rebuilt from state.earnings.
function expectedSummaryLogs({ earnings }) {
    const total = Object.values(earnings).reduce((sum, value) => sum + (value || 0), 0);
    const sign = total >= 0 ? '+' : '';
    const level = value => (value > 0 ? 'success' : 'info');
    return [
        '[info] ═══════════════════════════════════════',
        '[success] 최종 FLAKE 수익 요약',
        '[info] ═══════════════════════════════════════',
        `[${level(earnings.dailyMissions)}]   데일리 미션: ${earnings.dailyMissions} FLAKE`,
        `[${level(earnings.visitMissions || 0)}]   방문 미션: ${earnings.visitMissions || 0} FLAKE`,
        `[${level(earnings.contentMissions)}]   컨텐츠 미션: ${earnings.contentMissions} FLAKE`,
        `[${level(earnings.weeklyMissions)}]   위클리 미션: ${earnings.weeklyMissions} FLAKE`,
        `[${level(earnings.bannerMissions)}]   배너 미션: ${earnings.bannerMissions} FLAKE`,
        `[${level(earnings.attendanceMissions)}]   출석 미션: ${earnings.attendanceMissions} FLAKE`,
        `[${level(earnings.surveyMissions)}]   설문조사: ${earnings.surveyMissions} FLAKE`,
        `[${earnings.prizeEntry >= 0 ? 'success' : 'warning'}]   경품 응모: ${earnings.prizeEntry >= 0 ? '+' : ''}${earnings.prizeEntry} FLAKE`,
        `[${earnings.roulette >= 0 ? 'success' : 'warning'}]   룰렛 순수익: ${earnings.roulette >= 0 ? '+' : ''}${earnings.roulette} FLAKE`,
        `[${level(earnings.rouletteExtra)}]   룰렛 EXTRA: ${earnings.rouletteExtra} FLAKE`,
        `[${level(earnings.dailyShop)}]   데일리 보상: ${earnings.dailyShop} FLAKE`,
        `[${level(earnings.dailyAccumulated)}]   데일리 누적 보상: ${earnings.dailyAccumulated} FLAKE`,
        `[${level(earnings.majak)}]   마작 리워드: ${earnings.majak} FLAKE`,
        '[info] ───────────────────────────────────────',
        `[${total >= 0 ? 'success' : 'warning'}]   총 순수익: ${sign}${total} FLAKE`,
        '[info] ═══════════════════════════════════════'
    ];
}

function assertSummaryMatchesState(h) {
    const logs = h.logs();
    const start = logs.indexOf('[success] 최종 FLAKE 수익 요약') - 1;
    assert.ok(start >= 0, 'summary block is printed');
    const expected = expectedSummaryLogs(state);
    assert.deepEqual(logs.slice(start, start + expected.length), expected);
}

// Group lines end with their elapsed time (src/workflows/runTiming.js). Behavior checks compare the
// lines without it; the timing text itself is pinned in the "runAutomation timing" tests.
const withoutElapsed = line => line.replace(/ · (?:대기 )?\d+\.\d초.*$/, '');
const groupLogs = h => h.logs()
    .filter(line => /(그룹|복구) (시작|완료)|복구 그룹|백그라운드 작업/.test(line))
    .map(withoutElapsed);

test('completion sound plays through AudioContext, falls back to webkitAudioContext, and never throws', t => {
    const h = useHarness(t);
    playCompletionSound();
    assert.equal(h.sounds.length, 1);

    const FakeAudioContext = h.window.AudioContext;
    h.window.webkitAudioContext = FakeAudioContext;
    delete h.window.AudioContext;
    playCompletionSound();
    assert.equal(h.sounds.length, 2, 'webkit-prefixed constructor is used when AudioContext is missing');

    delete h.window.webkitAudioContext;
    assert.doesNotThrow(() => playCompletionSound());
    assert.equal(h.sounds.length, 2);
    assert.deepEqual(h.logs(), [], 'a failed sound is not reported in the panel');
});

// ---------------------------------------------------------------------------------------------
// createAutomationTaskHandlers / bindTaskHandlers
// ---------------------------------------------------------------------------------------------

test('handlers collect page/daily/content/banner tabs for closing, but not single-visit tabs', async t => {
    const h = useHarness(t);
    installAutomationWorld(h);
    const allTabs = [];
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS, articles: [], allTabs });

    await handlers.componentRefresh();
    assert.deepEqual(await handlers.singleVisits({ missionNos: [1001, 1002] }), {
        success: true, participated: 1, completed: 2, skipped: 0, total: 2, targeted: true, targetMissionNos: [1001, 1002]
    });
    assert.deepEqual(await handlers.requiredPages(), { tabCount: 2 });
    assert.deepEqual(await handlers.dailyMissions(), { tabCount: 0 });
    assert.deepEqual(await handlers.contentMissions(), { tabCount: 1 });
    assert.deepEqual(await handlers.bannerMissions(), { tabCount: 1 });
    assert.equal(await handlers.weeklyMissions(), undefined);
    assert.equal(await handlers.attendanceMissions(), undefined);
    assert.equal(await handlers.surveyMissions(), undefined);

    assert.equal(allTabs.length, 4);
    assert.deepEqual(h.tabs.map(tab => tab.url), [
        SINGLE_VISIT_URL,
        'https://reward.onstove.com/ko',
        'https://store.onstove.com/',
        'https://page.onstove.com/indie/kr/view/2001',
        'https://store.onstove.com/ko/banner/5001'
    ]);
    assert.deepEqual(state.earnings, { ...state.earnings,
        dailyMissions: 0, contentMissions: 20, bannerMissions: 15, weeklyMissions: 100, attendanceMissions: 30, surveyMissions: 5 });
});

test('handler eventRefresh: loads prize info only while prize entry is enabled', async t => {
    const h = useHarness(t);
    installAutomationWorld(h);
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS });
    const events = { draw: '1000000353', extra: '1000000357', apply: '1000000354', checkIn: '1000000355' };

    CONFIG.prizeEntry.enabled = false;
    assert.deepEqual(await handlers.eventRefresh(), events);
    CONFIG.prizeEntry.enabled = true;
    assert.deepEqual(await handlers.eventRefresh(), events);
    assert.deepEqual(h.requests.map(describe), [
        'GET /emsbackapi/v3.0/events', 'GET /emsbackapi/v3.0/events', 'GET /emsbackapi/v3.0/apply'
    ]);
    assert.deepEqual(state.prizeInfo, { eventNo: '1000000354', giftNo: 1000001776, giftName: '스토브 5,000 포인트', flakeCost: 500 });
});

test('handler rouletteDraws: never draws past the daily limit (0 → 30)', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h, { rouletteUsed: 0 });
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS });

    await handlers.rouletteDraws();
    assert.equal(h.requests.filter(isDraw).length, 30);
    assert.equal(world.audit.overDraws, 0);
    assert.equal(h.requests.filter(request => pathOf(request.url) === '/emsbackapi/v3.0/participationCnt').length, 2,
        'one read before drawing and one confirming read');
    assert.equal(state.earnings.roulette, (300 + 50 + 150 + 100) * 7 + 300 + 50 - 3000);
    await handlers.rouletteExtra();
    assert.deepEqual(world.audit.extraClaims, [73]);
    assertFlakeSpendingWithinLimits(h, world, 0);
});

test('bindTaskHandlers keeps only tasks with a handler and drops emptied groups', async () => {
    const calls = [];
    const plan = {
        plannedMissionNos: [1],
        groups: [
            { id: 'a', concurrency: 2, tasks: [{ id: 'a:1', kind: 'known' }, { id: 'a:2', kind: 'unknown' }] },
            { id: 'b', concurrency: 1, tasks: [{ id: 'b:1', kind: 'unknown' }] },
            { id: 'c', concurrency: 1 }
        ]
    };
    const bound = bindTaskHandlers(plan, { known: async task => { calls.push(task.id); return 'ran'; } });

    assert.deepEqual(bound.plannedMissionNos, [1]);
    assert.deepEqual(bound.groups.map(group => ({ ...group, tasks: group.tasks.map(({ run, ...task }) => task) })),
        [{ id: 'a', concurrency: 2, tasks: [{ id: 'a:1', kind: 'known' }] }]);
    assert.equal(await bound.groups[0].tasks[0].run(), 'ran');
    assert.deepEqual(calls, ['a:1']);
    assert.deepEqual(bindTaskHandlers(), { groups: [] });
});

// ---------------------------------------------------------------------------------------------
// runAutomation: guards and early exits
// ---------------------------------------------------------------------------------------------

test('runAutomation: a second start while running only warns', async t => {
    const h = useHarness(t);
    state.isRunning = true;
    await runAutomation();

    assert.deepEqual(h.logs(), ['[warning] 이미 자동화가 실행 중입니다']);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.titles, []);
    assert.deepEqual(h.tabs, []);
    assert.equal(state.isRunning, true, 'the running flag of the active run is left alone');
});

for (const [name, cookies, message] of [
    ['SUAT cookie', {}, 'Authorization token (SUAT) not found'],
    ['sgs_da_uuid', { SUAT: 'test-suat' }, 'UUID (sgs_da_uuid) not found']
]) {
    test(`runAutomation: missing ${name} ends with the error signal before any request`, async t => {
        const h = useHarness(t, { cookies });
        await runAutomation();

        assert.deepEqual(h.requests, []);
        assert.deepEqual(h.titles, [RUNNING_TITLE, `[SG_ERROR] ${message} | STOVE`]);
        assert.deepEqual(h.logs(), [
            '[info] 전체 자동화 시작',
            '[info] 헤더 정보 추출 중...',
            `[error] 오류 발생: ${message}`,
            '[info] ',
            '[info] 소요 시간 · 총 0.0초'
        ]);
        assert.equal(state.isRunning, false);
        assert.equal(h.sounds.length, 0);
    });
}

test('runAutomation fresh day: every task runs once, no repair, done signal, sound, tabs closed', async t => {
    assertTimezonePinned();
    const h = useHarness(t);
    const world = installAutomationWorld(h);
    await runAutomation();

    assertGolden('automation/fresh-day', h.snapshot({ unordered: true }));

    // Signals for the external bot and the completion sound.
    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    assert.equal(h.sounds.length, 1);
    assert.deepEqual(h.logs().filter(line => line.startsWith('[error]')), []);
    assert.equal(state.isRunning, false);
    assert.deepEqual(state.completed, { ...state.completed, roulette: true, dailyShop: true, majak: true });

    // Groups run in plan order.
    assert.deepEqual(groupLogs(h), [
        '[info] 그룹 시작: setup', '[success] 그룹 완료: setup (3/3)',
        '[info] 그룹 시작: visits', '[success] 그룹 완료: visits (4/4)',
        '[info] 그룹 시작: missionClaims', '[success] 그룹 완료: missionClaims (3/3)',
        '[info] 그룹 시작: flakeSpending', '[success] 그룹 완료: flakeSpending (3/3)',
        '[info] 그룹 시작: followups', '[success] 그룹 완료: followups (3/3)'
    ]);
    assert.ok(!h.logs().some(line => line.includes('안전 복구')), 'no repair pass on a clean run');

    // Order by design: every write is planned from the read-only before-snapshot, so it comes after
    // those reads. FLAKE spending (draws → EXTRA → prize entry → prize mission claim) runs after
    // mission claims.
    const requests = h.requests;
    const firstPlannedWrite = requests.findIndex(isWrite);
    for (const snapshotRead of ['/flake-shop/v1/mission/component', '/emsbackapi/v3.0/participationCnt']) {
        const index = requests.findIndex(request => pathOf(request.url) === snapshotRead);
        assert.ok(index >= 0 && index < firstPlannedWrite, `${snapshotRead} is read before the first planned write`);
    }
    const positions = predicate => requests.flatMap((request, index) => (predicate(request) ? [index] : []));
    const draws = positions(isDraw);
    const extraClaims = positions(isExtraClaim);
    const applies = positions(isPrizeApply);
    const prizeClaims = positions(request => isParticipate(request) && request.body.mission_no === PRIZE_MISSION_NO);
    const otherClaims = positions(request => isParticipate(request) && request.body.mission_no !== PRIZE_MISSION_NO);
    assert.deepEqual([draws.length, extraClaims.length, applies.length, prizeClaims.length], [2, 1, 1, 1]);
    assert.ok(Math.max(...otherClaims) < draws[0]);
    assert.ok(draws[1] < extraClaims[0] && extraClaims[0] < applies[0] && applies[0] < prizeClaims[0]);

    // Safety: spending limits, no double claims, summary consistent with state.
    assertFlakeSpendingWithinLimits(h, world, 28);
    assertNoRewardClaimedTwice(world);
    assertSummaryMatchesState(h);
    assert.deepEqual(state.earnings, {
        roulette: 150, rouletteExtra: 1000, dailyShop: 10, majak: 20,
        // Single-visit rewards (missions 1001/1002, 20 FLAKE) are counted on their own line.
        dailyMissions: 0, visitMissions: 20, contentMissions: 20, weeklyMissions: 100, bannerMissions: 15,
        attendanceMissions: 30, surveyMissions: 5, prizeEntry: -200, dailyAccumulated: 100
    });
    // Weekly/attendance/survey claims run concurrently, so compare the claimed set, not its order.
    assert.deepEqual([...world.audit.missionClaims].sort((a, b) => a - b),
        [PRIZE_MISSION_NO, 1001, 1002, 2001, 3001, 4001, 5001, 6002]);

    // Tabs: everything collected is closed at the end; the single-visit tab is never collected (leak).
    assert.deepEqual(h.tabs.filter(tab => !tab.closed).map(({ url, active, closed }) => ({ url, active, closed })), [{ url: SINGLE_VISIT_URL, active: false, closed: false }]);
    assert.deepEqual(h.logs().slice(-15), [
        '[info] ═══════════════════════════════════════',
        '[info] ',
        '[info] 상태 업데이트 중...',
        '[success] 상태 업데이트 완료!',
        '[info] ',
        '[success] 모든 작업이 완료되었습니다!',
        '[info] 열린 탭 4개 닫는 중...',
        '[success] 모든 탭 닫힘',
        '[info] ',
        '[info] 소요 시간 · 총 0.0초',
        '[info]   준비: 초기 스냅샷 0.0초 · 월간 출석 기록 0.0초',
        '[info]   그룹: setup 0.0초 · visits 0.0초 · missionClaims 0.0초 · flakeSpending 0.0초 · followups 0.0초',
        '[info]   마무리: 최종 스냅샷 0.0초 · 사전등록 0.0초 · 상태 업데이트 0.0초',
        '[info]   초기 스냅샷 세부: missionComponents 0.0초 → missions 0.0초 · roulette 0.0초 · rouletteExtra 0.0초 · shop 0.0초',
        '[info]   최종 스냅샷 세부: missionComponents 0.0초 → missions 0.0초 · roulette 0.0초 · rouletteExtra 0.0초 · shop 0.0초'
    ]);
    assert.deepEqual(JSON.parse(h.window.localStorage.getItem(MONTHLY_RECORD_KEY)), { date: '2026-10-16', counts: { 6001: 5 } });
});

test('runAutomation same-day re-run: nothing is written again and finished work is skipped', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h);
    await runAutomation();
    const firstRun = h.requests.length;
    const firstLogs = h.logs().length;
    const claimsBefore = structuredClone(world.audit);
    h.titles.length = 0;

    await runAutomation();
    const rerun = h.requests.slice(firstRun);
    const rerunLogs = h.logs().slice(firstLogs);

    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    // Everything was proven done by the snapshot or by the tasks' own checks, so the re-run makes no
    // write at all.
    assert.deepEqual(rerun.filter(isWrite).map(describe), []);
    assert.deepEqual(world.audit, claimsBefore);
    assertNoRewardClaimedTwice(world);
    assert.equal(world.audit.draws, 2);
    assert.equal(world.audit.prizeApplies, 1);
    assert.ok(h.logs().includes('[success] 스냅샷 비교: 미션 0개, 데일리 0개, 마작 0개, EXTRA 0개, 월간출석 +1 0/1 (오늘 이미 반영 1개)'));
});

test('runAutomation everything already done: no write at all', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h, DONE_WORLD);
    h.window.localStorage.setItem(MONTHLY_RECORD_KEY, JSON.stringify({ date: '2026-10-16', counts: { 6001: 5 } }));
    await runAutomation();

    assertGolden('automation/all-done', h.snapshot({ unordered: true }));
    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    assert.equal(h.sounds.length, 1);
    assert.deepEqual(h.logs().filter(line => line.startsWith('[error]') || line.startsWith('[warning]')), []);

    // The snapshot proves every planned category done.
    assert.deepEqual(h.requests.filter(isWrite).map(describe), []);
    assert.deepEqual(world.audit.draws, 0);
    assert.equal(h.requests.filter(isPrizeApply).length, 0);
    assertFlakeSpendingWithinLimits(h, world, 30);
    assertNoRewardClaimedTwice(world);
    assertSummaryMatchesState(h);
    assert.deepEqual(h.tabs.map(({ url, active, closed }) => ({ url, active, closed })), [
        { url: 'https://reward.onstove.com/ko', active: false, closed: true },
        { url: 'https://store.onstove.com/', active: false, closed: true }
    ]);
});

test('runAutomation partial failure: repair pass, "확인 필요" warning and error signal', async t => {
    const h = useHarness(t);
    CONFIG.preRegistration.campaigns[0].endDate = '2026-10-31';
    let mission1001Attempts = 0;
    const world = installAutomationWorld(h, {
        roulettePrizes: [50],
        overrides: {
            participate: (request, callIndex, next) => {
                // Visit mission 1001 fails twice (participate, then the daily claim) and then works;
                // the weekly claim keeps failing with an API error code.
                if (request.body.mission_no === 1001 && ++mission1001Attempts <= 2) return httpError(500);
                if (request.body.mission_no === 3001) return { code: 50000, message: '일시적인 오류입니다' };
                return next();
            },
            dailyClaim: failFirst(1, httpError(500)),
            preRegister: () => httpError(500)
        }
    });
    await runAutomation();

    assertGolden('automation/partial-failure', h.snapshot({ unordered: true }));

    const issues = '사전등록 확인 필요';
    assert.deepEqual(h.titles, [RUNNING_TITLE, `[SG_ERROR] ${issues} | STOVE`]);
    assert.equal(h.sounds.length, 0);
    const logs = h.logs().map(withoutElapsed);
    for (const line of [
        `[warning] 전체 자동화 종료 · 확인 필요: ${issues}`,
        `[warning] 일부 작업이 실패했거나 확인이 필요합니다: ${issues}`,
        '[warning] 스냅샷 비교: 미션 1개, 데일리 1개, 마작 0개, EXTRA 0개, 월간출석 +1 1/1',
        '[warning] 안전 복구 대상 확인 중...',
        '[warning] 복구 그룹 1개 실행',
        '[success] 복구 완료: repairSafe (2/2)',
        '[success] 복구 후 비교: 미션 0개, 데일리 0개, 마작 0개, EXTRA 0개, 월간출석 +1 1/1',
        '[warning] 사전등록 확인 필요: luvplace: API Error: 500 Error',
        // Roulette lost 100 FLAKE: its own sign, not the positive total's.
        '[warning]   룰렛 순수익: -100 FLAKE'
    ]) {
        assert.ok(logs.includes(line), `missing log: ${line}`);
    }
    assertSummaryMatchesState(h);
    assert.ok(!issues.includes('위클리'), 'the failing weekly claim is not reported as an issue');

    // Repair retried the visit mission and the daily shop claim.
    assert.equal(mission1001Attempts, 3);
    assert.deepEqual(world.audit.shopClaims, [902, 911, 802],
        'majak first, then the repaired daily claim; the accumulated 15-day reward stays unclaimed');
    assertFlakeSpendingWithinLimits(h, world, 28);
    assertNoRewardClaimedTwice(world);
});

test('runAutomation monthly attendance: unread +1 focuses the reward shop and rechecks until it shows', async t => {
    const h = useHarness(t);
    installAutomationWorld(h, { attendanceTrigger: 'focusedRewardTab' });
    await runAutomation();

    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    const logs = h.logs();
    const focusLine = logs.indexOf('[warning] 월간출석 +1 확인이 안 되어 리워드샵으로 포커스를 이동합니다');
    assert.ok(focusLine > logs.indexOf('[warning] 스냅샷 비교: 미션 0개, 데일리 0개, 마작 0개, EXTRA 0개, 월간출석 +1 0/1 (미증가 1개, 확인불가 0개)'));
    assert.equal(logs[focusLine + 1], '[success] 월간출석 재확인 1/3: 월간출석 +1 1/1');
    assert.ok(!logs.some(line => line.includes('안전 복구')));
    assert.deepEqual(h.tabs.filter(tab => !tab.closed).map(({ url, active, closed }) => ({ url, active, closed })), [
        { url: SINGLE_VISIT_URL, active: false, closed: false },
        { url: REWARD_SHOP_TAB, active: true, closed: false }
    ], 'the focused reward shop tab is left open on purpose');
    assert.equal(h.delays.filter(ms => ms === 3000).length, 3, 'content/banner visit waits + one recheck');
    assert.deepEqual(JSON.parse(h.window.localStorage.getItem(MONTHLY_RECORD_KEY)), { date: '2026-10-16', counts: { 6001: 5 } });
});

test('runAutomation monthly attendance: never confirmed → skips an unreadable recheck, warns, still succeeds', async t => {
    const h = useHarness(t);
    const focused = () => h.tabs.some(tab => tab.url === REWARD_SHOP_TAB && tab.active);
    const outage = { page: 1, components: 6 };
    const failDuringOutage = key => (request, callIndex, next) => {
        if (!focused() || outage[key] === 0) return next();
        outage[key] -= 1;
        return httpError(503);
    };
    installAutomationWorld(h, {
        attendanceTrigger: 'never',
        // The first recheck after focusing the shop cannot read missions at all.
        overrides: { missionPage: failDuringOutage('page'), missionComponent: failDuringOutage('components') }
    });
    await runAutomation();

    assertGolden('automation/monthly-attendance-unverified', h.snapshot({ unordered: true }));
    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    const logs = h.logs();
    assert.deepEqual(logs.filter(line => line.includes('월간출석 재확인') || line.includes('확인하지 못했습니다')), [
        '[warning] 월간출석 재확인 2/3: 월간출석 +1 0/1 (미증가 1개, 확인불가 0개)',
        '[warning] 월간출석 재확인 3/3: 월간출석 +1 0/1 (미증가 1개, 확인불가 0개)',
        '[warning] 월간출석 +1을 확인하지 못했습니다. 오늘 이미 출석했을 수 있어 실패로 처리하지 않습니다 (미션 6001)'
    ]);
    assert.deepEqual(outage, { page: 0, components: 0 }, 'the outage was consumed by the first recheck');
    assert.deepEqual(JSON.parse(h.window.localStorage.getItem(MONTHLY_RECORD_KEY)), { date: '2026-10-16', counts: { 6001: 4 } },
        'an unverified mission is recorded so the next run today does not refocus');
});

test('runAutomation: a stale final read is re-checked once and needs no repair', async t => {
    const h = useHarness(t);
    let staleServed = 0;
    const world = installAutomationWorld(h, {
        overrides: {
            // The first two daily-shop reads after both shop claims (the panel refresh and the final
            // snapshot, which run together) still show today's reward as unclaimed; later reads are
            // up to date.
            dailyShop: (request, callIndex, next) => {
                const body = next();
                if (staleServed < 2 && world.audit.shopClaims.includes(812)) {
                    staleServed += 1;
                    body.value.daily_attendances.rewards.find(reward => reward.item_no === 802).is_received = false;
                }
                return body;
            }
        }
    });
    await runAutomation();

    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    const logs = h.logs().filter(line => /스냅샷 비교|안전 복구|재확인 결과|복구 그룹/.test(line));
    assert.deepEqual(logs, [
        '[warning] 스냅샷 비교: 미션 0개, 데일리 1개, 마작 0개, EXTRA 0개, 월간출석 +1 1/1',
        '[warning] 안전 복구 대상 확인 중...',
        '[success] 재확인 결과: 미션 0개, 데일리 0개, 마작 0개, EXTRA 0개, 월간출석 +1 1/1'
    ]);
    assert.deepEqual(world.audit.shopClaims, [802, 812, 902, 911]);
    assertNoRewardClaimedTwice(world);
});

test('runAutomation: roulette event closed mid-day (7019) stops drawing and reports "룰렛 미완료"', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h, {
        overrides: { rouletteDraw: () => ({ code: 7019, message: '이벤트 기간이 아닙니다' }) }
    });
    await runAutomation();

    assert.deepEqual(h.titles, [RUNNING_TITLE, '[SG_ERROR] 룰렛 미완료 | STOVE']);
    assert.equal(h.requests.filter(isDraw).length, 1, 'the first 7019 answer stops the roulette');
    assert.ok(h.logs().includes('[warning] 룰렛 이벤트 기간이 아닙니다'));
    assert.ok(h.logs().includes('[warning] 전체 자동화 종료 · 확인 필요: 룰렛 미완료'));
    assert.equal(state.completed.roulette, false, 'final flag comes from the snapshot, not from the roulette task');
    assert.equal(world.audit.prizeApplies, 1, 'prize entry still runs after the roulette stops');
    assert.equal(h.sounds.length, 0);
});

test('runAutomation: roulette disabled still schedules the draw task, which only warns; no roulette issue', async t => {
    const h = useHarness(t);
    CONFIG.roulette.enabled = false;
    const world = installAutomationWorld(h);
    await runAutomation();

    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    assert.equal(h.requests.filter(isDraw).length, 0);
    assert.equal(world.audit.draws, 0);
    assert.ok(h.logs().includes('[warning] 룰렛 기능이 비활성화되어 있습니다'));
    assert.ok(h.logs().map(withoutElapsed).includes('[success] 그룹 완료: flakeSpending (3/3)'), 'draw, EXTRA and prize tasks are all planned');
    assert.equal(state.completed.roulette, true);
    assert.equal(state.earnings.roulette, 0);
});

test('runAutomation: a non-numeric reward amount turns the total into a warning and 0', async t => {
    const h = useHarness(t);
    installAutomationWorld(h, {
        overrides: {
            participate: (request, callIndex, next) => {
                const response = next();
                if (request.body.mission_no === 3001) response.value.reward_amount = 'N/A';
                return response;
            }
        }
    });
    await runAutomation();

    const logs = h.logs();
    assert.equal(state.earnings.weeklyMissions, '0N/A', 'string concatenation, not addition');
    for (const line of [
        '[success]   "주간 출석 5회": +N/A FLAKE',
        '[warning] 수익 계산 오류 발생 - 일부 값이 유효하지 않음',
        '[info]   위클리 미션: 0N/A FLAKE',
        '[success]   총 순수익: +0 FLAKE'
    ]) {
        assert.ok(logs.includes(line), `missing log: ${line}`);
    }
    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE], 'a broken summary does not affect the outcome');
});
