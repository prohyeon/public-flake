// Stateful STOVE "world" for runAutomation characterization tests.
//
// Every endpoint runAutomation touches is answered from one mutable world object: POST/PUT
// handlers change it (claims, draws, likes, comments, boosts) and GET handlers read it, so
// before/after snapshots, repair passes and same-day re-runs behave like the real services.
// Routes match on method + exact api.onstove.com pathname only (never a catch-all), so the
// harness still fails a test on any request this world does not know about.
//
// Clock: the harness pins Date to DEFAULT_NOW (2026-10-16 10:00 KST); all dates here straddle it.
import { DEFAULT_NOW } from '../helpers/gmHarness.js';
import { specialForceShop } from '../helpers/specialForceFixture.js';

export const API = 'https://api.onstove.com';
export const NOW = DEFAULT_NOW;
export const TODAY = '2026-10-16';
export const USER_ID = 100;
export const REWARD_SHOP_TAB = 'https://reward.onstove.com/ko';
export const PRIZE_MISSION_NO = 359;
export const SINGLE_VISIT_URL = 'https://store.onstove.com/ko/event/1001';
export const REVIEW_ARTICLE_ID = '14523486';
export const REVIEW_URL = `https://page.onstove.com/quarter/kr/view/${REVIEW_ARTICLE_ID}`;

export const COMPONENTS = Object.freeze({
    daily: 226, content: 301, weekly: 401, survey: 501, banner: 601, attendance: 701
});
const COMPONENT_TYPES = {
    [COMPONENTS.daily]: 'SINGLE', [COMPONENTS.content]: 'CONTENT1', [COMPONENTS.weekly]: 'ACCUMULATION',
    [COMPONENTS.survey]: 'SURVEY', [COMPONENTS.banner]: 'BANNER', [COMPONENTS.attendance]: 'ACCUMULATION'
};

const kst = date => `${date}+09:00`;
const COMPONENT_LIST = [
    { component_no: COMPONENTS.daily, type: 'SINGLE', start_dt: kst('2026-10-16T00:00:00'), end_dt: kst('2026-10-16T23:59:59') },
    // Yesterday's daily component is no longer active and must be ignored.
    { component_no: 199, type: 'SINGLE', start_dt: kst('2026-10-15T00:00:00'), end_dt: kst('2026-10-15T23:59:59') },
    { component_no: COMPONENTS.content, type: 'CONTENT1', start_dt: kst('2026-10-01T00:00:00'), end_dt: kst('2026-10-31T23:59:59') },
    { component_no: COMPONENTS.weekly, type: 'ACCUMULATION', start_dt: kst('2026-10-12T00:00:00'), end_dt: kst('2026-10-18T23:59:59') },
    { component_no: COMPONENTS.survey, type: 'SURVEY', start_dt: kst('2026-10-01T00:00:00'), end_dt: kst('2026-10-31T23:59:59') },
    { component_no: COMPONENTS.banner, type: 'BANNER', start_dt: kst('2026-10-01T00:00:00'), end_dt: kst('2026-10-31T23:59:59') },
    { component_no: COMPONENTS.attendance, type: 'ACCUMULATION', start_dt: kst('2026-10-01T00:00:00'), end_dt: kst('2026-10-31T23:59:59') }
];

// "pending" is the start of a fresh day; "done" is the same account after a successful run.
function buildMissions(done) {
    const s = (pending, completed = 'COMPLETE') => (done ? completed : pending);
    return {
        [COMPONENTS.daily]: [
            { mission_no: 1001, title: '스토브 이벤트 페이지 방문', mission_type: 'SINGLE', is_visit_mission: true,
                button_url: SINGLE_VISIT_URL, status: s('INCOMPLETE'), reward_amount: 10 },
            { mission_no: 1002, title: '라운지 방문', mission_type: 'SINGLE', is_visit_mission: true,
                button_url: 'https://lounge.onstove.com/', status: s('RECEIVABLE'), reward_amount: 10 },
            { mission_no: 1003, title: '스토브 앱 로그인', mission_type: 'SINGLE', is_visit_mission: false,
                status: 'INCOMPLETE', reward_amount: 20 },
            { mission_no: PRIZE_MISSION_NO, title: '경품 응모하기', mission_type: 'SINGLE', is_visit_mission: false,
                status: s('INCOMPLETE'), reward_amount: 300 }
        ],
        [COMPONENTS.content]: [
            { mission_no: 2001, title: '이번 주 인디 게임 소식 읽고 플레이크 받기', mission_type: 'CONTENT',
                url: 'https://page.onstove.com/indie/kr/view/2001', status: s('INCOMPLETE'), reward_amount: 20 }
        ],
        [COMPONENTS.weekly]: [
            { mission_no: 3001, title: '주간 출석 5회', mission_type: 'ACCUMULATION', status: s('RECEIVABLE'),
                reward_amount: 100, user_complete_cnt: 5, milestone_total_cnt: 5 },
            { mission_no: 3002, title: '주간 댓글 10회', mission_type: 'ACCUMULATION', status: 'INCOMPLETE',
                reward_amount: 50, user_complete_cnt: 3, milestone_total_cnt: 10 }
        ],
        [COMPONENTS.survey]: [
            { mission_no: 4001, title: '오늘의 설문', mission_type: 'SURVEY', status: s('RECEIVABLE'), reward_amount: 5,
                survey_infos: [
                    { content_no: 41, content: '좋아요', percent: 30 },
                    { content_no: 42, content: '최고예요', percent: 70 }
                ] }
        ],
        [COMPONENTS.banner]: [
            { mission_no: 5001, title: '가을<br>세일 배너', mission_type: 'BANNER',
                button_url: 'https://store.onstove.com/ko/banner/5001', status: s('INCOMPLETE'), reward_amount: 15 }
        ],
        [COMPONENTS.attendance]: [
            { mission_no: 6001, title: '월간 출석 10일', mission_type: 'ACCUMULATION', status: 'INCOMPLETE',
                reward_amount: 100, user_complete_cnt: done ? 5 : 4, milestone_per_cnt: 10, milestone_total_cnt: 10 },
            { mission_no: 6002, title: '월간 출석 3일', mission_type: 'ACCUMULATION', status: s('RECEIVABLE'),
                reward_amount: 30 }
        ]
    };
}

function buildShops({ dailyShopClaimed, majakClaimed }) {
    return {
        STOVEINDIE: {
            daily: [
                { attendance_date: '2026-10-15', item_no: 801, item_type: 'FLAKE', item_name: '10 플레이크', flake_amount: 10, is_received: true },
                { attendance_date: TODAY, item_no: 802, item_type: 'FLAKE', item_name: '10 플레이크', flake_amount: 10, is_received: dailyShopClaimed }
            ],
            totalDays: dailyShopClaimed ? 15 : 14,
            accumulated: [
                { rewardable_days: 7, item_no: 811, item_type: 'FLAKE', item_name: '50 플레이크', flake_amount: 50, is_received: true },
                { rewardable_days: 15, item_no: 812, item_type: 'FLAKE', item_name: '100 플레이크', flake_amount: 100, is_received: dailyShopClaimed },
                { rewardable_days: 28, item_no: 813, item_type: 'INDIE_GAME_COUPON', item_name: '인디 게임 쿠폰', game_id: 'GAME-1', is_received: false }
            ]
        },
        RIICHICITY_IND: {
            daily: [
                { attendance_date: TODAY, item_no: 902, item_type: 'FLAKE', item_name: '20 플레이크', flake_amount: 20, is_received: majakClaimed }
            ],
            totalDays: majakClaimed ? 3 : 2,
            accumulated: [
                { rewardable_days: 3, item_no: 911, item_type: 'COUPON', item_name: '마작 할인 쿠폰', flake_amount: 0, is_received: majakClaimed }
            ]
        }
    };
}

const ROULETTE_PRIZES = [300, 50, 150, 100];
const boostCandidate = (id, score) => ({
    article_id: String(id), score, title: `후보 ${id}`, datetime: NOW - 60000,
    today_contest_agree: true, source: 'postoffice', status: 'PUBLISHED', coverage: 'PUBLIC',
    profile: { id: '200', type: 'USER' }
});

/**
 * options (all optional):
 *   missions: 'pending' | 'done'            mission statuses (default 'pending')
 *   articleWritten: boolean                  today's own article already exists
 *   articleCount: number                     lounge "today" articles (default 13)
 *   likedArticleIds: number[]                already liked (default first 3)
 *   rouletteUsed: number                     participation count before the run (default 28)
 *   roulettePrizes: number[]                 FLAKE won per draw, cycled (default [300, 50, 150, 100])
 *   rouletteExtraReceived: number[]          milestones already received (default [10, 20])
 *   dailyShopClaimed / majakClaimed: boolean
 *   boost: 'pending' | 'rewarded' | 'none'
 *   reviewEvent: 'ready' | 'commented' | 'none'
 *   specialForce: 'claimable' | 'claimed' | 'none'
 *   attendanceTrigger: 'rewardTab' | 'focusedRewardTab' | 'never'
 *       which opened tab makes the server count today's monthly attendance (+1 once)
 *   overrides: { [routeName]: (request, callIndex, next) => response }
 *       next() runs the world's own handler (and its state change)
 */
export function installAutomationWorld(h, options = {}) {
    const done = options.missions === 'done';
    const articleCount = options.articleCount ?? 13;
    const world = {
        missions: buildMissions(done),
        articles: Array.from({ length: articleCount }, (_, index) => ({
            article_id: 70001 + index, title: `오늘의 글 ${index + 1}`
        })),
        liked: new Set(options.likedArticleIds ?? [70001, 70002, 70003]),
        articleWritten: Boolean(options.articleWritten),
        myArticles: options.articleWritten
            ? [{ article_id: 99000, title: '출석', datetime: NOW - 3600000 }]
            : [{ article_id: 98000, title: '지난 글', datetime: Date.parse('2026-10-14T03:00:00Z') }],
        roulette: {
            used: options.rouletteUsed ?? 28,
            milestones: [
                { milestone_no: 1, milestone: 10, gift_no: 71, gift_name: '100 플레이크' },
                { milestone_no: 2, milestone: 20, gift_no: 72, gift_name: '300 플레이크' },
                { milestone_no: 3, milestone: 30, gift_no: 73, gift_name: '1,000 플레이크' }
            ].map(milestone => ({
                ...milestone,
                received_yn: (options.rouletteExtraReceived ?? [10, 20]).includes(milestone.milestone)
            }))
        },
        shops: buildShops({ dailyShopClaimed: Boolean(options.dailyShopClaimed), majakClaimed: Boolean(options.majakClaimed) }),
        boost: {
            mode: options.boost ?? 'pending',
            boosted: options.boost === 'rewarded',
            rewarded: options.boost === 'rewarded',
            commented: options.boost === 'rewarded',
            remaining: 5,
            nextChargeAt: null,
            boostedIds: new Set()
        },
        review: {
            mode: options.reviewEvent ?? 'ready',
            comments: [
                ...(options.reviewEvent === 'commented'
                    ? [{ comment_id: 900001, comment_status_code: 'NORMAL', user_info: { member_no: USER_ID } }]
                    : []),
                { comment_id: 5001, comment_status_code: 'NORMAL', user_info: { member_no: 300 } }
            ]
        },
        specialForce: {
            mode: options.specialForce ?? 'claimable',
            received: new Set(options.specialForce === 'claimed' ? [25] : [])
        },
        attendance: { trigger: options.attendanceTrigger ?? 'rewardTab', counted: false },
        overrides: { ...(options.overrides || {}) },
        audit: {
            missionClaims: [], duplicateClaims: [], prematureClaims: [],
            draws: 0, overDraws: 0, prizeApplies: 0, extraClaims: [],
            shopClaims: [], boosts: [], boostRewards: 0, reviewComments: 0,
            specialForceClaims: [], likes: [], duplicateLikes: [], comments: [], articlesCreated: [],
            preRegistrations: 0, wishlists: 0
        }
    };
    const { audit } = world;
    const okBody = value => ({ code: 0, message: 'OK', value });

    // Server-side effects of browsing: an opened mission URL makes the mission receivable,
    // and opening the reward shop counts today's monthly attendance once.
    function tick() {
        const opened = h.tabs;
        for (const missions of Object.values(world.missions)) {
            for (const mission of missions) {
                const target = mission.button_url || mission.url;
                if (mission.status === 'INCOMPLETE' && target && opened.some(tab => tab.url === target)) {
                    mission.status = 'RECEIVABLE';
                }
            }
        }
        const { attendance } = world;
        const triggered = attendance.trigger === 'rewardTab'
            ? opened.some(tab => tab.url.startsWith('https://reward.onstove.com'))
            : attendance.trigger === 'focusedRewardTab'
                ? opened.some(tab => tab.url === REWARD_SHOP_TAB && tab.active)
                : false;
        if (triggered && !attendance.counted) {
            attendance.counted = true;
            for (const mission of world.missions[COMPONENTS.attendance]) {
                if (mission.status === 'INCOMPLETE' && Number.isFinite(mission.user_complete_cnt)) mission.user_complete_cnt += 1;
            }
        }
    }

    function route(name, method, pattern, handler) {
        const matches = url => {
            const parsed = new URL(url);
            return parsed.origin === API && pattern.test(parsed.pathname);
        };
        h.on(method, matches, (request, callIndex) => {
            const url = new URL(request.url);
            const next = () => {
                tick();
                return handler(request, url, pattern.exec(url.pathname));
            };
            const override = world.overrides[name];
            return override ? override(request, callIndex, next) : next();
        });
    }

    // --- account, lounge articles ---------------------------------------------------------
    route('profile', 'GET', /^\/postie\/v1\.0\/user\/me$/, () => okBody({ user_id: USER_ID, nickname: '테스터' }));
    route('myArticles', 'GET', /^\/postie\/v1\.0\/interest\/user\/(\d+)\/article\/list$/,
        () => okBody({ list: structuredClone(world.myArticles) }));
    route('articleList', 'GET', /^\/stadium-api\/v1\.0\/today\/all$/,
        () => okBody({ list: structuredClone(world.articles) }));
    route('likeStatus', 'GET', /^\/postie\/v1\.0\/article\/([\d,]+)\/interaction\/LIKE$/, (request, url, match) =>
        okBody(Object.fromEntries(match[1].split(',').map(id => [id, { LIKE: world.liked.has(Number(id)) }]))));
    route('like', 'PUT', /^\/postie\/v1\.0\/article\/(\d+)\/interaction\/LIKE$/, (request, url, match) => {
        const id = Number(match[1]);
        if (world.liked.has(id)) audit.duplicateLikes.push(id);
        world.liked.add(id);
        audit.likes.push(id);
        return okBody({ LIKE: true });
    });
    route('comment', 'POST', /^\/postie\/v1\.0\/article\/(\d+)\/comment$/, (request, url, match) => {
        audit.comments.push(Number(match[1]));
        return okBody({ comment_id: 880000 + audit.comments.length });
    });
    route('createArticle', 'POST', /^\/postie\/v1\.0\/article$/, request => {
        const articleId = 99001 + audit.articlesCreated.length;
        audit.articlesCreated.push(articleId);
        world.articleWritten = true;
        world.myArticles.unshift({ article_id: articleId, title: request.body.title, datetime: NOW });
        return okBody({ article_id: articleId });
    });

    // --- flake balance ------------------------------------------------------------------------
    route('flakeBalance', 'GET', /^\/mileage\/v1\.0\/balance$/, () => okBody({ mileage_amount: 150000 }));
    route('flakeMonthly', 'GET', /^\/mileage\/v2\.0\/master\/deposit\/total$/, () => okBody({ total_deposit_amount: 12000 }));

    // --- missions -----------------------------------------------------------------------------
    route('missionPage', 'GET', /^\/flake-shop\/v1\/page$/, () => okBody({ component_list: structuredClone(COMPONENT_LIST) }));
    route('missionComponent', 'GET', /^\/flake-shop\/v1\/mission\/component$/, (request, url) => {
        const componentNo = Number(url.searchParams.get('component_no'));
        const missions = world.missions[componentNo];
        if (!missions) return { code: 40400, message: 'component not found' };
        return okBody({
            component_info: { component_no: componentNo, component_type: COMPONENT_TYPES[componentNo] },
            missions: structuredClone(missions)
        });
    });
    route('participate', 'POST', /^\/flake-shop\/v1\/mission\/participate$/, request => {
        const { mission_no: missionNo, component_no: componentNo, content_nos: contentNos } = request.body;
        const mission = world.missions[componentNo]?.find(item => item.mission_no === missionNo);
        if (!mission) return { code: 40400, message: '미션을 찾을 수 없습니다' };
        if (mission.status === 'COMPLETE') {
            audit.duplicateClaims.push(`mission:${missionNo}`);
            return { code: 40900, message: '이미 보상을 받은 미션입니다' };
        }
        if (mission.status === 'INCOMPLETE') {
            if (!mission.is_visit_mission) {
                audit.prematureClaims.push(`mission:${missionNo}`);
                return { code: 40001, message: '미션 조건을 달성하지 않았습니다' };
            }
            // Participation itself completes a visit mission; the reward still has to be claimed.
            mission.status = 'RECEIVABLE';
            return okBody({ mission_no: missionNo, title: mission.title, status: 'RECEIVABLE' });
        }
        if (mission.mission_type === 'SURVEY' && !(contentNos?.length > 0)) {
            return { code: 40002, message: '투표 항목이 없습니다' };
        }
        mission.status = 'COMPLETE';
        audit.missionClaims.push(missionNo);
        return okBody({ mission_no: missionNo, title: mission.title, status: 'COMPLETE', reward_amount: mission.reward_amount });
    });

    // --- roulette and prize entry ----------------------------------------------------------
    route('rouletteEvents', 'GET', /^\/emsbackapi\/v3\.0\/events$/, () => okBody({
        draw_info: { sub_event_no: 1000000353 },
        extra_info: { sub_event_no: 1000000357 },
        apply_info: { sub_event_no: 1000000354 },
        check_in_info: { sub_event_no: 1000000355 }
    }));
    route('prizeInfo', 'GET', /^\/emsbackapi\/v3\.0\/apply$/, () => okBody({
        sub_event_no: 1000000354,
        participation_method_list: [{ participation_amount: 500 }],
        gift_list: [
            { gift_no: 1000001775, gift_name: '문화상품권 1만원' },
            { gift_no: 1000001776, gift_name: '스토브 5,000 포인트' }
        ]
    }));
    route('prizeApply', 'POST', /^\/emsbackapi\/v3\.0\/apply\/(\d+)$/, () => {
        audit.prizeApplies += 1;
        const mission = world.missions[COMPONENTS.daily].find(item => item.mission_no === PRIZE_MISSION_NO);
        if (mission?.status === 'INCOMPLETE') mission.status = 'RECEIVABLE';
        return okBody({ user_apply_cnt: audit.prizeApplies, residue_flake: 149500 });
    });
    route('rouletteCount', 'GET', /^\/emsbackapi\/v3\.0\/participationCnt$/,
        () => okBody({ participation_cnt: world.roulette.used }));
    route('rouletteDraw', 'POST', /^\/emsbackapi\/v3\.0\/draw\/(\d+)$/, () => {
        if (world.roulette.used >= 30) {
            audit.overDraws += 1;
            return { code: 7012, message: '오늘 참여 가능 횟수를 초과했습니다' };
        }
        const prizes = options.roulettePrizes ?? ROULETTE_PRIZES;
        const price = prizes[audit.draws % prizes.length];
        audit.draws += 1;
        world.roulette.used += 1;
        return okBody({ gift_info: { gift_name: `${price} 플레이크`, gift_price: price } });
    });
    route('rouletteExtra', 'GET', /^\/emsbackapi\/v3\.0\/extra$/, () => okBody({
        current_cnt: world.roulette.used,
        current_cycle: 1,
        milestones: structuredClone(world.roulette.milestones)
    }));
    route('rouletteExtraClaim', 'POST', /^\/emsbackapi\/v3\.0\/extra\/(\d+)$/, request => {
        const milestone = world.roulette.milestones.find(item => item.gift_no === request.body.gift_no);
        if (!milestone) return { code: 7404, message: '보상을 찾을 수 없습니다' };
        if (milestone.received_yn) {
            audit.duplicateClaims.push(`extra:${milestone.gift_no}`);
            return { code: 7100, message: '이미 수령한 보상입니다' };
        }
        if (world.roulette.used < milestone.milestone) {
            audit.prematureClaims.push(`extra:${milestone.gift_no}`);
            return { code: 7101, message: '수령 조건 미달' };
        }
        milestone.received_yn = true;
        audit.extraClaims.push(milestone.gift_no);
        return okBody({ gift_no: milestone.gift_no });
    });

    // --- daily shops, special force, pre-registration --------------------------------------
    const shopBody = shop => okBody({
        daily_attendances: { rewards: structuredClone(shop.daily) },
        accumulated_attendances: { total_attendance_days: shop.totalDays, rewards: structuredClone(shop.accumulated) }
    });
    route('dailyShop', 'GET', /^\/dailyshop\/v1\.0\/\d{6}\/services\/STOVEINDIE$/, () => shopBody(world.shops.STOVEINDIE));
    route('majakShop', 'GET', /^\/dailyshop\/v1\.0\/\d{6}\/services\/RIICHICITY_IND$/, () => shopBody(world.shops.RIICHICITY_IND));
    route('dailyClaim', 'POST', /^\/dailyshop\/v1\.0\/attendances\/daily\/(\w+)$/, (request, url) => {
        const itemNo = Number(url.searchParams.get('item_no'));
        for (const shop of Object.values(world.shops)) {
            const reward = shop.daily.find(item => item.item_no === itemNo);
            if (!reward) continue;
            if (reward.is_received) {
                audit.duplicateClaims.push(`daily:${itemNo}`);
                return { code: 1001, message: '이미 수령한 보상입니다' };
            }
            reward.is_received = true;
            shop.totalDays += 1;
            audit.shopClaims.push(itemNo);
            return okBody({ item_no: itemNo });
        }
        return { code: 1404, message: '보상을 찾을 수 없습니다' };
    });
    route('accumulateClaim', 'POST', /^\/dailyshop\/v1\.0\/attendances\/accumulate\/(\w+)$/, (request, url) => {
        const itemNo = Number(url.searchParams.get('item_no'));
        for (const shop of Object.values(world.shops)) {
            const reward = shop.accumulated.find(item => item.item_no === itemNo);
            if (!reward) continue;
            if (reward.is_received) {
                audit.duplicateClaims.push(`accumulated:${itemNo}`);
                return { code: 1001, message: '이미 수령한 보상입니다' };
            }
            if (shop.totalDays < reward.rewardable_days) {
                audit.prematureClaims.push(`accumulated:${itemNo}`);
                return { code: 1002, message: '출석일이 부족합니다' };
            }
            reward.is_received = true;
            audit.shopClaims.push(itemNo);
            return okBody({ item_no: itemNo });
        }
        return { code: 1404, message: '보상을 찾을 수 없습니다' };
    });
    route('familyLinks', 'GET', /^\/dailyshop\/v1\.0\/services\/family-links$/, () => okBody([
        { service_id: 'riichicity', progress_month: '202610' },
        ...(world.specialForce.mode === 'none' ? [] : [{ service_id: 'specialforce', progress_month: '202610' }])
    ]));
    const specialForceValue = () => {
        const value = specialForceShop();
        value.date_info = { attend_start_dt: '2026-10-01T00:00:00', attend_end_dt: '2026-10-31T23:59:59' };
        for (const reward of value.accumulated_plays.rewards) reward.is_received = world.specialForce.received.has(reward.item_no);
        return value;
    };
    route('specialForceShop', 'GET', /^\/dailyshop\/v1\.0\/\d{6}\/services\/specialforce$/, () => okBody(specialForceValue()));
    route('specialForceClaim', 'POST', /^\/dailyshop\/v1\.0\/attendances\/accumulate-play\/flake$/, (request, url) => {
        const itemNo = Number(url.searchParams.get('item_no'));
        const reward = specialForceValue().accumulated_plays.rewards.find(item => item.item_no === itemNo);
        if (!reward) return { code: 1404, message: '보상을 찾을 수 없습니다' };
        if (reward.is_received) {
            audit.duplicateClaims.push(`specialForce:${itemNo}`);
            return { code: 1001, message: '이미 수령한 보상입니다' };
        }
        if (!reward.eligible) {
            audit.prematureClaims.push(`specialForce:${itemNo}`);
            return { code: 1002, message: '플레이 일수가 부족합니다' };
        }
        world.specialForce.received.add(itemNo);
        audit.specialForceClaims.push(itemNo);
        return okBody({ item_no: itemNo, category: 'ACCUMULATE_PLAY', flake_amount: reward.flake_amount });
    });
    route('preRegister', 'POST', /^\/dailyshop\/v1\.0\/campaigns\/(\d{6})\/([\w-]+)\/register$/, () => {
        audit.preRegistrations += 1;
        return okBody({ registration_no: 4321 });
    });
    route('wishlist', 'POST', /^\/shop\/v2\.0\/indie\/wishlist\/add$/, () => {
        audit.wishlists += 1;
        return { response_code: 0, message: 'OK' };
    });

    // --- today's #1 boost mission ----------------------------------------------------------
    const boostMission = () => {
        const { boost } = world;
        const details = [
            { action_type: 'ARTICLE_BOOST_ADD', label: '부스트', current_count: boost.boosted ? 1 : 0, required_count: 1 },
            { action_type: 'COMMENT_ADD', label: '댓글', current_count: boost.commented || audit.comments.length > 0 ? 1 : 0, required_count: 1 },
            { action_type: 'ARTICLE_ADD', label: '글쓰기', current_count: world.articleWritten ? 1 : 0, required_count: 1 }
        ];
        return {
            mission_id: 1, title: '오늘의 1등', start_dt: NOW - 3600000, end_dt: NOW + 82800000, created_at: NOW - 3600000,
            is_completed: details.every(detail => detail.current_count >= detail.required_count),
            is_rewarded: boost.rewarded, rewards: [{ type: 'FLAKE', amount: 3000 }], details
        };
    };
    route('boostMissions', 'GET', /^\/stadium-api\/v1\.0\/missions$/,
        () => okBody({ missions: world.boost.mode === 'none' ? [] : [boostMission()] }));
    route('boostBalance', 'GET', /^\/stadium-api\/v1\.0\/boost\/balance$/,
        () => okBody({ remaining_count: world.boost.remaining, next_charge_at: world.boost.nextChargeAt }));
    route('boostRanking', 'GET', /^\/stadium-api\/v1\.0\/recommend\/articles\/realtime-ranking$/, () => okBody({
        articles: [boostCandidate(81011, 443), boostCandidate(81012, 966), boostCandidate(81013, 354)],
        generated_at: NOW - 30000
    }));
    route('boostStatuses', 'GET', /^\/stadium-api\/v1\.0\/article\/([\d,]+)\/interaction\/BOOST$/, (request, url, match) =>
        okBody(Object.fromEntries(match[1].split(',').map(id => [id, { BOOST: world.boost.boostedIds.has(id) }]))));
    route('boostArticle', 'PUT', /^\/stadium-api\/v1\.0\/boost\/(\d+)$/, (request, url, match) => {
        if (world.boost.remaining < 1) return { code: 81333, message: '부스트 잔여 횟수가 없습니다' };
        world.boost.boostedIds.add(match[1]);
        world.boost.boosted = true;
        world.boost.remaining -= 1;
        world.boost.nextChargeAt = NOW + 300000;
        audit.boosts.push(match[1]);
        return okBody({ remaining_count: world.boost.remaining, next_charge_at: world.boost.nextChargeAt });
    });
    route('boostReward', 'POST', /^\/stadium-api\/v1\.0\/missions\/(\d+)\/reward$/, () => {
        if (world.boost.rewarded) {
            audit.duplicateClaims.push('boost:1');
            return { code: 81001, message: '이미 보상을 받았습니다' };
        }
        if (!boostMission().is_completed) {
            audit.prematureClaims.push('boost:1');
            return { code: 81002, message: '미션 조건을 달성하지 않았습니다' };
        }
        world.boost.rewarded = true;
        audit.boostRewards += 1;
        return okBody({ mission_id: 1, rewards: [{ type: 'FLAKE', amount: 3000 }] });
    });

    // --- game review comment event ---------------------------------------------------------
    const reviewEvents = () => [
        { event_no: 1915, service_id: 'STOVEINDIE', language: 'ko', benefits: ['COUPON'], title: '가을 세일 쿠폰',
            status: 'ONGOING', expose_start_at: '2026-10-01', expose_end_at: '2026-10-31',
            link_url: 'https://store.onstove.com/ko/event/sale' },
        ...(world.review.mode === 'none' ? [] : [{
            event_no: 1914, service_id: 'STOVEINDIE', language: 'ko', benefits: ['FLAKE'],
            title: '게임 리뷰 읽고,<br>댓글 달면 플레이크 GET!', status: 'ONGOING',
            expose_start_at: '2026-10-10', expose_end_at: '2026-10-20', link_url: REVIEW_URL
        }])
    ];
    route('reviewEvents', 'GET', /^\/eventhub\/v1\.0\/promotion\/events\/ON$/, () => {
        const events = reviewEvents();
        return okBody({ total_event_cnt: events.length, promotion_events: events });
    });
    route('reviewArticle', 'GET', /^\/cwms\/v3\.0\/article$/, () => okBody({
        article_id: REVIEW_ARTICLE_ID, community_key: 'quarter', channel_key: 'kr', article_status_code: 'PUBLISHED',
        coverage_code: 'PUBLIC', board_seq: 134147, channel_seq: 73, title: '게임 리뷰'
    }));
    route('reviewMember', 'GET', /^\/cwms\/v1\.0\/user\/CHANNEL\/(\d+)$/, () => okBody({ user_info: { member_no: USER_ID } }));
    route('reviewPermission', 'GET', /^\/cwms\/v1\.0\/user\/board\/permission$/,
        () => okBody([{ board_seq: 134147, user_permission_info: { comment: { write: true } } }]));
    route('reviewComments', 'GET', /^\/cwms\/v1\.1\/article\/(\d+)\/comment\/list$/, (request, url) => {
        const page = Number(url.searchParams.get('page'));
        const comments = world.review.comments;
        return okBody({
            total: comments.length, display_total: comments.length, page, size: 20,
            next_yn: comments.length > page * 20 ? 'Y' : 'N',
            list: structuredClone(comments.slice((page - 1) * 20, page * 20))
        });
    });
    route('reviewComment', 'POST', /^\/cwms\/v1\.0\/article\/(\d+)\/comment$/, () => {
        if (world.review.comments.some(comment => comment.user_info.member_no === USER_ID)) {
            audit.duplicateClaims.push('review:comment');
        }
        audit.reviewComments += 1;
        world.review.comments.unshift({ comment_id: 900001, comment_status_code: 'NORMAL', user_info: { member_no: USER_ID } });
        return okBody({ comment_id: 900001 });
    });

    return world;
}

/** Override helper: the first `count` calls answer `response`, later calls reach the world. */
export function failFirst(count, response) {
    return (request, callIndex, next) => (callIndex < count ? response : next());
}

function replaceNavigator(t, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value });
    t.after(() => {
        if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
        else delete globalThis.navigator;
    });
}

/** A navigator WITHOUT Web Locks, whatever the running Node version provides. */
export function removeWebLocks(t) {
    replaceNavigator(t, { userAgent: 'automation-world' });
}

/**
 * Browser Web Locks stand-in (Node 22 has none). Boost and review-event automation refuse to run
 * without it, exactly as in a browser that lacks navigator.locks.
 */
export function installWebLocks(t) {
    const held = new Set();
    const requested = [];
    const locks = {
        async request(name, options, callback) {
            requested.push(name);
            if (held.has(name)) return callback(null);
            held.add(name);
            try {
                return await callback({ name, mode: 'exclusive' });
            } finally {
                held.delete(name);
            }
        }
    };
    replaceNavigator(t, { userAgent: 'automation-world', locks });
    return { requested };
}

/** World plus Web Locks (default) or an explicitly lock-less navigator (webLocks: false). */
export function useAutomationWorld(t, h, options = {}) {
    if (options.webLocks === false) removeWebLocks(t);
    else installWebLocks(t);
    return installAutomationWorld(h, options);
}
