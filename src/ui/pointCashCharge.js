import { CONFIG } from '../config.js';
import { state } from '../state.js';

function formatNumber(value) {
    return Number(value).toLocaleString('ko-KR');
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function isPointCashChargeAvailable(availableFlake, requiredFlake = CONFIG.pointExchange.requiredFlakeAmount) {
    const available = toFiniteNumber(availableFlake);
    return available !== null && available >= requiredFlake;
}

export function updatePointCashChargeButtonAvailability(availableFlake, options = {}) {
    const requiredFlake = options.requiredFlake ?? CONFIG.pointExchange.requiredFlakeAmount;
    const isRunning = options.running ?? state.isRunning;
    const available = toFiniteNumber(availableFlake);
    const hasRequiredFlake = isPointCashChargeAvailable(available, requiredFlake);
    const shortage = available === null ? null : Math.max(0, requiredFlake - available);

    state.pointCashCharge.availableFlake = available;
    state.pointCashCharge.hasRequiredFlake = hasRequiredFlake;

    const button = document.getElementById('stove-btn-point-cash-charge');
    const status = document.getElementById('stove-btn-point-cash-charge-status');

    if (button) {
        button.disabled = isRunning || !hasRequiredFlake;
        button.style.opacity = isRunning ? '0.5' : hasRequiredFlake ? '1' : '0.45';
        button.title = hasRequiredFlake
            ? `${formatNumber(requiredFlake)} 플레이크 보유: 충전 가능`
            : available === null
                ? `${formatNumber(requiredFlake)} 플레이크 이상일 때 충전 가능`
                : `${formatNumber(requiredFlake)} 플레이크 필요 (현재 ${formatNumber(available)})`;
    }

    if (status) {
        status.textContent = hasRequiredFlake
            ? '충전 가능'
            : shortage === null
                ? '플레이크 확인 중'
                : `${formatNumber(shortage)} 플레이크 부족`;
        status.style.color = hasRequiredFlake ? '#a7f3d0' : '#fbbf24';
    }

    return hasRequiredFlake;
}
