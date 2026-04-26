export function getKSTDate() {
    const now = new Date();
    const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const year = kstTime.getUTCFullYear();
    const month = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstTime.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getTimestamp() {
    return Date.now();
}

export function getCurrentMonthDateRange() {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);

    const year = kstNow.getUTCFullYear();
    const month = kstNow.getUTCMonth();

    const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const startTimestamp = startDate.getTime() - kstOffset;

    const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    const endTimestamp = endDate.getTime() - kstOffset;

    return { startDate: startTimestamp, endDate: endTimestamp };
}

export function getTodayString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getTodayKSTString() {
    const today = new Date();
    const kstOffset = 9 * 60;
    const kstDate = new Date(today.getTime() + kstOffset * 60 * 1000);
    return kstDate.toISOString().split('T')[0];
}
