export const CONFIG = {
    version: '2.7.3',
    lastUpdated: '2026-05-10',
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
    commentPool: [
        '굿',
        '굿굿',
        'ㅋㅋㅋㅋ',
        '좋네요',
        '오 좋다',
        '잘봤어요',
        '인정',
        '나이스',
        '괜찮네요',
        '오호'
    ],
    roulette: {
        enabled: true,
        subEventNo: '1000000353',
        extraSubEventNo: '1000000357',
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
        missionNo: 359,
        eventNo: 1000000354,
        giftNo: 1000001776,
        missionTitle: '경품 응모하기',
        targetGiftName: '스토브 5,000 포인트',
        flakeCost: 500
    },
    pointExchange: {
        enabled: true,
        clientId: 'M_STOVE_COMMUNITY',
        fromUseRuleId: 'ML_STOVE_COMMUNITY_MILE_PLAY',
        toDepositRuleId: 'PL_STOVE_COMMUNITY_MILE_PAID',
        pointAmount: 7700,
        requiredFlakeAmount: 192500,
        description: '플레이크 전환'
    }
};
