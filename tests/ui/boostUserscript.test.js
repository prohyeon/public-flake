import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { boostFixture, boostCandidate } from '../helpers/boostFixture.js';

const userscript = readFileSync(new URL('../../stove-quest-automation.user.js', import.meta.url), 'utf8');

test('distributed dashboard only reads status; full automation queries five times and claims after background comments', async t => {
    const dom = new JSDOM('<!doctype html><title>MY홈</title><div id="__nuxt"><div data-slot="App"><div data-slot="Body"></div></div></div>', {
        runScripts: 'outside-only', url: 'https://profile.onstove.com/'
    });
    t.after(() => dom.window.close());
    const { window } = dom;
    const { document } = window;
    const now = Date.now();
    const mission = boostFixture().mission;
    mission.start_dt = now - 86400000;
    mission.end_dt = now + 86400000;
    mission.details[1].current_count = 0;
    const articles = [boostCandidate(11, 443), boostCandidate(12, 966), boostCandidate(13, 354)]
        .map(article => ({ ...article, datetime: now - 60000 }));
    const calls = [];
    const unexpected = [];
    let comments = 0;
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
    window.GM_openInTab = () => ({ close() {} });
    Object.defineProperty(window.navigator, 'locks', { value: { request: async (key, options, work) => work({ name: key }) } });
    document.cookie = 'SUAT=test-token; path=/';
    window.localStorage.setItem('sgs_da_uuid', 'test-uuid');
    Object.defineProperty(document, 'readyState', { get: () => 'complete' });
    window.GM_xmlhttpRequest = config => {
        const url = new URL(config.url);
        const path = url.pathname;
        calls.push({ method: config.method, path });
        let value;
        if (path === '/stadium-api/v1.0/missions') value = { missions: [mission] };
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
        else if (path === '/postie/v2.0/interest/article/list') value = { list: Array.from({ length: 5 }, (_, i) => ({ article_id: String(21 + i) })) };
        else if (path.endsWith('/interaction/LIKE')) {
            const ids = path.split('/')[4].split(',');
            value = Object.fromEntries(ids.map(id => [id, { LIKE: false }]));
        } else if (path.endsWith('/comment') && config.method === 'POST') {
            comments++;
            if (comments === 5) { mission.details[1].current_count = 1; mission.is_completed = true; }
            value = { comment_id: String(comments) };
        } else if (path === '/flake-shop/v1/page') value = { component_list: [{ component_no: 271, component_type: 'SINGLE' }] };
        else if (path === '/flake-shop/v1/mission/component') value = { component_info: { component_type: 'SINGLE' }, missions: [] };
        else if (path === '/emsbackapi/v3.0/participationCnt') value = { participation_cnt: 30 };
        else if (path === '/emsbackapi/v3.0/extra') value = { current_cnt: 0, milestones: [] };
        else if (path === '/emsbackapi/v3.0/events' || path === '/emsbackapi/v3.0/apply') value = {};
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
    assert.equal(calls.some(call => call.method !== 'GET'), false, 'dashboard refresh makes no mutation');
    assert.equal(calls.some(call => call.path.endsWith('/realtime-ranking')), false, 'status reads do not consume the five-query search');
    document.getElementById('stove-btn-start').click();
    await waitUntil(() => document.documentElement.dataset.stoveAutomationStatus === 'done' || /^\[SG_DONE\]/.test(document.title));
    assert.equal(calls.filter(call => call.path.endsWith('/realtime-ranking')).length, 5);
    assert.equal(putBeforeCommentsFinish, true, 'boost and slower comments overlap');
    assert.equal(boostWrites, 1);
    assert.equal(rewardWrites, 1);
    assert.match(document.getElementById('stove-status-boost').textContent, /1\/1.*잔여 4회/);
    assert.match(document.getElementById('stove-status-boost-reward').textContent, /3,000 F 수령 완료/);
    assert.match(document.getElementById('stove-log-content').textContent, /오늘의 1등 미션: 3000 FLAKE/);
    assert.deepEqual(unexpected, []);
});
