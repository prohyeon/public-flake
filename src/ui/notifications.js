export function showSuccessNotice(message) {
    const existing = document.getElementById('stove-success-notice');
    if (existing) existing.remove();

    const notice = document.createElement('div');
    notice.id = 'stove-success-notice';
    notice.className = 'stove-success-notice';
    notice.textContent = message;

    const panel = document.getElementById('stove-quest-automation');
    if (panel) {
        panel.insertBefore(notice, panel.firstChild);
    } else {
        document.body.appendChild(notice);
    }

    setTimeout(() => {
        notice.classList.add('stove-success-notice--hide');
        setTimeout(() => notice.remove(), 300);
    }, 6000);
}
