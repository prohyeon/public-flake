const PANEL_ID = 'stove-quest-automation';
const OBSERVER_OPTIONS = { childList: true, subtree: true };

/**
 * Keep a single automation panel mounted while the host page replaces its DOM.
 * The panel node itself is reused so its controls and listeners survive moves.
 */
export function startPanelMount({
    createPanel,
    onFirstMount = () => {},
    document: doc = globalThis.document,
}) {
    if (!doc) throw new TypeError('startPanelMount requires a document');
    if (typeof createPanel !== 'function') {
        throw new TypeError('startPanelMount requires createPanel()');
    }

    // The panel id is known by the current UI. Reuse it when another bootstrap
    // already created the panel instead of creating a second copy.
    const existingPanel = doc.getElementById(PANEL_ID);
    let panel = existingPanel;
    if (!panel) panel = createPanel();
    if (!panel) throw new TypeError('createPanel() must return a panel element');

    const timerHost = doc.defaultView || globalThis;
    let stopped = false;
    // An existing panel belongs to an earlier initialization and already has
    // its controls wired. Adopt it for placement recovery without wiring it a
    // second time.
    let firstMountNotified = Boolean(existingPanel);
    let reconcileTimer = null;
    let observer = null;

    function isInsidePanel(node) {
        return node === panel || (typeof panel.contains === 'function' && panel.contains(node));
    }

    function getMountTargets() {
        const targets = [];
        const myHomeBody = doc.querySelector('#__nuxt [data-slot="Body"]');
        if (myHomeBody?.parentNode) {
            targets.push({
                mode: 'myhome',
                parent: myHomeBody.parentNode,
                before: myHomeBody,
            });
        }

        const legacyContent = doc.querySelector('.inds-content-body');
        if (legacyContent) {
            targets.push({ mode: 'legacy', parent: legacyContent, before: legacyContent.firstChild });
        }

        const main = doc.querySelector('main');
        if (main) {
            targets.push({ mode: 'legacy', parent: main, before: main.firstChild });
        }

        if (doc.body) {
            targets.push({ mode: 'fallback', parent: doc.body, before: doc.body.firstChild });
        }

        return targets;
    }

    function isAlreadyAtTarget(parent, before) {
        if (panel.parentNode !== parent) return false;
        if (before === panel) return true;
        return panel.nextSibling === before;
    }

    function isConnectedToDocument() {
        if (typeof panel.isConnected === 'boolean') return panel.isConnected;
        if (doc.documentElement?.contains(panel)) return true;
        return typeof doc.contains === 'function' && doc.contains(panel);
    }

    function notifyFirstMount() {
        if (firstMountNotified || !isConnectedToDocument()) return;
        firstMountNotified = true;
        onFirstMount();
    }

    function reconcile() {
        if (stopped) return;

        for (const target of getMountTargets()) {
            const { parent, before, mode } = target;
            // Avoid attempting to insert the panel into itself or one of its
            // descendants if the host markup is unusual.
            if (parent === panel || isInsidePanel(parent)) continue;
            if (before === panel && panel.parentNode !== parent) continue;

            if (!isAlreadyAtTarget(parent, before)) {
                panel.dataset.stoveMount = mode;
                try {
                    parent.insertBefore(panel, before);
                } catch {
                    // Try the next supported target if this insertion target
                    // is no longer usable.
                    continue;
                }
            } else if (panel.dataset.stoveMount !== mode) {
                panel.dataset.stoveMount = mode;
            }

            try {
                notifyFirstMount();
            } catch (error) {
                stop();
                throw error;
            }
            return;
        }
    }

    function scheduleReconcile() {
        if (stopped || reconcileTimer !== null) return;
        reconcileTimer = timerHost.setTimeout(() => {
            reconcileTimer = null;
            reconcile();
        }, 0);
    }

    function handleMutations(records) {
        if (stopped) return;
        if (records.some(record => !isInsidePanel(record.target))) scheduleReconcile();
    }

    function handleReady() {
        scheduleReconcile();
    }

    const MutationObserverImpl = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (MutationObserverImpl) {
        observer = new MutationObserverImpl(handleMutations);
        try {
            // Observe before the initial mount so no host-page mutation can be
            // lost between checking the DOM and attaching the panel.
            observer.observe(doc, OBSERVER_OPTIONS);
        } catch {
            if (doc.documentElement) observer.observe(doc.documentElement, OBSERVER_OPTIONS);
            else observer = null;
        }
    }

    doc.addEventListener('DOMContentLoaded', handleReady);
    reconcile();

    function stop() {
        if (stopped) return;
        stopped = true;
        if (observer) observer.disconnect();
        doc.removeEventListener('DOMContentLoaded', handleReady);
        if (reconcileTimer !== null) {
            timerHost.clearTimeout(reconcileTimer);
            reconcileTimer = null;
        }
    }

    return stop;
}
