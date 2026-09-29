const WATCHER_KEY = Symbol.for('stove.myhomeNoticeDismissal');
const PANEL_ID = 'stove-quest-automation';
const GUIDE_SELECTOR = '.driver-popover.myhome-coachmark-popover';
const BADGE_SELECTOR = '[role="tooltip"][id^="badge-tooltip-"]';
const MAX_CLICKS_PER_NOTICE = 2;
const OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-disabled', 'aria-hidden', 'inert'],
};

/**
 * Dismiss the two supported MY홈 coachmark steps and achievement badge tips
 * through their own buttons, while leaving a watcher for later SPA notices.
 */
export function startMyHomeNoticeDismissal({
    document: doc = globalThis.document,
    settleDelayMs = 600,
} = {}) {
    if (!doc) throw new TypeError('startMyHomeNoticeDismissal requires a document');

    const existingWatcher = doc[WATCHER_KEY];
    if (existingWatcher && !existingWatcher.stopped && typeof existingWatcher.stop === 'function') {
        return existingWatcher.stop;
    }

    const delay = Number.isFinite(Number(settleDelayMs))
        ? Math.max(0, Number(settleDelayMs))
        : 600;
    const timerHost = doc.defaultView || globalThis;
    const lifecycle = { stopped: false, stop: null };
    let observer = null;
    let scanTimer = null;
    const guideAttempts = new WeakMap();
    const badgeAttempts = new WeakMap();

    function isInsideAutomationPanel(node) {
        const panel = doc.getElementById(PANEL_ID);
        return Boolean(panel && (node === panel || panel.contains(node)));
    }

    function isVisible(element) {
        if (!element || !doc.documentElement?.contains(element)) return false;

        for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
            if (current.hidden || current.hasAttribute('hidden')) return false;
            if (current.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true') return false;

            const style = getComputedStyleFor(current);
            const display = style?.display || current.style?.display;
            const visibility = style?.visibility || current.style?.visibility;
            const opacity = style?.opacity || current.style?.opacity;
            if (display?.toLowerCase() === 'none') return false;
            if (visibility?.toLowerCase() === 'hidden' || visibility?.toLowerCase() === 'collapse') return false;
            if (opacity !== undefined && opacity !== '') {
                const numericOpacity = Number.parseFloat(opacity);
                if (Number.isFinite(numericOpacity) && numericOpacity <= 0) return false;
            }
        }

        return true;
    }

    function getComputedStyleFor(element) {
        try {
            return timerHost.getComputedStyle?.(element);
        } catch {
            return null;
        }
    }

    function isEnabled(element) {
        for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
            if (current.disabled === true) return false;
            if (current.getAttribute('aria-disabled')?.trim().toLowerCase() === 'true') return false;
            if (current.inert === true || current.hasAttribute('inert')) return false;
        }

        return true;
    }

    function canClick(element) {
        if (!isVisible(element) || !isEnabled(element)) return false;
        return getComputedStyleFor(element)?.pointerEvents?.toLowerCase() !== 'none';
    }

    function firstActionable(container, selector) {
        for (const element of container.querySelectorAll(selector)) {
            if (canClick(element) && typeof element.click === 'function') return element;
        }
        return null;
    }

    function findGuideButton(popover) {
        return firstActionable(popover, '.driver-popover-close-btn')
            || firstActionable(popover, '.driver-popover-done-btn')
            || firstActionable(popover, '.driver-popover-next-btn');
    }

    function getKnownGuideStep(popover) {
        for (const step of ['myhome-coachmark-step-1', 'myhome-coachmark-step-2']) {
            if (popover.classList.contains(step)) return step;
        }
        return null;
    }

    function findBadgeCloseButton(tooltip) {
        for (const button of tooltip.querySelectorAll('button[aria-label]')) {
            const label = button.getAttribute('aria-label')?.trim().toLowerCase();
            if ((label === '닫기' || label === 'close') && canClick(button) && typeof button.click === 'function') {
                return button;
            }
        }
        return null;
    }

    function clickAndWait(button) {
        button.click();
        scheduleScan(delay);
    }

    function scan() {
        if (lifecycle.stopped) return;

        const visibleGuides = [...doc.querySelectorAll(GUIDE_SELECTOR)].filter(isVisible);
        if (visibleGuides.length > 0) {
            const guide = visibleGuides.find(getKnownGuideStep);

            // A visible MY홈 guide blocks badge interaction even if an
            // unrecognized guide step has no supported button to press.
            if (!guide) {
                return;
            }

            const step = getKnownGuideStep(guide);
            let attemptsByStep = guideAttempts.get(guide);
            if (!attemptsByStep) {
                attemptsByStep = new Map();
                guideAttempts.set(guide, attemptsByStep);
            }
            const state = attemptsByStep.get(step) || { clicks: 0 };
            attemptsByStep.set(step, state);

            const button = findGuideButton(guide);
            if (button && state.clicks < MAX_CLICKS_PER_NOTICE) {
                state.clicks += 1;
                clickAndWait(button);
            }
            return;
        }

        const visibleBadges = [...doc.querySelectorAll(BADGE_SELECTOR)].filter(isVisible);

        // Process one tooltip at a time and let its close handler settle before
        // looking for the next one.
        for (const tooltip of visibleBadges) {
            const button = findBadgeCloseButton(tooltip);
            if (!button) continue;

            const state = badgeAttempts.get(tooltip) || { clicks: 0 };
            if (state.clicks >= MAX_CLICKS_PER_NOTICE) continue;
            state.clicks += 1;
            badgeAttempts.set(tooltip, state);
            clickAndWait(button);
            return;
        }
    }

    function scheduleScan(waitMs = delay, resetPending = false) {
        if (lifecycle.stopped) return;
        if (scanTimer !== null) {
            if (!resetPending) return;
            timerHost.clearTimeout(scanTimer);
        }
        scanTimer = timerHost.setTimeout(() => {
            scanTimer = null;
            scan();
        }, waitMs);
    }

    function handleMutations(records) {
        if (lifecycle.stopped) return;
        if (records.some(record => !isInsideAutomationPanel(record.target))) scheduleScan(delay);
    }

    function handleReady() {
        scheduleScan(delay, true);
    }

    function stop() {
        if (lifecycle.stopped) return;
        lifecycle.stopped = true;
        if (observer) observer.disconnect();
        doc.removeEventListener('DOMContentLoaded', handleReady);
        if (scanTimer !== null) {
            timerHost.clearTimeout(scanTimer);
            scanTimer = null;
        }
        if (doc[WATCHER_KEY] === lifecycle) delete doc[WATCHER_KEY];
    }

    lifecycle.stop = stop;
    Object.defineProperty(doc, WATCHER_KEY, {
        configurable: true,
        value: lifecycle,
    });

    const MutationObserverImpl = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (MutationObserverImpl) {
        observer = new MutationObserverImpl(handleMutations);
        try {
            observer.observe(doc, OBSERVER_OPTIONS);
        } catch {
            if (doc.documentElement) {
                try {
                    observer.observe(doc.documentElement, OBSERVER_OPTIONS);
                } catch {
                    observer.disconnect();
                    observer = null;
                }
            } else {
                observer.disconnect();
                observer = null;
            }
        }
    }

    doc.addEventListener('DOMContentLoaded', handleReady);
    scheduleScan(delay, true);
    return stop;
}
