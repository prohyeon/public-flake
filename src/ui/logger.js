const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const COLORS = { success: '#34d399', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };

// Emoji and the check/cross glyphs that older messages carried as icons. The panel shows the type
// as a colored bar instead, so these are removed from what is displayed.
const DECORATIVE = /(?:\p{Extended_Pictographic}️?|‍|✓|✗)+ ?/gu;

// Timing text is wrapped in these private-use markers; the logger renders it in its own span so the
// panel can hide it until the user asks for it. The text itself is unchanged.
export const TIMING_OPEN = '';
export const TIMING_CLOSE = '';
export const timingText = text => `${TIMING_OPEN}${text}${TIMING_CLOSE}`;

// Some API names arrive HTML-escaped ("1,000 플레이크 &amp; 아우루"); the entry is set via textContent,
// so decoding here only changes what is shown.
export function decodeHtmlEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
        if (name[0] === '#') {
            const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return ENTITIES[name.toLowerCase()] ?? match;
    });
}

function displayText(text) {
    return decodeHtmlEntities(text).replace(DECORATIVE, '');
}

// Text without markers, as shown to the user (and as read back by tests).
export function formatLogEntry(message) {
    return displayText(String(message).split(TIMING_OPEN).join('').split(TIMING_CLOSE).join(''));
}

function appendMessage(entry, message) {
    const pattern = new RegExp(`(${TIMING_OPEN}[^${TIMING_CLOSE}]*${TIMING_CLOSE})`);
    for (const part of String(message).split(pattern)) {
        if (!part) continue;
        if (part.startsWith(TIMING_OPEN) && part.endsWith(TIMING_CLOSE)) {
            const span = document.createElement('span');
            span.className = 'log-timing';
            span.textContent = displayText(part.slice(1, -1));
            entry.appendChild(span);
        } else {
            entry.appendChild(document.createTextNode(displayText(part)));
        }
    }
}

export function log(message, type = 'info', options = {}) {
    const logContent = document.getElementById('stove-log-content');
    if (!logContent) return;

    const entry = document.createElement('div');
    entry.style.color = COLORS[type];
    entry.style.borderLeftColor = COLORS[type];
    entry.dataset.type = type;
    if (options.timing) entry.dataset.timing = 'true';
    appendMessage(entry, message);

    logContent.appendChild(entry);

    const logSection = document.querySelector('.stove-log-section');
    if (logSection) {
        logSection.scrollTop = logSection.scrollHeight;
    }
}
