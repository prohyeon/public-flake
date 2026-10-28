// Characterization of src/workflows/status.js through the GM/DOM boundary: the dashboard reads
// (exact URLs and headers), how each check maps responses/failures to status objects, the tabs
// opened by visitRequiredPages, and the panel checkAllStatus renders. Status checks are READ-ONLY:
// every test asserts that no POST/PUT/DELETE leaves the dashboard.
process.env.TZ = 'Asia/Seoul'; // "today", yyyyMM and tz_offset follow the local (KST) calendar
import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, httpError, networkError, timeoutError, rawText, TEST_HEADERS, DEFAULT_NOW } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import {
    API, DAY, NOW, COMPONENTS, STATUS_PANEL_BODY, URLS, panelSnapshot,
    componentPageBody, loadedComponents, mission, componentBody, componentUrl, routeComponents,
    pendingComponentBodies, doneComponentBodies, participationBody, dailyShopBody,
    pendingWorld, routeStatusWorld
} from '../fixtures/status.js';
import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';
import {
    checkRouletteStatus, checkDailyShopStatus, checkMajakShopStatus, checkSurveyStatus,
    checkDailyMissionStatus, visitRequiredPages, checkAllStatus
} from '../../src/workflows/status.js';

const writes = h => h.requests.filter(request => request.method !== 'GET');
const ROULETTE_URL = `${API}/emsbackapi/v3.0/participationCnt?sub_event_no=1000000353`;
const SHOPS = [
    { name: 'daily', check: checkDailyShopStatus, service: 'STOVEINDIE' },
    { name: 'majak', check: checkMajakShopStatus, service: 'RIICHICITY_IND' }
];
const shopUrl = (service, month = '202610') => `${API}/dailyshop/v1.0/${month}/services/${service}`;
const TODAY_START = Date.parse('2026-10-15T15:00:00Z'); // 2026-10-16 00:00 KST

async function sequence(count, fn) {
    const results = [];
    for (let i = 0; i < count; i++) results.push(await fn());
    return results;
}

test('time zone is pinned to KST for this file', () => {
    assert.equal(new Date(DEFAULT_NOW).getTimezoneOffset(), -540);
});

// ---------------------------------------------------------------- checkRouletteStatus

test('roulette: reads participationCnt for the configured draw event with reward headers', async t => {
    const h = useHarness(t);
    h.on('GET', ROULETTE_URL, participationBody(12));

    const result = await checkRouletteStatus(TEST_HEADERS);

    assert.deepEqual(result, { success: true, current: 12, limit: 30, remaining: 18 });
    assert.deepEqual(writes(h), []);
    assertGolden('status/roulette-happy', { result, ...h.snapshot() });
});

test('roulette: remaining is clamped at 0, missing count is 0, response code is ignored, failures carry the error', async t => {
    const h = useHarness(t);
    h.on('GET', ROULETTE_URL, [
        participationBody(0),
        participationBody(35),
        { code: 0, value: {} },
        { code: 7019, message: '이벤트 기간이 아닙니다', value: { participation_cnt: 5 } },
        { code: 7019, message: '이벤트 기간이 아닙니다' },
        rawText('<html>'),
        httpError(500),
        networkError(),
        timeoutError()
    ]);

    const results = await sequence(9, () => checkRouletteStatus(TEST_HEADERS));

    assert.deepEqual(results, [
        { success: true, current: 0, limit: 30, remaining: 30 },
        { success: true, current: 35, limit: 30, remaining: 0 },
        { success: true, current: 0, limit: 30, remaining: 30 },
        { success: true, current: 5, limit: 30, remaining: 25 },
        { success: false, error: '데이터 없음' },
        { success: false, error: '데이터 없음' },
        { success: false, error: 'API Error: 500 Error' },
        { success: false, error: 'Network error' },
        { success: false, error: 'API request timed out' }
    ]);
    assert.deepEqual(writes(h), []);
});

test('roulette: a loaded draw event id and CONFIG.roulette.maxDraws drive the request and limit', async t => {
    const h = useHarness(t);
    state.rouletteEvents.draw = '1000000999';
    CONFIG.roulette.maxDraws = 50;
    h.on('GET', `${API}/emsbackapi/v3.0/participationCnt?sub_event_no=1000000999`, participationBody(20));

    assert.deepEqual(await checkRouletteStatus({ Authorization: 'Bearer x', 'caller-detail': 'detail' }),
        { success: true, current: 20, limit: 50, remaining: 30 });
    assert.equal(h.requests[0].headers['caller-detail'], 'detail');
});

// ---------------------------------------------------------------- checkDailyShopStatus / checkMajakShopStatus

for (const { name, check, service } of SHOPS) {
    test(`${name} shop: reads this month's ${service} attendance with event-hub headers`, async t => {
        const h = useHarness(t);
        h.on('GET', shopUrl(service), dailyShopBody(false));

        const result = await check(TEST_HEADERS);

        assert.deepEqual(result, { success: true, received: false, notReceived: true });
        assert.deepEqual(writes(h), []);
        assertGolden(`status/${name}-shop-pending`, { result, ...h.snapshot() });
    });

    test(`${name} shop: received / no reward today / malformed / failing responses`, async t => {
        const h = useHarness(t);
        h.on('GET', shopUrl(service), [
            dailyShopBody(true),
            dailyShopBody(false, { today: false }),
            { code: 0, value: { daily_attendances: {} } },
            { code: 0, value: { accumulated_attendances: { rewards: [] } } },
            { code: 90001, message: 'not found' },
            rawText(''),
            httpError(500),
            networkError()
        ]);

        const results = await sequence(8, () => check(TEST_HEADERS));

        assert.deepEqual(results, [
            { success: true, received: true, notReceived: false },
            { success: true, received: false, notReceived: false, noRewardToday: true },
            { success: true, received: false, notReceived: false, noRewardToday: true },
            { success: false, error: '데이터 없음' },
            { success: false, error: '데이터 없음' },
            { success: false, error: '데이터 없음' },
            { success: false, error: 'API Error: 500 Error' },
            { success: false, error: 'Network error' }
        ]);
        assert.deepEqual(writes(h), []);
    });

    test(`${name} shop: "today" and the month path roll over at KST midnight`, async t => {
        const h = useHarness(t, { now: Date.parse('2026-10-16T15:30:00Z') }); // 2026-10-17 00:30 KST
        h.on('GET', shopUrl(service), dailyShopBody(true)); // 10-16 received, 10-17 not yet
        assert.deepEqual(await check(TEST_HEADERS), { success: true, received: false, notReceived: true });
    });

    test(`${name} shop: on the first KST day of a month the next month is requested`, async t => {
        const h = useHarness(t, { now: Date.parse('2026-10-31T15:30:00Z') }); // 2026-11-01 00:30 KST
        h.on('GET', shopUrl(service, '202611'), { code: 0, value: { daily_attendances: { rewards: [
            { attendance_date: '2026-11-01', item_no: 1, is_received: false }
        ] } } });
        assert.deepEqual(await check(TEST_HEADERS), { success: true, received: false, notReceived: true });
    });
}

// ---------------------------------------------------------------- checkSurveyStatus

test('survey: disabled config or an unloaded survey component short-circuits without a request', async t => {
    const h = useHarness(t);
    state.missionComponents.survey = COMPONENTS.survey;
    CONFIG.surveyMissions.enabled = false;
    assert.deepEqual(await checkSurveyStatus(TEST_HEADERS), { success: true, notAvailable: true });

    CONFIG.surveyMissions.enabled = true;
    state.missionComponents.survey = null;
    assert.deepEqual(await checkSurveyStatus(TEST_HEADERS), { success: true, notAvailable: true });
    assert.deepEqual(h.requests, []);
});

test('survey: counts COMPLETE/COMPLETED and RECEIVABLE missions, sending the caller lounge headers unchanged', async t => {
    const h = useHarness(t);
    state.missionComponents.survey = COMPONENTS.survey;
    h.on('GET', componentUrl(COMPONENTS.survey), componentBody(COMPONENTS.survey, 'SURVEY', [
        mission(30, { status: 'COMPLETE' }),
        mission(31, { status: 'COMPLETED' }),
        mission(32, { status: 'RECEIVABLE' }),
        mission(33, { status: 'INCOMPLETE' })
    ]));

    const result = await checkSurveyStatus(TEST_HEADERS);

    assert.deepEqual(result, { success: true, completed: 2, receivable: 1, total: 4, allCompleted: false });
    // Unlike every other mission read, the survey check does not rewrite headers to flake-fe.
    assert.deepEqual(h.requests[0].headers, { ...TEST_HEADERS });
    assert.deepEqual(writes(h), []);
    assertGolden('status/survey-mixed', { result, ...h.snapshot() });
});

test('survey: all completed, no missions, wrong code, missing missions and HTTP failure', async t => {
    const h = useHarness(t);
    state.missionComponents.survey = COMPONENTS.survey;
    h.on('GET', componentUrl(COMPONENTS.survey), [
        componentBody(COMPONENTS.survey, 'SURVEY', [mission(30, { status: 'COMPLETE' }), mission(31, { status: 'COMPLETED' })]),
        componentBody(COMPONENTS.survey, 'SURVEY', []),
        { code: 1, message: 'error', value: { missions: [mission(30)] } },
        { code: 0, value: { component_info: {} } },
        rawText('nope'),
        httpError(500)
    ]);

    const results = await sequence(6, () => checkSurveyStatus(TEST_HEADERS));

    assert.deepEqual(results, [
        { success: true, completed: 2, receivable: 0, total: 2, allCompleted: true },
        { success: true, noMissions: true },
        { success: false, error: '데이터 없음' },
        { success: false, error: '데이터 없음' },
        { success: false, error: '데이터 없음' },
        { success: false, error: 'API Error: 500 Error' }
    ]);
});

// ---------------------------------------------------------------- checkDailyMissionStatus

test('daily missions: buckets loaded components into daily/weekly/content/attendance (survey and banner ignored)', async t => {
    const h = useHarness(t);
    state.missionComponents = loadedComponents();
    routeComponents(h, pendingComponentBodies());

    const result = await checkDailyMissionStatus(TEST_HEADERS);

    assert.equal(result.success, true);
    assert.deepEqual(Object.keys(result.categories), ['daily', 'weekly', 'content', 'attendance']);
    assert.deepEqual(Object.fromEntries(Object.entries(result.categories).map(([key, value]) =>
        [key, [value.total, value.completed, value.receivable, value.incomplete, value.missions.map(m => m.mission_no)]])), {
        daily: [3, 1, 1, 1, [1, 2, 3]],
        weekly: [2, 0, 1, 1, [20, 21]],
        content: [2, 0, 0, 2, [10, 11]],
        attendance: [1, 0, 0, 1, [50]]
    });
    assert.deepEqual(h.calls(), [
        componentUrl(271), componentUrl(272), componentUrl(280), componentUrl(274),
        componentUrl(281), componentUrl(283), componentUrl(284)
    ].map(url => `GET ${url}`));
    assert.deepEqual(writes(h), []);
    assertGolden('status/daily-missions-categories', { result, ...h.snapshot() });
});

test('daily missions: loads component ids from the mission page when none are known', async t => {
    const h = useHarness(t);
    h.on('GET', URLS.page, componentPageBody());
    routeComponents(h, pendingComponentBodies());

    const result = await checkDailyMissionStatus(TEST_HEADERS);

    assert.equal(result.success, true);
    assert.deepEqual(state.missionComponents, loadedComponents());
    assert.equal(h.calls()[0], `GET ${URLS.page}`);
    assert.equal(h.requests.length, 8);
    assert.deepEqual(h.requests[0].headers, {
        'Authorization': 'Bearer test-suat', 'caller-id': 'flake-fe', 'caller-detail': 'test-uuid',
        'x-lang': 'ko', 'x-nation': 'KR', 'Accept': '*/*',
        'Origin': 'https://reward.onstove.com', 'Referer': 'https://reward.onstove.com/'
    });
});

test('daily missions: no component ids, or every component failing, reports 데이터 없음', async t => {
    const h = useHarness(t);
    h.on('GET', URLS.page, [componentPageBody([]), httpError(500), componentPageBody()]);
    routeComponents(h, Object.fromEntries(Object.values(COMPONENTS).map(no => [no, httpError(500)])));

    assert.deepEqual(await checkDailyMissionStatus(TEST_HEADERS), { success: false, error: '데이터 없음' });
    assert.deepEqual(await checkDailyMissionStatus(TEST_HEADERS), { success: false, error: '데이터 없음' });
    assert.deepEqual(await checkDailyMissionStatus(TEST_HEADERS), { success: false, error: '데이터 없음' });
    assert.deepEqual(h.calls().slice(0, 3), [`GET ${URLS.page}`, `GET ${URLS.page}`, `GET ${URLS.page}`]);
    assert.equal(h.requests.length, 3 + 7);
});

test('daily missions: failed components are dropped, code is ignored when a value exists, ACCUMULATION outside weekly is attendance', async t => {
    const h = useHarness(t);
    state.missionComponents = { ...loadedComponents(), weekly: null, banner: null, survey: null };
    state.missionComponents.attendance = 290;
    routeComponents(h, {
        271: httpError(500),
        272: { code: 500, message: 'error' },
        280: { code: 1234, message: 'odd', value: { component_info: { component_type: 'CONTENT1' }, missions: [mission(10, { status: 'COMPLETED' })] } },
        290: componentBody(290, 'ACCUMULATION', [mission(60, { status: 'RECEIVABLE' })]),
        284: { code: 0, value: { missions: [mission(70)] } }, // no component_info -> not bucketed
        285: { code: 0, value: { component_info: { component_no: 285, component_type: 'SINGLE' } } } // no missions -> no daily category
    });
    state.missionComponents.dailyComponents = [271, 272, 284, 285];

    const result = await checkDailyMissionStatus(TEST_HEADERS);

    assert.deepEqual(Object.fromEntries(Object.entries(result.categories).map(([key, value]) =>
        [key, [value.total, value.completed, value.receivable, value.incomplete]])), {
        content: [1, 1, 0, 0],
        attendance: [1, 0, 1, 0]
    });
    assert.deepEqual(result.categories.attendance.components, [{ component_no: 290, component_type: 'ACCUMULATION', title: 'ACCUMULATION 290' }]);
});

test('daily missions: a non-iterable missions value is caught and reported as an error', async t => {
    const h = useHarness(t);
    state.missionComponents = { ...loadedComponents(), dailyComponents: [271], daily: 271, content: null, weekly: null, survey: null, banner: null, attendance: null };
    routeComponents(h, { 271: { code: 0, value: { component_info: { component_type: 'SINGLE' }, missions: { length: 1 } } } });

    const result = await checkDailyMissionStatus(TEST_HEADERS);

    assert.equal(result.success, false);
    assert.match(result.error, /iterable/);
    assert.equal(h.requests.length, 1);
});

// ---------------------------------------------------------------- visitRequiredPages

test('visitRequiredPages: opens the reward shop and store main in background tabs and logs progress', async t => {
    const h = useHarness(t);

    const tabs = await visitRequiredPages();

    assert.equal(tabs.length, 2);
    assert.deepEqual(h.tabs.map(({ url, active, closed }) => ({ url, active, closed })), [
        { url: 'https://reward.onstove.com/ko', active: false, closed: false },
        { url: 'https://store.onstove.com/', active: false, closed: false }
    ]);
    assert.deepEqual(h.requests, []);
    assertGolden('status/visit-required-pages', { tabCount: tabs.length, ...h.snapshot() });
});

test('visitRequiredPages: a tab failure is logged as a warning and the tabs opened so far are returned', async t => {
    const h = useHarness(t);
    const openInTab = globalThis.GM_openInTab;
    globalThis.GM_openInTab = (url, options) => {
        if (url.startsWith('https://store.')) throw new Error('popup blocked');
        return openInTab(url, options);
    };

    const tabs = await visitRequiredPages();

    assert.equal(tabs.length, 1);
    assert.deepEqual(h.logs(), [
        '[info] 필수 페이지 탭 열기...',
        '[info]   리워드샵 페이지 방문 중...',
        '[info]   스토브 메인 페이지 방문 중...',
        '[warning] 페이지 방문 중 오류: popup blocked'
    ]);
});

test('visitRequiredPages: without GM_openInTab it falls back to window.open (foreground tabs)', async t => {
    const h = useHarness(t);
    delete globalThis.GM_openInTab;

    const tabs = await visitRequiredPages();

    assert.equal(tabs.length, 2);
    assert.deepEqual(h.tabs.map(tab => [tab.url, tab.active]), [
        ['https://reward.onstove.com/ko', true],
        ['https://store.onstove.com/', true]
    ]);
});

// ---------------------------------------------------------------- checkAllStatus

function doneWorld() {
    return {
        ...pendingWorld(),
        components: doneComponentBodies(),
        participation: participationBody(30),
        dailyShop: dailyShopBody(true),
        majakShop: dailyShopBody(true),
        balance: { code: 0, message: 'OK', value: { mileage_amount: 200000 } },
        deposit: { code: 0, message: 'OK', value: { total_deposit_amount: 50000 } }
    };
}

async function runCheckAll(h) {
    const pending = checkAllStatus();
    const loadingPanel = panelSnapshot(h.document);
    const result = await pending;
    return { result, loadingPanel, panel: panelSnapshot(h.document) };
}

const countCalls = (h, match) => h.requests.filter(request =>
    request.method === 'GET' && (typeof match === 'string' ? request.url === match : match.test(request.url))).length;

test('checkAllStatus: fresh day with everything pending renders the full dashboard from read-only GETs', async t => {
    const h = useHarness(t, { body: STATUS_PANEL_BODY });
    routeStatusWorld(h, pendingWorld());

    const { result, loadingPanel, panel } = await runCheckAll(h);

    assert.equal(result, undefined);
    assert.deepEqual(writes(h), [], 'status refresh never mutates');
    assert.equal(loadingPanel.values['stove-status-roulette'], '<span class="stove-status-value" id="stove-status-roulette"><span style="color: #3b82f6">확인 중...</span></span>');

    const text = Object.fromEntries(Object.entries(panel.values).map(([id, html]) =>
        [id.replace('stove-status-', ''), h.document.getElementById(id).textContent]));
    assert.deepEqual(text, {
        'mission-daily': '보상 1개',
        'mission-weekly': '보상 1개',
        'mission-content': '받을 보상 없음',
        'mission-attendance': '7일중 9일출석',
        'roulette': '0/30 (30회 남음)',
        'daily': '보상 미수령',
        'majak': '보상 미수령',
        'survey': '투표 가능 1개',
        'total-flake': '150,000 F',
        'monthly-flake': '+12,345 F'
    });
    assert.equal(panel.pointCashCharge.status, '42,500 플레이크 부족');
    assert.deepEqual(state.missionComponents, loadedComponents());
    assert.equal(countCalls(h, URLS.page), 1);
    assert.equal(countCalls(h, componentUrl(COMPONENTS.survey)), 2, 'survey component is read by both the mission and survey checks');
    assert.deepEqual(h.requests.filter(request => request.url === componentUrl(COMPONENTS.survey)).map(request => request.headers['caller-id']),
        ['flake-fe', 'storee-lounge']);
    assertGolden('status/check-all-fresh-day', { loadingPanel, ...h.snapshot({ unordered: true }), panel });
});

test('checkAllStatus: everything already done (component ids preloaded, so no mission page read)', async t => {
    const h = useHarness(t, { body: STATUS_PANEL_BODY });
    state.missionComponents = loadedComponents();
    routeStatusWorld(h, doneWorld());

    const { panel } = await runCheckAll(h);

    assert.deepEqual(writes(h), []);
    assert.equal(countCalls(h, URLS.page), 0);
    const text = id => h.document.getElementById(`stove-status-${id}`).textContent;
    for (const id of ['mission-daily', 'mission-weekly', 'mission-content']) assert.equal(text(id), '완료');
    assert.equal(text('mission-attendance'), '7일중 28일출석');
    assert.equal(text('roulette'), '30/30 (0회 남음)');
    assert.equal(text('daily'), '전부 완료');
    assert.equal(text('majak'), '전부 완료');
    assert.equal(text('survey'), '전부 완료');
    assert.equal(text('total-flake'), '200,000 F');
    assert.deepEqual(panel.pointCashCharge, {
        disabled: false, title: '192,500 플레이크 보유: 충전 가능', opacity: '1', status: '충전 가능', statusColor: 'rgb(167, 243, 208)'
    });
    assert.deepEqual(state.pointCashCharge, { availableFlake: 200000, hasRequiredFlake: true });
    assertGolden('status/check-all-done', { ...h.snapshot({ unordered: true }), panel });
});

test('checkAllStatus: several APIs failing or malformed degrade cell by cell', async t => {
    const h = useHarness(t, { body: STATUS_PANEL_BODY });
    const components = pendingComponentBodies();
    components[COMPONENTS.survey] = httpError(500);
    components[COMPONENTS.banner] = { code: 500, message: 'error' };
    routeStatusWorld(h, {
        ...pendingWorld(),
        components,
        participation: httpError(500),
        dailyShop: { code: 9999, message: 'maintenance' },
        majakShop: rawText('<html>점검</html>'),
        balance: httpError(500),
        deposit: { code: 1, message: 'denied' }
    });

    const { panel } = await runCheckAll(h);

    assert.deepEqual(writes(h), []);
    const text = id => h.document.getElementById(`stove-status-${id}`).textContent;
    assert.equal(text('mission-daily'), '보상 1개', 'missions still render from the components that answered');
    assert.equal(text('roulette'), '확인 실패');
    assert.equal(text('daily'), '확인 실패');
    assert.equal(text('majak'), '확인 실패');
    assert.equal(text('survey'), '확인 실패');
    // Mileage failures are swallowed as 0 and look like a real zero balance.
    assert.equal(text('total-flake'), '0 F');
    assert.equal(text('monthly-flake'), '+0 F');
    assert.equal(panel.pointCashCharge.status, '192,500 플레이크 부족');
    assertGolden('status/check-all-partial-failures', { ...h.snapshot({ unordered: true }), panel });
});

test('checkAllStatus: every API down still renders, reading the mission page twice', async t => {
    const h = useHarness(t, { body: STATUS_PANEL_BODY });
    const down = httpError(500);
    routeStatusWorld(h, {
        ...Object.fromEntries(Object.keys(URLS).map(key => [key, down])),
        components: {}
    });

    const { panel } = await runCheckAll(h);

    assert.deepEqual(writes(h), []);
    assert.equal(countCalls(h, URLS.page), 2, 'checkAllStatus and getAllDailyMissions both try to load component ids');
    const text = id => h.document.getElementById(`stove-status-${id}`).textContent;
    for (const id of ['roulette', 'daily', 'majak']) assert.equal(text(id), '확인 실패');
    for (const id of ['daily', 'weekly', 'content', 'attendance']) assert.equal(text(`mission-${id}`), '실패');
    assert.equal(text('survey'), '비활성화', 'no survey component id is known, so the survey reads as disabled');
    assert.equal(text('total-flake'), '0 F');
    assert.equal(text('monthly-flake'), '+0 F');
    assertGolden('status/check-all-api-down', { ...h.snapshot({ unordered: true }), panel });
});

test('checkAllStatus: without a session cookie it alerts and marks every cell as failed', async t => {
    const h = useHarness(t, { body: STATUS_PANEL_BODY, cookies: {} });
    const { panel } = await runCheckAll(h);

    assert.deepEqual(h.alerts, ['상태 확인 실패: Authorization token (SUAT) not found']);
    assert.deepEqual(h.requests, []);
    const text = id => h.document.getElementById(`stove-status-${id}`).textContent;
    assert.equal(text('mission-daily'), '실패');
    assert.equal(text('total-flake'), '확인 실패');
    assert.equal(text('monthly-flake'), '확인 실패');
    assertGolden('status/check-all-no-session', { ...h.snapshot(), panel });
});
