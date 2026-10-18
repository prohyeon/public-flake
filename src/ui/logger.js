const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const ICONS = { success: '✓', error: '✗', info: '⏳', warning: '⚠️' };
const LEADING_ICONS = ['✓', '✗', '⏳', '⚠️', '✅', '❌'];

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

// Many messages already start with their own status icon; don't print a second one in front.
export function formatLogEntry(message, type = 'info') {
    const text = decodeHtmlEntities(message);
    return LEADING_ICONS.some(icon => text.startsWith(icon)) ? text : `${ICONS[type]} ${text}`;
}

export function log(message, type = 'info') {
    const logContent = document.getElementById('stove-log-content');
    if (!logContent) return;

    const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };

    const entry = document.createElement('div');
    entry.style.color = colors[type];
    entry.style.padding = '4px 0';
    entry.dataset.type = type;
    entry.textContent = formatLogEntry(message, type);

    logContent.appendChild(entry);

    const logSection = document.querySelector('.stove-log-section');
    if (logSection) {
        logSection.scrollTop = logSection.scrollHeight;
    }
}
