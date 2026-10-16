// Header sets of the STOVE front ends this script imitates. The APIs check caller-id/Origin per
// endpoint, so every request keeps the set its own page sends (pinned by the API contract goldens).

function callerDetail(headers) {
    return headers['X-UUID'] || headers['caller-detail'];
}

// reward.onstove.com (flake-fe): missions, roulette and prize entry.
export function makeRewardPageHeaders(headers) {
    return {
        'Authorization': headers['Authorization'],
        'caller-id': 'flake-fe',
        'caller-detail': callerDetail(headers),
        'x-lang': 'ko',
        'x-nation': 'KR',
        'Accept': '*/*',
        'Origin': 'https://reward.onstove.com',
        'Referer': 'https://reward.onstove.com/'
    };
}

// reward.onstove.com writes that send and expect JSON.
export function makeRewardPageJsonHeaders(headers) {
    return {
        ...makeRewardPageHeaders(headers),
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
}

// reward.onstove.com mileage (FLAKE balance) reads.
export function makeMileageHeaders(headers) {
    return {
        'Authorization': headers['Authorization'],
        'caller-id': 'flake-fe',
        'caller-detail': callerDetail(headers),
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': '*/*',
        'Origin': 'https://reward.onstove.com',
        'Referer': 'https://reward.onstove.com/'
    };
}

// event.onstove.com (event-hub) with only the account headers: daily shop and game ownership.
export function makeEventHubHeaders(headers) {
    return {
        'Authorization': headers['Authorization'],
        'caller-id': 'event-hub',
        'caller-detail': callerDetail(headers),
        'X-Client-Lang': 'ko',
        'X-Timezone': 'Asia/Seoul',
        'X-Utc-Offset': '540',
        'X-Nation': 'KR',
        'X-Lang': 'ko',
        'X-Device-Type': 'pc',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://event.onstove.com',
        'Referer': 'https://event.onstove.com/'
    };
}

// event.onstove.com on top of the full lounge headers: pre-registration.
// caller-detail is only the X-UUID here (no caller-detail fallback), as that page sends it.
export function withEventHubOrigin(headers) {
    return { ...headers, 'caller-id': 'event-hub', 'caller-detail': headers['X-UUID'],
        Origin: 'https://event.onstove.com', Referer: 'https://event.onstove.com/',
        'X-Timezone': 'Asia/Seoul', 'X-Utc-Offset': '540' };
}
