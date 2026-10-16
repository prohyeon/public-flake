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
