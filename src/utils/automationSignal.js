export const AUTOMATION_SIGNAL = Object.freeze({
    running: '[SG_RUNNING]',
    done: '[SG_DONE]',
    error: '[SG_ERROR]'
});

const SIGNAL_TO_STATUS = Object.freeze({
    [AUTOMATION_SIGNAL.running]: 'running',
    [AUTOMATION_SIGNAL.done]: 'done',
    [AUTOMATION_SIGNAL.error]: 'error'
});

const SIGNAL_PATTERN = /^\[SG_(RUNNING|DONE|ERROR)\]\s*/;

function normalizeSignal(signal) {
    if (AUTOMATION_SIGNAL[signal]) return AUTOMATION_SIGNAL[signal];
    return signal || '';
}

export function stripAutomationSignalTitle(title = '') {
    const source = String(title || '').trim();
    const match = source.match(SIGNAL_PATTERN);
    if (!match) return source;

    const rest = source.slice(match[0].length);
    const baseTitleIndex = rest.indexOf(' | ');
    if (baseTitleIndex === -1) return '';

    return rest.slice(baseTitleIndex + 3).trim();
}

export function buildAutomationSignalTitle(signal, message = '', baseTitle = '') {
    const prefix = normalizeSignal(signal);
    const text = String(message || '').trim();
    const cleanBaseTitle = stripAutomationSignalTitle(baseTitle);
    const signalTitle = [prefix, text].filter(Boolean).join(' ');

    return cleanBaseTitle ? `${signalTitle} | ${cleanBaseTitle}` : signalTitle;
}

export function parseAutomationSignalTitle(title = '') {
    const source = String(title || '').trim();
    const match = source.match(SIGNAL_PATTERN);
    if (!match) return null;

    const signal = `[SG_${match[1]}]`;
    const rest = source.slice(match[0].length);
    const messageEnd = rest.indexOf(' | ');
    const message = (messageEnd === -1 ? rest : rest.slice(0, messageEnd)).trim();

    return {
        status: SIGNAL_TO_STATUS[signal],
        message
    };
}

export function setAutomationSignal(signal, message = '', targetDocument) {
    const doc = targetDocument || (typeof document === 'undefined' ? null : document);
    if (!doc) return '';

    doc.title = buildAutomationSignalTitle(signal, message, doc.title);
    return doc.title;
}
