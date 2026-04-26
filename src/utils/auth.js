export function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

export function extractHeaders() {
    const token = getCookie('SUAT');
    const uuid = localStorage.getItem('sgs_da_uuid') || getCookie('sgs_da_uuid');

    if (!token) throw new Error('Authorization token (SUAT) not found');
    if (!uuid) throw new Error('UUID (sgs_da_uuid) not found');

    return {
        'Authorization': `Bearer ${token}`,
        'caller-id': 'storee-lounge',
        'X-UUID': uuid,
        'x-lang': 'ko',
        'x-nation': 'KR',
        'x-device-type': 'P01',
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Origin': 'https://lounge.onstove.com',
        'Referer': 'https://lounge.onstove.com/'
    };
}
