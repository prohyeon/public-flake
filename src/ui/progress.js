import { state } from '../state.js';
import { updatePointCashChargeButtonAvailability } from './pointCashCharge.js';

export function setButtonState(running) {
    const btnIds = ['stove-btn-start', 'stove-btn-reward-shop', 'stove-btn-status-refresh'];

    for (const id of btnIds) {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = running;
            btn.style.opacity = running ? '0.5' : '1';
        }
    }

    updatePointCashChargeButtonAvailability(state.pointCashCharge.availableFlake, { running });
}
