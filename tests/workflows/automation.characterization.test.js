// Characterization tests for src/workflows/automation.js (runAutomation end-to-end and the task
// handlers), src/api/articles.js and src/utils/audio.js. They lock in CURRENT behavior, quirks
// included, so the planned refactors (mission runner dedupe, deps injection, header/URL dedupe,
// state helpers, dead-code removal) can be checked against them. Everything is driven through
// public exports and observed at the HTTP/tab/title/log/storage boundary.
//
// runAutomation runs task groups with bounded concurrency and comments in the background, so
// whole-run goldens compare sorted multisets; order is asserted only where it is serial by design.

// checkArticleWriteStatus, the shop "today" filters and the monthly-flake tz_offset use LOCAL time.
// Pin the zone so the goldens do not depend on the machine running them.
process.env.TZ = 'Asia/Seoul';

import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, httpError, TEST_HEADERS, DEFAULT_NOW } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import {
    useAutomationWorld, installAutomationWorld, failFirst,
    REWARD_SHOP_TAB, SINGLE_VISIT_URL, PRIZE_MISSION_NO, USER_ID
} from '../fixtures/automationWorld.js';
import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';
import { runAutomation, createAutomationTaskHandlers, bindTaskHandlers } from '../../src/workflows/automation.js';
import {
    getArticleList, likeArticle, checkArticleLikeStatus, postComment, createArticle
} from '../../src/api/articles.js';
import { playCompletionSound } from '../../src/utils/audio.js';

const API = 'https://api.onstove.com';
const RUNNING_TITLE = '[SG_RUNNING] 전체 자동화 실행 중 | STOVE';
const DONE_TITLE = '[SG_DONE] 전체 자동화 완료 | STOVE';
const LOUNGE_HEADERS = { ...TEST_HEADERS, 'caller-id': 'lounge', 'x-lang': 'KO' };
const ALL_ARTICLE_IDS = Array.from({ length: 13 }, (_, index) => 70001 + index);

// The same account after a complete run earlier today (monthly attendance already recorded).
const DONE_WORLD = Object.freeze({
    missions: 'done', articleWritten: true, likedArticleIds: ALL_ARTICLE_IDS,
    rouletteUsed: 30, rouletteExtraReceived: [10, 20, 30], dailyShopClaimed: true, majakClaimed: true,
    boost: 'rewarded', reviewEvent: 'commented', attendanceTrigger: 'never'
});
const MONTHLY_RECORD_KEY = `stove-monthly-attendance-v1:${USER_ID}`;

const pathOf = url => new URL(url).pathname;
const isWrite = request => request.method !== 'GET';
const isLoungeComment = request => request.method === 'POST' && /^\/postie\/v1\.0\/article\/\d+\/comment$/.test(pathOf(request.url));
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
    assert.ok(world.audit.boostRewards <= 1);
}

// The summary block printed after every completed run, rebuilt from state.progress/state.earnings.
function expectedSummaryLogs({ progress, earnings }) {
    const article = progress.newArticle > 0 ? 200 : 0;
    const likes = progress.articleLikes * 3;
    const comments = progress.comments * 30;
    const total = article + likes + comments + Object.values(earnings).reduce((sum, value) => sum + (value || 0), 0);
    const sign = total >= 0 ? '+' : '';
    const level = value => (value > 0 ? 'success' : 'info');
    return [
        '[info] ═══════════════════════════════════════',
        '[success] 💰 최종 FLAKE 수익 요약',
        '[info] ═══════════════════════════════════════',
        `[success]   ✍️  글쓰기: ${article} FLAKE`,
        `[${level(likes)}]   👍 게시글 좋아요: ${likes} FLAKE (${progress.articleLikes}회 × 3)`,
        `[${level(comments)}]   💬 댓글 쓰기: ${comments} FLAKE (${progress.comments}회 × 30)`,
        `[${level(earnings.dailyMissions)}]   📋 데일리 미션: ${earnings.dailyMissions} FLAKE`,
        `[${level(earnings.contentMissions)}]   📰 컨텐츠 미션: ${earnings.contentMissions} FLAKE`,
        `[${level(earnings.weeklyMissions)}]   📅 위클리 미션: ${earnings.weeklyMissions} FLAKE`,
        `[${level(earnings.bannerMissions)}]   🎨 배너 미션: ${earnings.bannerMissions} FLAKE`,
        `[${level(earnings.attendanceMissions)}]   📆 출석 미션: ${earnings.attendanceMissions} FLAKE`,
        `[${level(earnings.surveyMissions)}]   📊 설문조사: ${earnings.surveyMissions} FLAKE`,
        `[${level(earnings.boostMission)}]   🔥 오늘의 1등 미션: ${earnings.boostMission} FLAKE`,
        `[${earnings.prizeEntry >= 0 ? 'success' : 'warning'}]   🎁 경품 응모: ${earnings.prizeEntry >= 0 ? '+' : ''}${earnings.prizeEntry} FLAKE`,
        // Quirk kept on purpose: the roulette line reuses the TOTAL's sign (see the roulette-loss test).
        `[${earnings.roulette >= 0 ? 'success' : 'warning'}]   🎰 룰렛 순수익: ${sign}${earnings.roulette} FLAKE`,
        `[${level(earnings.rouletteExtra)}]   🎁 룰렛 EXTRA: ${earnings.rouletteExtra} FLAKE`,
        `[${level(earnings.dailyShop)}]   💝 데일리 보상: ${earnings.dailyShop} FLAKE`,
        `[${level(earnings.dailyAccumulated)}]   🎁 데일리 누적 보상: ${earnings.dailyAccumulated} FLAKE`,
        `[${level(earnings.majak)}]   🀄 마작 리워드: ${earnings.majak} FLAKE`,
        '[info] ───────────────────────────────────────',
        `[${total >= 0 ? 'success' : 'warning'}]   📊 총 순수익: ${sign}${total} FLAKE`,
        '[info] ═══════════════════════════════════════'
    ];
}

function assertSummaryMatchesState(h) {
    const logs = h.logs();
    const start = logs.indexOf('[success] 💰 최종 FLAKE 수익 요약') - 1;
    assert.ok(start >= 0, 'summary block is printed');
    assert.deepEqual(logs.slice(start, start + 22), expectedSummaryLogs(state));
}

const groupLogs = h => h.logs().filter(line => /(그룹|복구) (시작|완료)|복구 그룹|백그라운드 작업/.test(line));

// ---------------------------------------------------------------------------------------------
// src/api/articles.js
// ---------------------------------------------------------------------------------------------

test('articles API: list and comment use lounge headers, like/status/create use the raw headers', async t => {
    const h = useHarness(t);
    h.on('GET', `${API}/stadium-api/v1.0/today/all?size=30`, { code: 0, value: { list: [{ article_id: 1 }] } })
        .on('GET', `${API}/stadium-api/v1.0/today/all?size=5`, { code: 0 })
        .on('PUT', `${API}/postie/v1.0/article/7/interaction/LIKE`, { code: 0 })
        .on('GET', `${API}/postie/v1.0/article/7,8/interaction/LIKE?timestemp=${DEFAULT_NOW}`,
            [{ code: 0, value: { 7: { LIKE: true }, 8: { LIKE: false } } }, { code: 0 }])
        .on('POST', `${API}/postie/v1.0/article/7/comment`, [{ code: 0, value: { comment_id: 55 } }, { code: 0 }])
        .on('POST', `${API}/postie/v1.0/article`, [{ code: 0, value: { article_id: 99 } }, { code: 0 }]);

    assert.deepEqual(await getArticleList(TEST_HEADERS), [{ article_id: 1 }]);
    assert.deepEqual(await getArticleList(TEST_HEADERS, 5), [], 'missing value.list falls back to []');
    assert.equal(await likeArticle(TEST_HEADERS, 7), undefined);
    assert.deepEqual(await checkArticleLikeStatus(TEST_HEADERS, [7, 8]), { 7: { LIKE: true }, 8: { LIKE: false } });
    assert.deepEqual(await checkArticleLikeStatus(TEST_HEADERS, [7, 8]), {}, 'missing value falls back to {}');
    assert.equal(await postComment(TEST_HEADERS, 7, '굿'), 55);
    assert.equal(await postComment(TEST_HEADERS, 7, '굿'), undefined);
    assert.equal(await createArticle(TEST_HEADERS, '출석', '출석'), 99);
    assert.equal(await createArticle(TEST_HEADERS, '제목', '본문', ['태그']), undefined);

    assert.deepEqual(h.requests, [
        { method: 'GET', url: `${API}/stadium-api/v1.0/today/all?size=30`, headers: LOUNGE_HEADERS, body: null },
        { method: 'GET', url: `${API}/stadium-api/v1.0/today/all?size=5`, headers: LOUNGE_HEADERS, body: null },
        { method: 'PUT', url: `${API}/postie/v1.0/article/7/interaction/LIKE`, headers: TEST_HEADERS, body: null },
        { method: 'GET', url: `${API}/postie/v1.0/article/7,8/interaction/LIKE?timestemp=${DEFAULT_NOW}`, headers: TEST_HEADERS, body: null },
        { method: 'GET', url: `${API}/postie/v1.0/article/7,8/interaction/LIKE?timestemp=${DEFAULT_NOW}`, headers: TEST_HEADERS, body: null },
        { method: 'POST', url: `${API}/postie/v1.0/article/7/comment`, headers: LOUNGE_HEADERS,
            body: { article_id: 7, content: '<p>굿</p>', attached: { media_ids: [] } } },
        { method: 'POST', url: `${API}/postie/v1.0/article/7/comment`, headers: LOUNGE_HEADERS,
            body: { article_id: 7, content: '<p>굿</p>', attached: { media_ids: [] } } },
        { method: 'POST', url: `${API}/postie/v1.0/article`, headers: TEST_HEADERS, body: {
            title: '출석', content: '<p>출석</p>', attached: { media_ids: [], file_ids: [], poll_ids: [] },
            status: 'PUBLISHED', category: null, coverage: 'PUBLIC', learning_data: true, reservation: null,
            tags: ['자유주제', '출석체크'] } },
        { method: 'POST', url: `${API}/postie/v1.0/article`, headers: TEST_HEADERS, body: {
            title: '제목', content: '<p>본문</p>', attached: { media_ids: [], file_ids: [], poll_ids: [] },
            status: 'PUBLISHED', category: null, coverage: 'PUBLIC', learning_data: true, reservation: null,
            tags: ['태그'] } }
    ]);
});

test('articles API: like status for no ids answers {} without a request; HTTP errors reject', async t => {
    const h = useHarness(t);
    h.on('PUT', `${API}/postie/v1.0/article/7/interaction/LIKE`, httpError(500))
        .on('POST', `${API}/postie/v1.0/article/7/comment`, httpError(429));

    assert.deepEqual(await checkArticleLikeStatus(TEST_HEADERS, []), {});
    assert.deepEqual(await checkArticleLikeStatus(TEST_HEADERS, null), {});
    assert.equal(h.requests.length, 0);
    await assert.rejects(likeArticle(TEST_HEADERS, 7), /API Error: 500/);
    await assert.rejects(postComment(TEST_HEADERS, 7, '굿'), /API Error: 429/);
});

// ---------------------------------------------------------------------------------------------
// src/utils/audio.js
// ---------------------------------------------------------------------------------------------

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

test('handler articleWrite: skipped without any write when today\'s article exists', async t => {
    const h = useHarness(t);
    installAutomationWorld(h, { articleWritten: true });
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS });

    assert.deepEqual(await handlers.articleWrite(), {
        skipped: true, reason: 'alreadyWritten', writeStatus: { success: true, hasWrittenToday: true, todayCount: 1 }
    });
    assert.deepEqual(h.requests.map(describe), [
        'GET /postie/v1.0/user/me',
        `GET /postie/v1.0/interest/user/${USER_ID}/article/list`
    ]);
    assert.equal(state.progress.newArticle, 0);
    assert.deepEqual(h.logs(), []);
});

test('handler articleWrite: writes the 출석 article and counts it once', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h);
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS });

    assert.deepEqual(await handlers.articleWrite(), { articleId: 99001 });
    assert.equal(state.progress.newArticle, 1);
    assert.deepEqual(world.audit.articlesCreated, [99001]);
    assert.deepEqual(h.requests.filter(isWrite), [{
        method: 'POST', url: `${API}/postie/v1.0/article`, headers: TEST_HEADERS, body: {
            title: '출석', content: '<p>출석</p>', attached: { media_ids: [], file_ids: [], poll_ids: [] },
            status: 'PUBLISHED', category: null, coverage: 'PUBLIC', learning_data: true, reservation: null,
            tags: ['자유주제', '출석체크'] }
    }]);
});

test('handler articleWrite: an unknown write status still writes (no "already written" proof needed)', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h, { articleWritten: true, overrides: { profile: () => httpError(500) } });
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS });

    assert.deepEqual(await handlers.articleWrite(), { articleId: 99001 });
    assert.deepEqual(world.audit.articlesCreated, [99001], 'a second article is written although one exists today');
});

test('handler articleWrite: missing article id and HTTP failure are returned as task errors', async t => {
    const h = useHarness(t);
    installAutomationWorld(h, { overrides: {
        createArticle: (request, callIndex) => (callIndex === 0 ? { code: 0, value: {} } : httpError(500))
    } });
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS });

    assert.deepEqual(await handlers.articleWrite(), { error: true, message: 'Article creation returned no article id' });
    assert.deepEqual(h.logs(), []);
    assert.deepEqual(await handlers.articleWrite(), { error: true, message: 'API Error: 500 Error' });
    assert.deepEqual(h.logs(), [
        '[error] 새글 작성 실패: API Error: 500 Error',
        '[warning] 새글 작성 실패했지만 자동화를 계속 진행합니다'
    ]);
    assert.equal(state.progress.newArticle, 0);
});

test('handler articleLikes: skips already-liked articles, likes up to the target, records failures', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h, {
        overrides: { like: (request, callIndex, next) => (request.url.includes('/70005/') ? httpError(500) : next()) }
    });
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS, articles: world.articles });

    assert.deepEqual(await handlers.articleLikes(), {
        attempted: 10, liked: 9, errors: [{ articleId: 70005, message: 'API Error: 500 Error' }]
    });
    assert.deepEqual(h.requests.map(describe), [
        `GET /postie/v1.0/article/${ALL_ARTICLE_IDS.join(',')}/interaction/LIKE`,
        ...ALL_ARTICLE_IDS.slice(3).map(id => `PUT /postie/v1.0/article/${id}/interaction/LIKE`)
    ]);
    assert.equal(state.progress.articleLikes, 9);
    assert.deepEqual(h.delays, Array(9).fill(CONFIG.delays.betweenActions), 'no delay after the last like');
    assert.deepEqual(h.logs().slice(0, 3), [
        '[success] 게시글 70004 좋아요 완료 (1/10)',
        '[error] 게시글 70005 좋아요 실패: API Error: 500 Error',
        '[success] 게시글 70006 좋아요 완료 (2/10)'
    ]);
    assert.deepEqual(world.audit.duplicateLikes, []);
});

test('handler articleLikes: considers only the first target×3 articles', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h, { articleCount: 40, likedArticleIds: [] });
    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS, articles: world.articles });

    const result = await handlers.articleLikes();
    assert.equal(result.liked, 10);
    const statusIds = pathOf(h.requests[0].url).split('/')[4].split(',');
    assert.equal(statusIds.length, 30);
    assert.deepEqual(world.audit.likes, world.articles.slice(0, 10).map(article => article.article_id));
});

test('handler articleLikes: no articles means no request; a failed status read rejects the task', async t => {
    const h = useHarness(t);
    installAutomationWorld(h, { overrides: { likeStatus: () => httpError(503) } });
    assert.deepEqual(await createAutomationTaskHandlers({ headers: TEST_HEADERS }).articleLikes(),
        { attempted: 0, liked: 0, errors: [] });
    assert.equal(h.requests.length, 0);

    const handlers = createAutomationTaskHandlers({ headers: TEST_HEADERS, articles: [{ article_id: 70001 }] });
    await assert.rejects(handlers.articleLikes(), /API Error: 503/);
});

test('handler reviewEvent: waits afterComment only after comments were attempted', async t => {
    const h = useHarness(t);
    const world = installAutomationWorld(h, { reviewEvent: 'none' });
    const skipped = { success: true, reason: 'noEvent', actionable: false, skipped: true };

    const withComments = createAutomationTaskHandlers({ headers: TEST_HEADERS, articles: world.articles.slice(0, 2) });
    const comments = await withComments.comments();
    assert.deepEqual(comments, { attempted: 2, commentIds: [880001, 880002], errors: [] });
    assert.deepEqual(await withComments.reviewEvent(), skipped);
    assert.deepEqual(h.delays, [CONFIG.delays.afterComment, CONFIG.delays.afterComment],
        'one gap between the two comments, then the afterComment wait before the review event');

    h.delays.length = 0;
    const noArticles = createAutomationTaskHandlers({ headers: TEST_HEADERS, articles: [] });
    assert.deepEqual(await noArticles.comments(), { attempted: 0, commentIds: [], errors: [] });
    assert.deepEqual(await noArticles.reviewEvent(), skipped);
    assert.deepEqual(await createAutomationTaskHandlers({ headers: TEST_HEADERS }).reviewEvent(), skipped,
        'reviewEvent before comments were started does not wait either');
    assert.deepEqual(h.delays, []);
    assert.deepEqual(state.createdCommentIds, [880001, 880002]);
    assert.equal(state.progress.comments, 2);
});

test('handlers collect page/daily/content/banner tabs for closing, but not single-visit tabs', async t => {
    const h = useHarness(t);
    useAutomationWorld(t, h);
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
            '[info] 🚀 전체 자동화 시작',
            '[info] 헤더 정보 추출 중...',
            `[error] ✗ 오류 발생: ${message}`
        ]);
        assert.equal(state.isRunning, false);
        assert.equal(h.sounds.length, 0);
    });
}

test('runAutomation: no lounge articles → error signal after the read-only snapshot, nothing written', async t => {
    const h = useHarness(t);
    useAutomationWorld(t, h, { articleCount: 0 });
    await runAutomation();

    assert.deepEqual(h.titles, [RUNNING_TITLE, '[SG_ERROR] 게시글 없음 | STOVE']);
    assert.deepEqual(h.requests.filter(isWrite), []);
    assert.deepEqual(h.tabs, []);
    assert.deepEqual(h.logs().slice(-3), ['[info] 게시글 목록 가져오는 중...', '[success] 게시글 0개 발견', '[error] 게시글이 없습니다']);
    assert.equal(state.isRunning, false);
    assertGolden('automation/no-articles', h.snapshot({ unordered: true }));
});

// ---------------------------------------------------------------------------------------------
// runAutomation: whole runs
// ---------------------------------------------------------------------------------------------

test('runAutomation fresh day: every task runs once, no repair, done signal, sound, tabs closed', async t => {
    assertTimezonePinned();
    const h = useHarness(t);
    const world = useAutomationWorld(t, h);
    await runAutomation();

    assertGolden('automation/fresh-day', h.snapshot({ unordered: true }));

    // Signals for the external bot, completion sound, progress widget.
    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    assert.equal(h.sounds.length, 1);
    assert.equal(h.document.getElementById('stove-progress-text').textContent, '100%');
    assert.equal(h.document.querySelector('.stove-progress-fill').style.width, '100%');
    assert.deepEqual(h.logs().filter(line => line.startsWith('[error]')), []);
    assert.equal(state.isRunning, false);
    assert.deepEqual(state.completed, { ...state.completed, roulette: true, dailyShop: true, majak: true });

    // Groups run in plan order; the background comment task is awaited after the last group.
    assert.deepEqual(groupLogs(h), [
        '[info] 그룹 시작: setup', '[success] 그룹 완료: setup (3/3)',
        '[info] 그룹 시작: community', '[success] 그룹 완료: community (2/2, 백그라운드 1개)',
        '[info] 그룹 시작: visits', '[success] 그룹 완료: visits (4/4)',
        '[info] 그룹 시작: boost', '[success] 그룹 완료: boost (1/1)',
        '[info] 그룹 시작: missionClaims', '[success] 그룹 완료: missionClaims (3/3)',
        '[info] 그룹 시작: flakeSpending', '[success] 그룹 완료: flakeSpending (3/3)',
        '[info] 그룹 시작: followups', '[success] 그룹 완료: followups (3/3)',
        '[info] 그룹 시작: reviewEvent', '[success] 그룹 완료: reviewEvent (1/1)',
        '[info] 백그라운드 작업 대기: community (1개)', '[success] 백그라운드 작업 완료: community (1/1)'
    ]);
    assert.ok(!h.logs().some(line => line.includes('안전 복구')), 'no repair pass on a clean run');

    // Serial-by-design order: the before snapshot is read-only and finishes before the article list;
    // FLAKE spending (draws → EXTRA → prize entry → prize mission claim) runs after mission claims.
    const requests = h.requests;
    const articleListIndex = requests.findIndex(request => pathOf(request.url) === '/stadium-api/v1.0/today/all');
    assert.ok(articleListIndex > 0);
    assert.ok(requests.slice(0, articleListIndex).every(request => request.method === 'GET'));
    const serial = requests.filter(request => !isLoungeComment(request));
    const positions = predicate => serial.flatMap((request, index) => (predicate(request) ? [index] : []));
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
        // Single-visit rewards (missions 1001/1002, 20 FLAKE) are claimed but never added to earnings.
        dailyMissions: 0, contentMissions: 20, weeklyMissions: 100, bannerMissions: 15,
        attendanceMissions: 30, surveyMissions: 5, prizeEntry: -200, dailyAccumulated: 100,
        boostMission: 3000
    });
    // Weekly/attendance/survey claims run concurrently, so compare the claimed set, not its order.
    assert.deepEqual([...world.audit.missionClaims].sort((a, b) => a - b),
        [PRIZE_MISSION_NO, 1001, 1002, 2001, 3001, 4001, 5001, 6002]);

    // Tabs: everything collected is closed at the end; the single-visit tab is never collected (leak).
    assert.deepEqual(h.tabs.filter(tab => !tab.closed).map(({ url, active, closed }) => ({ url, active, closed })), [{ url: SINGLE_VISIT_URL, active: false, closed: false }]);
    assert.deepEqual(h.logs().slice(-7), [
        '[info] ',
        '[info] 📊 상태 업데이트 중...',
        '[success] ✅ 상태 업데이트 완료!',
        '[info] ',
        '[success] 🎊 모든 작업이 완료되었습니다!',
        '[info] 🔒 열린 탭 4개 닫는 중...',
        '[success] ✓ 모든 탭 닫힘'
    ]);
    assert.deepEqual(JSON.parse(h.window.localStorage.getItem(MONTHLY_RECORD_KEY)), { date: '2026-10-16', counts: { 6001: 5 } });
});

test('runAutomation same-day re-run: no FLAKE spent, nothing claimed twice, only comments are written again', async t => {
    const h = useHarness(t);
    const world = useAutomationWorld(t, h);
    await runAutomation();
    const firstRun = h.requests.length;
    const claimsBefore = structuredClone(world.audit);
    h.titles.length = 0;

    await runAutomation();
    const rerun = h.requests.slice(firstRun);

    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    assert.deepEqual(rerun.filter(isWrite).map(describe), world.articles.slice(0, 5).map(article =>
        `POST /postie/v1.0/article/${article.article_id}/comment {"article_id":${article.article_id},"content":"<p>잘봤어요</p>","attached":{"media_ids":[]}}`));
    assert.deepEqual({ ...world.audit, comments: [] }, { ...claimsBefore, comments: [] });
    assertNoRewardClaimedTwice(world);
    assert.equal(world.audit.draws, 2);
    assert.equal(world.audit.prizeApplies, 1);
    assert.ok(h.logs().includes('[success] 스냅샷 비교: 글 확인, 미션 0개, 데일리 0개, 마작 0개, EXTRA 0개, 월간출석 +1 0/1 (오늘 이미 반영 1개)'));
});

test('runAutomation everything already done: comments are the only writes, success', async t => {
    const h = useHarness(t);
    const world = useAutomationWorld(t, h, DONE_WORLD);
    h.window.localStorage.setItem(MONTHLY_RECORD_KEY, JSON.stringify({ date: '2026-10-16', counts: { 6001: 5 } }));
    await runAutomation();

    assertGolden('automation/all-done', h.snapshot({ unordered: true }));
    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    assert.equal(h.sounds.length, 1);
    assert.deepEqual(h.logs().filter(line => line.startsWith('[error]') || line.startsWith('[warning]')), []);

    // Comments are not idempotent: five new comments are posted on every run.
    assert.deepEqual(h.requests.filter(isWrite).map(describe), world.articles.slice(0, 5).map(article =>
        `POST /postie/v1.0/article/${article.article_id}/comment {"article_id":${article.article_id},"content":"<p>잘봤어요</p>","attached":{"media_ids":[]}}`));
    assertFlakeSpendingWithinLimits(h, world, 30);
    assert.equal(h.requests.filter(isDraw).length + h.requests.filter(isPrizeApply).length, 0);
    assertNoRewardClaimedTwice(world);
    assertSummaryMatchesState(h);
    assert.ok(h.logs().includes('[info] 자동화 그룹 5개 실행'), 'setup, community, visits, missionClaims, followups');
    assert.deepEqual(h.tabs.map(({ url, active, closed }) => ({ url, active, closed })), [
        { url: 'https://reward.onstove.com/ko', active: false, closed: true },
        { url: 'https://store.onstove.com/', active: false, closed: true }
    ]);
});

test('runAutomation partial failure: repair pass, "확인 필요" warning and error signal', async t => {
    const h = useHarness(t);
    CONFIG.preRegistration.campaigns[0].endDate = '2026-10-31';
    let mission1001Attempts = 0;
    const world = useAutomationWorld(t, h, {
        roulettePrizes: [50],
        overrides: {
            createArticle: () => httpError(500),
            likeStatus: () => httpError(500),
            comment: (request, callIndex, next) => (callIndex === 1 ? httpError(500) : next()),
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

    const issues = '작업 실패 4개, 글·미션·보상 미완료, 사전등록 확인 필요';
    assert.deepEqual(h.titles, [RUNNING_TITLE, `[SG_ERROR] ${issues} | STOVE`]);
    assert.equal(h.sounds.length, 0);
    assert.equal(h.document.getElementById('stove-progress-text').textContent, '확인 필요');
    const logs = h.logs();
    for (const line of [
        `[warning] 전체 자동화 종료 · 확인 필요: ${issues}`,
        `[warning] 일부 작업이 실패했거나 확인이 필요합니다: ${issues}`,
        // Quirk: the group id is printed twice ("group/group:task") because task ids already carry it.
        '[error] 작업 실패: community/community:articleWrite: API Error: 500 Error',
        '[error] 작업 실패: community/community:articleLikes: API Error: 500 Error',
        '[error] 작업 실패: community/community:comments: API Error: 500 Error',
        '[error] 작업 실패: repairSafe/repairSafe:articleWrite: API Error: 500 Error',
        '[warning] 그룹 완료: community (0/2, 백그라운드 1개)',
        '[warning] 백그라운드 작업 완료: community (0/1)',
        '[warning] 스냅샷 비교: 글 미완료, 미션 1개, 데일리 1개, 마작 0개, EXTRA 0개, 월간출석 +1 1/1',
        '[warning] 안전 복구 대상 확인 중...',
        '[warning] 복구 그룹 1개 실행',
        '[warning] 복구 완료: repairSafe (2/3)',
        '[warning] 복구 후 비교: 글 미완료, 미션 0개, 데일리 0개, 마작 0개, EXTRA 0개, 월간출석 +1 1/1',
        '[warning] 사전등록 확인 필요: luvplace: API Error: 500 Error',
        // Roulette lost 100 FLAKE but the line borrows the positive total's '+' sign.
        '[warning]   🎰 룰렛 순수익: +-100 FLAKE'
    ]) {
        assert.ok(logs.includes(line), `missing log: ${line}`);
    }
    assertSummaryMatchesState(h);
    assert.ok(!issues.includes('위클리'), 'the failing weekly claim is not reported as an issue');

    // Repair retried the article (still failing), the visit mission and the daily shop claim.
    assert.deepEqual(world.audit.articlesCreated, []);
    assert.equal(h.requests.filter(request => request.method === 'POST' && pathOf(request.url) === '/postie/v1.0/article').length, 2);
    assert.equal(mission1001Attempts, 3);
    assert.deepEqual(world.audit.shopClaims, [902, 911, 802],
        'majak first, then the repaired daily claim; the accumulated 15-day reward stays unclaimed');
    assertFlakeSpendingWithinLimits(h, world, 28);
    assertNoRewardClaimedTwice(world);
});

test('runAutomation monthly attendance: unread +1 focuses the reward shop and rechecks until it shows', async t => {
    const h = useHarness(t);
    useAutomationWorld(t, h, { attendanceTrigger: 'focusedRewardTab' });
    await runAutomation();

    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    const logs = h.logs();
    const focusLine = logs.indexOf('[warning] 월간출석 +1 확인이 안 되어 리워드샵으로 포커스를 이동합니다');
    assert.ok(focusLine > logs.indexOf('[warning] 스냅샷 비교: 글 확인, 미션 0개, 데일리 0개, 마작 0개, EXTRA 0개, 월간출석 +1 0/1 (미증가 1개, 확인불가 0개)'));
    assert.equal(logs[focusLine + 1], '[success] 월간출석 재확인 1/3: 월간출석 +1 1/1');
    assert.ok(!logs.some(line => line.includes('안전 복구')));
    assert.deepEqual(h.tabs.filter(tab => !tab.closed).map(({ url, active, closed }) => ({ url, active, closed })), [
        { url: SINGLE_VISIT_URL, active: false, closed: false },
        { url: REWARD_SHOP_TAB, active: true, closed: false }
    ], 'the focused reward shop tab is left open on purpose');
    assert.equal(h.delays.filter(ms => ms === 3000).length, 4, 'content/banner/review visit waits + one recheck');
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
    useAutomationWorld(t, h, {
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
    let staleServed = false;
    const world = useAutomationWorld(t, h, {
        overrides: {
            // The first daily-shop read after both shop claims (= the final snapshot) still shows
            // today's reward as unclaimed; the next read is up to date.
            dailyShop: (request, callIndex, next) => {
                const body = next();
                if (!staleServed && world.audit.shopClaims.includes(812)) {
                    staleServed = true;
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
        '[warning] 스냅샷 비교: 글 확인, 미션 0개, 데일리 1개, 마작 0개, EXTRA 0개, 월간출석 +1 1/1',
        '[warning] 안전 복구 대상 확인 중...',
        '[success] 재확인 결과: 글 확인, 미션 0개, 데일리 0개, 마작 0개, EXTRA 0개, 월간출석 +1 1/1'
    ]);
    assert.deepEqual(world.audit.shopClaims, [802, 812, 902, 911]);
    assertNoRewardClaimedTwice(world);
});

test('runAutomation without Web Locks: boost and review event abort, run ends with "확인 필요"', async t => {
    const h = useHarness(t);
    const world = useAutomationWorld(t, h, { webLocks: false });
    await runAutomation();

    const issues = '작업 실패 2개, 오늘의 1등 보상 확인 필요';
    assert.deepEqual(h.titles, [RUNNING_TITLE, `[SG_ERROR] ${issues} | STOVE`]);
    const logs = h.logs();
    for (const line of [
        '[warning] 그룹 완료: boost (0/1)',
        '[warning] 그룹 완료: reviewEvent (0/1)',
        '[error] 작업 실패: boost/boost:boostMission: 부스트 중복 실행 잠금을 사용할 수 없습니다',
        '[error] 작업 실패: reviewEvent/reviewEvent:comment: 게임 리뷰 중복 실행 잠금을 사용할 수 없습니다',
        '[warning] 오늘의 1등 보상 상태를 확인하지 못했습니다. 대시보드를 확인해 주세요'
    ]) {
        assert.ok(logs.includes(line), `missing log: ${line}`);
    }
    assert.deepEqual([world.audit.boosts, world.audit.boostRewards, world.audit.reviewComments], [[], 0, 0]);
    assertNoRewardClaimedTwice(world);
});

test('runAutomation: roulette event closed mid-day (7019) stops drawing and reports "룰렛 미완료"', async t => {
    const h = useHarness(t);
    const world = useAutomationWorld(t, h, {
        overrides: { rouletteDraw: () => ({ code: 7019, message: '이벤트 기간이 아닙니다' }) }
    });
    await runAutomation();

    assert.deepEqual(h.titles, [RUNNING_TITLE, '[SG_ERROR] 룰렛 미완료 | STOVE']);
    assert.equal(h.requests.filter(isDraw).length, 1, 'the first 7019 answer stops the roulette');
    assert.ok(h.logs().includes('[warning] ⚠️ 룰렛 이벤트 기간이 아닙니다'));
    assert.ok(h.logs().includes('[warning] 전체 자동화 종료 · 확인 필요: 룰렛 미완료'));
    assert.equal(state.completed.roulette, false, 'final flag comes from the snapshot, not from the roulette task');
    assert.equal(world.audit.prizeApplies, 1, 'prize entry still runs after the roulette stops');
    assert.equal(h.sounds.length, 0);
});

test('runAutomation: roulette disabled still schedules the draw task, which only warns; no roulette issue', async t => {
    const h = useHarness(t);
    CONFIG.roulette.enabled = false;
    const world = useAutomationWorld(t, h);
    await runAutomation();

    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE]);
    assert.equal(h.requests.filter(isDraw).length, 0);
    assert.equal(world.audit.draws, 0);
    assert.ok(h.logs().includes('[warning] ⚠️ 룰렛 기능이 비활성화되어 있습니다'));
    assert.ok(h.logs().includes('[success] 그룹 완료: flakeSpending (3/3)'), 'draw, EXTRA and prize tasks are all planned');
    assert.equal(state.completed.roulette, true);
    assert.equal(state.earnings.roulette, 0);
});

test('runAutomation: a non-numeric reward amount turns the total into a warning and 0', async t => {
    const h = useHarness(t);
    useAutomationWorld(t, h, {
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
        '[success]   ✓ "주간 출석 5회": +N/A FLAKE',
        '[warning] ⚠️ 수익 계산 오류 발생 - 일부 값이 유효하지 않음',
        '[info]   📅 위클리 미션: 0N/A FLAKE',
        '[success]   📊 총 순수익: +0 FLAKE'
    ]) {
        assert.ok(logs.includes(line), `missing log: ${line}`);
    }
    assert.deepEqual(h.titles, [RUNNING_TITLE, DONE_TITLE], 'a broken summary does not affect the outcome');
});
