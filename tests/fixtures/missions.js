// Stateful mission API world for characterization tests: GET component reads the current mission
// list, participate POSTs move missions INCOMPLETE → RECEIVABLE → COMPLETE, and opening a visit
// mission's URL marks it RECEIVABLE, like the real reward page does after a visit.
import { state } from '../../src/state.js';

export const API = 'https://api.onstove.com';
export const componentUrl = componentNo => `${API}/flake-shop/v1/mission/component?component_no=${componentNo}`;
export const PARTICIPATE_URL = `${API}/flake-shop/v1/mission/participate`;
export const MISSION_PAGE_URL = `${API}/flake-shop/v1/page?page_type=MISSION`;
export const prizeApplyUrl = eventNo => `${API}/emsbackapi/v3.0/apply/${eventNo}`;

export const COMPONENTS = Object.freeze({
    daily: 226,
    content: 301,
    weekly: 401,
    survey: 501,
    banner: 601,
    attendance: 701
});

export function loadComponents(overrides = {}) {
    Object.assign(state.missionComponents, {
        daily: COMPONENTS.daily,
        dailyComponents: [COMPONENTS.daily],
        content: COMPONENTS.content,
        weekly: COMPONENTS.weekly,
        survey: COMPONENTS.survey,
        banner: COMPONENTS.banner,
        attendance: COMPONENTS.attendance,
        ...overrides
    });
}

export function mission(missionNo, overrides = {}) {
    return {
        mission_no: missionNo,
        title: `미션 ${missionNo}`,
        status: 'INCOMPLETE',
        reward_amount: 10,
        mission_type: 'SINGLE',
        ...overrides
    };
}

export function componentBody(componentNo, missions) {
    return {
        code: 0,
        message: 'OK',
        value: {
            component_info: { component_no: componentNo },
            missions: structuredClone(missions)
        }
    };
}

/**
 * Registers mission routes on the harness.
 * components: { [componentNo]: mission[] }
 * options.componentResponses: { [componentNo]: response | response[] } overrides GET answers
 * options.participate: (body, missionRef) => response overrides the default state machine
 * options.visitCompletes: false keeps visited missions INCOMPLETE
 */
export function installMissionWorld(h, components, options = {}) {
    const world = { components: structuredClone(components), participations: [] };
    const findMission = (componentNo, missionNo) =>
        (world.components[componentNo] || []).find(item => item.mission_no === missionNo);

    for (const componentNo of Object.keys(world.components)) {
        const override = options.componentResponses?.[componentNo];
        h.on('GET', componentUrl(componentNo), override ?? (() => componentBody(Number(componentNo), world.components[componentNo])));
    }
    for (const [componentNo, override] of Object.entries(options.componentResponses || {})) {
        if (!(componentNo in world.components)) h.on('GET', componentUrl(componentNo), override);
    }

    h.on('POST', PARTICIPATE_URL, request => {
        const { mission_no: missionNo, component_no: componentNo } = request.body;
        world.participations.push({ missionNo, componentNo });
        const found = findMission(componentNo, missionNo);
        if (options.participate) return options.participate(request.body, found, world);
        if (!found) return { code: 40400, message: 'mission not found' };
        if (found.status === 'INCOMPLETE') {
            found.status = 'RECEIVABLE';
            return { code: 0, value: { ...found } };
        }
        if (found.status === 'RECEIVABLE') {
            found.status = 'COMPLETE';
            return { code: 0, value: { ...found } };
        }
        return { code: 40900, message: 'already completed' };
    });

    if (options.visitCompletes !== false) {
        const openTab = globalThis.GM_openInTab;
        globalThis.GM_openInTab = (url, tabOptions) => {
            for (const missions of Object.values(world.components)) {
                for (const item of missions) {
                    if (item.status === 'INCOMPLETE' && (item.button_url === url || item.url === url)) {
                        item.status = 'RECEIVABLE';
                    }
                }
            }
            return openTab(url, tabOptions);
        };
    }

    return world;
}
