// Fixtures for the status dashboard characterization tests (workflows/status.js, ui/status.js,
// ui/progress.js). Response shapes follow what src reads plus captured shapes used elsewhere in
import { DEFAULT_NOW } from '../helpers/gmHarness.js';

export const API = 'https://api.onstove.com';
export const DAY = 86400000;
export const NOW = DEFAULT_NOW; // 2026-10-16 10:00 KST
export const TODAY = '2026-10-16';
export const MONTH = '202610';

// Copied from src/main.js createUI() (controls, status list, special force, progress and log
// sections) with ${CONFIG...} placeholders resolved. Ids, classes and nesting match the real panel
// so ui/status.js tooltips (closest('.stove-mission-item')) and ui/progress.js selectors behave
// as they do in the userscript.
export const STATUS_PANEL_BODY = `
<div id="stove-quest-automation">
        <div class="stove-controls">
            <button id="stove-btn-start" class="stove-btn">전체 자동화</button>
            <button id="stove-btn-point-cash-charge" class="stove-btn" disabled title="192,500 플레이크 이상일 때 충전 가능">
                <span class="stove-btn-main">7700 캐시 충전</span>
                <span class="stove-btn-sub">(192,500 플레이크)</span>
                <span class="stove-btn-note" id="stove-btn-point-cash-charge-status">플레이크 확인 중</span>
            </button>
            <button id="stove-btn-reward-shop" class="stove-btn">리워드샵 방문</button>
        </div>

        <div class="stove-status-section">
            <div class="stove-status-header">
                현재 상태
                <button id="stove-btn-status-refresh" class="stove-status-refresh">새로고침</button>
            </div>
            <div class="stove-status-list">
                <div class="stove-status-item stove-mission-item" data-category="daily">
                    <span class="stove-status-label">데일리</span>
                    <span class="stove-status-value" id="stove-status-mission-daily">-</span>
                </div>
                <div class="stove-status-item stove-mission-item" data-category="weekly">
                    <span class="stove-status-label">위클리</span>
                    <span class="stove-status-value" id="stove-status-mission-weekly">-</span>
                </div>
                <div class="stove-status-item stove-mission-item" data-category="content">
                    <span class="stove-status-label">컨텐츠</span>
                    <span class="stove-status-value" id="stove-status-mission-content">-</span>
                </div>
                <div class="stove-status-item stove-mission-item" data-category="attendance">
                    <span class="stove-status-label">월간출석</span>
                    <span class="stove-status-value" id="stove-status-mission-attendance">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">룰렛 횟수</span>
                    <span class="stove-status-value" id="stove-status-roulette">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">데일리 보상</span>
                    <span class="stove-status-value" id="stove-status-daily">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">마작 리워드</span>
                    <span class="stove-status-value" id="stove-status-majak">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">설문조사</span>
                    <span class="stove-status-value" id="stove-status-survey">-</span>
                </div>
                <div class="stove-status-item" style="border-top: 2px solid #3a3a3a; margin-top: 8px; padding-top: 16px;">
                    <span class="stove-status-label">현재 보유</span>
                    <span class="stove-status-value" id="stove-status-total-flake">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">이번 달 획득</span>
                    <span class="stove-status-value" id="stove-status-monthly-flake">-</span>
                </div>
            </div>
        </div>

        <div class="stove-log-section">
            <div class="stove-log-header">
                <span>로그</span>
                <button id="stove-btn-copy-log" class="stove-ghost-btn" title="로그 전체 복사"></button>
            </div>
            <div id="stove-log-content"></div>
        </div>
</div>`;

const compact = html => html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

/** Rendered dashboard: every status cell (with title/style), mission tooltips, charge button, SF card. */
export function panelSnapshot(document) {
    const values = Object.fromEntries([...document.querySelectorAll('.stove-status-value')]
        .map(element => [element.id, element.outerHTML]));
    const tooltips = Object.fromEntries([...document.querySelectorAll('.stove-mission-item')]
        .map(item => [item.dataset.category,
            [...item.querySelectorAll('.stove-mission-tooltip')].map(tooltip => compact(tooltip.innerHTML))]));
    const charge = document.getElementById('stove-btn-point-cash-charge');
    const chargeStatus = document.getElementById('stove-btn-point-cash-charge-status');
    return {
        values,
        tooltips,
        pointCashCharge: {
            disabled: charge.disabled,
            title: charge.title,
            opacity: charge.style.opacity,
            status: chargeStatus.textContent,
            statusColor: chargeStatus.style.color
        }
    };
}

// ------------------------------------------------------------------ mission components

export const COMPONENTS = Object.freeze({
    dailyA: 271, dailyB: 272, content: 280, weekly: 274, survey: 281, banner: 283, attendance: 284, expired: 260
});

/** /flake-shop/v1/page?page_type=MISSION component list, epoch-ms windows around NOW. */
export function componentList() {
    const month = { start_dt: NOW - 15 * DAY, end_dt: NOW + 15 * DAY };
    return [
        { component_no: COMPONENTS.dailyA, type: 'SINGLE', ...month },
        { component_no: COMPONENTS.dailyB, type: 'SINGLE', ...month },
        { component_no: COMPONENTS.expired, type: 'SINGLE', start_dt: NOW - 40 * DAY, end_dt: NOW - 10 * DAY },
        { component_no: COMPONENTS.content, type: 'CONTENT1', ...month },
        { component_no: COMPONENTS.weekly, type: 'ACCUMULATION', start_dt: NOW - 3 * DAY, end_dt: NOW + 3 * DAY },
        { component_no: COMPONENTS.survey, type: 'SURVEY', ...month },
        { component_no: COMPONENTS.banner, type: 'BANNER', ...month },
        { component_no: COMPONENTS.attendance, type: 'ACCUMULATION', ...month }
    ];
}

export const componentPageBody = (list = componentList()) => ({ code: 0, message: 'OK', value: { component_list: list } });

/** state.missionComponents as mapMissionComponentIds(componentList()) produces it. */
export function loadedComponents() {
    return {
        daily: COMPONENTS.dailyB,
        dailyComponents: [COMPONENTS.dailyA, COMPONENTS.dailyB],
        content: COMPONENTS.content,
        weekly: COMPONENTS.weekly,
        survey: COMPONENTS.survey,
        banner: COMPONENTS.banner,
        attendance: COMPONENTS.attendance
    };
}

export function mission(missionNo, overrides = {}) {
    return { mission_no: missionNo, title: `미션 ${missionNo}`, status: 'INCOMPLETE', reward_amount: 10, ...overrides };
}

export function componentBody(componentNo, type, missions) {
    return { code: 0, message: 'OK', value: { component_info: { component_no: componentNo, component_type: type, title: `${type} ${componentNo}` }, missions } };
}

export const componentUrl = componentNo => `${API}/flake-shop/v1/mission/component?component_no=${componentNo}`;

/** Routes each /mission/component?component_no=N to bodies[N]; unknown components stay unmatched. */
export function routeComponents(h, bodies) {
    const componentNoOf = url => url.match(/\/flake-shop\/v1\/mission\/component\?component_no=(\d+)$/)?.[1];
    h.on('GET', url => {
        const componentNo = componentNoOf(url);
        return componentNo !== undefined && Object.hasOwn(bodies, componentNo);
    }, request => bodies[componentNoOf(request.url)]);
}

export function pendingComponentBodies() {
    return {
        [COMPONENTS.dailyA]: componentBody(COMPONENTS.dailyA, 'SINGLE', [
            mission(1, { title: '스토브 메인 방문', is_visit_mission: true }),
            mission(2, { title: '리워드샵 방문', status: 'RECEIVABLE' })
        ]),
        [COMPONENTS.dailyB]: componentBody(COMPONENTS.dailyB, 'SINGLE', [
            mission(3, { title: '라운지 좋아요', status: 'COMPLETE' })
        ]),
        [COMPONENTS.content]: componentBody(COMPONENTS.content, 'CONTENT1', [
            mission(10, { title: '게임 플레이' }),
            mission(11, { title: '게임 위시리스트' })
        ]),
        [COMPONENTS.weekly]: componentBody(COMPONENTS.weekly, 'ACCUMULATION', [
            mission(20, { title: '주간 댓글 5회', status: 'RECEIVABLE', user_complete_cnt: 5, milestone_total_cnt: 5 }),
            mission(21, { title: '주간 글쓰기 3회', user_complete_cnt: 1, milestone_total_cnt: 3 })
        ]),
        [COMPONENTS.survey]: componentBody(COMPONENTS.survey, 'SURVEY', [
            mission(30, { title: '설문 1', status: 'RECEIVABLE' }),
            mission(31, { title: '설문 2', status: 'COMPLETED' })
        ]),
        [COMPONENTS.banner]: componentBody(COMPONENTS.banner, 'BANNER', [
            mission(40, { title: '배너 방문' })
        ]),
        [COMPONENTS.attendance]: componentBody(COMPONENTS.attendance, 'ACCUMULATION', [
            mission(50, { title: '월간 출석', user_complete_cnt: 9, milestone_per_cnt: 7, milestone_total_cnt: 28 })
        ])
    };
}

export function doneComponentBodies() {
    const done = overrides => ({ status: 'COMPLETE', ...overrides });
    return {
        [COMPONENTS.dailyA]: componentBody(COMPONENTS.dailyA, 'SINGLE', [
            mission(1, done({ title: '스토브 메인 방문' })), mission(2, done({ title: '리워드샵 방문' }))
        ]),
        [COMPONENTS.dailyB]: componentBody(COMPONENTS.dailyB, 'SINGLE', [mission(3, done({ title: '라운지 좋아요' }))]),
        [COMPONENTS.content]: componentBody(COMPONENTS.content, 'CONTENT1', [mission(10, { title: '게임 플레이', status: 'COMPLETED' })]),
        [COMPONENTS.weekly]: componentBody(COMPONENTS.weekly, 'ACCUMULATION', [mission(20, done({ title: '주간 댓글 5회' }))]),
        [COMPONENTS.survey]: componentBody(COMPONENTS.survey, 'SURVEY', [
            mission(30, done({ title: '설문 1' })), mission(31, { title: '설문 2', status: 'COMPLETED' })
        ]),
        [COMPONENTS.banner]: componentBody(COMPONENTS.banner, 'BANNER', [mission(40, done({ title: '배너 방문' }))]),
        [COMPONENTS.attendance]: componentBody(COMPONENTS.attendance, 'ACCUMULATION', [
            mission(50, done({ title: '월간 출석', user_complete_cnt: 28, milestone_per_cnt: 7, milestone_total_cnt: 28 }))
        ])
    };
}

// ------------------------------------------------------------------ other dashboard reads

export const participationBody = count => ({ code: 0, message: 'OK', value: { sub_event_no: 1000000353, participation_cnt: count } });

export function dailyShopBody(todayReceived, { today = true } = {}) {
    const rewards = [
        { item_type: 'FLAKE', attendance_date: '2026-10-15', item_no: 1600, item_name: '50 플레이크', is_received: true },
        { item_type: 'FLAKE', attendance_date: '2026-10-17', item_no: 1602, item_name: '50 플레이크', is_received: false }
    ];
    if (today) rewards.splice(1, 0, { item_type: 'FLAKE', attendance_date: TODAY, item_no: 1601, item_name: '50 플레이크', is_received: todayReceived });
    return { code: 0, message: 'OK', value: {
        daily_attendances: { rewards },
        accumulated_attendances: { total_attendance_days: 15, rewards: [] }
    } };
}


export const balanceBody = amount => ({ code: 0, message: 'OK', value: { mileage_amount: amount } });
export const depositBody = amount => ({ code: 0, message: 'OK', value: { total_deposit_amount: amount } });



// ------------------------------------------------------------------ checkAllStatus world

export const URLS = Object.freeze({
    page: `${API}/flake-shop/v1/page?page_type=MISSION`,
    participation: /^https:\/\/api\.onstove\.com\/emsbackapi\/v3\.0\/participationCnt\?sub_event_no=\d+$/,
    dailyShop: `${API}/dailyshop/v1.0/${MONTH}/services/STOVEINDIE`,
    majakShop: `${API}/dailyshop/v1.0/${MONTH}/services/RIICHICITY_IND`,
    balance: `${API}/mileage/v1.0/balance?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY`,
    deposit: /^https:\/\/api\.onstove\.com\/mileage\/v2\.0\/master\/deposit\/total\?/,
});

/** Defaults: a fresh day where everything is still pending. */
export function pendingWorld() {
    return {
        page: componentPageBody(),
        components: pendingComponentBodies(),
        participation: participationBody(0),
        dailyShop: dailyShopBody(false),
        majakShop: dailyShopBody(false),
        balance: balanceBody(150000),
        deposit: depositBody(12345),
    };
}

/** Registers every endpoint checkAllStatus reads; `world` maps URLS keys (+ components) to responses. */
export function routeStatusWorld(h, world) {
    routeComponents(h, world.components);
    for (const [key, match] of Object.entries(URLS)) {
        if (world[key] !== undefined) h.on('GET', match, world[key]);
    }
}
