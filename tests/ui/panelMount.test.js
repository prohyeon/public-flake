import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { startPanelMount } from '../../src/ui/mount.js';

const waitForMutations = () => new Promise(resolve => setTimeout(resolve, 25));

function createPanel(document) {
    const panel = document.createElement('section');
    panel.id = 'stove-quest-automation';
    panel.innerHTML = `
        <button id="panel-action">Action</button>
        <button id="panel-disabled" disabled>Disabled</button>
        <div id="panel-log"></div>
        <div id="panel-status"></div>
    `;
    panel.querySelector('#panel-action').addEventListener('click', () => {
        panel.dataset.clicked = 'true';
    });
    return panel;
}

function setup(markup = '<!doctype html><html><body></body></html>', beforeMount = () => {}) {
    const dom = new JSDOM(markup, { url: 'https://example.test/' });
    const { document } = dom.window;
    beforeMount(document);
    let panel;
    let createCount = 0;
    let firstMountCount = 0;
    const stop = startPanelMount({
        document,
        createPanel: () => {
            createCount += 1;
            panel = createPanel(document);
            return panel;
        },
        onFirstMount: () => { firstMountCount += 1; }
    });

    return {
        dom,
        document,
        stop,
        get panel() { return panel; },
        get createCount() { return createCount; },
        get firstMountCount() { return firstMountCount; }
    };
}

test('mounts before the new MY홈 Body slot as a sibling, ahead of its aside sibling', async t => {
    const app = setup(`<!doctype html><html><body>
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
    </body></html>`);
    t.after(() => app.dom.window.close());

    await waitForMutations();

    const bodySlot = app.document.querySelector('#__nuxt [data-slot="Body"]');
    const appSlot = app.document.querySelector('#__nuxt > [data-slot="App"]');
    assert.equal(app.document.querySelector('main, .inds-content-body'), null);
    assert.ok(app.panel);
    assert.equal(bodySlot.parentElement, appSlot);
    assert.equal(app.panel.parentElement, appSlot);
    assert.equal(app.panel.nextElementSibling, bodySlot);
    assert.equal(app.panel.dataset.stoveMount, 'myhome');
    assert.equal(app.createCount, 1);
    assert.equal(app.firstMountCount, 1);
});

test('keeps the legacy content-body and main insertion targets working', async t => {
    const fixtures = [
        {
            markup: '<div class="inds-content-body"><p>Legacy content</p></div>',
            selector: '.inds-content-body'
        },
        {
            markup: '<main><p>Legacy main</p></main>',
            selector: 'main'
        }
    ];

    for (const fixture of fixtures) {
        const app = setup(`<!doctype html><html><body>${fixture.markup}</body></html>`);
        t.after(() => app.dom.window.close());

        await waitForMutations();

        const target = app.document.querySelector(fixture.selector);
        assert.equal(app.panel.parentElement, target, `${fixture.selector} receives the panel`);
        assert.equal(target.firstElementChild, app.panel, `${fixture.selector} prepends the panel`);
        assert.equal(app.panel.dataset.stoveMount, 'legacy');
        assert.equal(app.createCount, 1);
        assert.equal(app.firstMountCount, 1);
    }
});

test('uses body fallback then promotes the same panel when a MY홈 target appears', async t => {
    const app = setup();
    t.after(() => app.dom.window.close());

    await waitForMutations();
    const originalPanel = app.panel;
    assert.equal(originalPanel.parentElement, app.document.body);
    assert.equal(app.document.body.firstElementChild, originalPanel);
    assert.equal(originalPanel.dataset.stoveMount, 'fallback');

    const appRoot = app.document.createElement('div');
    appRoot.id = '__nuxt';
    appRoot.innerHTML = '<header>Header</header><aside>Aside</aside><div data-slot="Body">Body</div>';
    app.document.body.append(appRoot);
    await waitForMutations();

    const bodySlot = appRoot.querySelector('[data-slot="Body"]');
    assert.equal(app.panel, originalPanel);
    assert.equal(originalPanel.parentElement, appRoot);
    assert.equal(originalPanel.nextElementSibling, bodySlot);
    assert.equal(originalPanel.dataset.stoveMount, 'myhome');
    assert.equal(app.createCount, 1);
    assert.equal(app.firstMountCount, 1);
});

test('waits for body, then mounts when body is added later', async t => {
    const app = setup('<!doctype html><html><head></head><body></body></html>', document => {
        document.body.remove();
    });
    t.after(() => app.dom.window.close());
    await waitForMutations();
    assert.equal(app.panel.isConnected, false);
    assert.equal(app.firstMountCount, 0);
    assert.equal(app.document.getElementById('stove-quest-automation'), null);

    const body = app.document.createElement('body');
    app.document.documentElement.append(body);
    await waitForMutations();

    assert.equal(app.panel.parentElement, body);
    assert.equal(body.firstElementChild, app.panel);
    assert.equal(app.panel.dataset.stoveMount, 'fallback');
    assert.equal(app.createCount, 1);
    assert.equal(app.firstMountCount, 1);
});

test('reattaches the same panel after route-root replacement and external removal', async t => {
    const app = setup(`<!doctype html><html><body>
        <div id="__nuxt"><div data-slot="Body">Initial</div></div>
    </body></html>`);
    t.after(() => app.dom.window.close());

    await waitForMutations();
    const originalPanel = app.panel;
    const action = originalPanel.querySelector('#panel-action');
    const disabled = originalPanel.querySelector('#panel-disabled');
    originalPanel.querySelector('#panel-log').textContent = 'retained log';
    originalPanel.querySelector('#panel-status').textContent = 'running';

    app.document.querySelector('#__nuxt').replaceWith(Object.assign(
        app.document.createElement('div'),
        { id: '__nuxt' }
    ));
    app.document.querySelector('#__nuxt').innerHTML = '<header>New Header</header><div data-slot="Body">New route</div>';
    await waitForMutations();

    assert.equal(app.panel, originalPanel);
    assert.equal(originalPanel.parentElement, app.document.querySelector('#__nuxt'));
    assert.equal(originalPanel.nextElementSibling, app.document.querySelector('[data-slot="Body"]'));

    originalPanel.remove();
    await waitForMutations();

    assert.equal(app.document.querySelectorAll('#stove-quest-automation').length, 1);
    assert.equal(app.document.getElementById('stove-quest-automation'), originalPanel);
    assert.equal(app.createCount, 1);
    assert.equal(app.firstMountCount, 1);
    assert.equal(originalPanel.querySelector('#panel-log').textContent, 'retained log');
    assert.equal(originalPanel.querySelector('#panel-status').textContent, 'running');
    assert.equal(disabled.disabled, true);
    action.click();
    assert.equal(originalPanel.dataset.clicked, 'true');
});

test('reuses an existing panel without creating another or repeating first-mount work', async t => {
    const existing = '<section id="stove-quest-automation">Already initialized</section>';
    const app = setup(`<!doctype html><html><body>
        <div id="__nuxt"><header>Header</header><div data-slot="Body">MY홈</div></div>
        ${existing}
    </body></html>`);
    t.after(() => app.dom.window.close());

    await waitForMutations();

    const panel = app.document.getElementById('stove-quest-automation');
    assert.equal(app.document.querySelectorAll('#stove-quest-automation').length, 1);
    assert.equal(panel.parentElement, app.document.querySelector('#__nuxt'));
    assert.equal(panel.nextElementSibling, app.document.querySelector('[data-slot="Body"]'));
    assert.equal(app.createCount, 0);
    assert.equal(app.firstMountCount, 0);
});

test('does not treat a first-mount callback error as an insertion failure', t => {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="__nuxt"><div data-slot="Body">MY홈</div></div>
    </body></html>`);
    t.after(() => dom.window.close());
    const { document } = dom.window;
    const panel = createPanel(document);
    const callbackError = new Error('initialization failed');

    assert.throws(() => startPanelMount({
        document,
        createPanel: () => panel,
        onFirstMount: () => { throw callbackError; }
    }), error => error === callbackError);

    assert.equal(panel.parentElement, document.querySelector('#__nuxt'));
    assert.equal(panel.dataset.stoveMount, 'myhome');
});

test('does not relocate the panel for log and status mutations inside it', async t => {
    const app = setup(`<!doctype html><html><body>
        <div id="__nuxt"><div data-slot="Body">MY홈</div></div>
    </body></html>`);
    t.after(() => app.dom.window.close());

    await waitForMutations();
    const panel = app.panel;
    const parent = panel.parentElement;
    const originalNextSibling = panel.nextSibling;
    let panelInsertions = 0;
    const originalInsertBefore = parent.insertBefore.bind(parent);
    parent.insertBefore = (node, reference) => {
        if (node === panel) panelInsertions += 1;
        return originalInsertBefore(node, reference);
    };

    panel.querySelector('#panel-log').append('new log line');
    panel.querySelector('#panel-status').textContent = 'updated status';
    await waitForMutations();

    assert.equal(panel.parentElement, parent);
    assert.equal(panel.nextSibling, originalNextSibling);
    assert.equal(panelInsertions, 0);
    assert.equal(app.createCount, 1);
    assert.equal(app.firstMountCount, 1);
});

test('stop disconnects observation and prevents later recovery', async t => {
    const app = setup(`<!doctype html><html><body>
        <div id="__nuxt"><div data-slot="Body">MY홈</div></div>
    </body></html>`);
    t.after(() => app.dom.window.close());

    await waitForMutations();
    const panel = app.panel;
    app.stop();
    panel.remove();

    const replacementRoot = app.document.createElement('div');
    replacementRoot.id = '__nuxt';
    replacementRoot.innerHTML = '<div data-slot="Body">New route</div>';
    app.document.getElementById('__nuxt').replaceWith(replacementRoot);
    await waitForMutations();

    assert.equal(panel.isConnected, false);
    assert.equal(app.document.querySelectorAll('#stove-quest-automation').length, 0);
    assert.equal(app.createCount, 1);
    assert.equal(app.firstMountCount, 1);
});
