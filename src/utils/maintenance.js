import { CONFIG } from '../config.js';

export function isMaintenanceMode() {
    if (!CONFIG.maintenanceMode.enabled) return false;

    const now = new Date();
    const kstOffset = 9 * 60;
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstDate = new Date(utc + (kstOffset * 60000));

    const currentDateKST = kstDate.toISOString().split('T')[0];
    return currentDateKST >= CONFIG.maintenanceMode.startDate;
}
