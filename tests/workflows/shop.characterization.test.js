// Characterization tests for src/workflows/shop.js and src/api/shop.js: they lock in today's
// behavior (quirks included) at the HTTP/GM boundary so refactors can be checked against it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { useHarness, httpError, rawText, TEST_HEADERS } from '../helpers/gmHarness.js';
import { assertGolden } from '../helpers/golden.js';
import { state } from '../../src/state.js';
import {
    claimDailyShopRewards, claimMajakDailyShopRewards, claimDailyAccumulatedRewards, openRewardShop
} from '../../src/workflows/shop.js';
import {
    getDailyShopRewards, getMajakDailyShopRewards, claimDailyReward,
    claimDailyAccumulatedReward, claimMajakAccumulatedReward
} from '../../src/api/shop.js';
import {
    TODAY, YESTERDAY, DAILY_SHOP_URL, MAJAK_SHOP_URL, EVENT_HEADERS, EVENT_POST_HEADERS,
    dailyClaimUrl, accumulateClaimUrl, ownershipUrl,
    dailyReward, accumulatedReward, dailyShop, CLAIM_OK, claimFailed, notOwned, owned
} from '../fixtures/shop.js';

// getTodayString() and the dailyshop yearMonth read the *local* clock, not KST. Pin the zone the
// script really runs in so goldens do not depend on the machine running the tests. node --test
// runs every file in its own process, so this does not leak into other test files.
process.env.TZ = 'Asia/Seoul';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const writes = h => h.requests.filter(request => WRITE_METHODS.has(request.method));
const writeUrls = h => writes(h).map(request => request.url);
const gets = (h, url) => h.requests.filter(request => request.method === 'GET' && request.url === url);
const INITIAL_COMPLETED = structuredClone(state.completed);

function assertNoDuplicateClaims(h) {
    const urls = writeUrls(h);
    assert.deepEqual(urls, [...new Set(urls)], 'a reward must never be claimed twice');
}

// ---------------------------------------------------------------------------------------------
// claimDailyShopRewards
// ---------------------------------------------------------------------------------------------

test('claimDailyShopRewards claims only today\'s unreceived rewards, deriving reward_type from item_type', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        daily: [
            dailyReward({ item_no: 1001, item_type: 'FLAKE', item_name: '플레이크 50', flake_amount: 50 }),
            dailyReward({ item_no: 1002, item_type: 'INDIE_SALE_COUPON', item_name: '인디 게임 할인 쿠폰', flake_amount: undefined }),
            dailyReward({ item_no: 1003, item_type: 'COUPON', item_name: undefined, flake_amount: undefined }),
            dailyReward({ item_no: 1004, is_received: true }),
            dailyReward({ item_no: 1005, attendance_date: YESTERDAY })
        ]
    }));
    h.on('POST', dailyClaimUrl('flake', 1001), CLAIM_OK)
        .on('POST', dailyClaimUrl('indie_sale_coupon', 1002), CLAIM_OK)
        .on('POST', dailyClaimUrl('coupon', 1003), CLAIM_OK);

    const earned = await claimDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 50);
    assert.equal(state.earnings.dailyShop, 50);
    assert.equal(state.completed.dailyShop, true);
    assert.deepEqual(writeUrls(h), [
        dailyClaimUrl('flake', 1001),
        dailyClaimUrl('indie_sale_coupon', 1002),
        dailyClaimUrl('coupon', 1003)
    ]);
    assertNoDuplicateClaims(h);
    assert.deepEqual(h.requests[0].headers, EVENT_HEADERS);
    assert.deepEqual(writes(h)[0].headers, EVENT_POST_HEADERS);
    assert.deepEqual(writes(h).map(request => request.body), [
        { item_no: 1001, reward_type: 'flake' },
        { item_no: 1002, reward_type: 'indie_sale_coupon' },
        { item_no: 1003, reward_type: 'coupon' }
    ]);
    assert.deepEqual(h.delays, [200, 200, 200]);
    assertGolden('shop/daily-claims-today-unreceived', h.snapshot());
});

test('claimDailyShopRewards with nothing claimable today sends no claim and resets earnings to 0', async t => {
    const h = useHarness(t);
    state.earnings.dailyShop = 99;
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        daily: [
            dailyReward({ item_no: 1001, is_received: true }),
            dailyReward({ item_no: 1000, attendance_date: YESTERDAY }),
            dailyReward({ item_no: 1002, attendance_date: '2026-10-17' })
        ]
    }));

    const earned = await claimDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 0);
    assert.equal(state.earnings.dailyShop, 0);
    assert.equal(state.completed.dailyShop, true);
    assert.deepEqual(writes(h), []);
    assertGolden('shop/daily-nothing-to-claim', h.snapshot());
});

test('claimDailyShopRewards keeps going after a rejected claim and a thrown claim, counting only successes', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        daily: [
            dailyReward({ item_no: 1001, flake_amount: 50 }),
            dailyReward({ item_no: 1002, flake_amount: 70 }),
            dailyReward({ item_no: 1003, flake_amount: 90 })
        ]
    }));
    h.on('POST', dailyClaimUrl('flake', 1001), CLAIM_OK)
        .on('POST', dailyClaimUrl('flake', 1002), claimFailed(1003, '이미 수령한 보상입니다'))
        .on('POST', dailyClaimUrl('flake', 1003), httpError(500));

    const earned = await claimDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 50);
    assert.equal(state.earnings.dailyShop, 50);
    assert.equal(state.completed.dailyShop, true);
    // One attempt per reward, no retries; the thrown claim skips its betweenActions delay.
    assert.equal(writes(h).length, 3);
    assertNoDuplicateClaims(h);
    assert.deepEqual(h.delays, [200, 200]);
    assertGolden('shop/daily-partial-failure', h.snapshot());
});

test('claimDailyShopRewards marks dailyShop completed even when the reward list request fails', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, httpError(500));

    const earned = await claimDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 0);
    assert.equal(state.earnings.dailyShop, 0);
    assert.equal(state.completed.dailyShop, true);
    assert.deepEqual(writes(h), []);
    assert.ok(h.logs().includes('[error] ✗ 데일리 보상 확인 실패: API Error: 500 Error'));
    assertGolden('shop/daily-fetch-http-error', h.snapshot());
});

test('claimDailyShopRewards treats an error response without value as "no info" and still completes', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, { code: 40101, message: 'Unauthorized', value: null });

    const earned = await claimDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 0);
    assert.equal(state.completed.dailyShop, true);
    assert.deepEqual(writes(h), []);
    assertGolden('shop/daily-response-without-value', h.snapshot());
});

test('claimDailyShopRewards treats daily_attendances without a rewards list as nothing to claim', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, { code: 0, message: 'OK', value: { daily_attendances: {} } });

    assert.equal(await claimDailyShopRewards(TEST_HEADERS), 0);
    assert.deepEqual(writes(h), []);
    assert.ok(h.logs().includes('[info] 오늘 수령 가능한 데일리 보상이 없습니다'));
});

test('claimDailyShopRewards compares attendance_date with the LOCAL calendar date, not KST', async t => {
    // 2026-10-16 10:00 KST is still 2026-10-15 in Los Angeles: the script then skips the KST-today
    // reward and claims "yesterday's" one instead.
    process.env.TZ = 'America/Los_Angeles';
    t.after(() => { process.env.TZ = 'Asia/Seoul'; });
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        daily: [
            dailyReward({ item_no: 1001, attendance_date: TODAY }),
            dailyReward({ item_no: 1000, attendance_date: YESTERDAY })
        ]
    }));
    h.on('POST', dailyClaimUrl('flake', 1000), CLAIM_OK);

    assert.equal(await claimDailyShopRewards(TEST_HEADERS), 50);
    assert.deepEqual(writeUrls(h), [dailyClaimUrl('flake', 1000)]);
    assert.ok(h.logs().includes('[info] 오늘 날짜: 2026-10-15'));
});

// ---------------------------------------------------------------------------------------------
// claimMajakDailyShopRewards
// ---------------------------------------------------------------------------------------------

const majakAccumulated = [
    accumulatedReward({ item_no: 4000, rewardable_days: 3, item_name: '마작 3일 보상', is_received: true }),
    accumulatedReward({ item_no: 4001, rewardable_days: 5, item_name: '마작 5일 플레이크', flake_amount: 100 }),
    accumulatedReward({ item_no: 4002, rewardable_days: 5, item_type: 'COUPON', item_name: '마작 5일 쿠폰', flake_amount: undefined }),
    accumulatedReward({ item_no: 4003, rewardable_days: 10, item_name: '마작 10일 플레이크', flake_amount: 200 })
];

test('claimMajakDailyShopRewards claims the daily reward, re-reads attendance, then claims newly reached accumulated rewards', async t => {
    const h = useHarness(t);
    const before = dailyShop({
        daily: [dailyReward({ item_no: 3001, item_name: '마작 플레이크 10', flake_amount: 10 })],
        accumulated: majakAccumulated,
        totalDays: 4
    });
    const after = dailyShop({
        daily: [dailyReward({ item_no: 3001, item_name: '마작 플레이크 10', flake_amount: 10, is_received: true })],
        accumulated: majakAccumulated,
        totalDays: 5
    });
    h.on('GET', MAJAK_SHOP_URL, [before, after]);
    h.on('POST', dailyClaimUrl('flake', 3001), CLAIM_OK)
        .on('POST', accumulateClaimUrl('flake', 4001), CLAIM_OK)
        .on('POST', accumulateClaimUrl('coupon', 4002), CLAIM_OK);

    const earned = await claimMajakDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 110);
    assert.equal(state.earnings.majak, 110);
    assert.equal(state.completed.majak, true);
    assert.equal(gets(h, MAJAK_SHOP_URL).length, 2);
    // The majak daily claim shares the STOVEINDIE daily endpoint (no service id in the request).
    assert.deepEqual(writeUrls(h), [
        dailyClaimUrl('flake', 3001),
        accumulateClaimUrl('flake', 4001),
        accumulateClaimUrl('coupon', 4002)
    ]);
    assertNoDuplicateClaims(h);
    assert.deepEqual(writes(h).map(request => request.body), [
        { item_no: 3001, reward_type: 'flake' },
        { item_no: 4001 },
        { item_no: 4002 }
    ]);
    for (const request of writes(h)) assert.deepEqual(request.headers, EVENT_POST_HEADERS);
    assertGolden('shop/majak-daily-then-accumulated-after-refetch', h.snapshot());
});

test('claimMajakDailyShopRewards with nothing claimable reads once and sends no claim', async t => {
    const h = useHarness(t);
    h.on('GET', MAJAK_SHOP_URL, dailyShop({
        daily: [dailyReward({ item_no: 3001, is_received: true })],
        accumulated: majakAccumulated,
        totalDays: 4
    }));

    const earned = await claimMajakDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 0);
    assert.equal(state.earnings.majak, 0);
    assert.equal(state.completed.majak, true);
    assert.equal(gets(h, MAJAK_SHOP_URL).length, 1);
    assert.deepEqual(writes(h), []);
    assertGolden('shop/majak-nothing-to-claim', h.snapshot());
});

test('claimMajakDailyShopRewards skips accumulated rewards when the re-read returns no value', async t => {
    const h = useHarness(t);
    h.on('GET', MAJAK_SHOP_URL, [
        dailyShop({
            daily: [dailyReward({ item_no: 3001, flake_amount: 10 })],
            accumulated: majakAccumulated,
            totalDays: 5
        }),
        { code: 9999, message: '일시적인 오류', value: null }
    ]);
    h.on('POST', dailyClaimUrl('flake', 3001), CLAIM_OK);

    const earned = await claimMajakDailyShopRewards(TEST_HEADERS);

    // Accumulated rewards claimable in the first read (5 days) are not claimed.
    assert.equal(earned, 10);
    assert.equal(state.earnings.majak, 10);
    assert.equal(state.completed.majak, true);
    assert.deepEqual(writeUrls(h), [dailyClaimUrl('flake', 3001)]);
    assertGolden('shop/majak-refetch-without-value-skips-accumulated', h.snapshot());
});

test('claimMajakDailyShopRewards keeps the daily FLAKE in earnings when the re-read throws', async t => {
    const h = useHarness(t);
    h.on('GET', MAJAK_SHOP_URL, [
        dailyShop({
            daily: [dailyReward({ item_no: 3001, flake_amount: 10 })],
            accumulated: majakAccumulated,
            totalDays: 5
        }),
        httpError(500)
    ]);
    h.on('POST', dailyClaimUrl('flake', 3001), CLAIM_OK);

    const earned = await claimMajakDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 10);
    assert.equal(state.earnings.majak, 10);
    assert.equal(state.completed.majak, true);
    assert.deepEqual(writeUrls(h), [dailyClaimUrl('flake', 3001)]);
    assert.ok(h.logs().includes('[error] ✗ 마작 리워드 확인 실패: API Error: 500 Error'));
    assertGolden('shop/majak-refetch-http-error-keeps-daily-earnings', h.snapshot());
});

test('claimMajakDailyShopRewards: failed daily claim skips the re-read; accumulated failures are logged per reward', async t => {
    const h = useHarness(t);
    h.on('GET', MAJAK_SHOP_URL, dailyShop({
        daily: [dailyReward({ item_no: 3001, flake_amount: 10 })],
        accumulated: [
            accumulatedReward({ item_no: 4001, rewardable_days: 5, flake_amount: 100 }),
            accumulatedReward({ item_no: 4002, rewardable_days: 5, item_type: 'COUPON', item_name: '마작 쿠폰', flake_amount: undefined }),
            accumulatedReward({ item_no: 4003, rewardable_days: 10, flake_amount: 200 })
        ],
        totalDays: 10
    }));
    h.on('POST', dailyClaimUrl('flake', 3001), claimFailed(1003))
        .on('POST', accumulateClaimUrl('flake', 4001), claimFailed(7001, '수령 조건 미달'))
        .on('POST', accumulateClaimUrl('coupon', 4002), httpError(500))
        .on('POST', accumulateClaimUrl('flake', 4003), rawText(''));

    const earned = await claimMajakDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 0);
    assert.equal(state.earnings.majak, 0);
    assert.equal(state.completed.majak, true);
    assert.equal(gets(h, MAJAK_SHOP_URL).length, 1);
    assert.equal(writes(h).length, 4);
    assertNoDuplicateClaims(h);
    assert.deepEqual(h.delays, [200, 200, 200]);
    assert.ok(h.logs().includes('[error] ✗ 마작 누적 보상 수령 실패 (item_no: 4003, 코드: N/A)'));
    assertGolden('shop/majak-claim-failures', h.snapshot());
});

test('claimMajakDailyShopRewards marks majak completed even when the first read fails', async t => {
    const h = useHarness(t);
    h.on('GET', MAJAK_SHOP_URL, httpError(500));

    assert.equal(await claimMajakDailyShopRewards(TEST_HEADERS), 0);
    assert.equal(state.completed.majak, true);
    assert.deepEqual(writes(h), []);
    assertGolden('shop/majak-fetch-http-error', h.snapshot());
});

test('claimMajakDailyShopRewards warns when the response has no value', async t => {
    const h = useHarness(t);
    h.on('GET', MAJAK_SHOP_URL, { code: 40101, message: 'Unauthorized', value: null });

    assert.equal(await claimMajakDailyShopRewards(TEST_HEADERS), 0);
    assert.equal(state.completed.majak, true);
    assert.deepEqual(writes(h), []);
    assertGolden('shop/majak-response-without-value', h.snapshot());
});

test('claimMajakDailyShopRewards without a daily section claims accumulated rewards, mapping item types to majak endpoints', async t => {
    const h = useHarness(t);
    h.on('GET', MAJAK_SHOP_URL, dailyShop({
        accumulated: [
            accumulatedReward({ item_no: 4101, rewardable_days: 5, item_type: 'INDIE_GAME_COUPON', item_name: '인디 게임', game_id: 'INDIE_X', flake_amount: undefined }),
            accumulatedReward({ item_no: 4102, rewardable_days: 7, item_type: 'INDIE_SALE_COUPON', item_name: '할인 쿠폰', flake_amount: undefined }),
            accumulatedReward({ item_no: 4103, rewardable_days: 10, item_type: 'ITEMBOX', item_name: '아이템 상자', flake_amount: undefined }),
            accumulatedReward({ item_no: 4104, rewardable_days: 15, item_type: 'FLAKE', item_name: '플레이크 50', flake_amount: 50 })
        ],
        totalDays: 20
    }));
    h.on('POST', /\/attendances\/accumulate\//, CLAIM_OK);

    const earned = await claimMajakDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 50);
    assert.equal(state.earnings.majak, 50);
    // No ownership check for majak game coupons, and ITEMBOX falls back to the coupon endpoint.
    assert.deepEqual(writeUrls(h), [
        accumulateClaimUrl('LIBRARY', 4101),
        accumulateClaimUrl('coupon', 4102),
        accumulateClaimUrl('coupon', 4103),
        accumulateClaimUrl('flake', 4104)
    ]);
    assert.deepEqual(h.requests.filter(request => request.method === 'GET').map(request => request.url), [MAJAK_SHOP_URL]);
    assertGolden('shop/majak-accumulated-only-endpoint-mapping', h.snapshot());
});

test('claimMajakDailyShopRewards maps daily item types like the STOVEINDIE shop and survives a thrown claim', async t => {
    const h = useHarness(t);
    const daily = [
        dailyReward({ item_no: 3001, item_type: 'INDIE_SALE_COUPON', item_name: undefined, flake_amount: undefined }),
        dailyReward({ item_no: 3002, item_type: 'COUPON', item_name: '마작 쿠폰', flake_amount: undefined }),
        dailyReward({ item_no: 3003, item_type: 'FLAKE', item_name: '마작 플레이크', flake_amount: 10 })
    ];
    h.on('GET', MAJAK_SHOP_URL, [
        dailyShop({ daily }),
        dailyShop({ daily: daily.map(reward => ({ ...reward, is_received: reward.item_no !== 3002 })) })
    ]);
    h.on('POST', dailyClaimUrl('indie_sale_coupon', 3001), CLAIM_OK)
        .on('POST', dailyClaimUrl('coupon', 3002), httpError(500))
        .on('POST', dailyClaimUrl('flake', 3003), CLAIM_OK);

    const earned = await claimMajakDailyShopRewards(TEST_HEADERS);

    assert.equal(earned, 10);
    assert.equal(state.earnings.majak, 10);
    assert.equal(state.completed.majak, true);
    assert.deepEqual(writeUrls(h), [
        dailyClaimUrl('indie_sale_coupon', 3001),
        dailyClaimUrl('coupon', 3002),
        dailyClaimUrl('flake', 3003)
    ]);
    assert.equal(gets(h, MAJAK_SHOP_URL).length, 2);
    assert.deepEqual(h.delays, [200, 200]);
    assertGolden('shop/majak-daily-reward-types-and-thrown-claim', h.snapshot());
});

test('claimMajakDailyShopRewards treats empty daily/accumulated sections as nothing to claim', async t => {
    const h = useHarness(t);
    h.on('GET', MAJAK_SHOP_URL, { code: 0, message: 'OK', value: { daily_attendances: {}, accumulated_attendances: {} } });

    assert.equal(await claimMajakDailyShopRewards(TEST_HEADERS), 0);
    assert.deepEqual(writes(h), []);
    assert.ok(h.logs().includes('[info] 현재 누적 출석일: 0일'));
    assert.ok(h.logs().includes('[info] 수령 가능한 마작 누적 보상이 없습니다'));
});

// ---------------------------------------------------------------------------------------------
// claimDailyAccumulatedRewards
// ---------------------------------------------------------------------------------------------

test('claimDailyAccumulatedRewards treats an empty accumulated section as nothing to claim', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, { code: 0, message: 'OK', value: { accumulated_attendances: {} } });

    assert.equal(await claimDailyAccumulatedRewards(TEST_HEADERS), 0);
    assert.deepEqual(writes(h), []);
    assert.ok(h.logs().includes('[info] 현재 누적 출석일: 0일'));
});

test('claimDailyAccumulatedRewards counts a FLAKE reward without flake_amount as 0', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        accumulated: [accumulatedReward({ item_no: 2001, flake_amount: undefined })],
        totalDays: 5
    }));
    h.on('POST', accumulateClaimUrl('flake', 2001), CLAIM_OK);

    assert.equal(await claimDailyAccumulatedRewards(TEST_HEADERS), 0);
    assert.deepEqual(writeUrls(h), [accumulateClaimUrl('flake', 2001)]);
    assert.ok(h.logs().includes('[success] ✓ FLAKE 보상 수령 완료 (5일): 누적 5일 플레이크 (0 FLAKE)'));
});

test('claimDailyAccumulatedRewards claims reached rewards, skipping already-owned game coupons', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        accumulated: [
            accumulatedReward({ item_no: 2000, rewardable_days: 3, is_received: true }),
            accumulatedReward({ item_no: 2001, rewardable_days: 5, item_name: '누적 5일 플레이크', flake_amount: 300 }),
            accumulatedReward({ item_no: 2002, rewardable_days: 7, item_type: 'ITEMBOX', item_name: '아이템 상자', flake_amount: undefined }),
            accumulatedReward({ item_no: 2003, rewardable_days: 10, item_type: 'INDIE_SALE_COUPON', item_name: '할인 쿠폰', flake_amount: undefined }),
            accumulatedReward({ item_no: 2004, rewardable_days: 12, item_type: 'INDIE_GAME_COUPON', item_name: '인디 게임 A', game_id: 'INDIE_A', flake_amount: undefined }),
            accumulatedReward({ item_no: 2005, rewardable_days: 14, item_type: 'INDIE_GAME_COUPON', item_name: '인디 게임 B', game_id: 'INDIE_B', flake_amount: undefined }),
            accumulatedReward({ item_no: 2006, rewardable_days: 15, item_type: 'INDIE_GAME_COUPON', item_name: '인디 게임 (ID 없음)', flake_amount: undefined }),
            accumulatedReward({ item_no: 2007, rewardable_days: 16, item_type: 'STOVE_CASH', item_name: '기타 보상', flake_amount: undefined }),
            accumulatedReward({ item_no: 2008, rewardable_days: 20, item_name: '누적 20일 플레이크', flake_amount: 500 })
        ],
        totalDays: 16
    }));
    h.on('GET', ownershipUrl('INDIE_A'), notOwned)
        .on('GET', ownershipUrl('INDIE_B'), owned('INDIE_B'))
        .on('POST', /\/attendances\/accumulate\//, CLAIM_OK);

    const earned = await claimDailyAccumulatedRewards(TEST_HEADERS);

    assert.equal(earned, 300);
    assert.equal(state.earnings.dailyAccumulated, 300);
    assert.deepEqual(state.completed, INITIAL_COMPLETED, 'no completed flag is set for accumulated rewards');
    assert.deepEqual(writeUrls(h), [
        accumulateClaimUrl('flake', 2001),
        accumulateClaimUrl('itembox', 2002),
        accumulateClaimUrl('coupon', 2003),
        accumulateClaimUrl('LIBRARY', 2004),
        accumulateClaimUrl('LIBRARY', 2006),
        accumulateClaimUrl('LIBRARY', 2007)
    ]);
    assertNoDuplicateClaims(h);
    for (const request of writes(h)) assert.deepEqual(Object.keys(request.body), ['item_no']);
    // The owned game is skipped without a claim and without a betweenActions delay.
    assert.deepEqual(h.delays, [200, 200, 200, 200, 200, 200]);
    assertGolden('shop/accumulated-claims-with-ownership-check', h.snapshot());
});

test('claimDailyAccumulatedRewards with nothing reached sends no claim', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        accumulated: [
            accumulatedReward({ item_no: 2000, rewardable_days: 3, is_received: true }),
            accumulatedReward({ item_no: 2001, rewardable_days: 5 })
        ],
        totalDays: 3
    }));

    assert.equal(await claimDailyAccumulatedRewards(TEST_HEADERS), 0);
    assert.equal(state.earnings.dailyAccumulated, 0);
    assert.deepEqual(writes(h), []);
    assertGolden('shop/accumulated-nothing-claimable', h.snapshot());
});

test('claimDailyAccumulatedRewards logs each failure kind and continues with the next reward', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        accumulated: [
            accumulatedReward({ item_no: 2001, rewardable_days: 5, item_name: '5일 플레이크', flake_amount: 300 }),
            accumulatedReward({ item_no: 2002, rewardable_days: 7, item_type: 'ITEMBOX', item_name: '아이템 상자', flake_amount: undefined }),
            accumulatedReward({ item_no: 2003, rewardable_days: 10, item_type: 'INDIE_SALE_COUPON', item_name: '할인 쿠폰', flake_amount: undefined }),
            accumulatedReward({ item_no: 2004, rewardable_days: 12, item_type: 'INDIE_GAME_COUPON', item_name: '인디 게임 A', game_id: 'INDIE_A', flake_amount: undefined }),
            accumulatedReward({ item_no: 2005, rewardable_days: 14, item_type: 'INDIE_GAME_COUPON', item_name: '인디 게임 C', game_id: 'INDIE_C', flake_amount: undefined }),
            accumulatedReward({ item_no: 2006, rewardable_days: 20, item_name: '20일 플레이크', flake_amount: 100 })
        ],
        totalDays: 30
    }));
    h.on('GET', ownershipUrl('INDIE_A'), httpError(500))
        .on('GET', ownershipUrl('INDIE_C'), { code: 0, message: 'OK', value: { owner_list: null } })
        .on('POST', accumulateClaimUrl('flake', 2001), claimFailed(9001, '이미 수령한 보상'))
        .on('POST', accumulateClaimUrl('itembox', 2002), { code: 9002, msg: 'legacy msg field' })
        .on('POST', accumulateClaimUrl('coupon', 2003), httpError(500))
        .on('POST', accumulateClaimUrl('LIBRARY', 2005), rawText(''))
        .on('POST', accumulateClaimUrl('flake', 2006), CLAIM_OK);

    const earned = await claimDailyAccumulatedRewards(TEST_HEADERS);

    assert.equal(earned, 100);
    assert.equal(state.earnings.dailyAccumulated, 100);
    // The ownership check failure means no claim for 2004.
    assert.deepEqual(writeUrls(h), [
        accumulateClaimUrl('flake', 2001),
        accumulateClaimUrl('itembox', 2002),
        accumulateClaimUrl('coupon', 2003),
        accumulateClaimUrl('LIBRARY', 2005),
        accumulateClaimUrl('flake', 2006)
    ]);
    assertNoDuplicateClaims(h);
    const logs = h.logs();
    assert.ok(logs.includes('[error] ✗ 보상 수령 실패: 5일 플레이크 (코드: 9001, 메시지: 이미 수령한 보상)'));
    assert.ok(logs.includes('[error] ✗ 보상 수령 실패: 아이템 상자 (코드: 9002, 메시지: legacy msg field)'));
    assert.ok(logs.includes('[error] ✗ 보상 수령 실패: 인디 게임 C (코드: N/A, 메시지: N/A)'));
    assertGolden('shop/accumulated-claim-failures', h.snapshot());
});

test('claimDailyAccumulatedRewards logs the failure and records 0 when the list request fails', async t => {
    const h = useHarness(t);
    state.earnings.dailyAccumulated = 42;
    h.on('GET', DAILY_SHOP_URL, httpError(500));

    assert.equal(await claimDailyAccumulatedRewards(TEST_HEADERS), 0);
    assert.equal(state.earnings.dailyAccumulated, 0);
    assert.deepEqual(writes(h), []);
    assertGolden('shop/accumulated-fetch-http-error', h.snapshot());
});

test('claimDailyAccumulatedRewards warns when the response has no accumulated section', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({ daily: [dailyReward()] }));

    assert.equal(await claimDailyAccumulatedRewards(TEST_HEADERS), 0);
    assert.deepEqual(writes(h), []);
    assertGolden('shop/accumulated-response-without-section', h.snapshot());
});

test('claimDailyAccumulatedRewards formats large FLAKE amounts with toLocaleString()', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop({
        accumulated: [accumulatedReward({ item_no: 2010, rewardable_days: 25, item_name: '개근 보상', flake_amount: 1500 })],
        totalDays: 25
    }));
    h.on('POST', accumulateClaimUrl('flake', 2010), CLAIM_OK);

    assert.equal(await claimDailyAccumulatedRewards(TEST_HEADERS), 1500);
    assert.ok(h.logs().includes(
        `[success] ✓ FLAKE 보상 수령 완료 (25일): 개근 보상 (${(1500).toLocaleString()} FLAKE)`));
});

// ---------------------------------------------------------------------------------------------
// openRewardShop
// ---------------------------------------------------------------------------------------------

test('openRewardShop opens the reward shop in an active, inserted tab without any request', async t => {
    const h = useHarness(t);
    const openInTab = globalThis.GM_openInTab;
    const optionsSeen = [];
    globalThis.GM_openInTab = (url, options) => {
        optionsSeen.push(options);
        return openInTab(url, options);
    };

    openRewardShop();

    assert.deepEqual(h.tabs.map(({ url, active, closed }) => ({ url, active, closed })), [{ url: 'https://reward.onstove.com/ko', active: true, closed: false }]);
    assert.deepEqual(optionsSeen, [{ active: true, insert: true }]);
    assert.deepEqual(h.requests, []);
    assertGolden('shop/open-reward-shop', h.snapshot());
});

test('openRewardShop logs an error when the tab cannot be opened', async t => {
    const h = useHarness(t);
    globalThis.GM_openInTab = () => { throw new Error('popup blocked'); };

    assert.doesNotThrow(() => openRewardShop());

    assert.deepEqual(h.tabs, []);
    assert.ok(h.logs().includes('[error] ❌ 탭 열기 실패: popup blocked'));
    assertGolden('shop/open-reward-shop-failure', h.snapshot());
});

// ---------------------------------------------------------------------------------------------
// api/shop.js request contracts
// ---------------------------------------------------------------------------------------------

test('getDailyShopRewards / getMajakDailyShopRewards GET the monthly service lists with event-hub headers', async t => {
    const h = useHarness(t);
    const daily = dailyShop({ daily: [dailyReward()] });
    const majak = dailyShop({ accumulated: [accumulatedReward()], totalDays: 1 });
    h.on('GET', DAILY_SHOP_URL, daily).on('GET', MAJAK_SHOP_URL, majak);

    assert.deepEqual(await getDailyShopRewards(TEST_HEADERS), daily);
    assert.deepEqual(await getMajakDailyShopRewards(TEST_HEADERS), majak);

    assert.deepEqual(h.requests, [
        { method: 'GET', url: DAILY_SHOP_URL, headers: EVENT_HEADERS, body: null },
        { method: 'GET', url: MAJAK_SHOP_URL, headers: EVENT_HEADERS, body: null }
    ]);
});

test('dailyshop list URLs use the local month (KST here) at a month boundary', async t => {
    // 2026-10-31 15:30 UTC = 2026-11-01 00:30 KST
    const h = useHarness(t, { now: Date.parse('2026-10-31T15:30:00Z') });
    const novemberDaily = 'https://api.onstove.com/dailyshop/v1.0/202611/services/STOVEINDIE';
    const novemberMajak = 'https://api.onstove.com/dailyshop/v1.0/202611/services/RIICHICITY_IND';
    h.on('GET', novemberDaily, dailyShop()).on('GET', novemberMajak, dailyShop());

    await getDailyShopRewards(TEST_HEADERS);
    await getMajakDailyShopRewards(TEST_HEADERS);

    assert.deepEqual(h.calls(), [`GET ${novemberDaily}`, `GET ${novemberMajak}`]);
});

test('event-hub headers fall back to the caller-detail header when X-UUID is absent', async t => {
    const h = useHarness(t);
    h.on('GET', DAILY_SHOP_URL, dailyShop());

    await getDailyShopRewards({ 'Authorization': 'Bearer other', 'caller-detail': 'detail-from-caller' });

    assert.deepEqual(h.requests[0].headers, {
        ...EVENT_HEADERS,
        'Authorization': 'Bearer other',
        'caller-detail': 'detail-from-caller'
    });
});

test('claimDailyReward POSTs item_no and reward_type in both the query and the body', async t => {
    const h = useHarness(t);
    h.on('POST', dailyClaimUrl('flake', 1001), CLAIM_OK)
        .on('POST', dailyClaimUrl('coupon', 1002), httpError(500));

    assert.deepEqual(await claimDailyReward(TEST_HEADERS, 1001, 'flake'), CLAIM_OK);
    await assert.rejects(claimDailyReward(TEST_HEADERS, 1002, 'coupon'), /API Error: 500/);

    assert.deepEqual(h.requests[0], {
        method: 'POST',
        url: dailyClaimUrl('flake', 1001),
        headers: EVENT_POST_HEADERS,
        body: { item_no: 1001, reward_type: 'flake' }
    });
});

test('claimDailyAccumulatedReward maps item types to accumulate endpoints (default LIBRARY)', async t => {
    const h = useHarness(t);
    h.on('POST', /\/attendances\/accumulate\//, CLAIM_OK);

    await claimDailyAccumulatedReward(TEST_HEADERS, 1, 'ITEMBOX');
    await claimDailyAccumulatedReward(TEST_HEADERS, 2, 'INDIE_GAME_COUPON');
    await claimDailyAccumulatedReward(TEST_HEADERS, 3, 'FLAKE');
    await claimDailyAccumulatedReward(TEST_HEADERS, 4, 'INDIE_SALE_COUPON');
    await claimDailyAccumulatedReward(TEST_HEADERS, 5, 'COUPON');
    await claimDailyAccumulatedReward(TEST_HEADERS, 6);

    assert.deepEqual(h.calls(), [
        `POST ${accumulateClaimUrl('itembox', 1)} {"item_no":1}`,
        `POST ${accumulateClaimUrl('LIBRARY', 2)} {"item_no":2}`,
        `POST ${accumulateClaimUrl('flake', 3)} {"item_no":3}`,
        `POST ${accumulateClaimUrl('coupon', 4)} {"item_no":4}`,
        `POST ${accumulateClaimUrl('LIBRARY', 5)} {"item_no":5}`,
        `POST ${accumulateClaimUrl('LIBRARY', 6)} {"item_no":6}`
    ]);
    for (const request of h.requests) assert.deepEqual(request.headers, EVENT_POST_HEADERS);
});

test('claimDailyAccumulatedReward adds guid and character_seq to query and body only when both are given', async t => {
    const h = useHarness(t);
    h.on('POST', /\/attendances\/accumulate\//, CLAIM_OK);

    await claimDailyAccumulatedReward(TEST_HEADERS, 1556, 'ITEMBOX', '20039967058', 374277168);
    await claimDailyAccumulatedReward(TEST_HEADERS, 1557, 'ITEMBOX', '20039967058', null);

    assert.deepEqual(h.calls(), [
        'POST https://api.onstove.com/dailyshop/v1.0/attendances/accumulate/itembox?item_no=1556&guid=20039967058&character_seq=374277168 '
            + '{"item_no":1556,"guid":"20039967058","character_seq":374277168}',
        `POST ${accumulateClaimUrl('itembox', 1557)} {"item_no":1557}`
    ]);
});

test('claimMajakAccumulatedReward maps item types to accumulate endpoints (default coupon)', async t => {
    const h = useHarness(t);
    h.on('POST', /\/attendances\/accumulate\//, CLAIM_OK);

    await claimMajakAccumulatedReward(TEST_HEADERS, 1, 'INDIE_GAME_COUPON');
    await claimMajakAccumulatedReward(TEST_HEADERS, 2, 'FLAKE');
    await claimMajakAccumulatedReward(TEST_HEADERS, 3, 'COUPON');
    await claimMajakAccumulatedReward(TEST_HEADERS, 4, 'INDIE_SALE_COUPON');
    await claimMajakAccumulatedReward(TEST_HEADERS, 5, 'ITEMBOX');
    await claimMajakAccumulatedReward(TEST_HEADERS, 6);

    assert.deepEqual(h.calls(), [
        `POST ${accumulateClaimUrl('LIBRARY', 1)} {"item_no":1}`,
        `POST ${accumulateClaimUrl('flake', 2)} {"item_no":2}`,
        `POST ${accumulateClaimUrl('coupon', 3)} {"item_no":3}`,
        `POST ${accumulateClaimUrl('coupon', 4)} {"item_no":4}`,
        `POST ${accumulateClaimUrl('coupon', 5)} {"item_no":5}`,
        `POST ${accumulateClaimUrl('coupon', 6)} {"item_no":6}`
    ]);
    for (const request of h.requests) assert.deepEqual(request.headers, EVENT_POST_HEADERS);
});
