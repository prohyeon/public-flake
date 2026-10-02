import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { boostFixture, boostCandidate } from '../helpers/boostFixture.js';
import { reviewEventFixture } from '../helpers/reviewEventFixture.js';
import { specialForceShop } from '../helpers/specialForceFixture.js';

const userscript = readFileSync(new URL('../../stove-quest-automation.user.js', import.meta.url), 'utf8');

test('distributed dashboard only reads status; full automation queries five times and claims after background comments', async t => {
    const dom = new JSDOM('<!doctype html><title>MY홈</title><div id="__nuxt"><div data-slot="App"><div data-slot="Body"></div></div></div>', {
        runScripts: 'outside-only', url: 'https://profile.onstove.com/'
    });
    t.after(() => dom.window.close());
    const { window } = dom;
    const { document } = window;
    const now = Date.now();
    const today = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const reviewEvent = { ...reviewEventFixture().event, expose_start_at: today, expose_end_at: today };
    const reviewComments = [];
    const sfShop = specialForceShop();
    sfShop.date_info.attend_start_dt = `${today}T00:00:00`;
    sfShop.date_info.attend_end_dt = `${new Date(now + 13 * 86400000 + 9 * 3600000).toISOString().slice(0, 10)}T23:59:59`;
    let sfWrites = 0;
    let sfUnavailable = false;
    let reviewWrites = 0;
    const reviewVisits = [];
    const mission = boostFixture().mission;
    mission.start_dt = now - 86400000;
    mission.end_dt = now + 86400000;
    mission.details[1].current_count = 0;
    const articles = [boostCandidate(11, 443), boostCandidate(12, 966), boostCandidate(13, 354)]
        .map(article => ({ ...article, datetime: now - 60000 }));
    const calls = [];
    const unexpected = [];
    let comments = 0;
    let failComments = false;
    let putBeforeCommentsFinish = false;
    let remaining = 5;
    let boostWrites = 0;
    let rewardWrites = 0;
    const timers = [];
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => {
        if (ms === 500) { timers.push(callback); return timers.length; }
        return nativeSetTimeout(callback, ms === 11000 ? 40 : 1, ...args);
    };
    window.scrollTo = () => {};
    window.alert = message => { unexpected.push(`alert: ${message}`); };
    window.console = Object.fromEntries(['log', 'warn', 'error'].map(method => [method, () => {}]));
    window.GM_openInTab = url => {
        if (url === reviewEvent.link_url) reviewVisits.push(url);
        return { close() {} };
    };
    Object.defineProperty(window.navigator, 'locks', { value: { request: async (key, options, work) => work({ name: key }) } });
    document.cookie = 'SUAT=test-token; path=/';
    window.localStorage.setItem('sgs_da_uuid', 'test-uuid');
    Object.defineProperty(document, 'readyState', { get: () => 'complete' });
    window.GM_xmlhttpRequest = config => {
        if (config.data !== null) {
            assert.ok(config.timeout === undefined || config.timeout > 0,
                'distributed body requests never pass a zero timeout to Tampermonkey');
        }
        const url = new URL(config.url);
        const path = url.pathname;
        calls.push({ method: config.method, path });
        let value;
        if (path === '/eventhub/v1.0/promotion/events/ON') value = { total_event_cnt: 1, promotion_events: [reviewEvent] };
        else if (path === '/cwms/v3.0/article') value = { ...reviewEventFixture().article,
            community_key: 'quarter', channel_key: 'kr', article_status_code: 'PUBLISHED', coverage_code: 'PUBLIC' };
        else if (path === '/cwms/v1.0/user/CHANNEL/73') value = { user_info: { member_no: 100 } };
        else if (path === '/cwms/v1.0/user/board/permission') value = [{ board_seq: 134147, user_permission_info: { comment: { write: true } } }];
        else if (path === '/cwms/v1.1/article/14523486/comment/list') value = {
            total: reviewComments.length, display_total: reviewComments.length, page: 1, size: 20, list: reviewComments, next_yn: 'N'
        };
        else if (path === '/cwms/v1.0/article/14523486/comment' && config.method === 'POST') {
            assert.equal(comments, 5, 'review posting waits for existing background comments');
            assert.equal(config.headers['caller-id'], 'storee-cp');
            assert.equal(reviewVisits.length, 1, 'review visit precedes sticker posting');
            assert.match(JSON.parse(config.data).comment, /data-sticker/);
            reviewWrites++;
            reviewComments.unshift({ comment_id: '901', comment_status_code: 'NORMAL', user_info: { member_no: 100 } });
            value = { comment_id: '901' };
        }
        else if (path === '/stadium-api/v1.0/missions') value = { missions: [mission] };
        else if (path === '/stadium-api/v1.0/boost/balance') value = { remaining_count: remaining };
        else if (path.endsWith('/recommend/articles/realtime-ranking')) value = { articles, generated_at: now };
        else if (path.startsWith('/stadium-api/') && path.endsWith('/interaction/BOOST')) {
            const ids = path.split('/')[4].split(',');
            value = Object.fromEntries(ids.map(id => [id, { BOOST: id === '12' && boostWrites > 0 }]));
        } else if (path === '/stadium-api/v1.0/boost/12' && config.method === 'PUT') {
            boostWrites++;
            putBeforeCommentsFinish = comments < 5;
            remaining--;
            mission.details[0].current_count = 1;
            mission.is_completed = mission.details.every(detail => detail.current_count >= detail.required_count);
            value = { remaining_count: remaining, next_charge_at: now + 300000 };
        } else if (path === '/stadium-api/v1.0/missions/1/reward' && config.method === 'POST') {
            assert.equal(comments, 5, 'reward claim follows completion of background comments');
            assert.equal(mission.details[0].current_count, 1);
            rewardWrites++;
            mission.is_rewarded = true;
            value = { mission_id: 1, rewards: [{ type: 'FLAKE', amount: 3000 }] };
        } else if (path.endsWith('/user/me')) value = { user_id: '100' };
        else if (path.includes('/interest/user/')) value = { list: [{ datetime: now }] };
        else if (path === '/stadium-api/v1.0/today/all') {
            assert.equal(url.searchParams.get('size'), '30');
            assert.equal(config.headers['caller-id'], 'lounge');
            assert.equal(config.headers['x-lang'], 'KO');
            value = { has_next: true, token: 'test-cursor', size: 30,
                list: Array.from({ length: 5 }, (_, i) => ({ article_id: String(21 + i) })) };
        }
        else if (path.endsWith('/interaction/LIKE')) {
            const ids = path.split('/')[4].split(',');
            value = Object.fromEntries(ids.map(id => [id, { LIKE: false }]));
        } else if (path.endsWith('/comment') && config.method === 'POST') {
            if (failComments) {
                config.ontimeout();
                return;
            }
            const articleId = path.split('/')[4];
            assert.ok(['21', '22', '23', '24', '25'].includes(articleId), 'comment target comes from the new lounge list');
            assert.equal(JSON.parse(config.data).article_id, articleId);
            assert.equal(config.headers['caller-id'], 'lounge');
            assert.equal(config.headers['x-lang'], 'KO');
            comments++;
            if (comments === 5) { mission.details[1].current_count = 1; mission.is_completed = true; }
            value = { comment_id: String(comments) };
        } else if (path === '/flake-shop/v1/page') value = { component_list: [{
            component_no: 271, type: 'SINGLE', start_dt: now - 86400000, end_dt: now + 86400000
        }] };
        else if (path === '/flake-shop/v1/mission/component') value = { component_info: { component_type: 'SINGLE' }, missions: [] };
        else if (path === '/emsbackapi/v3.0/participationCnt') value = { participation_cnt: 30 };
        else if (path === '/emsbackapi/v3.0/extra') value = { current_cnt: 0, milestones: [] };
        else if (path === '/emsbackapi/v3.0/events' || path === '/emsbackapi/v3.0/apply') value = {};
        else if (path === '/dailyshop/v1.0/services/family-links') value = sfUnavailable ? [] : [{ service_id: 'specialforce', progress_month: '202610' }];
        else if (path === '/dailyshop/v1.0/202610/services/specialforce') value = sfShop;
        else if (path === '/dailyshop/v1.0/attendances/accumulate-play/flake' && config.method === 'POST') {
            assert.equal(config.headers['caller-id'], 'event-hub');
            assert.deepEqual(JSON.parse(config.data), { item_no: 25 });
            assert.equal(sfShop.accumulated_plays.rewards[0].is_received, false);
            sfWrites++;
            sfShop.accumulated_plays.rewards[0].is_received = true;
            value = { item_no: 25, category: 'ACCUMULATE_PLAY', flake_amount: 1000 };
        }
        else if (path.startsWith('/dailyshop/')) value = { daily_attendances: { rewards: [] }, accumulated_attendances: { rewards: [] } };
        else if (path === '/mileage/v1.0/balance') value = { mileage_amount: mission.is_rewarded ? 13000 : 10000 };
        else if (path === '/mileage/v2.0/master/deposit/total') value = { total_deposit_amount: mission.is_rewarded ? 3000 : 0 };
        else { unexpected.push(`${config.method} ${path}`); value = {}; }
        config.onload({ status: 200, responseText: JSON.stringify({ code: 0, message: 'success', value }) });
    };
    const waitUntil = async predicate => {
        const deadline = Date.now() + 5000;
        while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(predicate(), document.getElementById('stove-log-content')?.textContent);
    };
    window.eval(userscript);
    assert.equal(timers.length, 1);
    document.getElementById('stove-btn-status-refresh').click();
    await waitUntil(() => /0\/1/.test(document.getElementById('stove-status-boost').textContent));
    await waitUntil(() => /0\/1/.test(document.getElementById('stove-status-review-event').textContent));
    assert.equal(reviewVisits.length, 0, 'dashboard does not visit or participate');
    assert.equal(calls.some(call => call.method !== 'GET'), false, 'dashboard refresh makes no mutation');
    assert.match(document.getElementById('stove-special-force-data').textContent, /14일 행사/);
    assert.match(document.getElementById('stove-special-force-data').textContent, /보상 0\/7개/);
    assert.equal(calls.some(call => call.path.endsWith('/realtime-ranking')), false, 'status reads do not consume the five-query search');
    document.getElementById('stove-btn-start').click();
    await waitUntil(() => document.documentElement.dataset.stoveAutomationStatus === 'done' || /^\[SG_DONE\]/.test(document.title));
    assert.equal(calls.filter(call => call.path.endsWith('/realtime-ranking')).length, 5);
    assert.equal(putBeforeCommentsFinish, true, 'boost and slower comments overlap');
    assert.equal(boostWrites, 1);
    assert.equal(rewardWrites, 1);
    assert.equal(sfWrites, 1);
    assert.match(document.getElementById('stove-special-force-data').textContent, /보상 1\/7개/);
    assert.match(document.getElementById('stove-log-content').textContent, /스페셜포스: 1000 FLAKE/);
    assert.equal(reviewWrites, 1);
    assert.equal(reviewVisits.length, 1);
    assert.match(document.getElementById('stove-status-review-event').textContent, /댓글 등록 완료/);
    assert.match(document.getElementById('stove-status-review-event').title, /지급 여부는 별도 확인/);
    assert.match(document.getElementById('stove-status-boost').textContent, /1\/1.*잔여 4회/);
    assert.match(document.getElementById('stove-status-boost-reward').textContent, /3,000 F 수령 완료/);
    assert.match(document.getElementById('stove-log-content').textContent, /오늘의 1등 미션: 3000 FLAKE/);
    // Re-running full automation must not repeat the review comment or the already claimed boost reward.
    document.getElementById('stove-btn-start').click();
    await waitUntil(() => document.documentElement.dataset.stoveAutomationStatus === 'done' || /^\[SG_DONE\]/.test(document.title));
    assert.equal(reviewWrites, 1);
    assert.equal(reviewVisits.length, 1);
    assert.equal(boostWrites, 1);
    assert.equal(rewardWrites, 1);
    assert.equal(sfWrites, 1, 'repeating full automation does not claim a received SF reward again');

    // Successful event lookups must not conceal failed background comment writes.
    failComments = true;
    const logBeforeFailure = document.getElementById('stove-log-content').textContent.length;
    document.getElementById('stove-btn-start').click();
    await waitUntil(() => /^\[SG_ERROR\]/.test(document.title));
    const failedRunLog = document.getElementById('stove-log-content').textContent.slice(logBeforeFailure);
    assert.match(failedRunLog, /댓글 작성 실패/);
    assert.match(failedRunLog, /작업 실패 1개/);
    assert.doesNotMatch(failedRunLog, /전체 자동화 완료!|모든 작업이 완료되었습니다/);
    assert.equal(document.getElementById('stove-progress-text').textContent, '확인 필요');
    assert.equal(rewardWrites, 1);
    assert.equal(reviewWrites, 1);
    assert.equal(sfWrites, 1);

    sfUnavailable = true;
    document.getElementById('stove-btn-special-force-refresh').click();
    await waitUntil(() => /공개된 스페셜포스 행사가 없습니다/.test(document.getElementById('stove-special-force-data').textContent));
    assert.deepEqual(unexpected, []);
});
