export function log(message, type = 'info') {
    const logContent = document.getElementById('stove-log-content');
    if (!logContent) return;

    const icons = { success: '✓', error: '✗', info: '⏳', warning: '⚠️' };
    const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };

    const entry = document.createElement('div');
    entry.style.color = colors[type];
    entry.style.padding = '4px 0';
    entry.textContent = `${icons[type]} ${message}`;

    logContent.appendChild(entry);

    const logSection = document.querySelector('.stove-log-section');
    if (logSection) {
        logSection.scrollTop = logSection.scrollHeight;
    }
}
