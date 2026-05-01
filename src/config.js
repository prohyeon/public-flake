export const CONFIG = {
    version: '2.5.1',
    lastUpdated: '2026-01-09',
    maintenanceMode: {
        enabled: false,
        startDate: '2025-11-01',
        message: '11월 플레이크 구조 확인중입니다, 업데이트 이후 사용할 수 있습니다'
    },
    api: {
        baseUrl: 'https://api.onstove.com'
    },
    targets: {
        articleLikes: 10,
        comments: 5,
        newArticle: 1
    },
    delays: {
        betweenActions: 200,
        afterComment: 11000
    },
    comment: "Nice!",
    roulette: {
        enabled: true,
        subEventNo: '1000000248',
        extraSubEventNo: '1000000250',
        drawCost: 100,
        maxDraws: 30,
        maxRetries: 3,
        retryDelay: 1000
    },
    dailyMissions: {
        enabled: true,
        skipMissions: [],
        visitDelay: 3000
    },
    contentMissions: {
        enabled: true
    },
    weeklyMissions: {
        enabled: true
    },
    bannerMissions: {
        enabled: true,
        visitDelay: 3000
    },
    attendanceMissions: {
        enabled: true
    },
    surveyMissions: {
        enabled: true,
        voteStrategy: 'highest'
    },
    prizeEntry: {
        enabled: true,
        missionNo: 8,
        eventNo: 1000000249,
        giftNo: 1000001247,
        targetGiftName: '스토브 5,000 포인트',
        flakeCost: 500
    }
};
