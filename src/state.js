export function createInitialState() {
    return {
        isRunning: false,
        progress: {
            articleLikes: 0,
            comments: 0,
            newArticle: 0
        },
        completed: {
            roulette: false,
            dailyShop: false,
            majak: false,
            dailyMissions: false,
            contentMissions: false,
            weeklyMissions: false,
            bannerMissions: false,
            attendanceMissions: false,
            surveyMissions: false,
            prizeEntry: false
        },
        createdCommentIds: [],
        earnings: {
            roulette: 0,
            rouletteExtra: 0,
            dailyShop: 0,
            majak: 0,
            dailyMissions: 0,
            visitMissions: 0,
            contentMissions: 0,
            weeklyMissions: 0,
            bannerMissions: 0,
            attendanceMissions: 0,
            surveyMissions: 0,
            prizeEntry: 0,
            dailyAccumulated: 0,
            boostMission: 0
        },
        missionComponents: {
            daily: null,
            dailyComponents: [],
            content: null,
            weekly: null,
            survey: null,
            banner: null,
            attendance: null
        },
        rouletteEvents: {
            draw: null,
            extra: null,
            apply: null,
            checkIn: null
        },
        prizeInfo: {
            eventNo: null,
            giftNo: null,
            giftName: null,
            flakeCost: null
        },
        pointCashCharge: {
            availableFlake: null,
            hasRequiredFlake: false
        }
    };
}

// The single state object every module shares; it is mutated in place, never replaced.
export const state = createInitialState();

// A full automation run starts its progress, completion flags, comment ids and earnings from zero.
// Loaded ids (mission components, roulette events, prize info) and the FLAKE balance are kept.
export function resetRunProgress(target = state) {
    const initial = createInitialState();
    target.progress = initial.progress;
    target.createdCommentIds = initial.createdCommentIds;
    target.completed = initial.completed;
    target.earnings = initial.earnings;
}
