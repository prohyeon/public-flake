import { isMaintenanceMode } from './utils/maintenance.js';
import { log } from './ui/logger.js';
import { runAutomation } from './workflows/automation.js';
import { runPointExchange } from './workflows/pointExchange.js';
import { openRewardShop } from './workflows/shop.js';
import { checkAllStatus } from './workflows/status.js';
import { updatePointCashChargeButtonAvailability } from './ui/pointCashCharge.js';
import { startPanelMount } from './ui/mount.js';
import { startMyHomeNoticeDismissal } from './ui/dismissMyHomeNotices.js';
import { panelMarkup } from './ui/panelTemplate.js';

// Panel buttons and the workflow each one starts. Maintenance mode disables all of them.
const ACTION_BUTTONS = [
    ['stove-btn-start', runAutomation],
    ['stove-btn-point-cash-charge', runPointExchange],
    ['stove-btn-reward-shop', openRewardShop],
    ['stove-btn-status-refresh', checkAllStatus]
];

function createUI() {
    const container = document.createElement('div');
    container.id = 'stove-quest-automation';
    container.innerHTML = panelMarkup();

    return container;
}

function initializeUI() {
    function copyLogToClipboard() {
        const logContent = document.getElementById('stove-log-content');
        if (!logContent) return;
        const logText = logContent.innerText || logContent.textContent;
        navigator.clipboard.writeText(logText).then(() => {
            const btn = document.getElementById('stove-btn-copy-log');
            if (btn) {
                const original = btn.textContent;
                btn.textContent = '복사됨';
                setTimeout(() => { btn.textContent = original; }, 1000);
            }
        }).catch(err => {
            console.error('로그 복사 실패:', err);
        });
    }

    const attachListener = (id, handler) => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('click', handler);
        } else {
            console.warn(`[이벤트 등록] ${id} 버튼을 찾을 수 없습니다`);
        }
    };

    if (isMaintenanceMode()) {
        const maintenanceNotice = document.getElementById('stove-maintenance-notice');
        if (maintenanceNotice) maintenanceNotice.style.display = 'block';

        ACTION_BUTTONS.forEach(([id]) => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = true;
        });

        log('⚠️ 점검 모드 활성화: 모든 기능이 비활성화되었습니다', 'warning');
    } else {
        ACTION_BUTTONS.forEach(([id, handler]) => attachListener(id, handler));
        updatePointCashChargeButtonAvailability(null);
        log('자동화 패널이 준비되었습니다', 'info');
    }

    attachListener('stove-btn-copy-log', copyLogToClipboard);

    // The timing lines stay hidden until the switch is checked; copying takes what is visible.
    const timingToggle = document.getElementById('stove-toggle-timing');
    const logContent = document.getElementById('stove-log-content');
    if (timingToggle && logContent) {
        timingToggle.addEventListener('change', () => {
            logContent.dataset.showTiming = timingToggle.checked ? 'true' : 'false';
        });
    }

    setTimeout(() => { checkAllStatus(); }, 500);
}

function init() {
    console.log('[STOVE Automation] Initializing...');

    const mountPanel = () => {
        startMyHomeNoticeDismissal();
        startPanelMount({
            createPanel: createUI,
            onFirstMount: initializeUI,
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
    } else {
        mountPanel();
    }
}

init();
