// 계정별 캡슐 뽑기 설정. SGManager(봇)가 127.0.0.1 로컬 서버로 알려 준 값을 읽는다.
// 봇이 꺼져 있거나, 프로필 번호를 알 수 없거나, 응답이 이상하면 기본값(100뽑기)을 쓴다.
// 기본값은 설정 기능이 생기기 전의 동작과 같다.

export const CAPSULE_TIER_OFF = 'off';
export const CAPSULE_TIER_100 = '100';
export const CAPSULE_TIER_1000 = '1000';
export const CAPSULE_TIER_DEFAULT = CAPSULE_TIER_100;

// 봇 쪽 CAPSULE_TIER_PORT와 같아야 한다.
export const CAPSULE_TIER_PORT = 47813;
export const CAPSULE_TIER_URL = `http://127.0.0.1:${CAPSULE_TIER_PORT}/capsule-tier`;
export const CAPSULE_TIER_TIMEOUT_MS = 2000;

const KNOWN_TIERS = [CAPSULE_TIER_OFF, CAPSULE_TIER_100, CAPSULE_TIER_1000];

// 프로필 페이지 주소(/ko/100000001)의 끝 숫자가 계정 번호(member_no)다.
export function memberNoFromPath(pathname) {
    const match = /\/(\d+)\/?$/.exec(pathname || '');
    return match ? match[1] : null;
}

export function parseCapsuleTier(value) {
    return KNOWN_TIERS.includes(value) ? value : null;
}

// 봇에 값을 물어본다. 실패하면 null을 돌려주고, 호출하는 쪽이 기본값을 고른다.
export function requestCapsuleTier(memberNo, deps = {}) {
    const gmRequest = deps.gmRequest || globalThis.GM_xmlhttpRequest;
    const timeout = deps.timeoutMs ?? CAPSULE_TIER_TIMEOUT_MS;
    return new Promise(resolve => {
        if (typeof gmRequest !== 'function') {
            resolve(null);
            return;
        }
        try {
            gmRequest({
                method: 'GET',
                url: `${CAPSULE_TIER_URL}?member_no=${encodeURIComponent(memberNo)}`,
                timeout,
                onload: response => {
                    try {
                        const body = JSON.parse(response.responseText);
                        resolve(response.status === 200 ? parseCapsuleTier(body.tier) : null);
                    } catch {
                        resolve(null);
                    }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null),
            });
        } catch {
            resolve(null);
        }
    });
}

// 현재 페이지 주소로 계정을 찾아 설정값을 얻는다. 얻지 못하면 기본값.
export async function resolveCapsuleTier(pathname, deps = {}) {
    const memberNo = memberNoFromPath(pathname);
    if (!memberNo) return CAPSULE_TIER_DEFAULT;
    return (await requestCapsuleTier(memberNo, deps)) ?? CAPSULE_TIER_DEFAULT;
}

// 뽑기 옵션 번호(type_no)와 1회 비용. 100뽑기 = type_no 1, 1000뽑기 = type_no 2 (HAR 확인).
export function capsuleDrawSpec(tier) {
    if (tier === CAPSULE_TIER_1000) {
        return { typeNo: 2, cost: 1000, label: '1000뽑기' };
    }
    return { typeNo: 1, cost: 100, label: '100뽑기' };
}
