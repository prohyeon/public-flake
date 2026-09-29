import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const userscript = readFileSync(new URL('../../stove-quest-automation.user.js', import.meta.url), 'utf8');
const waitForMutations = () => new Promise(resolve => setTimeout(resolve, 25));

test('deployed userscript mounts once into MY홈 and survives route replacement and reevaluation', async t => {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="__nuxt">
            <div data-slot="App">
                <header data-slot="Header">Header</header>
                <div data-slot="Body">
                    <div style="display:flex">
                        <aside>Navigation</aside>
                        <div data-slot="Contents">MY홈 contents</div>
                    </div>
                </div>
            </div>
        </div>
    </body></html>`, {
        runScripts: 'outside-only',
        url: 'https://profile.onstove.com/'
    });
    t.after(() => dom.window.close());

    const { window } = dom;
    const { document } = window;
    const alerts = [];
    const consoleCalls = [];
    const statusTimers = [];
    let requestCount = 0;
    let badgeClicks = 0;
    const nativeSetTimeout = window.setTimeout.bind(window);

    window.alert = message => alerts.push(message);
    window.GM_xmlhttpRequest = () => { requestCount += 1; };
    window.GM_openInTab = () => {};
    window.console = Object.fromEntries(['log', 'warn', 'error'].map(method => [
        method,
        (...args) => consoleCalls.push({ method, args })
    ]));
    window.setTimeout = (callback, delay, ...args) => {
        if (delay === 500) {
            statusTimers.push(callback);
            return statusTimers.length;
        }
        if (delay === 600) return nativeSetTimeout(callback, 5, ...args);
        return nativeSetTimeout(callback, delay, ...args);
    };
    Object.defineProperty(document, 'readyState', {
        configurable: true,
        get: () => 'complete'
    });

    assert.equal(document.querySelector('main, .inds-content-body'), null);
    window.eval(userscript);

    const panel = document.getElementById('stove-quest-automation');
    assert.ok(panel, 'the distributed userscript creates its panel');
    const bodySlot = document.querySelector('#__nuxt [data-slot="Body"]');
    const appSlot = document.querySelector('#__nuxt > [data-slot="App"]');
    const refreshButton = panel.querySelector('#stove-btn-status-refresh');
    const initialLog = panel.querySelector('#stove-log-content').textContent;

    assert.equal(panel.parentElement, appSlot);
    assert.equal(panel.nextElementSibling, bodySlot);
    assert.equal(panel.dataset.stoveMount, 'myhome');
    assert.match(initialLog, /자동화 패널이 준비되었습니다/);
    assert.equal(statusTimers.length, 1, 'panel initialization schedules the status check once');

    const replacementRoot = document.createElement('div');
    replacementRoot.id = '__nuxt';
    replacementRoot.innerHTML = `
        <div data-slot="App">
            <header data-slot="Header">New Header</header>
            <div data-slot="Body">
                <div style="display:flex"><aside>New Navigation</aside><div data-slot="Contents">New route</div></div>
            </div>
        </div>
    `;
    document.getElementById('__nuxt').replaceWith(replacementRoot);
    await waitForMutations();

    assert.equal(document.getElementById('stove-quest-automation'), panel);
    assert.equal(panel.parentElement, replacementRoot.querySelector('[data-slot="App"]'));
    assert.equal(panel.nextElementSibling, replacementRoot.querySelector('[data-slot="Body"]'));
    assert.equal(panel.querySelector('#stove-btn-status-refresh'), refreshButton);
    assert.equal(panel.querySelector('#stove-log-content').textContent, initialLog);
    assert.equal(document.querySelectorAll('#stove-quest-automation').length, 1);

    window.eval(userscript);
    await waitForMutations();
    assert.equal(document.querySelectorAll('#stove-quest-automation').length, 1);
    assert.equal(panel.querySelector('#stove-btn-status-refresh'), refreshButton);
    assert.equal(statusTimers.length, 1, 'reevaluation adopts the mounted panel without reinitializing it');

    const badge = document.createElement('div');
    badge.id = 'badge-tooltip-smoke';
    badge.setAttribute('role', 'tooltip');
    badge.innerHTML = '<button aria-label="닫기">Close badge</button>';
    badge.querySelector('button').addEventListener('click', () => { badgeClicks += 1; });
    document.body.append(badge);
    await new Promise(resolve => setTimeout(resolve, 80));

    assert.equal(badgeClicks, 2, 'bundle reevaluation keeps one watcher with the two-click retry bound');

    refreshButton.click();
    await waitForMutations();

    assert.equal(alerts.length, 1, 'the refresh handler runs once and reports the missing login');
    assert.match(alerts[0], /SUAT.*not found/);
    assert.equal(requestCount, 0, 'the missing-login path makes no external requests');
    assert.equal(consoleCalls.filter(call => call.args[0] === '[상태 확인 시작]').length, 1);
});
