// Characterization of src/workflows/missions.js through the GM boundary. These lock the current
// request sequence, tabs, delays, logs and state before the execute*Missions dedupe refactor.
import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, httpError, TEST_HEADERS } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import {
    COMPONENTS, PARTICIPATE_URL, MISSION_PAGE_URL, componentUrl, prizeApplyUrl,
    loadComponents, mission, componentBody, installMissionWorld
} from '../fixtures/missions.js';
import { CONFIG } from '../../src/config.js';
import { state } from '../../src/state.js';
import {
    executeVisitMission, executeDailyMissions, executeContentMissions, executeWeeklyMissions,
    executeBannerMissions, executeAttendanceMissions, executeSurveyMissions, executePrizeEntry,
    autoParticipateVisitMissions, selectSurveyOption
} from '../../src/workflows/missions.js';
import {
    makeMissionHeaders, getMissionComponentIds, getDailyMissions, getAllDailyMissions,
    receiveMissionReward, participateMission, checkGameOwnership, getDailyMissionStatus
} from '../../src/api/missions.js';

const writes = h => h.requests.filter(request => request.method !== 'GET');

function golden(name, h, extra = {}) {
    assertGolden(`missions/${name}`, { ...h.snapshot(), ...extra });
}

// ---------------------------------------------------------------- executeVisitMission

test('visit mission opens its button URL in a background tab', async t => {
    const h = useHarness(t);
    const result = await executeVisitMission({ title: '라운지 방문', button_url: 'https://page.onstove.com/a' });
    assert.equal(result.success, true);
    assert.ok(result.tab);
    golden('visit-opens-tab', h);
});

test('visit mission reports failure when the tab cannot be opened', async t => {
    const h = useHarness(t);
    globalThis.GM_openInTab = () => { throw new Error('popup blocked'); };
    const result = await executeVisitMission({ title: '라운지 방문', button_url: 'https://page.onstove.com/a' });
    assert.deepEqual(result, { success: false, tab: null });
    golden('visit-open-fails', h);
});

// ---------------------------------------------------------------- executeDailyMissions

test('daily: visits incomplete visit missions, rereads, then claims every receivable reward', async t => {
    const h = useHarness(t);
    loadComponents();
    const world = installMissionWorld(h, {
        [COMPONENTS.daily]: [
            mission(11, { is_visit_mission: true, button_url: 'https://page.onstove.com/11', reward_amount: 20 }),
            mission(12, { is_visit_mission: true, button_url: '   ' }),
            mission(13, { status: 'RECEIVABLE', reward_amount: 30 }),
            mission(14, { status: 'COMPLETE' }),
            mission(15, { is_visit_mission: false, button_url: 'https://page.onstove.com/15' })
        ]
    });

    const tabs = await executeDailyMissions(TEST_HEADERS);

    assert.equal(tabs.length, 1);
    assert.deepEqual(world.participations.map(p => p.missionNo), [11, 13]);
    assert.equal(state.earnings.dailyMissions, 50);
    assert.equal(state.completed.dailyMissions, true);
    golden('daily-visit-and-claim', h);
});

test('daily: merges every active SINGLE component and claims with each mission component', async t => {
    const h = useHarness(t);
    loadComponents({ daily: 227, dailyComponents: [226, 227] });
    const world = installMissionWorld(h, {
        226: [mission(21, { status: 'RECEIVABLE', reward_amount: 5 })],
        227: [mission(22, { status: 'RECEIVABLE', reward_amount: 7 })]
    });

    await executeDailyMissions(TEST_HEADERS);

    assert.deepEqual(world.participations, [{ missionNo: 21, componentNo: 226 }, { missionNo: 22, componentNo: 227 }]);
    assert.equal(state.earnings.dailyMissions, 12);
    golden('daily-multiple-components', h);
});

test('daily: skipMissions are never claimed', async t => {
    const h = useHarness(t);
    loadComponents();
    CONFIG.dailyMissions.skipMissions = [31];
    const world = installMissionWorld(h, {
        [COMPONENTS.daily]: [mission(31, { status: 'RECEIVABLE' }), mission(32, { status: 'RECEIVABLE' })]
    });

    await executeDailyMissions(TEST_HEADERS);

    assert.deepEqual(world.participations.map(p => p.missionNo), [32]);
    golden('daily-skip-missions', h);
});

test('daily: nothing to visit or claim only rereads once and records zero earnings', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, { [COMPONENTS.daily]: [mission(41, { status: 'COMPLETE' })] });

    const tabs = await executeDailyMissions(TEST_HEADERS);

    assert.deepEqual(tabs, []);
    assert.equal(writes(h).length, 0);
    assert.equal(state.completed.dailyMissions, true);
    golden('daily-nothing-to-do', h);
});

test('daily: claim failures add nothing but keep going', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, {
        [COMPONENTS.daily]: [mission(51, { status: 'RECEIVABLE' }), mission(52, { status: 'RECEIVABLE', reward_amount: 9 })]
    }, {
        participate: body => body.mission_no === 51 ? httpError(500) : { code: 0, value: { title: '미션 52', reward_amount: 9 } }
    });

    await executeDailyMissions(TEST_HEADERS);

    assert.equal(writes(h).length, 2);
    assert.equal(state.earnings.dailyMissions, 9);
    golden('daily-claim-failure', h);
});

test('daily: mission list failure marks the step complete with zero earnings', async t => {
    const h = useHarness(t);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.daily), { code: 500, message: 'error' });

    const result = await executeDailyMissions(TEST_HEADERS);

    assert.equal(result, undefined);
    assert.equal(state.completed.dailyMissions, true);
    golden('daily-list-fails', h);
});

test('daily: reread failure stops before claiming', async t => {
    const h = useHarness(t);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.daily), [
        componentBody(COMPONENTS.daily, [mission(61, { is_visit_mission: true, button_url: 'https://page.onstove.com/61' })]),
        httpError(503)
    ]);

    const result = await executeDailyMissions(TEST_HEADERS);

    assert.equal(result, undefined);
    assert.equal(writes(h).length, 0);
    assert.equal(h.tabs.length, 1);
    golden('daily-reread-fails', h);
});

test('daily: components not loaded fails without any request', async t => {
    const h = useHarness(t);
    await executeDailyMissions(TEST_HEADERS);
    assert.equal(h.requests.length, 0);
    golden('daily-no-components', h);
});

test('daily: a malformed missions payload is treated as a list failure', async t => {
    const h = useHarness(t);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.daily), { code: 0, value: { missions: { broken: true } } });

    assert.equal(await executeDailyMissions(TEST_HEADERS), undefined);
    assert.equal(state.completed.dailyMissions, true);
    golden('daily-malformed-payload', h);
});

test('daily: an unexpected mission field type is caught by the workflow and logged', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, { [COMPONENTS.daily]: [mission(71, { is_visit_mission: true, button_url: 123 })] });

    const tabs = await executeDailyMissions(TEST_HEADERS);

    assert.deepEqual(tabs, []);
    assert.equal(state.completed.dailyMissions, false);
    golden('daily-unexpected-field', h);
});

test('daily: disabled sends nothing', async t => {
    const h = useHarness(t);
    loadComponents();
    CONFIG.dailyMissions.enabled = false;
    assert.equal(await executeDailyMissions(TEST_HEADERS), undefined);
    assert.equal(h.requests.length, 0);
    golden('daily-disabled', h);
});

// ---------------------------------------------------------------- executeContentMissions

test('content: opens incomplete content URLs, waits, rereads, and claims receivable rewards', async t => {
    const h = useHarness(t);
    loadComponents();
    const world = installMissionWorld(h, {
        [COMPONENTS.content]: [
            mission(101, { title: '아주 긴 컨텐츠 미션 제목은 삼십 글자에서 잘려서 로그에 표시됩니다', url: 'https://page.onstove.com/101', reward_amount: 15 }),
            mission(102, { url: '' }),
            mission(103, { status: 'RECEIVABLE', reward_amount: 25 }),
            mission(104, { status: 'COMPLETED' })
        ]
    });

    const tabs = await executeContentMissions(TEST_HEADERS);

    assert.equal(tabs.length, 1);
    assert.deepEqual(world.participations.map(p => p.missionNo), [101, 103]);
    assert.ok(world.participations.every(p => p.componentNo === COMPONENTS.content));
    assert.equal(state.earnings.contentMissions, 40);
    golden('content-visit-and-claim', h);
});

test('content: nothing incomplete still rereads before reporting no rewards', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, { [COMPONENTS.content]: [mission(111, { status: 'COMPLETE' })] });

    await executeContentMissions(TEST_HEADERS);

    assert.equal(h.requests.length, 2);
    assert.equal(state.completed.contentMissions, true);
    golden('content-nothing-to-do', h);
});

test('content: list failure completes with zero earnings', async t => {
    const h = useHarness(t);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.content), { code: 1, message: 'nope' });

    await executeContentMissions(TEST_HEADERS);

    assert.equal(state.completed.contentMissions, true);
    assert.equal(state.earnings.contentMissions, 0);
    golden('content-list-fails', h);
});

test('content: reread failure returns early without marking completion', async t => {
    const h = useHarness(t);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.content), [
        componentBody(COMPONENTS.content, [mission(121, { status: 'RECEIVABLE' })]),
        { code: 1 }
    ]);

    const result = await executeContentMissions(TEST_HEADERS);

    assert.equal(result, undefined);
    assert.equal(state.completed.contentMissions, false);
    assert.equal(writes(h).length, 0);
    golden('content-reread-fails', h);
});

test('content: request errors are caught and logged', async t => {
    const h = useHarness(t);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.content), httpError(500));

    const tabs = await executeContentMissions(TEST_HEADERS);

    assert.deepEqual(tabs, []);
    golden('content-request-error', h);
});

test('content: tab failures are logged per mission', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, { [COMPONENTS.content]: [mission(131, { url: 'https://page.onstove.com/131' })] }, { visitCompletes: false });
    globalThis.GM_openInTab = () => { throw new Error('popup blocked'); };

    const tabs = await executeContentMissions(TEST_HEADERS);

    assert.deepEqual(tabs, []);
    golden('content-tab-fails', h);
});

test('content: missing component or disabled sends nothing', async t => {
    const h = useHarness(t);
    await executeContentMissions(TEST_HEADERS);
    assert.equal(state.completed.contentMissions, true);
    loadComponents();
    CONFIG.contentMissions.enabled = false;
    await executeContentMissions(TEST_HEADERS);
    assert.equal(h.requests.length, 0);
    golden('content-missing-and-disabled', h);
});

// ---------------------------------------------------------------- executeWeeklyMissions

test('weekly: claims receivable rewards and logs incomplete progress', async t => {
    const h = useHarness(t);
    loadComponents();
    const world = installMissionWorld(h, {
        [COMPONENTS.weekly]: [
            mission(201, { status: 'RECEIVABLE', reward_amount: 100 }),
            mission(202, { status: 'RECEIVABLE', reward_amount: 0 }),
            mission(203, { status: 'INCOMPLETE', user_complete_cnt: 2, milestone_total_cnt: 5 }),
            mission(204, { status: 'INCOMPLETE' }),
            mission(205, { status: 'COMPLETED' })
        ]
    });

    await executeWeeklyMissions(TEST_HEADERS);

    assert.deepEqual(world.participations.map(p => p.missionNo), [201, 202]);
    assert.equal(state.earnings.weeklyMissions, 100);
    golden('weekly-claim-and-progress', h);
});

test('weekly: nothing receivable', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, { [COMPONENTS.weekly]: [mission(211, { status: 'COMPLETE' })] });
    await executeWeeklyMissions(TEST_HEADERS);
    assert.equal(writes(h).length, 0);
    golden('weekly-nothing-receivable', h);
});

test('weekly: unavailable list, request errors and missing component all complete quietly', async t => {
    const h = useHarness(t);
    await executeWeeklyMissions(TEST_HEADERS);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.weekly), [{ code: 1 }, httpError(500)]);
    await executeWeeklyMissions(TEST_HEADERS);
    await executeWeeklyMissions(TEST_HEADERS);
    assert.equal(state.completed.weeklyMissions, true);
    assert.equal(state.earnings.weeklyMissions, 0);
    CONFIG.weeklyMissions.enabled = false;
    await executeWeeklyMissions(TEST_HEADERS);
    assert.equal(h.requests.length, 2);
    golden('weekly-unavailable', h);
});

// ---------------------------------------------------------------- executeBannerMissions

test('banner: visits banners with URLs, waits, rereads, then claims and reports totals', async t => {
    const h = useHarness(t);
    loadComponents();
    const world = installMissionWorld(h, {
        [COMPONENTS.banner]: [
            mission(301, { title: '배너<br>하나', button_url: 'https://page.onstove.com/301', reward_amount: 50 }),
            mission(302, { title: '배너 둘', button_url: '' }),
            mission(303, { status: 'RECEIVABLE', reward_amount: 70 }),
            mission(304, { status: 'COMPLETE' })
        ]
    });

    const tabs = await executeBannerMissions(TEST_HEADERS);

    assert.equal(tabs.length, 1);
    assert.deepEqual(world.participations.map(p => p.missionNo), [301, 303]);
    assert.equal(state.earnings.bannerMissions, 120);
    golden('banner-visit-and-claim', h);
});

test('banner: reread failure falls back to the first list', async t => {
    const h = useHarness(t);
    loadComponents();
    const missions = [
        mission(311, { button_url: 'https://page.onstove.com/311' }),
        mission(312, { status: 'RECEIVABLE', reward_amount: 5 })
    ];
    h.on('GET', componentUrl(COMPONENTS.banner), [
        componentBody(COMPONENTS.banner, missions), { code: 0, value: {} },
        componentBody(COMPONENTS.banner, missions), httpError(500)
    ]);
    h.on('POST', PARTICIPATE_URL, [{ code: 0, value: { title: '미션 312', reward_amount: 5 } }, { code: 1 }]);

    await executeBannerMissions(TEST_HEADERS);
    await executeBannerMissions(TEST_HEADERS);

    assert.deepEqual(writes(h).map(request => request.body.mission_no), [312, 312]);
    golden('banner-reread-fallback', h);
});

test('banner: only URL-less incomplete banners skip the wait and reread', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, { [COMPONENTS.banner]: [mission(321, { button_url: null })] });
    await executeBannerMissions(TEST_HEADERS);
    assert.equal(h.requests.length, 1);
    golden('banner-no-urls', h);
});

test('banner: nothing actionable, missing data, errors, missing component and disabled', async t => {
    const h = useHarness(t);
    await executeBannerMissions(TEST_HEADERS);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.banner), [
        componentBody(COMPONENTS.banner, [mission(331, { status: 'COMPLETED' })]),
        { code: 0 },
        httpError(500)
    ]);
    await executeBannerMissions(TEST_HEADERS);
    await executeBannerMissions(TEST_HEADERS);
    await executeBannerMissions(TEST_HEADERS);
    CONFIG.bannerMissions.enabled = false;
    await executeBannerMissions(TEST_HEADERS);
    assert.equal(writes(h).length, 0);
    golden('banner-edge-cases', h);
});

// ---------------------------------------------------------------- executeAttendanceMissions

test('attendance: claims receivable rewards and logs failures', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, {
        [COMPONENTS.attendance]: [
            mission(401, { status: 'RECEIVABLE', reward_amount: 300 }),
            mission(402, { status: 'RECEIVABLE' })
        ]
    }, {
        participate: body => body.mission_no === 401 ? { code: 0, value: { reward_amount: 300 } } : { code: 9 }
    });

    await executeAttendanceMissions(TEST_HEADERS);

    assert.equal(state.earnings.attendanceMissions, 300);
    golden('attendance-claim', h);
});

test('attendance: no receivable rewards logs progress of incomplete missions', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, {
        [COMPONENTS.attendance]: [
            mission(411, { user_complete_cnt: 3, milestone_per_cnt: 7, milestone_total_cnt: 28 }),
            mission(412, { milestone_total_cnt: 14 })
        ]
    });
    await executeAttendanceMissions(TEST_HEADERS);
    assert.equal(writes(h).length, 0);
    golden('attendance-progress', h);
});

test('attendance: missing data, errors, missing component and disabled', async t => {
    const h = useHarness(t);
    await executeAttendanceMissions(TEST_HEADERS);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.attendance), [{ code: 0 }, httpError(500)]);
    await executeAttendanceMissions(TEST_HEADERS);
    await executeAttendanceMissions(TEST_HEADERS);
    CONFIG.attendanceMissions.enabled = false;
    await executeAttendanceMissions(TEST_HEADERS);
    golden('attendance-edge-cases', h);
});

// ---------------------------------------------------------------- surveys

test('selectSurveyOption picks by strategy', t => {
    useHarness(t, { random: 0.7 });
    const infos = [{ content_no: 1, percent: 20 }, { content_no: 2, percent: 50 }, { content_no: 3, percent: 30 }];
    assert.equal(selectSurveyOption(infos), 2);
    assert.equal(selectSurveyOption(infos, 'highest'), 2);
    assert.equal(selectSurveyOption(infos, 'lowest'), 1);
    assert.equal(selectSurveyOption(infos, 'random'), 3);
    assert.equal(selectSurveyOption(infos, 'unknown'), 2);
    assert.equal(selectSurveyOption([], 'highest'), null);
    assert.equal(selectSurveyOption(null), null);
});

test('survey: votes the configured option on receivable SURVEY missions only', async t => {
    const h = useHarness(t);
    loadComponents();
    const surveyInfos = [
        { content_no: 9001, content: '좋아요', percent: 61 },
        { content_no: 9002, content: '별로', percent: 39 }
    ];
    installMissionWorld(h, {
        [COMPONENTS.survey]: [
            mission(501, { mission_type: 'SURVEY', status: 'RECEIVABLE', survey_infos: surveyInfos }),
            mission(502, { mission_type: 'SURVEY', status: 'RECEIVABLE', survey_infos: [] }),
            mission(503, { mission_type: 'SINGLE', status: 'RECEIVABLE' }),
            mission(504, { mission_type: 'SURVEY', status: 'RECEIVABLE', survey_infos: surveyInfos }),
            mission(505, { mission_type: 'SURVEY', status: 'RECEIVABLE', survey_infos: surveyInfos }),
            mission(506, { mission_type: 'SURVEY', status: 'COMPLETE' })
        ]
    }, {
        participate: body => {
            if (body.mission_no === 501) return { code: 0, value: { reward_amount: 20 } };
            if (body.mission_no === 504) return { code: 3, message: 'closed' };
            return httpError(500);
        }
    });

    await executeSurveyMissions(TEST_HEADERS);

    assert.deepEqual(writes(h).map(request => request.body), [
        { mission_no: 501, component_no: COMPONENTS.survey, content_nos: [9001] },
        { mission_no: 504, component_no: COMPONENTS.survey, content_nos: [9001] },
        { mission_no: 505, component_no: COMPONENTS.survey, content_nos: [9001] }
    ]);
    assert.equal(state.earnings.surveyMissions, 20);
    golden('survey-vote', h);
});

test('survey: no votable survey reports completed count', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, {
        [COMPONENTS.survey]: [mission(511, { mission_type: 'SURVEY', status: 'COMPLETED' })]
    });
    await executeSurveyMissions(TEST_HEADERS);
    golden('survey-none-votable', h);
});

test('survey: list failure, request error, missing component and disabled', async t => {
    const h = useHarness(t);
    await executeSurveyMissions(TEST_HEADERS);
    loadComponents();
    h.on('GET', componentUrl(COMPONENTS.survey), [{ code: 1 }, httpError(500)]);
    await executeSurveyMissions(TEST_HEADERS);
    await executeSurveyMissions(TEST_HEADERS);
    CONFIG.surveyMissions.enabled = false;
    await executeSurveyMissions(TEST_HEADERS);
    golden('survey-edge-cases', h);
});

// ---------------------------------------------------------------- executePrizeEntry

test('prize entry: applies once, records the KST date, and claims the prize mission reward', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, {
        [COMPONENTS.daily]: [mission(CONFIG.prizeEntry.missionNo, { title: '경품 응모하기', status: 'INCOMPLETE', reward_amount: 600 })]
    }, {
        participate: () => ({ code: 0, value: { title: '경품 응모하기', reward_amount: 600 } })
    });
    h.on('POST', prizeApplyUrl(CONFIG.prizeEntry.eventNo), { code: 0, value: { user_apply_cnt: 3, residue_flake: 12000 } });

    await executePrizeEntry(TEST_HEADERS);

    const applies = h.requests.filter(request => request.url.includes('/apply/'));
    assert.equal(applies.length, 1, 'prize entry spends FLAKE exactly once');
    assert.deepEqual(applies[0].body, { gift_no: CONFIG.prizeEntry.giftNo, req_cnt: 1 });
    assert.equal(sessionStorage.getItem('prize_entry_last_date'), '2026-10-16');
    assert.equal(state.earnings.prizeEntry, 100);
    assert.equal(state.completed.prizeEntry, true);
    golden('prize-entry-success', h);
});

test('prize entry: uses discovered prize info and the fallback mission when the list lacks it', async t => {
    const h = useHarness(t);
    loadComponents();
    Object.assign(state.prizeInfo, { eventNo: 777, giftNo: 888, giftName: '테스트 경품', flakeCost: 1000 });
    installMissionWorld(h, { [COMPONENTS.daily]: [mission(1)] }, {
        participate: () => ({ code: 1 })
    });
    h.on('POST', prizeApplyUrl(777), { code: 0, value: { user_apply_cnt: 1, residue_flake: 5 } });

    await executePrizeEntry(TEST_HEADERS);

    assert.equal(state.earnings.prizeEntry, -1000);
    golden('prize-entry-fallback-mission', h);
});

test('prize entry: already entered today sends nothing', async t => {
    const h = useHarness(t);
    sessionStorage.setItem('prize_entry_last_date', '2026-10-16');
    await executePrizeEntry(TEST_HEADERS);
    assert.equal(h.requests.length, 0);
    assert.equal(state.completed.prizeEntry, true);
    golden('prize-entry-already-today', h);
});

test('prize entry: rejected application does not record the date or claim', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, { [COMPONENTS.daily]: [mission(CONFIG.prizeEntry.missionNo)] });
    h.on('POST', prizeApplyUrl(CONFIG.prizeEntry.eventNo), [{ code: 4001, message: 'FLAKE 부족' }, {}, httpError(500)]);

    await executePrizeEntry(TEST_HEADERS);
    await executePrizeEntry(TEST_HEADERS);
    await executePrizeEntry(TEST_HEADERS);

    assert.equal(sessionStorage.getItem('prize_entry_last_date'), null);
    assert.equal(h.requests.filter(request => request.url === PARTICIPATE_URL).length, 0);
    assert.equal(state.completed.prizeEntry, false);
    golden('prize-entry-rejected', h);
});

test('prize entry: disabled marks completion without requests', async t => {
    const h = useHarness(t);
    CONFIG.prizeEntry.enabled = false;
    await executePrizeEntry(TEST_HEADERS);
    assert.equal(h.requests.length, 0);
    assert.equal(state.completed.prizeEntry, true);
    golden('prize-entry-disabled', h);
});

// ---------------------------------------------------------------- autoParticipateVisitMissions (real APIs)

test('single visits: participates, opens URLs, claims, and skips non-visit SINGLE missions with reasons', async t => {
    const h = useHarness(t);
    loadComponents();
    CONFIG.dailyMissions.skipMissions = [609];
    installMissionWorld(h, {
        [COMPONENTS.daily]: [
            mission(601, { is_visit_mission: true, button_url: 'https://page.onstove.com/601', reward_amount: 10 }),
            mission(602, { is_visit_mission: true, status: 'RECEIVABLE', reward_amount: 20 }),
            mission(603, { is_visit_mission: true, button_url: '' }),
            mission(604, { is_visit_mission: false, title: '경품 응모하기', mission_no: CONFIG.prizeEntry.missionNo }),
            mission(605, { is_visit_mission: false, title: '스토브 앱 로그인' }),
            mission(606, { is_visit_mission: false, title: '기타 미션' }),
            mission(607, { is_visit_mission: true, status: 'COMPLETE' }),
            mission(608, { is_visit_mission: true, mission_type: 'ACCUMULATION' }),
            mission(609, { is_visit_mission: true })
        ],
        [COMPONENTS.content]: [],
        [COMPONENTS.weekly]: [],
        [COMPONENTS.survey]: [],
        [COMPONENTS.banner]: [],
        [COMPONENTS.attendance]: []
    }, { visitCompletes: false });

    const result = await autoParticipateVisitMissions(TEST_HEADERS);

    assert.deepEqual(result, { success: true, participated: 2, completed: 3, skipped: 3, total: 3, targeted: false, targetMissionNos: [] });
    golden('single-visits-mixed', h, { result });
});

test('single visits: participate statuses COMPLETE, unexpected, empty response and errors', async t => {
    const h = useHarness(t);
    loadComponents({ content: null, weekly: null, survey: null, banner: null, attendance: null });
    installMissionWorld(h, {
        [COMPONENTS.daily]: [
            mission(611, { is_visit_mission: true, reward_amount: 11 }),
            mission(612, { is_visit_mission: true }),
            mission(613, { is_visit_mission: true }),
            mission(614, { is_visit_mission: true })
        ]
    }, {
        visitCompletes: false,
        participate: (body, found, world) => {
            const attempt = world.participations.filter(p => p.missionNo === body.mission_no).length;
            if (body.mission_no === 611) return { code: 0, value: { status: 'COMPLETED' } };
            if (body.mission_no === 612) return { code: 0, value: { status: 'INCOMPLETE' } };
            if (body.mission_no === 613) return attempt === 1 ? {} : { code: 0, value: { status: 'COMPLETE', reward_amount: 3 } };
            return httpError(500);
        }
    });

    const result = await autoParticipateVisitMissions(TEST_HEADERS);

    assert.deepEqual(result, { success: true, participated: 0, completed: 2, skipped: 0, total: 4, targeted: false, targetMissionNos: [] });
    golden('single-visits-statuses', h, { result });
});

test('single visits: missionNo filter limits work to repair targets', async t => {
    const h = useHarness(t);
    loadComponents({ content: null, weekly: null, survey: null, banner: null, attendance: null });
    installMissionWorld(h, {
        [COMPONENTS.daily]: [
            mission(621, { is_visit_mission: true }),
            mission(622, { is_visit_mission: true }),
            mission(623, { is_visit_mission: false })
        ]
    }, { visitCompletes: false });

    const result = await autoParticipateVisitMissions(TEST_HEADERS, { id: 'repairSafe:singleVisits', meta: { missionNos: [622, 623] } });

    assert.equal(result.total, 1);
    assert.deepEqual(writes(h).map(request => request.body.mission_no), [622, 622]);
    golden('single-visits-targeted', h, { result });
});

test('single visits: loads component ids from the mission page when none are cached', async t => {
    const h = useHarness(t);
    h.on('GET', MISSION_PAGE_URL, {
        code: 0,
        value: {
            component_list: [
                { type: 'SINGLE', component_no: COMPONENTS.daily, start_dt: '2026-10-01T00:00:00+09:00', end_dt: '2026-10-31T23:59:59+09:00' },
                { type: 'SURVEY', component_no: COMPONENTS.survey, start_dt: '2026-09-01T00:00:00+09:00', end_dt: '2026-09-30T23:59:59+09:00' }
            ]
        }
    });
    installMissionWorld(h, { [COMPONENTS.daily]: [mission(631, { is_visit_mission: false })] });

    const result = await autoParticipateVisitMissions(TEST_HEADERS);

    assert.equal(state.missionComponents.daily, COMPONENTS.daily);
    assert.equal(state.missionComponents.survey, null);
    assert.equal(result.skipped, 1);
    golden('single-visits-loads-components', h, { result });
});

test('single visits: no missions available', async t => {
    const h = useHarness(t);
    h.on('GET', MISSION_PAGE_URL, httpError(500));
    const result = await autoParticipateVisitMissions(TEST_HEADERS);
    assert.equal(result.success, false);
    golden('single-visits-none', h, { result });
});

test('single visits: unexpected failure is reported in the result', async t => {
    const h = useHarness(t);
    loadComponents({ content: null, weekly: null, survey: null, banner: null, attendance: null });
    h.on('GET', componentUrl(COMPONENTS.daily), { code: 0, value: { missions: 'broken' } });
    const result = await autoParticipateVisitMissions(TEST_HEADERS);
    assert.equal(result.success, false);
    assert.match(result.error, /forEach/);
    golden('single-visits-error', h, { result });
});

// ---------------------------------------------------------------- api/missions.js contracts

test('mission API requests use the reward-page headers and JSON bodies for writes', async t => {
    const h = useHarness(t);
    loadComponents();
    installMissionWorld(h, { [COMPONENTS.daily]: [mission(701, { status: 'RECEIVABLE', reward_amount: 4 })] });
    h.on('GET', componentUrl(1), componentBody(1, []));

    assert.deepEqual(makeMissionHeaders(TEST_HEADERS), {
        'Authorization': 'Bearer test-suat',
        'caller-id': 'flake-fe',
        'caller-detail': 'test-uuid',
        'x-lang': 'ko',
        'x-nation': 'KR',
        'Accept': '*/*',
        'Origin': 'https://reward.onstove.com',
        'Referer': 'https://reward.onstove.com/'
    });
    assert.equal(makeMissionHeaders({ 'Authorization': 'x', 'caller-detail': 'fallback' })['caller-detail'], 'fallback');

    assert.equal((await getDailyMissionStatus(TEST_HEADERS)).code, 0);
    assert.equal((await participateMission(TEST_HEADERS, 701, COMPONENTS.daily)).value.status, 'COMPLETE');
    assert.equal(await receiveMissionReward(TEST_HEADERS, 701, COMPONENTS.daily), null);
    golden('api-headers-and-bodies', h);
});

test('component ids: API error and request failure leave state untouched', async t => {
    const h = useHarness(t);
    h.on('GET', MISSION_PAGE_URL, [{ code: 1 }, httpError(500)]);
    assert.equal(await getMissionComponentIds(TEST_HEADERS), null);
    assert.equal(await getMissionComponentIds(TEST_HEADERS), null);
    assert.equal(state.missionComponents.daily, null);
    golden('api-component-ids-failures', h);
});

test('daily missions: a failing component is skipped and the rest are merged', async t => {
    const h = useHarness(t);
    loadComponents({ daily: 227, dailyComponents: [226, 227, 228] });
    h.on('GET', componentUrl(226), componentBody(226, [mission(801)]));
    h.on('GET', componentUrl(227), { code: 7 });
    h.on('GET', componentUrl(228), componentBody(228, [mission(802, { component_no: 999 })]));

    const result = await getDailyMissions(TEST_HEADERS);

    assert.deepEqual(result.missions.map(m => [m.mission_no, m.component_no]), [[801, 226], [802, 999]]);
    assert.equal(result.componentNo, 227);
    golden('api-daily-partial-failure', h, { result });
});

test('all missions: failed components are dropped instead of failing the whole read', async t => {
    const h = useHarness(t);
    loadComponents({ weekly: null, survey: null, banner: null, attendance: null });
    h.on('GET', componentUrl(COMPONENTS.daily), componentBody(COMPONENTS.daily, [mission(901)]));
    h.on('GET', componentUrl(COMPONENTS.content), httpError(500));

    const result = await getAllDailyMissions(TEST_HEADERS);

    assert.deepEqual(result.map(component => component.componentNo), [COMPONENTS.daily]);
    golden('api-all-missions-partial-failure', h, { result });
});

test('game ownership check uses event-hub headers', async t => {
    const h = useHarness(t);
    h.on('GET', 'https://api.onstove.com/ownership/v1/check_ownership_by_bgameid?game_id=STOVE_MAJAK', { code: 0, value: { owned: true } });
    assert.deepEqual(await checkGameOwnership(TEST_HEADERS, 'STOVE_MAJAK'), { code: 0, value: { owned: true } });
    golden('api-game-ownership', h);
});

test('a non-zero code fails content, weekly and survey reads but banner and attendance accept listed missions', async t => {
    const h = useHarness(t);
    loadComponents();
    const listed = componentNo => ({ code: 7, value: { missions: [mission(componentNo * 10, { status: 'COMPLETE' })] } });
    for (const componentNo of [COMPONENTS.content, COMPONENTS.weekly, COMPONENTS.survey, COMPONENTS.banner, COMPONENTS.attendance]) {
        h.on('GET', componentUrl(componentNo), listed(componentNo));
    }

    await executeContentMissions(TEST_HEADERS);
    await executeWeeklyMissions(TEST_HEADERS);
    await executeSurveyMissions(TEST_HEADERS);
    await executeBannerMissions(TEST_HEADERS);
    await executeAttendanceMissions(TEST_HEADERS);

    const logs = h.logs();
    assert.ok(logs.includes('[error] ✗ 컨텐츠 미션 목록 조회 실패'));
    assert.ok(logs.includes('[info] ℹ️ 위클리 미션: 현재 이용 불가'));
    assert.ok(logs.includes('[error] ✗ 설문조사 미션 목록 조회 실패'));
    assert.ok(logs.includes('[info] 📋 배너 미션 1개 발견'));
    assert.ok(logs.includes('[info] 📋 출석 미션 1개 발견'));
    assert.equal(h.requests.length, 5);
});
