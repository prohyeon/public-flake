import { refreshSpecialForce, receiveSpecialForce } from './workflows/specialForce.js';
import { CONFIG } from './config.js';
import { isMaintenanceMode } from './utils/maintenance.js';
import { log } from './ui/logger.js';
import { runAutomation } from './workflows/automation.js';
import { runPointExchange } from './workflows/pointExchange.js';
import { openRewardShop } from './workflows/shop.js';
import { checkAllStatus } from './workflows/status.js';
import { updatePointCashChargeButtonAvailability } from './ui/pointCashCharge.js';
import { startPanelMount } from './ui/mount.js';
import { startMyHomeNoticeDismissal } from './ui/dismissMyHomeNotices.js';

function createUI() {
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
                min-width: 0;
                box-sizing: border-box;
            }
            #stove-quest-automation[data-stove-mount="myhome"] {
                width: calc(100% - 40px);
                max-width: 1300px;
                margin: 24px auto;
                flex: 0 0 auto;
            }
            #stove-quest-automation[data-stove-mount="fallback"] {
                margin-top: 96px;
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
                min-width: 0;
                flex-wrap: wrap;
            }
            .stove-panel-title { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
            .stove-panel-version {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                font-size: 11px;
                font-weight: normal;
                color: #888888;
                line-height: 1.4;
                font-family: 'Courier New', monospace;
                min-width: 0;
                overflow-wrap: anywhere;
            }
            .stove-controls {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
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
                min-width: 0;
                overflow-wrap: anywhere;
            }
            .stove-controls > * { min-width: 0; }
            .stove-btn-main,
            .stove-btn-sub {
                display: block;
                line-height: 1.35;
            }
            .stove-btn-sub {
                margin-top: 2px;
                font-size: 12px;
                color: #a7f3d0;
                font-weight: 500;
            }
            .stove-btn-note {
                display: block;
                margin-top: 4px;
                font-size: 11px;
                color: #fbbf24;
                font-weight: 500;
                line-height: 1.3;
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
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }
            .stove-task {
                background: #1a1a1a;
                border: 1px solid #2a2a2a;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                color: #d0d0d0;
                min-width: 0;
                overflow-wrap: anywhere;
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
                gap: 8px;
                min-width: 0;
            }
            .stove-status-label { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
            .stove-status-value { font-family: 'Courier New', monospace; min-width: 0; overflow-wrap: anywhere; text-align: right; }
            #stove-quest-automation .stove-sf-section { padding: 20px; }
            #stove-quest-automation .stove-sf-header {
                display: flex; align-items: center; justify-content: space-between;
                gap: 12px; margin-bottom: 18px;
            }
            #stove-quest-automation .stove-sf-title-group { display: flex; align-items: center; gap: 12px; min-width: 0; }
            #stove-quest-automation .stove-sf-game-icon {
                display: grid; place-items: center; width: 42px; height: 42px; flex-shrink: 0;
                background: #1a1a1a; border: 1px solid #353535; border-radius: 10px; font-size: 22px;
            }
            #stove-quest-automation .stove-sf-title { margin: 0; color: #f5f5f5; font-size: 16px; font-weight: 650; line-height: 1.4; }
            #stove-quest-automation .stove-sf-subtitle { margin: 3px 0 0; color: #9ca3af; font-size: 12px; line-height: 1.4; }
            #stove-quest-automation .stove-sf-refresh { padding: 8px 12px; flex-shrink: 0; border-radius: 6px; }
            #stove-quest-automation .stove-sf-period {
                display: flex; align-items: center; justify-content: space-between; gap: 12px;
                flex-wrap: wrap; margin-bottom: 14px; font-size: 12px; color: #b5bbc5;
            }
            #stove-quest-automation .stove-sf-dates { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
            #stove-quest-automation .stove-sf-period-label { color: #9ca3af; }
            #stove-quest-automation .stove-sf-period-length { color: #a6adba; border-left: 1px solid #414141; padding-left: 8px; }
            #stove-quest-automation .stove-sf-period-badge { padding: 4px 8px; border-radius: 5px; background: #303030; color: #b5bbc5; white-space: nowrap; }
            #stove-quest-automation .stove-sf-period-badge.is-active { background: #163e32; color: #a7f3d0; }
            #stove-quest-automation .stove-sf-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
            #stove-quest-automation .stove-sf-metric { min-width: 0; padding: 14px 16px; border: 1px solid #353535; border-radius: 8px; background: #1a1a1a; }
            #stove-quest-automation .stove-sf-metric-label { display: block; font-size: 12px; line-height: 1.4; color: #a6adba; }
            #stove-quest-automation .stove-sf-metric-value { display: block; font-size: 24px; font-weight: 650; line-height: 1.5; color: #f5f5f5; font-variant-numeric: tabular-nums; }
            #stove-quest-automation .stove-sf-metric.is-claimable { border-color: #705328; background: #30291c; }
            #stove-quest-automation .stove-sf-metric.is-claimable .stove-sf-metric-value { color: #fcd34d; }
            #stove-quest-automation .stove-sf-progress { height: 4px; margin-top: 8px; background: #343434; border-radius: 4px; overflow: hidden; }
            #stove-quest-automation .stove-sf-progress-fill { display: block; height: 100%; background: #34d399; border-radius: inherit; }
            #stove-quest-automation .stove-sf-rewards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: 8px; }
            #stove-quest-automation .stove-sf-reward { display: flex; flex-direction: column; min-width: 0; padding: 13px 12px; border-radius: 8px; border: 1px solid #353535; background: #1c1c1c; }
            #stove-quest-automation .stove-sf-reward-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
            #stove-quest-automation .stove-sf-day { color: #b5bbc5; font-size: 12px; font-weight: 600; }
            #stove-quest-automation .stove-sf-reward-icon { display: grid; place-items: center; width: 22px; height: 22px; flex-shrink: 0; color: #9ca3af; background: #303030; border-radius: 50%; font-size: 12px; }
            #stove-quest-automation .stove-sf-reward-amount { color: #e5e7eb; font-size: 20px; font-weight: 650; line-height: 1.35; font-variant-numeric: tabular-nums; }
            #stove-quest-automation .stove-sf-reward-unit { color: #a6adba; font-size: 12px; font-weight: 500; }
            #stove-quest-automation .stove-sf-reward-detail { flex: 1; margin: 6px 0 16px; min-height: 36px; color: #a6adba; font-size: 12px; line-height: 1.5; word-break: keep-all; overflow-wrap: anywhere; }
            #stove-quest-automation .stove-sf-reward-state { align-self: flex-start; padding: 4px 7px; border-radius: 4px; color: #b5bbc5; background: #303030; font-size: 11px; font-weight: 500; line-height: 1.4; }
            #stove-quest-automation .stove-sf-reward.is-received { border-color: #28503f; background: #18251f; }
            #stove-quest-automation .stove-sf-reward.is-received .stove-sf-reward-icon,
            #stove-quest-automation .stove-sf-reward.is-received .stove-sf-reward-state { background: #1c4332; color: #a7f3d0; }
            #stove-quest-automation .stove-sf-reward.is-claimable { border-color: #9a742f; background: #30291c; }
            #stove-quest-automation .stove-sf-reward.is-claimable .stove-sf-reward-amount { color: #fcd34d; }
            #stove-quest-automation .stove-sf-reward.is-claimable .stove-sf-reward-icon,
            #stove-quest-automation .stove-sf-reward.is-claimable .stove-sf-reward-state { background: #544020; color: #fde68a; }
            #stove-quest-automation .stove-sf-note { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; margin-top: 14px; color: #9ca3af; font-size: 11px; line-height: 1.6; }
            #stove-quest-automation .stove-sf-checked { white-space: nowrap; }
            #stove-quest-automation .stove-sf-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 16px; margin-top: 16px; border-top: 1px solid #353535; }
            #stove-quest-automation .stove-sf-shop-link { display: inline-flex; align-items: center; gap: 8px; color: #b5bbc5; font-size: 12px; text-decoration: none; }
            #stove-quest-automation .stove-sf-shop-link:hover { color: #f5f5f5; }
            #stove-quest-automation .stove-sf-claim { background: #166044; border-color: #277357; color: #d1fae5; padding: 9px 16px; font-size: 13px; }
            #stove-quest-automation .stove-sf-claim:hover:not(:disabled) { background: #1c7452; border-color: #34a276; }
            #stove-quest-automation .stove-sf-empty { display: flex; align-items: center; gap: 14px; min-height: 120px; padding: 20px; background: #1a1a1a; border: 1px dashed #414141; border-radius: 8px; }
            #stove-quest-automation .stove-sf-empty-icon { display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; background: #303030; color: #a6adba; font-size: 22px; }
            #stove-quest-automation .stove-sf-empty-content { min-width: 0; overflow-wrap: anywhere; }
            #stove-quest-automation .stove-sf-empty-content strong { font-size: 13px; font-weight: 600; color: #d1d5db; }
            #stove-quest-automation .stove-sf-empty-content p { margin: 6px 0 0; color: #9ca3af; font-size: 12px; line-height: 1.6; }
            #stove-quest-automation .stove-sf-empty--error { border-color: #75453e; }
            #stove-quest-automation .stove-sf-empty--error .stove-sf-empty-icon { background: #4c2924; color: #fca5a5; }
            @media (max-width: 720px) {
                #stove-quest-automation .stove-sf-section { padding: 14px; }
                #stove-quest-automation .stove-sf-header { gap: 8px; }
                #stove-quest-automation .stove-sf-title-group { gap: 8px; }
                #stove-quest-automation .stove-sf-game-icon { width: 34px; height: 34px; font-size: 18px; }
                #stove-quest-automation .stove-sf-title { font-size: 14px; }
                #stove-quest-automation .stove-sf-refresh { padding: 7px 8px; font-size: 11px; }
                #stove-quest-automation .stove-sf-summary { gap: 6px; }
                #stove-quest-automation .stove-sf-metric { padding: 10px 8px; }
                #stove-quest-automation .stove-sf-metric-value { font-size: 20px; }
                #stove-quest-automation .stove-sf-metric-label { font-size: 11px; }
                #stove-quest-automation .stove-sf-rewards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                #stove-quest-automation .stove-sf-empty { padding: 16px; gap: 10px; }
                #stove-quest-automation .stove-sf-claim { width: 100%; }
                #stove-quest-automation .stove-sf-shop-link { margin-left: auto; }
            }
            @media (max-width: 420px) {
                #stove-quest-automation .stove-sf-game-icon { display: none; }
                #stove-quest-automation .stove-sf-metric-value { font-size: 18px; }
                #stove-quest-automation .stove-sf-period-label { display: none; }
            }
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
            .stove-success-notice {
                background: #064e3b;
                border: 1px solid #10b981;
                border-radius: 8px;
                color: #d1fae5;
                font-size: 14px;
                font-weight: 700;
                margin-bottom: 16px;
                padding: 12px 14px;
                text-align: center;
                transition: opacity 0.3s ease, transform 0.3s ease;
            }
            .stove-success-notice--hide {
                opacity: 0;
                transform: translateY(-6px);
            }
            @media (max-width: 720px) {
                #stove-quest-automation[data-stove-mount="myhome"] { width: calc(100% - 24px); }
                .stove-controls,
                .stove-task-list { grid-template-columns: minmax(0, 1fr); }
                .stove-panel-header { align-items: flex-start; }
                .stove-panel-version { align-items: flex-start; }
                .stove-status-header,
                .stove-log-header { flex-wrap: wrap; gap: 8px; }
                .stove-mission-tooltip {
                    min-width: 0;
                    width: min(400px, calc(100vw - 48px));
                    max-width: calc(100vw - 48px);
                }
            }
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
            <button id="stove-btn-point-cash-charge" class="stove-btn" disabled title="192,500 플레이크 이상일 때 충전 가능">
                <span class="stove-btn-main">💱 7700 캐시 충전</span>
                <span class="stove-btn-sub">(192,500 플레이크)</span>
                <span class="stove-btn-note" id="stove-btn-point-cash-charge-status">플레이크 확인 중</span>
            </button>
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
                    <span class="stove-status-label">🔥 부스트 미션</span>
                    <span class="stove-status-value" id="stove-status-boost">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">🎁 오늘의 1등 보상</span>
                    <span class="stove-status-value" id="stove-status-boost-reward">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">🎯 부스트 선택 글</span>
                    <span class="stove-status-value" id="stove-status-boost-target">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">💬 게임 리뷰 이벤트</span>
                    <span class="stove-status-value" id="stove-status-review-event">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">📅 리뷰 이벤트 기간</span>
                    <span class="stove-status-value" id="stove-status-review-period">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">🎯 이벤트 대상 리뷰</span>
                    <span class="stove-status-value" id="stove-status-review-target">-</span>
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

        <section class="stove-status-section stove-sf-section" aria-label="스페셜포스 상태">
            <div class="stove-sf-header">
                <div class="stove-sf-title-group">
                    <span class="stove-sf-game-icon" aria-hidden="true">🎮</span>
                    <div><h3 class="stove-sf-title">스페셜포스 리마스터</h3><p class="stove-sf-subtitle">누적 플레이 보상</p></div>
                </div>
                <button id="stove-btn-special-force-refresh" class="stove-status-refresh stove-sf-refresh" type="button">↻ 새로고침</button>
            </div>
            <div id="stove-special-force-data" aria-live="polite"><div class="stove-sf-empty"><span class="stove-sf-empty-icon" aria-hidden="true">◇</span><div class="stove-sf-empty-content"><strong>플레이 현황을 확인해 보세요</strong><p>새로고침하면 누적 플레이와 일차별 보상을 확인할 수 있습니다.</p></div></div></div>
            <div class="stove-sf-actions">
                <a id="stove-special-force-link" class="stove-sf-shop-link" href="https://event.onstove.com/ko/dailyshop/specialforce" target="_blank" rel="noopener noreferrer">출석 교환 상점 <span aria-hidden="true">↗</span></a>
                <button id="stove-btn-special-force-claim" class="stove-btn stove-sf-claim" type="button" disabled>수령 가능한 보상 받기</button>
            </div>
        </section>

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

        ['stove-btn-start', 'stove-btn-point-cash-charge', 'stove-btn-reward-shop', 'stove-btn-status-refresh', 'stove-btn-special-force-refresh', 'stove-btn-special-force-claim'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = true;
        });

        log('⚠️ 점검 모드 활성화: 모든 기능이 비활성화되었습니다', 'warning');
    } else {
        attachListener('stove-btn-special-force-refresh', refreshSpecialForce);
        attachListener('stove-btn-special-force-claim', receiveSpecialForce);
        attachListener('stove-btn-start', runAutomation);
        attachListener('stove-btn-point-cash-charge', runPointExchange);
        attachListener('stove-btn-reward-shop', openRewardShop);
        attachListener('stove-btn-status-refresh', checkAllStatus);
        updatePointCashChargeButtonAvailability(null);
        log('자동화 패널이 준비되었습니다', 'info');
    }

    attachListener('stove-btn-copy-log', copyLogToClipboard);

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
