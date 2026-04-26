import { CONFIG } from './config.js';
import { isMaintenanceMode } from './utils/maintenance.js';
import { log } from './ui/logger.js';
import { runAutomation } from './workflows/automation.js';
import { runRoulette } from './workflows/roulette.js';
import { openRewardShop } from './workflows/shop.js';
import { checkAllStatus } from './workflows/status.js';

function createUI() {
    if (document.getElementById('stove-quest-automation')) return;

    const container = document.createElement('div');
    container.id = 'stove-quest-automation';
    container.innerHTML = `
        <style>
            #stove-quest-automation {
                background: #1a1a1a;
                border: 1px solid #2a2a2a;
                border-radius: 12px;
                padding: 24px;
                margin: 24px 0;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                color: #e0e0e0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                width: 100%;
                box-sizing: border-box;
            }
            .stove-panel-header {
                font-size: 20px;
                font-weight: bold;
                margin-bottom: 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                color: #ffffff;
                border-bottom: 2px solid #2a2a2a;
                padding-bottom: 12px;
            }
            .stove-panel-title { flex: 1; }
            .stove-panel-version {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                font-size: 11px;
                font-weight: normal;
                color: #888888;
                line-height: 1.4;
                font-family: 'Courier New', monospace;
            }
            .stove-controls {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                margin-bottom: 20px;
            }
            .stove-btn {
                background: #2a2a2a;
                border: 1px solid #3a3a3a;
                color: #e0e0e0;
                padding: 10px 20px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                transition: all 0.2s ease;
            }
            .stove-btn:hover:not(:disabled) {
                background: #3a3a3a;
                border-color: #4a4a4a;
                transform: translateY(-1px);
            }
            .stove-btn:active:not(:disabled) { transform: translateY(0); }
            .stove-btn:disabled {
                cursor: not-allowed;
                opacity: 0.4;
                background: #1f1f1f;
            }
            .stove-progress-section {
                background: #232323;
                border: 1px solid #2a2a2a;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 16px;
            }
            .stove-progress-header {
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 12px;
                color: #ffffff;
            }
            .stove-progress-bar {
                background: #1a1a1a;
                border: 1px solid #2a2a2a;
                border-radius: 8px;
                height: 24px;
                overflow: hidden;
                margin-bottom: 12px;
                position: relative;
            }
            .stove-progress-fill {
                background: #10b981;
                height: 100%;
                width: 0%;
                transition: width 0.5s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: bold;
                color: #ffffff;
            }
            .stove-task-list {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 8px;
            }
            .stove-task {
                background: #1a1a1a;
                border: 1px solid #2a2a2a;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                color: #d0d0d0;
            }
            .stove-log-section {
                background: #0f0f0f;
                border: 1px solid #2a2a2a;
                border-radius: 8px;
                padding: 16px;
                max-height: 300px;
                overflow-y: auto;
                scroll-behavior: smooth;
            }
            .stove-log-header {
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 8px;
                color: #ffffff;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .stove-log-copy-btn {
                background: #2a2a2a;
                border: 1px solid #3a3a3a;
                color: #ffffff;
                font-size: 14px;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .stove-log-copy-btn:hover { background: #3a3a3a; border-color: #4a4a4a; }
            #stove-log-content {
                font-size: 13px;
                line-height: 1.5;
                font-family: 'Courier New', monospace;
            }
            .stove-log-section::-webkit-scrollbar { width: 8px; }
            .stove-log-section::-webkit-scrollbar-track { background: #1a1a1a; border-radius: 4px; }
            .stove-log-section::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }
            .stove-log-section::-webkit-scrollbar-thumb:hover { background: #4a4a4a; }
            .stove-status-section {
                background: #232323;
                border: 1px solid #2a2a2a;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 16px;
            }
            .stove-status-header {
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 12px;
                color: #ffffff;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .stove-status-refresh {
                background: #2a2a2a;
                border: 1px solid #3a3a3a;
                color: #e0e0e0;
                padding: 4px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                transition: all 0.2s ease;
            }
            .stove-status-refresh:hover { background: #3a3a3a; border-color: #4a4a4a; }
            .stove-status-list { display: grid; grid-template-columns: 1fr; gap: 8px; }
            .stove-status-item {
                background: #1a1a1a;
                border: 1px solid #2a2a2a;
                padding: 10px 12px;
                border-radius: 6px;
                font-size: 14px;
                color: #d0d0d0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .stove-status-label { font-weight: 600; }
            .stove-status-value { font-family: 'Courier New', monospace; }
            .stove-mission-item { position: relative; cursor: help; }
            .stove-mission-item:hover { background: #252525; border-color: #3a3a3a; }
            .stove-mission-tooltip {
                position: absolute;
                left: 0;
                top: 100%;
                margin-top: 8px;
                background: #2a2a2a;
                border: 1px solid #3a3a3a;
                border-radius: 6px;
                padding: 12px;
                min-width: 300px;
                max-width: 400px;
                z-index: 10000;
                font-size: 13px;
                line-height: 1.5;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                display: none;
            }
            .stove-mission-item:hover .stove-mission-tooltip { display: block; }
            .stove-mission-tooltip-title {
                font-weight: 600;
                color: #10b981;
                margin-bottom: 8px;
                border-bottom: 1px solid #3a3a3a;
                padding-bottom: 6px;
            }
            .stove-mission-tooltip-item {
                padding: 4px 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .stove-mission-tooltip-name { flex: 1; color: #d0d0d0; }
            .stove-mission-tooltip-status { margin-left: 12px; font-size: 12px; }
            .stove-maintenance-notice {
                background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%);
                border: 2px solid #b71c1c;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 20px;
                text-align: center;
            }
            .stove-maintenance-icon { font-size: 48px; margin-bottom: 12px; display: block; }
            .stove-maintenance-title { font-size: 18px; font-weight: bold; color: #ffffff; margin-bottom: 8px; }
            .stove-maintenance-message { font-size: 14px; color: #ffebee; line-height: 1.6; }
        </style>

        <div class="stove-panel-header">
            <span class="stove-panel-title">🤖 STOVE 퀘스트 자동화</span>
            <span class="stove-panel-version">
                <div>v${CONFIG.version}</div>
                <div>Updated: ${CONFIG.lastUpdated}</div>
            </span>
        </div>

        <div id="stove-maintenance-notice" class="stove-maintenance-notice" style="display: none;">
            <span class="stove-maintenance-icon">🚧</span>
            <div class="stove-maintenance-title">점검 중</div>
            <div class="stove-maintenance-message">${CONFIG.maintenanceMode.message}</div>
        </div>

        <div class="stove-controls">
            <button id="stove-btn-start" class="stove-btn">🚀 전체 자동화</button>
            <button id="stove-btn-roulette" class="stove-btn">🎰 룰렛만</button>
            <button id="stove-btn-reward-shop" class="stove-btn">🏪 리워드샵 방문</button>
        </div>

        <div class="stove-status-section">
            <div class="stove-status-header">
                📊 현재 상태
                <button id="stove-btn-status-refresh" class="stove-status-refresh">🔄 새로고침</button>
            </div>
            <div class="stove-status-list">
                <div class="stove-status-item">
                    <span class="stove-status-label">✍️ 오늘 글쓰기</span>
                    <span class="stove-status-value" id="stove-status-article">-</span>
                </div>
                <div class="stove-status-item stove-mission-item" data-category="daily">
                    <span class="stove-status-label">📅 데일리</span>
                    <span class="stove-status-value" id="stove-status-mission-daily">-</span>
                </div>
                <div class="stove-status-item stove-mission-item" data-category="weekly">
                    <span class="stove-status-label">📆 위클리</span>
                    <span class="stove-status-value" id="stove-status-mission-weekly">-</span>
                </div>
                <div class="stove-status-item stove-mission-item" data-category="content">
                    <span class="stove-status-label">💬 컨텐츠</span>
                    <span class="stove-status-value" id="stove-status-mission-content">-</span>
                </div>
                <div class="stove-status-item stove-mission-item" data-category="attendance">
                    <span class="stove-status-label">📆 월간출석</span>
                    <span class="stove-status-value" id="stove-status-mission-attendance">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">🎰 룰렛 횟수</span>
                    <span class="stove-status-value" id="stove-status-roulette">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">💝 데일리 보상</span>
                    <span class="stove-status-value" id="stove-status-daily">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">🀄 마작 리워드</span>
                    <span class="stove-status-value" id="stove-status-majak">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">📊 설문조사</span>
                    <span class="stove-status-value" id="stove-status-survey">-</span>
                </div>
                <div class="stove-status-item" style="border-top: 2px solid #3a3a3a; margin-top: 8px; padding-top: 16px;">
                    <span class="stove-status-label">💎 현재 보유</span>
                    <span class="stove-status-value" id="stove-status-total-flake">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">📅 이번 달 획득</span>
                    <span class="stove-status-value" id="stove-status-monthly-flake">-</span>
                </div>
            </div>
        </div>

        <div class="stove-progress-section">
            <div class="stove-progress-header">📊 커뮤니티 활동 진행 상황</div>
            <div class="stove-progress-bar">
                <div class="stove-progress-fill">
                    <span id="stove-progress-text"></span>
                </div>
            </div>
            <div class="stove-task-list">
                <div class="stove-task">게시글 추천: <span id="stove-article-likes">0/${CONFIG.targets.articleLikes}</span></div>
                <div class="stove-task">댓글 작성: <span id="stove-comments">0/${CONFIG.targets.comments}</span></div>
                <div class="stove-task">새글 작성: <span id="stove-new-article">0/${CONFIG.targets.newArticle}</span></div>
            </div>
        </div>

        <div class="stove-log-section">
            <div class="stove-log-header">
                <span>📝 로그</span>
                <button id="stove-btn-copy-log" class="stove-log-copy-btn" title="로그 전체 복사">📋</button>
            </div>
            <div id="stove-log-content"></div>
        </div>
    `;

    const targetSelectors = ['.inds-content-body', 'main', 'body'];
    let insertTarget = null;
    for (const selector of targetSelectors) {
        insertTarget = document.querySelector(selector);
        if (insertTarget) break;
    }

    if (insertTarget) {
        try {
            insertTarget.insertBefore(container, insertTarget.firstChild);
        } catch (err) {
            insertTarget.appendChild(container);
        }
    } else {
        document.body.insertBefore(container, document.body.firstChild);
    }

    function copyLogToClipboard() {
        const logContent = document.getElementById('stove-log-content');
        if (!logContent) return;
        const logText = logContent.innerText || logContent.textContent;
        navigator.clipboard.writeText(logText).then(() => {
            const btn = document.getElementById('stove-btn-copy-log');
            if (btn) {
                const original = btn.textContent;
                btn.textContent = '✓';
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

        ['stove-btn-start', 'stove-btn-roulette', 'stove-btn-reward-shop', 'stove-btn-status-refresh'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = true;
        });

        log('⚠️ 점검 모드 활성화: 모든 기능이 비활성화되었습니다', 'warning');
    } else {
        attachListener('stove-btn-start', runAutomation);
        attachListener('stove-btn-roulette', runRoulette);
        attachListener('stove-btn-reward-shop', openRewardShop);
        attachListener('stove-btn-status-refresh', checkAllStatus);
        log('자동화 패널이 준비되었습니다', 'info');
    }

    attachListener('stove-btn-copy-log', copyLogToClipboard);

    setTimeout(() => { checkAllStatus(); }, 500);
}

function tryCreateUI(retries = 5) {
    const contentBody = document.querySelector('.inds-content-body');
    const main = document.querySelector('main');

    if (contentBody || main || retries <= 0) {
        createUI();
    } else {
        setTimeout(() => tryCreateUI(retries - 1), 500);
    }
}

function init() {
    console.log('[STOVE Automation] Initializing...');

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => tryCreateUI());
    } else {
        tryCreateUI();
    }
}

init();
