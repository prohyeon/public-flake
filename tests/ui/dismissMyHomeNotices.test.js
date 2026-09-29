import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { startMyHomeNoticeDismissal } from '../../src/ui/dismissMyHomeNotices.js';

const settleDelayMs = 15;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = () => wait(settleDelayMs * 4);

async function waitFor(predicate, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await wait(5);
    }
    assert.ok(predicate(), `condition did not become true within ${timeoutMs} ms`);
}

function createPage(markup = '<!doctype html><html><body></body></html>') {
    const dom = new JSDOM(markup, { url: 'https://profile.onstove.com/' });
    return { dom, document: dom.window.document };
}

function start(document) {
    return startMyHomeNoticeDismissal({ document, settleDelayMs });
}

function makeBadge(document, id, label = '닫기') {
    const tooltip = document.createElement('div');
    tooltip.id = id;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.innerHTML = `<button aria-label="${label}">Close badge</button>`;
    return { tooltip, button: tooltip.querySelector('button') };
}

test('finishes the two-step guide before dismissing badges through page handlers', async t => {
    const { dom, document } = createPage(`<!doctype html><html><head><style>
        body.driver-active { pointer-events: none; }
        body.driver-active .driver-popover, body.driver-active .driver-popover * { pointer-events: auto; }
        body.driver-active [role="tooltip"] { pointer-events: none; }
    </style></head><body class="driver-active" style="overflow: hidden">
        <div class="driver-overlay" data-page-overlay style="pointer-events: auto"></div>
        <div class="driver-popover myhome-coachmark-popover myhome-coachmark-step-1">
            <button class="driver-popover-close-btn" style="display:none">Close</button>
            <button class="driver-popover-next-btn">Next</button>
        </div>
        <div id="badge-tooltip-achievement-new" role="tooltip">
            <span>새 업적을 확인하세요</span><button aria-label="닫기">Close badge</button>
        </div>
        <div role="dialog" aria-label="Settings"><button aria-label="닫기">Settings close</button></div>
        <button data-payment-action>Payment</button>
    </body></html>`);
    t.after(() => dom.window.close());

    const guide = document.querySelector('.driver-popover.myhome-coachmark-popover');
    const next = guide.querySelector('.driver-popover-next-btn');
    const closeGuide = guide.querySelector('.driver-popover-close-btn');
    const overlay = document.querySelector('[data-page-overlay]');
    const tooltip = document.getElementById('badge-tooltip-achievement-new');
    const badgeClose = tooltip.querySelector('button[aria-label="닫기"]');
    const unrelatedClose = document.querySelector('[role="dialog"] button');
    const payment = document.querySelector('[data-payment-action]');
    const clicks = [];

    next.addEventListener('click', () => {
        if (guide.classList.contains('myhome-coachmark-step-1')) {
            clicks.push('guide-next');
            dom.window.setTimeout(() => {
                guide.classList.replace('myhome-coachmark-step-1', 'myhome-coachmark-step-2');
                next.classList.add('driver-popover-done-btn');
                next.textContent = '닫기';
            }, 2);
        } else {
            clicks.push('guide-done');
            guide.remove();
            overlay.remove();
            document.body.classList.remove('driver-active');
            document.body.style.overflow = '';
        }
    });
    closeGuide.addEventListener('click', () => clicks.push('hidden-guide-close'));
    badgeClose.addEventListener('click', () => {
        clicks.push('badge-close');
        tooltip.remove();
    });
    unrelatedClose.addEventListener('click', () => clicks.push('settings-close'));
    payment.addEventListener('click', () => clicks.push('payment'));

    const stop = start(document);
    await waitFor(() => clicks.length === 3 && !guide.isConnected && !tooltip.isConnected);

    assert.deepEqual(clicks, ['guide-next', 'guide-done', 'badge-close']);
    assert.equal(document.querySelector('.driver-popover.myhome-coachmark-popover'), null);
    assert.equal(document.querySelector('[data-page-overlay]'), null);
    assert.equal(document.getElementById('badge-tooltip-achievement-new'), null);
    assert.equal(document.body.style.overflow, '', 'the page close handler restores the body lock');
    assert.equal(document.body.classList.contains('driver-active'), false);
    assert.equal(clicks.includes('hidden-guide-close'), false);
    assert.equal(clicks.includes('settings-close'), false);
    assert.equal(clicks.includes('payment'), false);
    stop();
});

test('prefers a visible guide close button over the next button', async t => {
    const { dom, document } = createPage(`<!doctype html><html><body>
        <div class="driver-popover myhome-coachmark-popover myhome-coachmark-step-2">
            <button class="driver-popover-close-btn">Close</button>
            <button class="driver-popover-next-btn">Next</button>
        </div>
    </body></html>`);
    t.after(() => dom.window.close());
    const guide = document.querySelector('.driver-popover.myhome-coachmark-popover');
    let closeClicks = 0;
    let nextClicks = 0;
    guide.querySelector('.driver-popover-close-btn').addEventListener('click', () => {
        closeClicks += 1;
        guide.remove();
    });
    guide.querySelector('.driver-popover-next-btn').addEventListener('click', () => { nextClicks += 1; });

    const stop = start(document);
    await waitFor(() => !guide.isConnected);

    assert.equal(closeClicks, 1);
    assert.equal(nextClicks, 0);
    stop();
});

test('waits for dynamic notices to become visible and enabled, then handles replacement tooltips', async t => {
    const { dom, document } = createPage();
    t.after(() => dom.window.close());
    let clickCount = 0;
    const stop = start(document);

    const hiddenAncestor = document.createElement('section');
    hiddenAncestor.style.display = 'none';
    const first = makeBadge(document, 'badge-tooltip-hidden', '닫기');
    first.button.disabled = true;
    first.button.addEventListener('click', () => {
        clickCount += 1;
        first.tooltip.remove();
    });
    hiddenAncestor.append(first.tooltip);
    document.body.append(hiddenAncestor);
    await settle();
    assert.equal(clickCount, 0, 'hidden ancestors prevent dismissal');

    hiddenAncestor.style.display = 'block';
    await settle();
    assert.equal(clickCount, 0, 'disabled buttons are left alone');

    first.button.disabled = false;
    await waitFor(() => clickCount === 1);
    assert.equal(clickCount, 1);
    assert.equal(first.tooltip.isConnected, false);

    const replacement = makeBadge(document, 'badge-tooltip-replacement', 'Close');
    replacement.button.addEventListener('click', () => {
        clickCount += 1;
        replacement.tooltip.remove();
    });
    document.body.append(replacement.tooltip);
    await waitFor(() => clickCount === 2);

    assert.equal(clickCount, 2, 'a replacement tooltip with English Close is dismissed');
    assert.equal(replacement.tooltip.isConnected, false);
    stop();
});

test('keeps scanning despite continuous unrelated class and style mutations', async t => {
    const { dom, document } = createPage();
    t.after(() => dom.window.close());
    const { tooltip, button } = makeBadge(document, 'badge-tooltip-under-noise');
    const noise = document.createElement('div');
    document.body.append(tooltip, noise);
    let clickCount = 0;
    button.addEventListener('click', () => {
        clickCount += 1;
        tooltip.remove();
    });

    const stop = start(document);
    const noiseTimer = setInterval(() => {
        noise.classList.toggle('noise-a');
        noise.style.color = noise.style.color ? '' : 'red';
    }, 5);
    try {
        await waitFor(() => clickCount === 1, settleDelayMs * 8);
    } finally {
        clearInterval(noiseTimer);
        stop();
    }

    assert.equal(tooltip.isConnected, false);
});

test('a replacement badge node can be dismissed after the previous node used both retries', async t => {
    const { dom, document } = createPage(`<!doctype html><html><body>
        <div id="badge-tooltip-reused-id" role="tooltip"><button aria-label="닫기">Close</button></div>
    </body></html>`);
    t.after(() => dom.window.close());
    const firstTooltip = document.getElementById('badge-tooltip-reused-id');
    let firstClicks = 0;
    firstTooltip.querySelector('button').addEventListener('click', () => { firstClicks += 1; });
    let replacementClicks = 0;
    const stop = start(document);

    await waitFor(() => firstClicks === 2);
    const replacement = makeBadge(document, 'badge-tooltip-reused-id', 'Close');
    replacement.button.addEventListener('click', () => {
        replacementClicks += 1;
        replacement.tooltip.remove();
    });
    firstTooltip.replaceWith(replacement.tooltip);
    await waitFor(() => replacementClicks === 1);

    assert.equal(firstClicks, 2);
    assert.equal(replacement.tooltip.isConnected, false);
    stop();
});

test('deduplicates starts per document and bounds a nonresponsive close button to two clicks', async t => {
    const { dom, document } = createPage(`<!doctype html><html><body>
        <div id="badge-tooltip-stuck" role="tooltip"><button aria-label="닫기">Close</button></div>
    </body></html>`);
    t.after(() => dom.window.close());
    let clickCount = 0;
    document.querySelector('#badge-tooltip-stuck button').addEventListener('click', () => {
        clickCount += 1;
        // Model a page handler that does not close the tooltip.
    });

    const stopFirst = start(document);
    const stopSecond = start(document);
    await wait(settleDelayMs * 8);

    assert.equal(clickCount, 2, 'retries the same root and stage at most once');
    await wait(settleDelayMs * 4);
    assert.equal(clickCount, 2, 'a nonresponsive button is not clicked indefinitely');

    stopSecond();
    stopFirst();
});

test('stop cancels pending work and never removes notices directly', async t => {
    const { dom, document } = createPage(`<!doctype html><html><body>
        <div id="badge-tooltip-pending" role="tooltip"><button aria-label="닫기">Close</button></div>
    </body></html>`);
    t.after(() => dom.window.close());
    let clickCount = 0;
    const tooltip = document.getElementById('badge-tooltip-pending');
    tooltip.querySelector('button').addEventListener('click', () => { clickCount += 1; });

    const stop = start(document);
    stop();
    await settle();

    assert.equal(clickCount, 0);
    assert.equal(tooltip.isConnected, true);
});

test('ignores unrelated, unrecognized guide, and non-badge tooltip controls', async t => {
    const { dom, document } = createPage(`<!doctype html><html><body style="overflow: hidden">
        <div class="driver-popover myhome-coachmark-popover unrelated-step">
            <button class="driver-popover-done-btn">Done</button>
        </div>
        <div id="other-tooltip" role="tooltip"><button aria-label="닫기">Close</button></div>
        <div id="badge-tooltip-without-role"><button aria-label="Close">Close</button></div>
        <div role="dialog" aria-label="Settings"><button aria-label="닫기">Close</button></div>
        <button data-payment-action>Pay</button>
    </body></html>`);
    t.after(() => dom.window.close());
    const buttons = [...document.querySelectorAll('button')];
    let clickCount = 0;
    buttons.forEach(button => button.addEventListener('click', () => { clickCount += 1; }));
    const beforeOverflow = document.body.style.overflow;

    const stop = start(document);
    await settle();

    assert.equal(clickCount, 0);
    assert.equal(document.body.style.overflow, beforeOverflow, 'the watcher leaves body styles to page handlers');
    assert.equal(document.querySelectorAll('button').length, buttons.length);
    stop();
});
