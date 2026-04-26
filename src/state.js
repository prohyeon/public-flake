export const state = {
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
        contentMissions: 0,
        weeklyMissions: 0,
        bannerMissions: 0,
        attendanceMissions: 0,
        surveyMissions: 0,
        prizeEntry: 0
    },
    missionComponents: {
        daily: null,
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
    }
};
