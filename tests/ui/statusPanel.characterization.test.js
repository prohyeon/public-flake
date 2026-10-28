// Characterization of the dashboard renderers: src/ui/status.js (updateStatusUI), src/ui/progress.js,
// src/ui/logger.js and src/ui/notifications.js, rendered into a copy of the real panel markup.
process.env.TZ = 'Asia/Seoul';
import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import { STATUS_PANEL_BODY, panelSnapshot } from '../fixtures/status.js';
import { state } from '../../src/state.js';
import { updateStatusUI } from '../../src/ui/status.js';
import * as progressModule from '../../src/ui/progress.js';
import { log, timingText } from '../../src/ui/logger.js';
import { showSuccessNotice } from '../../src/ui/notifications.js';

const { setButtonState } = progressModule;
const nativeSetTimeout = globalThis.setTimeout;
const tick = (ms = 10) => new Promise(resolve => nativeSetTimeout(resolve, ms));
// Polls with real timers (the harness setTimeout fires callbacks at 0ms, but still asynchronously).
// performance.now() because Date is frozen by the harness.
async function waitFor(predicate, timeout = 2000) {
    const deadline = performance.now() + timeout;
    while (!predicate() && performance.now() < deadline) await tick(5);
}

const panel = t => useHarness(t, { body: STATUS_PANEL_BODY });
const cell = (h, id) => h.document.getElementById(`stove-status-${id}`).innerHTML;

// Same shape checkDailyMissionStatus() builds for each category.
function category(missions) {
    const done = m => m.status === 'COMPLETE' || m.status === 'COMPLETED';
    return {
        total: missions.length,
        completed: missions.filter(done).length,
        receivable: missions.filter(m => m.status === 'RECEIVABLE').length,
        incomplete: missions.filter(m => m.status === 'INCOMPLETE').length,
        components: [],
        missions
    };
}
const m = (title, status, extra = {}) => ({ mission_no: title.length, title, status, ...extra });

const ALL_LOADING = {
    dailyMission: { loading: true }, roulette: { loading: true },
    dailyShop: { loading: true }, majakShop: { loading: true }, survey: { loading: true },
    totalFlake: { loading: true }, monthlyFlake: { loading: true }
};

// ---------------------------------------------------------------- updateStatusUI

test('updateStatusUI: loading state shows a spinner in every dashboard cell', async t => {
    const h = panel(t);
    updateStatusUI(ALL_LOADING);
    assert.equal(cell(h, 'mission-daily'), '<span style="color: #3b82f6">확인 중</span>');
    assertGolden('status/ui-loading', panelSnapshot(h.document));
});

test('updateStatusUI: first-render success variants, mission tooltips and number formatting', async t => {
    const h = panel(t);
    updateStatusUI({
        dailyMission: { success: true, categories: {
            daily: category([m('방문', 'COMPLETE'), m('좋아요', 'COMPLETED')]),
            weekly: category([m('주간 댓글', 'RECEIVABLE'), m('주간 글쓰기', 'INCOMPLETE')]),
            content: category([m('게임 플레이', 'INCOMPLETE'), m('위시리스트', 'INCOMPLETE')]),
            attendance: category([m('월간 출석', 'INCOMPLETE', { user_complete_cnt: 3, milestone_per_cnt: 7, milestone_total_cnt: 28 })])
        } },
        roulette: { success: true, current: 12, limit: 30, remaining: 18 },
        dailyShop: { success: true, received: true, notReceived: false },
        majakShop: { success: true, received: false, notReceived: true },
        survey: { success: true, completed: 1, receivable: 2, total: 4, allCompleted: false },
        totalFlake: 1234567,
        monthlyFlake: 12345
    });

    assert.equal(cell(h, 'mission-daily'), '<span style="color: #10b981">완료</span>');
    assert.equal(cell(h, 'mission-weekly'), '<span style="color: #f59e0b">보상 1개</span>');
    assert.equal(cell(h, 'mission-content'), '<span style="color: #6b7280">받을 보상 없음</span>');
    // The "N일중" figure is milestone_per_cnt (7), not the milestone_total_cnt goal (28).
    assert.equal(cell(h, 'mission-attendance'), '<span style="color: #6b7280">7일중 3일출석</span>');
    assert.equal(cell(h, 'roulette'), '<span style="color: #10b981">12/30 (18회 남음)</span>');
    assert.equal(cell(h, 'total-flake'), '<span style="color: #10b981">1,234,567 F</span>');
    assert.equal(cell(h, 'monthly-flake'), '<span style="color: #10b981">+12,345 F</span>');
    assert.equal(h.document.querySelectorAll('.stove-mission-tooltip').length, 4);
    assertGolden('status/ui-variants-first', panelSnapshot(h.document));
});

test('updateStatusUI: re-render replaces tooltips, but a category that disappears keeps its stale tooltip', async t => {
    const h = panel(t);
    updateStatusUI({ dailyMission: { success: true, categories: {
        daily: category([m('방문', 'COMPLETE')]),
        weekly: category([m('주간 댓글', 'RECEIVABLE')]),
        content: category([m('게임 플레이', 'INCOMPLETE')]),
        attendance: category([m('출석 보상', 'RECEIVABLE')])
    } } });
    updateStatusUI({
        dailyMission: { success: true, categories: {
            daily: category([m('방문', 'COMPLETE'), m('좋아요', 'INCOMPLETE'), m('댓글', 'INCOMPLETE')]),
            content: { ...category([]), total: 0 },
            attendance: category([m('출석 보상', 'RECEIVABLE'), m('출석 보상 2', 'COMPLETE')])
        } },
        roulette: { success: true, current: 30, limit: 30, remaining: 0 },
        dailyShop: { success: true, received: false, notReceived: false, noRewardToday: true },
        majakShop: { success: true, received: true, notReceived: false },
        survey: { success: true, completed: 3, receivable: 0, total: 3, allCompleted: true },
        totalFlake: { error: true },
        monthlyFlake: { error: true }
    });

    assert.equal(cell(h, 'mission-daily'), '<span style="color: #6b7280">1/3</span>');
    assert.equal(cell(h, 'mission-weekly'), '<span style="color: #6b7280">-</span>');
    assert.equal(cell(h, 'mission-content'), '<span style="color: #6b7280">-</span>');
    assert.equal(cell(h, 'mission-attendance'), '<span style="color: #f59e0b">보상 1개</span>');
    const tooltips = panelSnapshot(h.document).tooltips;
    assert.equal(tooltips.daily.length, 1, 'tooltip replaced, not duplicated');
    assert.match(tooltips.weekly[0], /주간 댓글/, 'stale weekly tooltip from the previous render is left in place');
    assert.match(tooltips.content[0], /게임 플레이/, 'stale content tooltip from the previous render is left in place');
    assertGolden('status/ui-variants-second', panelSnapshot(h.document));
});

test('updateStatusUI: shop, survey and attendance fallbacks render the expected cell text', async t => {
    const h = panel(t);
    const cases = [
        [{ dailyShop: { success: true, received: false, notReceived: false } }, 'daily', '<span style="color: #6b7280">-</span>'],
        [{ dailyShop: { success: true, received: false, notReceived: true } }, 'daily', '<span style="color: #f59e0b">보상 미수령</span>'],
        [{ majakShop: { success: true, received: false, notReceived: false, noRewardToday: true } }, 'majak', '<span style="color: #9ca3af">오늘 보상 없음</span>'],
        [{ majakShop: { success: true, received: false, notReceived: false } }, 'majak', '<span style="color: #6b7280">-</span>'],
        [{ survey: { success: true, notAvailable: true } }, 'survey', '<span style="color: #6b7280">비활성화</span>'],
        [{ survey: { success: true, noMissions: true } }, 'survey', '<span style="color: #6b7280">미션 없음</span>'],
        [{ survey: { success: true, completed: 1, receivable: 0, total: 3, allCompleted: false } }, 'survey', '<span style="color: #6b7280">1/3</span>'],
        [{ survey: { success: true, completed: 0, receivable: 0, total: 3, allCompleted: false } }, 'survey', '<span style="color: #6b7280">-</span>'],
        [{ dailyMission: { success: true, categories: { attendance: category([m('출석', 'INCOMPLETE')]) } } }, 'mission-attendance', '<span style="color: #6b7280">-</span>'],
        [{ dailyMission: { success: true, categories: { daily: category([m('a', 'RECEIVABLE'), m('b', 'RECEIVABLE')]) } } }, 'mission-daily', '<span style="color: #f59e0b">보상 2개</span>'],
        [{ totalFlake: 0, monthlyFlake: 0 }, 'total-flake', '<span style="color: #10b981">0 F</span>'],
        [{ totalFlake: 0, monthlyFlake: 0 }, 'monthly-flake', '<span style="color: #10b981">+0 F</span>']
    ];
    for (const [statusData, id, expected] of cases) {
        updateStatusUI(statusData);
        assert.equal(cell(h, id), expected, `${JSON.stringify(statusData)} -> ${id}`);
    }
});

test('updateStatusUI: failed checks render the failure marker in every cell', async t => {
    const h = panel(t);
    const failed = { success: false, error: '확인 실패' };
    updateStatusUI({
        dailyMission: failed, roulette: failed, dailyShop: failed, majakShop: failed,
        survey: failed, totalFlake: { error: true }, monthlyFlake: { error: true }
    });
    assert.equal(cell(h, 'mission-weekly'), '<span style="color: #ef4444">실패</span>');
    assertGolden('status/ui-failures', panelSnapshot(h.document));

    // success without categories is treated as a failure for the four mission cells
    updateStatusUI({ dailyMission: { success: true } });
    for (const id of ['daily', 'weekly', 'content', 'attendance']) {
        assert.equal(cell(h, `mission-${id}`), '<span style="color: #ef4444">실패</span>');
    }
});

test('updateStatusUI: partial updates only touch the cells they name', async t => {
    const h = panel(t);
    const before = panelSnapshot(h.document);
    updateStatusUI({ roulette: { success: true, current: 1, limit: 30, remaining: 29 } });
    const after = panelSnapshot(h.document);
    assert.equal(after.values['stove-status-roulette'], '<span class="stove-status-value" id="stove-status-roulette"><span style="color: #10b981">1/30 (29회 남음)</span></span>');
    delete before.values['stove-status-roulette'];
    delete after.values['stove-status-roulette'];
    assert.deepEqual(after, before);
});

test('updateStatusUI: mission titles are written into the tooltip as HTML (not escaped)', async t => {
    const h = panel(t);
    updateStatusUI({ dailyMission: { success: true, categories: {
        daily: category([m('<b id="injected">굵게</b>', 'INCOMPLETE')])
    } } });
    const injected = h.document.getElementById('injected');
    assert.ok(injected, 'server-provided title markup becomes DOM');
    assert.equal(injected.closest('.stove-mission-tooltip-name') !== null, true);
});

test('updateStatusUI: without the panel elements it is a no-op', async t => {
    const h = useHarness(t, { body: '<div id="stove-log-content"></div>' });
    updateStatusUI({
        ...ALL_LOADING,
        dailyMission: { success: true, categories: { daily: category([m('a', 'COMPLETE')]) } }
    });
    updateStatusUI({ dailyMission: { success: false } });
    assert.equal(h.document.body.innerHTML, '<div id="stove-log-content"></div>');
});

// ---------------------------------------------------------------- setButtonState

function buttonView(h) {
    return Object.fromEntries(['stove-btn-start', 'stove-btn-reward-shop', 'stove-btn-status-refresh',
        'stove-btn-point-cash-charge'].map(id => {
        const button = h.document.getElementById(id);
        return [id, { disabled: button.disabled, opacity: button.style.opacity }];
    }));
}

test('setButtonState: running disables the control buttons and the charge button', async t => {
    const h = panel(t);
    state.pointCashCharge.availableFlake = 200000;

    setButtonState(true);
    const running = { buttons: buttonView(h), charge: panelSnapshot(h.document).pointCashCharge, state: structuredClone(state.pointCashCharge) };
    setButtonState(false);
    const idle = { buttons: buttonView(h), charge: panelSnapshot(h.document).pointCashCharge, state: structuredClone(state.pointCashCharge) };

    assert.deepEqual(running.buttons['stove-btn-start'], { disabled: true, opacity: '0.5' });
    assert.deepEqual(idle.buttons['stove-btn-start'], { disabled: false, opacity: '1' });
    assertGolden('status/ui-button-state', { running, idle });
});

test('setButtonState: an unknown (null) flake balance is treated as 0 F, so idle shows a full shortage', async t => {
    const h = panel(t);
    setButtonState(false);
    // Number(null) === 0 in pointCashCharge.js, so the "플레이크 확인 중" branch is not reached for null.
    assert.deepEqual(panelSnapshot(h.document).pointCashCharge, {
        disabled: true,
        title: '192,500 플레이크 필요 (현재 0)',
        opacity: '0.45',
        status: '192,500 플레이크 부족',
        statusColor: 'rgb(251, 191, 36)'
    });
    assert.deepEqual(buttonView(h)['stove-btn-reward-shop'], { disabled: false, opacity: '1' });
    assert.deepEqual(state.pointCashCharge, { availableFlake: 0, hasRequiredFlake: false });

    state.pointCashCharge.availableFlake = undefined;
    setButtonState(false);
    assert.equal(panelSnapshot(h.document).pointCashCharge.status, '플레이크 확인 중', 'only undefined/NaN reach the unknown branch');
});

// ---------------------------------------------------------------- log

test('log: appends a colored entry per call (info by default)', async t => {
    const h = panel(t);
    const section = h.document.querySelector('.stove-log-section');
    Object.defineProperty(section, 'scrollHeight', { configurable: true, get: () => 480 });
    const scrolls = [];
    Object.defineProperty(section, 'scrollTop', { configurable: true, get: () => 0, set: value => scrolls.push(value) });

    log('기본');
    log('성공', 'success');
    log('실패', 'error');
    log('경고', 'warning');
    log('알 수 없음', 'debug');

    const entries = [...h.document.querySelectorAll('#stove-log-content > div')]
        .map(entry => ({ text: entry.textContent, color: entry.style.color, padding: entry.style.padding }));
    assert.deepEqual(entries, [
        { text: '기본', color: 'rgb(96, 165, 250)', padding: '' },
        { text: '성공', color: 'rgb(52, 211, 153)', padding: '' },
        { text: '실패', color: 'rgb(248, 113, 113)', padding: '' },
        { text: '경고', color: 'rgb(251, 191, 36)', padding: '' },
        { text: '알 수 없음', color: '', padding: '' }
    ]);
    assert.deepEqual(h.logs(), ['[info] 기본', '[success] 성공', '[error] 실패', '[warning] 경고', '[debug] 알 수 없음']);
    assert.deepEqual(scrolls, [480, 480, 480, 480, 480]);
});

test('log: text is inserted as text, and nothing happens without a log container', async t => {
    const h = useHarness(t, { body: '<div id="stove-log-content"></div>' });
    log('<b>굵게</b>', 'info');
    assert.equal(h.document.querySelector('#stove-log-content b'), null);
    assert.deepEqual(h.logs(), ['[info] <b>굵게</b>']);

    h.document.getElementById('stove-log-content').remove();
    assert.doesNotThrow(() => log('사라짐', 'error'));
    assert.equal(h.document.body.textContent, '');
});

test('log: timing lines are tagged, and timing text sits in its own span for the panel to hide', async t => {
    const h = panel(t);
    log('소요 시간 · 총 1.0초', 'info', { timing: true });
    log(`그룹 완료: setup (3/3)${timingText(' · 0.5초')}`, 'success');

    const [summary, group] = [...h.document.querySelectorAll('#stove-log-content > div')];
    assert.equal(summary.dataset.timing, 'true');
    assert.equal(group.dataset.timing, undefined);
    assert.equal(group.querySelector('.log-timing').textContent, ' · 0.5초');
    assert.equal(group.textContent, '그룹 완료: setup (3/3) · 0.5초');
});

// ---------------------------------------------------------------- showSuccessNotice

test('showSuccessNotice: prepends a notice to the panel, replaces an existing one, hides after 6s and removes 300ms later', async t => {
    const h = panel(t);
    const root = h.document.getElementById('stove-quest-automation');

    showSuccessNotice('첫 번째');
    const first = root.firstChild;
    assert.equal(first.id, 'stove-success-notice');
    assert.equal(first.className, 'stove-success-notice');
    assert.equal(first.textContent, '첫 번째');

    showSuccessNotice('<b>두 번째</b>');
    assert.equal(h.document.querySelectorAll('#stove-success-notice').length, 1);
    assert.equal(root.firstChild.textContent, '<b>두 번째</b>');
    assert.equal(first.isConnected, false);

    await waitFor(() => h.document.getElementById('stove-success-notice') === null);
    assert.deepEqual(h.delays, [6000, 6000, 300, 300]);
    assert.equal(h.document.getElementById('stove-success-notice'), null);
});

test('showSuccessNotice: hide class is added first, then the notice is removed; falls back to body without a panel', async t => {
    const h = useHarness(t, { body: '<main></main>' });
    const timers = [];
    globalThis.setTimeout = (callback, ms) => { timers.push({ callback, ms }); return timers.length; };

    showSuccessNotice('완료!');
    const notice = h.document.getElementById('stove-success-notice');
    assert.equal(notice.parentElement, h.document.body);
    assert.equal(h.document.body.lastElementChild, notice);
    assert.deepEqual(timers.map(timer => timer.ms), [6000]);

    timers[0].callback();
    assert.equal(notice.className, 'stove-success-notice stove-success-notice--hide');
    assert.equal(notice.isConnected, true);
    assert.deepEqual(timers.map(timer => timer.ms), [6000, 300]);

    timers[1].callback();
    assert.equal(notice.isConnected, false);
});
