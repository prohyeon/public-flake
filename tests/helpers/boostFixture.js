export const BOOST_NOW = Date.parse('2026-10-01T10:45:31Z');

export function boostCandidate(id, score, overrides = {}) {
    return { article_id: String(id), score, title: `후보 ${id}`, datetime: BOOST_NOW - 60000,
        today_contest_agree: true, source: 'postoffice', status: 'PUBLISHED', coverage: 'PUBLIC',
        profile: { id: '200', type: 'USER' }, ...overrides };
}

export function boostFixture() {
    const mission = { mission_id: 1, title: '오늘의 1등', start_dt: BOOST_NOW - 86400000,
        end_dt: BOOST_NOW + 86400000, created_at: BOOST_NOW - 86400000,
        is_completed: false, is_rewarded: false, rewards: [{ type: 'FLAKE', amount: 3000 }],
        details: [
            { action_type: 'ARTICLE_BOOST_ADD', label: '부스트', current_count: 0, required_count: 1 },
            { action_type: 'COMMENT_ADD', label: '댓글', current_count: 1, required_count: 1 },
            { action_type: 'ARTICLE_ADD', label: '글쓰기', current_count: 1, required_count: 1 }
        ] };
    const metrics = { rankings: 0, boosts: [], rewards: [], delays: [], published: [] };
    const records = new Map();
    const boosted = new Set();
    const rankings = [{ articles: [boostCandidate(11, 443), boostCandidate(12, 966), boostCandidate(13, 354)], generatedAt: BOOST_NOW }];
    let locked = false;
    let remaining = 5;
    const deps = {
        now: () => BOOST_NOW,
        storage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) },
        withLock: async (key, work) => {
            if (locked) return { success: false, reason: 'alreadyRunning' };
            locked = true;
            try { return await work(); } finally { locked = false; }
        },
        getMyProfile: async () => ({ code: 0, value: { user_id: '100' } }),
        getBoostMissions: async () => [structuredClone(mission)],
        getBoostBalance: async () => ({ remainingCount: remaining, nextChargeAt: null }),
        getBoostRanking: async () => {
            const index = metrics.rankings++;
            return structuredClone(rankings[Math.min(index, rankings.length - 1)]);
        },
        getArticleBoostStatuses: async (headers, ids) => Object.fromEntries(ids.map(id => [id, { BOOST: boosted.has(String(id)) }])),
        boostArticle: async (headers, id) => {
            metrics.boosts.push(String(id));
            boosted.add(String(id));
            mission.details[0].current_count = 1;
            mission.is_completed = mission.details.every(detail => detail.current_count >= detail.required_count);
            remaining--;
            return { remainingCount: remaining, nextChargeAt: BOOST_NOW + 300000 };
        },
        receiveBoostMissionReward: async (headers, id) => {
            metrics.rewards.push(String(id));
            mission.is_rewarded = true;
            return 3000;
        },
        delay: async ms => { metrics.delays.push(ms); },
        log: () => {},
        publish: status => { metrics.published.push(status); }
    };
    return { mission, metrics, records, boosted, rankings, deps };
}
