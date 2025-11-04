// ==UserScript==
// @name         STOVE Quest Automation
// @namespace    https://profile.onstove.com/
// @version      2.1.5
// @description  STOVE 자동화 (게시글 추천 10회, 댓글 5회 작성, 새글 1회, 룰렛, 데일리 보상)
// @author       prohyeon
// @match        https://profile.onstove.com/ko*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      api.onstove.com
// @connect      reward.onstove.com
// @updateURL    https://github.com/prohyeon/public-flake/raw/refs/heads/main/stove-quest-automation.user.js
// @downloadURL  https://github.com/prohyeon/public-flake/raw/refs/heads/main/stove-quest-automation.user.js
// @supportURL   https://github.com/prohyeon/public-flake/issues
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // Configuration
    // ============================================
    const CONFIG = {
        version: '2.1.5',
        lastUpdated: '2025-11-04',
        maintenanceMode: {
            enabled: false,                   // 점검 모드 비활성화
            startDate: '2025-11-01',          // KST 기준 점검 시작일 (YYYY-MM-DD)
            message: '11월 플레이크 구조 확인중입니다, 업데이트 이후 사용할 수 있습니다'
        },
        api: {
            baseUrl: 'https://api.onstove.com'
        },
        targets: {
            articleLikes: 10,    // 게시글 추천 10회
            comments: 5,         // 댓글 5회 작성 (비동기)
            newArticle: 1        // 새글 작성 1회
        },
        delays: {
            betweenActions: 200,
            afterComment: 11000
        },
        comment: "Nice!",
        tags: [
            'STOVEINDIE',
            'epicseven',
            'crossfire',
            'btscookingon',
            'chaoszeronightmare'
        ],
        roulette: {
            enabled: true,              // 룰렛 자동 실행 활성화
            subEventNo: '1000000237',   // 룰렛 이벤트 ID (11월 업데이트)
            extraSubEventNo: '1000000239', // 룰렛 EXTRA 이벤트 ID (11월 업데이트)
            drawCost: 100,              // 룰렛 1회당 비용 (FLAKE)
            maxDraws: 30,               // 최대 룰렛 횟수 (일일 제한)
            maxRetries: 3,              // API 실패 시 최대 재시도 횟수
            retryDelay: 1000            // 재시도 간 대기 시간 (ms)
        },
        dailyMissions: {
            enabled: true,              // 데일리 미션 자동 실행 활성화
            componentNo: 1,             // 미션 컴포넌트 번호
            visitMissions: [1, 2],      // 방문 미션 번호 (MY홈, 스토브 메인)
            skipMissions: [3, 8],       // 건너뛸 미션 번호 (앱 로그인, 경품 응모)
            visitDelay: 1000            // 방문 후 탭 닫기까지 대기 시간 (ms)
        },
        contentMissions: {
            enabled: true,              // 컨텐츠 미션 자동 실행 활성화
            componentNo: 4              // 미션 컴포넌트 번호 (인기 게시글 보기)
        },
        weeklyMissions: {
            enabled: true,              // 위클리 미션 자동 실행 활성화
            componentNo: 2              // 미션 컴포넌트 번호 (위클리 미션)
        },
        eventMissions: {
            enabled: true,              // 이벤트 미션 자동 실행 활성화
            componentNo: 9              // 미션 컴포넌트 번호 (오픈기념 이벤트)
        },
        bannerMissions: {
            enabled: true,              // 배너 미션 자동 실행 활성화
            componentNo: 12,            // 미션 컴포넌트 번호 (11월 배너 미션)
            visitDelay: 1000            // 방문 후 탭 닫기까지 대기 시간 (ms)
        },
        attendanceMissions: {
            enabled: true,              // 출석 미션 자동 실행 활성화
            componentNo: 10             // 미션 컴포넌트 번호 (매일 출석 보너스)
        },
        prizeEntry: {
            enabled: true,              // 경품 응모 자동 실행 활성화
            missionNo: 8,               // mission_no (경품 응모하기)
            eventNo: 1000000238,        // event_no for API endpoint
            giftNo: 1000001184,         // gift_no for request body
            flakeCost: 500              // 응모 시 소모되는 FLAKE
        }
    };

    // ============================================
    // State Management
    // ============================================
    const state = {
        isRunning: false,
        progress: {
            articleLikes: 0,
            comments: 0,
            newArticle: 0
        },
        completed: {
            roulette: false,        // 룰렛 완료 여부
            dailyShop: false,       // 데일리 샵 완료 여부
            majak: false,           // 마작 완료 여부
            dailyMissions: false,   // 데일리 미션 완료 여부
            contentMissions: false, // 컨텐츠 미션 완료 여부
            weeklyMissions: false,  // 위클리 미션 완료 여부
            eventMissions: false,   // 이벤트 미션 완료 여부
            bannerMissions: false,  // 배너 미션 완료 여부
            attendanceMissions: false, // 출석 미션 완료 여부
            prizeEntry: false       // 경품 응모 완료 여부
        },
        createdCommentIds: [],  // Store created comment IDs for liking
        earnings: {
            // quest: 0 제거됨 (퀘스트 리워드 API 제거로 인해)
            roulette: 0,         // Net profit from roulette (rewards - cost)
            rouletteExtra: 0,    // FLAKE from roulette extra milestones
            dailyShop: 0,        // FLAKE from daily shop rewards
            majak: 0,            // FLAKE from majak rewards
            dailyMissions: 0,    // FLAKE from daily missions
            contentMissions: 0,  // FLAKE from content missions
            weeklyMissions: 0,   // FLAKE from weekly missions
            eventMissions: 0,    // FLAKE from event missions
            bannerMissions: 0,   // FLAKE from banner missions
            attendanceMissions: 0, // FLAKE from attendance missions
            prizeEntry: 0        // FLAKE from prize entry (net: reward - cost)
        }
    };

    // ============================================
    // Utility Functions
    // ============================================
    /**
     * Get current date in KST timezone (YYYY-MM-DD format)
     */
    function getKSTDate() {
        const now = new Date();
        // Convert to KST (UTC+9)
        const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const year = kstTime.getUTCFullYear();
        const month = String(kstTime.getUTCMonth() + 1).padStart(2, '0');
        const day = String(kstTime.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function extractHeaders() {
        const token = getCookie('SUAT');
        const uuid = localStorage.getItem('sgs_da_uuid') || getCookie('sgs_da_uuid');

        if (!token) {
            throw new Error('Authorization token (SUAT) not found');
        }
        if (!uuid) {
            throw new Error('UUID (sgs_da_uuid) not found');
        }

        return {
            'Authorization': `Bearer ${token}`,
            'caller-id': 'storee-lounge',
            'X-UUID': uuid,
            'x-lang': 'ko',
            'x-nation': 'KR',
            'x-device-type': 'P01',
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Origin': 'https://lounge.onstove.com',
            'Referer': 'https://lounge.onstove.com/'
        };
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getTimestamp() {
        return Date.now();
    }

    /**
     * 백그라운드에서 새 탭 열기 (포커스 없이)
     * @param {string} url - 열 URL
     * @param {boolean} active - true: 포커스, false: 백그라운드 (기본값: false)
     * @returns {object} 열린 탭 객체
     */
    function openTabInBackground(url, active = false) {
        if (typeof GM_openInTab === 'undefined') {
            console.warn('[Tab] GM_openInTab not available, using window.open');
            return window.open(url, '_blank');
        }

        // GM_openInTab 옵션
        // active: false = 백그라운드, true = 포커스
        // insert: true = 현재 탭 옆에 열림
        // setParent: true = 부모 탭으로 설정
        const tab = GM_openInTab(url, {
            active: active,
            insert: true,
            setParent: true
        });

        console.log(`[Tab] ${active ? '포커스' : '백그라운드'}로 탭 열림: ${url}`);
        return tab;
    }

    /**
     * 열린 탭 닫기
     * @param {object|array} tabs - 닫을 탭 객체 또는 탭 배열
     * @returns {number} 닫힌 탭 개수
     */
    function closeTab(tabs) {
        if (!tabs) {
            console.warn('[Tab] 닫을 탭이 없습니다');
            return 0;
        }

        // 배열이 아니면 배열로 변환
        const tabArray = Array.isArray(tabs) ? tabs : [tabs];
        let closedCount = 0;

        tabArray.forEach((tab, index) => {
            try {
                if (tab && typeof tab.close === 'function') {
                    tab.close();
                    closedCount++;
                    console.log(`[Tab] 탭 ${index + 1} 닫힘`);
                } else if (tab && typeof tab === 'object') {
                    console.warn(`[Tab] 탭 ${index + 1}은 close() 메서드가 없습니다`);
                }
            } catch (e) {
                console.error(`[Tab] 탭 ${index + 1} 닫기 실패:`, e.message);
            }
        });

        console.log(`[Tab] 총 ${closedCount}/${tabArray.length}개 탭 닫힘`);
        return closedCount;
    }

    /**
     * 지정된 시간 후 자동으로 탭 닫기
     * @param {object|array} tabs - 닫을 탭 객체 또는 탭 배열
     * @param {number} delayMs - 대기 시간 (밀리초)
     * @returns {Promise<number>} 닫힌 탭 개수
     */
    async function closeTabAfterDelay(tabs, delayMs = 3000) {
        console.log(`[Tab] ${delayMs}ms 후 탭 닫기 예약됨`);
        await delay(delayMs);
        return closeTab(tabs);
    }

    // KST 기준 현재 날짜 확인 (점검 모드용)
    function isMaintenanceMode() {
        if (!CONFIG.maintenanceMode.enabled) {
            return false;
        }

        // KST (UTC+9) 기준 현재 날짜 가져오기
        const now = new Date();
        const kstOffset = 9 * 60; // KST는 UTC+9
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const kstDate = new Date(utc + (kstOffset * 60000));

        const currentDateKST = kstDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const maintenanceStart = CONFIG.maintenanceMode.startDate;

        return currentDateKST >= maintenanceStart;
    }

    function getTodayString() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Check if current time is in reward skip period (KST 00:00 ~ 01:00)
    function isRewardSkipPeriod() {
        const now = new Date();
        const kstOffset = 9 * 60; // KST is UTC+9
        const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        const kstMinutes = (utcMinutes + kstOffset) % (24 * 60);
        const kstHour = Math.floor(kstMinutes / 60);

        // Return true if KST hour is 0 (00:00 ~ 00:59)
        return kstHour === 0;
    }

    // checkDailyRewardsClaimed 함수 제거됨 (퀘스트 리워드 API 제거로 인해)
    // 항상 false 반환하여 커뮤니티 활동 스킵 방지
    async function checkDailyRewardsClaimed(headers) {
        return false;
    }

    function playCompletionSound() {
        try {
            // Create audio context
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            // Connect nodes
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // Configure sound - pleasant completion chime
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
            oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
            oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5

            // Fade out
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            // Play sound
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) {
            console.log('[사운드 재생 실패]', e);
        }
    }

    // ============================================
    // API Functions
    // ============================================
    function apiRequest(url, method, headers, body = null) {
        return new Promise((resolve, reject) => {
            const requestConfig = {
                method: method,
                url: url,
                headers: headers,
                data: body ? JSON.stringify(body) : null,
                onload: function(response) {
                    console.log(`[API Request] ${method} ${url} - Status: ${response.status}`);
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } catch (e) {
                            console.warn('[API Request] Failed to parse JSON response:', e);
                            resolve({ success: true });
                        }
                    } else {
                        console.error(`[API Request] Error response:`, response);
                        reject(new Error(`API Error: ${response.status} ${response.statusText}`));
                    }
                },
                onerror: function(error) {
                    console.error('[API Request] Network error:', error);
                    reject(new Error('Network error'));
                }
            };

            console.log('[API Request] Starting request:', { method, url, hasBody: !!body });
            GM_xmlhttpRequest(requestConfig);
        });
    }

    async function getArticleList(headers, size = 30) {
        const url = `${CONFIG.api.baseUrl}/postie/v2.0/interest/article/list?size=${size}&timestemp=${getTimestamp()}`;
        const response = await apiRequest(url, 'GET', headers);
        return response.value?.list || [];
    }

    async function getCommentList(headers, articleId, size = 10) {
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/comment/list?size=${size}&timestemp=${getTimestamp()}`;
        console.log(`[댓글 목록 조회] articleId: ${articleId}, URL: ${url}`);
        try {
            const response = await apiRequest(url, 'GET', headers);
            console.log(`[댓글 목록 조회] Response:`, response);
            const comments = response.value?.comments || response.value?.list || [];
            console.log(`[댓글 목록 조회] Found ${comments.length} comments`);
            return comments;
        } catch (e) {
            console.error(`[댓글 목록 조회] Error:`, e);
            return [];
        }
    }

    async function likeArticle(headers, articleId) {
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/interaction/LIKE`;
        await apiRequest(url, 'PUT', headers);
    }

    async function likeComment(headers, commentId) {
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/comment/${commentId}/interaction/LIKE`;
        console.log(`[댓글 좋아요] commentId: ${commentId}`);
        console.log(`[댓글 좋아요] URL: ${url}`);
        console.log(`[댓글 좋아요] Headers:`, headers);
        const response = await apiRequest(url, 'PUT', headers);
        console.log(`[댓글 좋아요] Response:`, response);
        return response;
    }

    // Check bulk article like status
    async function checkArticleLikeStatus(headers, articleIds) {
        if (!articleIds || articleIds.length === 0) return {};
        const ids = articleIds.join(',');
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${ids}/interaction/LIKE?timestemp=${getTimestamp()}`;
        const response = await apiRequest(url, 'GET', headers);
        return response.value || {};
    }

    // Check bulk comment like status
    async function checkCommentLikeStatus(headers, commentIds) {
        if (!commentIds || commentIds.length === 0) return {};
        const ids = commentIds.join(',');
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/comment/${ids}/interaction/LIKE?timestemp=${getTimestamp()}`;
        const response = await apiRequest(url, 'GET', headers);
        return response.value || {};
    }

    async function postComment(headers, articleId, content) {
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/comment`;
        const body = {
            article_id: articleId,
            content: `<p>${content}</p>`,
            attached: {
                media_ids: []
            }
        };
        const response = await apiRequest(url, 'POST', headers, body);
        return response.value?.comment_id;
    }

    // 할로윈 이벤트 댓글 (특정 게시글에 "사탕" 댓글 작성)
    async function postHalloweenComment(headers) {
        const halloweenArticleId = '11137068'; // 할로윈 이벤트 게시글 ID
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${halloweenArticleId}/comment`;
        const body = {
            article_id: halloweenArticleId,
            content: '<p>사탕</p>',
            attached: {
                media_ids: []
            }
        };
        const response = await apiRequest(url, 'POST', headers, body);
        return response.value?.comment_id;
    }

    // 할로윈 이벤트 새글 작성 (이미지 포함)
    async function createHalloweenArticle(headers) {
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/article`;
        const body = {
            title: '할로윈',
            content: '<p><img id="imageUploaddefd7c31-eb76-406c-a64d-e95f3d6edb53" src="//d2x8kymwjom7h7.cloudfront.net/live/application_no/96001/default/3f64bd24ebd24946bbfa68c17528cb7e.png" temp-no="20063468" media-no="20063468"></p><p>할로윈</p>',
            attached: {
                media_ids: ['20063468'],
                file_ids: [],
                poll_ids: []
            },
            status: 'PUBLISHED',
            category: null,
            coverage: 'PUBLIC',
            learning_data: true,
            reservation: null,
            tags: ['할로윈', '라운지이벤트']
        };
        console.log(`[할로윈 게시글 작성] URL: ${url}`);
        console.log(`[할로윈 게시글 작성] Body:`, body);
        const response = await apiRequest(url, 'POST', headers, body);
        console.log(`[할로윈 게시글 작성] Response:`, response);

        // 상세한 응답 검증
        if (!response) {
            console.error('[할로윈 게시글 작성] 응답이 없습니다');
            return null;
        }

        if (response.code !== 0) {
            console.error(`[할로윈 게시글 작성] API 오류: code=${response.code}, message=${response.message}`);
            return null;
        }

        if (!response.value) {
            console.error('[할로윈 게시글 작성] response.value가 없습니다');
            return null;
        }

        if (!response.value.article_id) {
            console.error('[할로윈 게시글 작성] response.value.article_id가 없습니다');
            console.error('[할로윈 게시글 작성] response.value 내용:', response.value);
            return null;
        }

        return response.value.article_id;
    }

    async function createArticle(headers, title, content, tags = []) {
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/article`;
        const body = {
            title: title,
            content: `<p>${content}</p>`,
            attached: {
                media_ids: [],
                file_ids: [],
                poll_ids: []
            },
            status: "PUBLISHED",
            category: null,
            coverage: "PUBLIC",
            learning_data: true,
            reservation: null,
            tags: tags.length > 0 ? tags : ["자유주제", "출석체크"]
        };
        console.log(`[게시글 작성] URL: ${url}`);
        console.log(`[게시글 작성] Body:`, body);
        const response = await apiRequest(url, 'POST', headers, body);
        console.log(`[게시글 작성] Response:`, response);
        return response.value?.article_id;
    }

    async function unfollowTag(headers, tagName) {
        const encodedTag = encodeURIComponent(tagName);
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/favorite/TAG/${encodedTag}`;
        await apiRequest(url, 'DELETE', headers);
    }

    async function followTag(headers, tagName) {
        const encodedTag = encodeURIComponent(tagName);
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/favorite/TAG/${encodedTag}`;
        await apiRequest(url, 'PUT', headers);
    }

    // 퀘스트 API 함수들 제거됨 (퀘스트 리워드 API 제거로 인해)
    // getQuestStatus, claimReward, claimMasterReward 함수 제거됨

    // ============================================
    // Daily Missions API Functions
    // ============================================
    async function getDailyMissions(headers) {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.dailyMissions.componentNo}`;

        const missionHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'x-lang': 'ko',
            'x-nation': 'KR',
            'Accept': '*/*',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        console.log(`[데일리 미션 조회] URL: ${url}`);

        try {
            const response = await apiRequest(url, 'GET', missionHeaders);

            if (response && response.code === 0 && response.value) {
                console.log(`[데일리 미션 조회] ✓ 미션 ${response.value.missions?.length || 0}개 조회 완료`);
                return response.value;
            } else {
                console.error(`[데일리 미션 조회] ✗ API 오류:`, response);
                return null;
            }
        } catch (e) {
            console.error(`[데일리 미션 조회] ✗ 실패:`, e.message);
            return null;
        }
    }

    async function receiveMissionReward(headers, missionNo, componentNo) {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;

        const missionHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'x-lang': 'ko',
            'x-nation': 'KR',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        const body = {
            mission_no: missionNo,
            component_no: componentNo
        };

        console.log(`[미션 보상 수령] mission_no: ${missionNo}`);

        try {
            const response = await apiRequest(url, 'POST', missionHeaders, body);

            if (response && response.code === 0 && response.value) {
                const reward = response.value.reward_amount || 0;
                const status = response.value.status;
                console.log(`[미션 보상 수령] ✓ ${response.value.title}: ${reward} FLAKE (${status})`);
                return response.value;
            } else {
                console.error(`[미션 보상 수령] ✗ API 오류:`, response);
                return null;
            }
        } catch (e) {
            console.error(`[미션 보상 수령] ✗ 실패:`, e.message);
            return null;
        }
    }

    async function getRouletteParticipationCount(headers, subEventNo) {
        const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/participationCnt?sub_event_no=${subEventNo}`;
        console.log(`[룰렛 참여 횟수 조회] sub_event_no: ${subEventNo}`);
        console.log(`[룰렛 참여 횟수 조회] URL: ${url}`);

        // Use reward site headers (flake-fe)
        const rewardHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'x-lang': 'ko',
            'x-nation': 'KR',
            'Accept': '*/*',  // GET 요청은 Content-Type 불필요
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        console.log(`[룰렛 참여 횟수 조회] Request Headers:`, {
            'Authorization': headers['Authorization'] ? `Bearer ${headers['Authorization'].substring(0, 20)}...` : 'MISSING',
            'caller-id': rewardHeaders['caller-id'],
            'caller-detail': rewardHeaders['caller-detail'] || 'MISSING',
            'x-lang': rewardHeaders['x-lang'],
            'x-nation': rewardHeaders['x-nation']
        });

        try {
            const response = await apiRequest(url, 'GET', rewardHeaders);

            // Enhanced response logging
            console.log(`[룰렛 참여 횟수 조회] ✅ Response received:`, response);

            if (response && response.value) {
                const maxDraws = CONFIG.roulette.maxDraws; // 최대 룰렛 횟수
                const current = response.value.participation_cnt || 0;
                const remaining = Math.max(0, maxDraws - current);

                console.log(`[룰렛 참여 횟수 조회] ✓ 데이터 구조 정상:`, {
                    participation_cnt: current,
                    max_draws: maxDraws,
                    remaining: remaining,
                    completed: current >= maxDraws
                });
            } else {
                console.error(`[룰렛 참여 횟수 조회] ❌ 응답 구조 비정상:`, {
                    hasResponse: !!response,
                    hasValue: response ? !!response.value : false,
                    responseKeys: response ? Object.keys(response) : [],
                    fullResponse: response
                });
            }

            return response;
        } catch (error) {
            console.error(`[룰렛 참여 횟수 조회] ❌ API 호출 실패:`, {
                error: error.message,
                stack: error.stack,
                url: url,
                subEventNo: subEventNo
            });
            throw error;
        }
    }

    async function executeRouletteDraw(headers, subEventNo) {
        const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/draw/${subEventNo}`;
        console.log(`[룰렛 뽑기 실행] sub_event_no: ${subEventNo}`);
        console.log(`[룰렛 뽑기 실행] URL: ${url}`);

        // Use reward site headers (flake-fe)
        const rewardHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'x-lang': 'ko',
            'x-nation': 'KR',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        const body = { type_no: 1 };

        console.log(`[룰렛 뽑기 실행] Request Headers:`, {
            'Authorization': headers['Authorization'] ? `Bearer ${headers['Authorization'].substring(0, 20)}...` : 'MISSING',
            'caller-id': rewardHeaders['caller-id'],
            'caller-detail': rewardHeaders['caller-detail'] || 'MISSING',
            'x-lang': rewardHeaders['x-lang'],
            'x-nation': rewardHeaders['x-nation']
        });
        console.log(`[룰렛 뽑기 실행] Request Body:`, body);

        try {
            const response = await apiRequest(url, 'POST', rewardHeaders, body);

            // Enhanced response logging
            console.log(`[룰렛 뽑기 실행] ✅ Response received:`, response);

            // Check for API error response
            if (response && response.code !== 0) {
                const errorCode = response.code;
                const errorMessage = response.message || '알 수 없는 오류';

                // Handle specific error codes
                if (errorCode === 7019) {
                    console.warn(`[룰렛 뽑기 실행] ⚠️ 이벤트 기간이 아닙니다:`, {
                        code: errorCode,
                        message: errorMessage
                    });
                } else {
                    console.error(`[룰렛 뽑기 실행] ❌ API 에러 응답:`, {
                        code: errorCode,
                        message: errorMessage
                    });
                }
                return response;
            }

            if (response && response.value && response.value.gift_info) {
                const giftInfo = response.value.gift_info;
                const giftName = giftInfo.gift_name || '알 수 없음';
                const giftPrice = giftInfo.gift_price || 0;
                const giftNo = giftInfo.gift_no || 'N/A';
                const residueFlake = response.value.residue_flake || 0;
                const userDrawCnt = response.value.user_draw_cnt || 0;

                console.log(`[룰렛 뽑기 실행] ✓ 뽑기 결과:`, {
                    gift_name: giftName,
                    gift_price: giftPrice,
                    gift_no: giftNo,
                    residue_flake: residueFlake,
                    user_draw_cnt: userDrawCnt,
                    success: true
                });
            } else {
                console.error(`[룰렛 뽑기 실행] ❌ 응답 구조 비정상:`, {
                    hasResponse: !!response,
                    hasValue: response ? !!response.value : false,
                    responseKeys: response ? Object.keys(response) : [],
                    fullResponse: response
                });
            }

            return response;
        } catch (error) {
            console.error(`[룰렛 뽑기 실행] ❌ API 호출 실패:`, {
                error: error.message,
                stack: error.stack,
                url: url,
                subEventNo: subEventNo,
                body: body
            });
            throw error;
        }
    }

    async function getRouletteExtra(headers, subEventNo) {
        const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/extra?sub_event_no=${subEventNo}`;
        console.log(`[룰렛 EXTRA 조회] sub_event_no: ${subEventNo}, URL: ${url}`);

        // Use reward site headers (flake-fe)
        const rewardHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'x-lang': 'ko',
            'x-nation': 'KR',
            'Accept': '*/*',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        console.log(`[룰렛 EXTRA 조회] Headers:`, rewardHeaders);
        const response = await apiRequest(url, 'GET', rewardHeaders);
        console.log(`[룰렛 EXTRA 조회] Response:`, response);
        return response;
    }

    async function claimRouletteExtra(headers, subEventNo, giftNo, currentCycle) {
        const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/extra/${subEventNo}`;
        console.log(`[룰렛 EXTRA 수령] sub_event_no: ${subEventNo}, gift_no: ${giftNo}, current_cycle: ${currentCycle}`);

        // Use reward site headers (flake-fe)
        const rewardHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'x-lang': 'ko',
            'x-nation': 'KR',
            'Content-Type': 'application/json',
            'Accept': '*/*',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        const body = {
            gift_no: giftNo,
            current_cycle: currentCycle
        };

        const response = await apiRequest(url, 'POST', rewardHeaders, body);
        console.log(`[룰렛 EXTRA 수령] Response:`, response);
        return response;
    }


    async function getDailyShopRewards(headers) {
        const now = new Date();
        const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/${yearMonth}/services/STOVEINDIE`;
        console.log(`[데일리 보상 목록 조회] URL: ${url}`);

        // Use event site headers (event-hub)
        const eventHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'event-hub',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
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

        const response = await apiRequest(url, 'GET', eventHeaders);
        console.log(`[데일리 보상 목록 조회] Response:`, response);
        return response;
    }

    async function getMyProfile(headers) {
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/user/me?timestemp=${getTimestamp()}`;
        console.log(`[내 프로필 조회] URL: ${url}`);

        // Use profile-specific headers (indie-web-my)
        const profileHeaders = {
            ...headers,
            'caller-id': 'indie-web-my',
            'Origin': 'https://profile.onstove.com',
            'Referer': 'https://profile.onstove.com/'
        };
        // Replace X-UUID with caller-detail for profile APIs
        if (profileHeaders['X-UUID']) {
            profileHeaders['caller-detail'] = profileHeaders['X-UUID'];
            delete profileHeaders['X-UUID'];
        }

        const response = await apiRequest(url, 'GET', profileHeaders);
        console.log(`[내 프로필 조회] Response:`, response);
        return response;
    }

    async function getMyArticles(headers, userId, size = 10) {
        const url = `${CONFIG.api.baseUrl}/postie/v1.0/interest/user/${userId}/article/list?user_id=${userId}&sort=LATEST&size=${size}&type=WRITE&timestemp=${getTimestamp()}`;
        console.log(`[내 게시글 조회] URL: ${url}`);

        // Use indie-my headers
        const myHeaders = {
            ...headers,
            'caller-id': 'indie-my',
            'x-lang': 'ko',
            'x-nation': 'KR',
            'x-device-type': 'P01',
            'Origin': 'https://profile.onstove.com',
            'Referer': 'https://profile.onstove.com/'
        };

        const response = await apiRequest(url, 'GET', myHeaders);
        console.log(`[내 게시글 조회] Response:`, response);
        return response;
    }

    async function claimDailyReward(headers, itemNo, rewardType) {
        const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/daily/${rewardType}?item_no=${itemNo}&reward_type=${rewardType}`;
        console.log(`[데일리 보상 수령] item_no: ${itemNo}, reward_type: ${rewardType}`);

        // Use event site headers (event-hub)
        const eventHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'event-hub',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'X-Client-Lang': 'ko',
            'X-Timezone': 'Asia/Seoul',
            'X-Utc-Offset': '540',
            'X-Nation': 'KR',
            'X-Lang': 'ko',
            'X-Device-Type': 'pc',
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://event.onstove.com',
            'Referer': 'https://event.onstove.com/'
        };

        const body = {
            item_no: itemNo,
            reward_type: rewardType
        };

        const response = await apiRequest(url, 'POST', eventHeaders, body);
        console.log(`[데일리 보상 수령] Response:`, response);
        return response;
    }

    // Get Majak (Riichi City) daily shop rewards list
    async function getMajakDailyShopRewards(headers) {
        const now = new Date();
        const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/${yearMonth}/services/RIICHICITY_IND`;
        console.log(`[마작 리워드 목록 조회] URL: ${url}`);

        // Use event site headers (event-hub)
        const eventHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'event-hub',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
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

        const response = await apiRequest(url, 'GET', eventHeaders);
        console.log(`[마작 리워드 목록 조회] Response:`, response);
        return response;
    }

    // Get daily mission status
    async function getDailyMissionStatus(headers, componentNo = 1) {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
        console.log(`[NEW 데일리 미션 조회] component_no: ${componentNo}, URL: ${url}`);

        // Use reward site headers (flake-fe)
        const rewardHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'x-lang': 'ko',
            'x-nation': 'KR',
            'Accept': '*/*',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        console.log(`[NEW 데일리 미션 조회] Request Headers:`, {
            'Authorization': headers['Authorization'] ? `Bearer ${headers['Authorization'].substring(0, 20)}...` : 'MISSING',
            'caller-id': rewardHeaders['caller-id'],
            'caller-detail': rewardHeaders['caller-detail'] || 'MISSING'
        });

        const response = await apiRequest(url, 'GET', rewardHeaders);
        console.log(`[NEW 데일리 미션 조회] Response:`, response);
        return response;
    }

    // Get all daily mission statuses
    async function getAllDailyMissions(headers) {
        const componentNos = [1, 2, 4, 5, 9, 10, 11, 12]; // 모든 component 번호
        console.log(`[전체 미션 조회] ${componentNos.length}개 component 조회 시작`);

        try {
            const results = await Promise.all(
                componentNos.map(no => getDailyMissionStatus(headers, no).catch(err => {
                    console.error(`[전체 미션 조회] Component ${no} 실패:`, err);
                    return null;
                }))
            );

            // Filter out failed requests and add component_no to each result
            const validResults = results
                .map((result, index) => {
                    if (result && result.value) {
                        return {
                            componentNo: componentNos[index],
                            ...result.value
                        };
                    }
                    return null;
                })
                .filter(r => r !== null);

            console.log(`[전체 미션 조회] ${validResults.length}개 성공`);
            return validResults;
        } catch (error) {
            console.error(`[전체 미션 조회] 오류:`, error);
            return [];
        }
    }

    // Participate in a mission (for visit-based missions like "STOVE 메인 방문하기")
    async function participateMission(headers, missionNo, componentNo) {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;

        const rewardHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'x-lang': 'ko',
            'x-nation': 'KR',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Origin': 'https://reward.onstove.com',
            'Referer': 'https://reward.onstove.com/'
        };

        const body = {
            mission_no: missionNo,
            component_no: componentNo
        };

        console.log(`[미션 참여] mission_no: ${missionNo}, component_no: ${componentNo}`);
        const response = await apiRequest(url, 'POST', rewardHeaders, body);

        if (response && response.value) {
            console.log(`[미션 참여] ${response.value.title} - 상태: ${response.value.status}`);
        }

        return response;
    }

    // Check game ownership by game ID
    async function checkGameOwnership(headers, gameId) {
        const url = `${CONFIG.api.baseUrl}/ownership/v1/check_ownership_by_bgameid?game_id=${gameId}`;
        console.log(`[게임 소유권 확인] game_id: ${gameId}`);

        // Use event site headers (event-hub)
        const eventHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'event-hub',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
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

        const response = await apiRequest(url, 'GET', eventHeaders);
        console.log(`[게임 소유권 확인] Response:`, response);
        return response;
    }

    // Claim Daily accumulated reward (5/10/20/25 day milestones)
    // Supports different reward types: INDIE_GAME_COUPON (LIBRARY), FLAKE, INDIE_SALE_COUPON (coupon)
    async function claimDailyAccumulatedReward(headers, itemNo, itemType = 'LIBRARY') {
        // Determine endpoint type based on item type
        let endpointType;
        if (itemType === 'INDIE_GAME_COUPON') {
            endpointType = 'LIBRARY';
        } else if (itemType === 'FLAKE') {
            endpointType = 'flake';
        } else if (itemType === 'INDIE_SALE_COUPON') {
            endpointType = 'coupon';
        } else {
            endpointType = 'LIBRARY'; // fallback
        }

        const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/accumulate/${endpointType}?item_no=${itemNo}`;
        console.log(`[데일리 누적 보상 수령] item_no: ${itemNo}, item_type: ${itemType}, endpoint: ${endpointType}`);

        // Use event site headers (event-hub)
        const eventHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'event-hub',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'X-Client-Lang': 'ko',
            'X-Timezone': 'Asia/Seoul',
            'X-Utc-Offset': '540',
            'X-Nation': 'KR',
            'X-Lang': 'ko',
            'X-Device-Type': 'pc',
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://event.onstove.com',
            'Referer': 'https://event.onstove.com/'
        };

        const body = { item_no: itemNo };

        const response = await apiRequest(url, 'POST', eventHeaders, body);
        console.log(`[데일리 누적 보상 수령] Response:`, response);
        return response;
    }

    // Claim Majak accumulated reward (5/10/15/20 day milestones)
    async function claimMajakAccumulatedReward(headers, itemNo) {
        const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/accumulate/coupon?item_no=${itemNo}`;
        console.log(`[마작 누적 보상 수령] item_no: ${itemNo}`);

        // Use event site headers (event-hub)
        const eventHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'event-hub',
            'caller-detail': headers['X-UUID'] || headers['caller-detail'],
            'X-Client-Lang': 'ko',
            'X-Timezone': 'Asia/Seoul',
            'X-Utc-Offset': '540',
            'X-Nation': 'KR',
            'X-Lang': 'ko',
            'X-Device-Type': 'pc',
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://event.onstove.com',
            'Referer': 'https://event.onstove.com/'
        };

        const body = { item_no: itemNo };

        const response = await apiRequest(url, 'POST', eventHeaders, body);
        console.log(`[마작 누적 보상 수령] Response:`, response);
        return response;
    }

    // ============================================
    // UI Functions
    // ============================================
    function log(message, type = 'info') {
        const logContent = document.getElementById('stove-log-content');
        if (!logContent) return;

        const icons = {
            success: '✓',
            error: '✗',
            info: '⏳',
            warning: '⚠️'
        };

        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6',
            warning: '#f59e0b'
        };

        const entry = document.createElement('div');
        entry.style.color = colors[type];
        entry.style.padding = '4px 0';
        entry.textContent = `${icons[type]} ${message}`;

        logContent.appendChild(entry);

        // Auto-scroll to bottom
        const logSection = document.querySelector('.stove-log-section');
        if (logSection) {
            logSection.scrollTop = logSection.scrollHeight;
        }
    }

    function updateProgress(task, current, total) {
        const element = document.getElementById(`stove-${task}`);
        if (element) {
            element.textContent = `${current}/${total}`;
        }

        // Update overall progress - only community activities (게시글 추천, 댓글 작성, 새글 작성)
        const questTotalTasks = CONFIG.targets.articleLikes + CONFIG.targets.comments + CONFIG.targets.newArticle;
        const questCompletedTasks = state.progress.articleLikes + state.progress.comments + state.progress.newArticle;

        // Additional tasks: roulette, daily shop, majak (3 tasks, count 1 each when completed)
        const additionalCompletedTasks = (state.completed.roulette ? 1 : 0) +
                                        (state.completed.dailyShop ? 1 : 0) +
                                        (state.completed.majak ? 1 : 0);

        const totalTasks = questTotalTasks + 3; // Quest activities + 3 additional tasks
        const completedTasks = questCompletedTasks + additionalCompletedTasks;
        const percentage = Math.round((completedTasks / totalTasks) * 100);

        const progressFill = document.querySelector('.stove-progress-fill');
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }

        const progressText = document.getElementById('stove-progress-text');
        if (progressText) {
            // Hide percentage text when less than 10%
            if (percentage < 10) {
                progressText.style.opacity = '0';
                progressText.textContent = '';
            } else {
                progressText.style.opacity = '1';
                progressText.textContent = `${percentage}%`;
            }
        }
    }

    function setButtonState(running) {
        const btnStart = document.getElementById('stove-btn-start');
        const btnRoulette = document.getElementById('stove-btn-roulette');
        const btnRewardShop = document.getElementById('stove-btn-reward-shop');
        const btnTestTab = document.getElementById('stove-btn-test-tab');

        if (btnStart) {
            btnStart.disabled = running;
            btnStart.style.opacity = running ? '0.5' : '1';
        }
        if (btnRoulette) {
            btnRoulette.disabled = running;
            btnRoulette.style.opacity = running ? '0.5' : '1';
        }
        if (btnRewardShop) {
            btnRewardShop.disabled = running;
            btnRewardShop.style.opacity = running ? '0.5' : '1';
        }
        if (btnTestTab) {
            btnTestTab.disabled = running;
            btnTestTab.style.opacity = running ? '0.5' : '1';
        }
    }

    function extractComments(articles, count) {
        const comments = [];
        for (const article of articles) {
            if (article.comments && article.comments.length > 0) {
                for (const comment of article.comments) {
                    if (comment.comment_id) {
                        comments.push(comment.comment_id);
                        if (comments.length >= count) {
                            return comments;
                        }
                    }
                }
            }
        }
        return comments;
    }

    // ============================================
    // Automation Logic
    // ============================================
    async function runAutomation() {
        if (state.isRunning) {
            log('이미 자동화가 실행 중입니다', 'warning');
            return;
        }

        state.isRunning = true;
        setButtonState(true);

        // Scroll to show progress bar at 30% from top of viewport
        const progressSection = document.querySelector('.stove-progress-section');
        if (progressSection) {
            // Calculate position to place the progress bar at 30% from top
            const rect = progressSection.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const progressHeight = rect.height;
            const offsetTop = window.pageYOffset + rect.top - (viewportHeight * 0.3) + (progressHeight / 2);
            window.scrollTo({ top: offsetTop, behavior: 'smooth' });
        }

        // Reset earnings tracking
        state.earnings = {
            quest: 0,
            roulette: 0,
            rouletteExtra: 0,
            dailyShop: 0,
            majak: 0,
            dailyMissions: 0
        };

        try {
            // Extract headers
            log('🚀 전체 자동화 시작', 'info');
            log('헤더 정보 추출 중...', 'info');
            const headers = extractHeaders();
            log('✓ 헤더 정보 추출 완료', 'success');
            log('📋 헤더 확인:', 'info');
            log(`  - Authorization: ${headers.Authorization ? '✅ 존재' : '❌ 없음'}`, 'info');
            log(`  - X-UUID: ${headers['X-UUID'] || headers['caller-detail'] ? '✅ 존재' : '❌ 없음'}`, 'info');

            // Check if we're in reward skip period
            let skipRewards = isRewardSkipPeriod();
            if (skipRewards) {
                log('', 'info');
                log('⏰ KST 새벽 0시~1시 사이 실행 감지', 'warning');
                log('📌 리워드 관련 작업은 스킵됩니다 (글쓰기, 댓글좋아요, 글좋아요, 태그팔로우)', 'warning');
                log('', 'info');

                // Fill progress bar immediately for skipped tasks
                state.progress.articleLikes = CONFIG.targets.articleLikes;
                state.progress.comments = CONFIG.targets.comments;
                state.progress.newArticle = CONFIG.targets.newArticle;

                // Update progress displays
                updateProgress('article-likes', state.progress.articleLikes, CONFIG.targets.articleLikes);
                updateProgress('comments', state.progress.comments, CONFIG.targets.comments);
                updateProgress('new-article', state.progress.newArticle, CONFIG.targets.newArticle);
            }

            // Check if daily rewards are already claimed
            if (!skipRewards) {
                log('', 'info');
                log('📦 데일리 리워드 수령 상태 확인 중...', 'info');
                const rewardsClaimed = await checkDailyRewardsClaimed(headers);
                log(`✓ 데일리 리워드 수령 상태: ${rewardsClaimed ? '이미 수령됨' : '수령 가능'}`, 'info');
                if (rewardsClaimed) {
                    log('', 'info');
                    log('✅ 데일리 리워드가 이미 모두 수령되었습니다', 'success');
                    log('📌 리워드 관련 작업은 스킵됩니다 (글쓰기, 댓글좋아요, 글좋아요, 태그팔로우)', 'info');
                    log('', 'info');
                    skipRewards = true;

                    // Fill progress bar immediately for skipped tasks
                    state.progress.articleLikes = CONFIG.targets.articleLikes;
                    state.progress.comments = CONFIG.targets.comments;
                    state.progress.newArticle = CONFIG.targets.newArticle;

                    // Update progress displays
                    updateProgress('article-likes', state.progress.articleLikes, CONFIG.targets.articleLikes);
                    updateProgress('comments', state.progress.comments, CONFIG.targets.comments);
                    updateProgress('new-article', state.progress.newArticle, CONFIG.targets.newArticle);
                } else {
                    log('✓ 데일리 리워드 수령 가능 확인', 'success');
                }
            }

            // Get article list first
            log('', 'info'); // Empty line for separation
            log('📰 게시글 목록 가져오는 중...', 'info');
            const articles = await getArticleList(headers, 30);
            log(`✓ 게시글 ${articles.length}개 발견`, 'success');

            if (articles.length === 0) {
                log('❌ 게시글이 없습니다', 'error');
                state.isRunning = false;
                setButtonState(false);
                return;
            }

            log('✅ 게시글 목록 로드 완료, 작업 시작합니다', 'success');

            await delay(CONFIG.delays.betweenActions);

            // Step 0: Comment posting (댓글 작성 5회 - 10초 딜레이 우선 처리)
            let commentPromise = null;
            if (!skipRewards) {
                log('💬 Step 0: 댓글 작성 시작 (10초 딜레이)...', 'info');
                const maxComments = Math.min(CONFIG.targets.comments, articles.length);
                commentPromise = (async () => {
                    for (let i = 0; i < maxComments; i++) {
                        try {
                            const commentId = await postComment(headers, articles[i].article_id, CONFIG.comment);
                            log(`✓ 댓글 작성 완료: ${commentId}`, 'success');

                            state.createdCommentIds.push(commentId);  // Save comment ID
                            state.progress.comments++;
                            updateProgress('comments', state.progress.comments, CONFIG.targets.comments);
                        } catch (e) {
                            log(`✗ 댓글 작성 실패: ${e.message}`, 'error');
                        }

                        if (i < maxComments - 1) {
                            await delay(CONFIG.delays.afterComment);
                        }
                    }
                    log('✓ Step 0 완료: 모든 댓글 작성 완료', 'success');
                })();
            } else {
                log('⏩ 댓글 작성 스�ip (리워드 초기화 대기 중)', 'info');
            }

            // Step 1: Create new article (새글 작성 1회)
            if (!skipRewards) {
                log('', 'info'); // Empty line for separation
                log('✍️ Step 1: 새글 작성 시작...', 'info');

                // Check if already written today
                log('오늘 작성한 글 확인 중...', 'info');
                const writeStatus = await checkArticleWriteStatus(headers);

                if (writeStatus.success && writeStatus.hasWrittenToday) {
                    log(`⏩ 오늘 이미 ${writeStatus.todayCount}개 글 작성 완료, 새글 작성 스킵`, 'info');
                    state.progress.newArticle = CONFIG.targets.newArticle;
                    updateProgress('new-article', state.progress.newArticle, CONFIG.targets.newArticle);
                } else {
                    try {
                        const articleId = await createArticle(headers, '출석', '출석');
                        if (articleId) {
                            state.progress.newArticle++;
                            updateProgress('new-article', state.progress.newArticle, CONFIG.targets.newArticle);
                            log(`✓ Step 1 완료: 새글 작성 완료! 게시글 ID: ${articleId}`, 'success');
                        } else {
                            log('⚠️ 게시글 작성 응답에 article_id가 없습니다', 'warning');
                        }
                    } catch (e) {
                        log(`✗ 새글 작성 실패: ${e.message}`, 'error');
                        log('⚠️ 새글 작성 실패했지만 자동화를 계속 진행합니다', 'warning');
                    }
                }
            } else {
                log('⏩ 새글 작성 스킵 (리워드 초기화 대기 중)', 'info');
            }

            await delay(CONFIG.delays.betweenActions);

            // Step 2: Like articles - skip if in reward period
            if (!skipRewards) {
                log('👍 Step 2: 게시글 추천 시작...', 'info');

            // Collect more candidate articles (3x target to ensure we have enough unliked ones)
            const targetArticleLikes = CONFIG.targets.articleLikes;
            const candidateCount = Math.min(targetArticleLikes * 3, articles.length);
            const candidateArticles = articles.slice(0, candidateCount);
            const candidateArticleIds = candidateArticles.map(a => a.article_id);

            log(`게시글 ${candidateArticleIds.length}개의 좋아요 상태 확인 중...`, 'info');
            const articleLikeStatuses = await checkArticleLikeStatus(headers, candidateArticleIds);

            // Filter articles that haven't been liked yet
            const unlikedArticles = candidateArticles.filter(article =>
                articleLikeStatuses[article.article_id]?.LIKE !== true
            );

            log(`✓ 좋아요 안 누른 게시글 ${unlikedArticles.length}개 발견`, 'success');

            // Select only the target number of articles to like
            const articlesToLike = unlikedArticles.slice(0, targetArticleLikes);

            if (articlesToLike.length < targetArticleLikes) {
                log(`⚠️ 좋아요 가능한 게시글이 ${articlesToLike.length}개만 있습니다 (목표: ${targetArticleLikes}개)`, 'warning');
            }

            // Now like the selected articles
            for (let i = 0; i < articlesToLike.length; i++) {
                const articleId = articlesToLike[i].article_id;

                try {
                    await likeArticle(headers, articleId);
                    state.progress.articleLikes++;
                    updateProgress('article-likes', state.progress.articleLikes, CONFIG.targets.articleLikes);
                    log(`✓ 게시글 ${articleId} 좋아요 완료 (${state.progress.articleLikes}/${targetArticleLikes})`, 'success');
                } catch (e) {
                    log(`✗ 게시글 ${articleId} 좋아요 실패: ${e.message}`, 'error');
                }

                if (i < articlesToLike.length - 1) {
                    await delay(CONFIG.delays.betweenActions);
                }
            }

                // Update progress to target even if we couldn't like all of them
                while (state.progress.articleLikes < targetArticleLikes) {
                    state.progress.articleLikes++;
                    updateProgress('article-likes', state.progress.articleLikes, CONFIG.targets.articleLikes);
                }
                log('✓ Step 2 완료: 게시글 추천 완료', 'success');
            } else {
                log('⏩ 게시글 추천 스킵 (리워드 초기화 대기 중)', 'info');
            }

            await delay(CONFIG.delays.betweenActions);

            // Step 3: Auto-participate in SINGLE missions (visit, game play, etc.)
            if (!skipRewards) {
                log('', 'info'); // Empty line for separation
                log('🎯 Step 3: SINGLE 미션 자동 참여 시작...', 'info');
                await autoParticipateVisitMissions(headers);
            } else {
                log('⏩ SINGLE 미션 스킵 (리워드 초기화 대기 중)', 'info');
            }

            await delay(CONFIG.delays.betweenActions);

            log('✅ 퀘스트 주요 작업 완료!', 'success');
            if (!skipRewards) {
                log('ℹ️ 댓글 작성은 백그라운드에서 계속 진행 중...', 'info');
            }

            // Step 4.5: Execute daily missions (before roulette)
            log('', 'info'); // Empty line for separation
            await executeDailyMissions(headers);

            // Step 4.6: Execute content missions (after daily missions)
            log('', 'info'); // Empty line for separation
            await executeContentMissions(headers);

            // Step 4.7: Execute weekly missions (after content missions)
            log('', 'info'); // Empty line for separation
            await executeWeeklyMissions(headers);

            // Step 4.8: Execute event missions (after weekly missions)
            log('', 'info'); // Empty line for separation
            await executeEventMissions(headers);

            // Step 4.9: Execute banner missions (after event missions)
            log('', 'info'); // Empty line for separation
            await executeBannerMissions(headers);

            // Step 4.10: Execute attendance missions (after banner missions)
            log('', 'info'); // Empty line for separation
            await executeAttendanceMissions(headers);

            // Step 4.11: Execute prize entry (after attendance missions)
            log('', 'info'); // Empty line for separation
            await executePrizeEntry(headers);

            // Step 5: Run roulette automatically (before rewards)
            log('', 'info'); // Empty line for separation
            await runRouletteDraws(headers);

            // Wait for comment posting to complete before claiming rewards
            if (!skipRewards && commentPromise) {
                log('', 'info'); // Empty line for separation
                log('📝 댓글 작성 완료 확인 중...', 'info');
                await commentPromise;
            }

            // 퀘스트 리워드 수령 기능 제거됨 (더 이상 사용하지 않음)

            // Step 7: Claim daily shop rewards
            log('', 'info'); // Empty line for separation
            log('💝 데일리 보상 수령 시작...', 'info');
            await claimDailyShopRewards(headers);

            // Step 8: Claim majak rewards
            log('', 'info'); // Empty line for separation
            log('🀄 마작 리워드 수령 시작...', 'info');
            await claimMajakDailyShopRewards(headers);

            // Step 9: Claim roulette extra rewards
            log('', 'info'); // Empty line for separation
            await claimRouletteExtraRewards(headers);

            // Step 10: Claim daily accumulated rewards
            log('', 'info'); // Empty line for separation
            log('🎁 데일리 누적 보상 수령 시작...', 'info');
            let dailyAccumulatedFlake = 0;
            try {
                const dailyShopData = await getDailyShopRewards(headers);

                if (dailyShopData && dailyShopData.value && dailyShopData.value.accumulated_attendances) {
                    const accumulatedRewards = dailyShopData.value.accumulated_attendances.rewards || [];
                    const totalDays = dailyShopData.value.accumulated_attendances.total_attendance_days || 0;

                    log(`현재 누적 출석일: ${totalDays}일`, 'info');

                    const claimableRewards = accumulatedRewards.filter(reward =>
                        totalDays >= reward.rewardable_days && !reward.is_received
                    );

                    if (claimableRewards.length > 0) {
                        log(`✓ 수령 가능한 누적 보상: ${claimableRewards.length}개`, 'success');

                        for (const reward of claimableRewards) {
                            try {
                                log(`📦 보상 정보: ${reward.item_name} (타입: ${reward.item_type}, item_no: ${reward.item_no}, ${reward.rewardable_days}일)`, 'info');

                                // Check game ownership for INDIE_GAME_COUPON
                                if (reward.item_type === 'INDIE_GAME_COUPON' && reward.game_id) {
                                    const ownershipData = await checkGameOwnership(headers, reward.game_id);
                                    if (ownershipData && ownershipData.value && ownershipData.value.owner_list && ownershipData.value.owner_list.length > 0) {
                                        log(`⚠️ 이미 소유한 게임: ${reward.item_name} - 수령 건너뜀`, 'warning');
                                        continue;
                                    }
                                }

                                const result = await claimDailyAccumulatedReward(headers, reward.item_no, reward.item_type);

                                if (result && result.code === 0) {
                                    if (reward.item_type === 'FLAKE') {
                                        const rewardAmount = reward.flake_amount || 0;
                                        dailyAccumulatedFlake += rewardAmount;
                                        log(`✓ FLAKE 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name} (${rewardAmount.toLocaleString()} FLAKE)`, 'success');
                                    } else {
                                        log(`✓ 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name}`, 'success');
                                    }
                                } else {
                                    const errorCode = result?.code || 'N/A';
                                    const errorMsg = result?.message || result?.msg || 'N/A';
                                    log(`✗ 보상 수령 실패: ${reward.item_name} (응답 코드: ${errorCode}, 메시지: ${errorMsg})`, 'error');
                                }

                                await delay(CONFIG.delays.betweenActions);
                            } catch (e) {
                                log(`✗ 보상 수령 오류 (${reward.item_name}): ${e.message}`, 'error');
                            }
                        }
                    } else {
                        log('수령 가능한 누적 보상이 없습니다', 'info');
                    }
                } else {
                    log('⚠️ 누적 보상 정보를 가져올 수 없습니다', 'warning');
                }
            } catch (e) {
                log(`✗ 데일리 누적 보상 처리 실패: ${e.message}`, 'error');
            }

            // Calculate quest activity earnings (0 if skipped)
            const articleWriteFlake = skipRewards ? 0 : 200; // 글쓰기 1회
            const articleLikeFlake = skipRewards ? 0 : state.progress.articleLikes * 3; // 게시글 좋아요 1회당 3 FLAKE
            const commentFlake = skipRewards ? 0 : state.progress.comments * 30; // 댓글 쓰기 1회당 30 FLAKE
            const questActivityFlake = articleWriteFlake + articleLikeFlake + commentFlake;

            // Calculate and display total earnings (quest 제외됨)
            const totalEarnings = questActivityFlake + state.earnings.roulette +
                                 state.earnings.rouletteExtra + state.earnings.dailyShop + state.earnings.majak +
                                 state.earnings.dailyMissions + state.earnings.contentMissions +
                                 state.earnings.weeklyMissions + state.earnings.eventMissions +
                                 state.earnings.bannerMissions + state.earnings.attendanceMissions +
                                 state.earnings.prizeEntry + dailyAccumulatedFlake;
            const profitSign = totalEarnings >= 0 ? '+' : '';

            log('', 'info'); // Empty line for separation
            log('🎉 전체 자동화 완료!', 'success');
            log('', 'info'); // Empty line for separation
            log('═══════════════════════════════════════', 'info');
            log('💰 최종 FLAKE 수익 요약', 'success');
            log('═══════════════════════════════════════', 'info');
            log(`  ✍️  글쓰기: ${articleWriteFlake} FLAKE (1회)`, 'success');
            log(`  👍 게시글 좋아요: ${articleLikeFlake} FLAKE (${state.progress.articleLikes}회 × 3)`, articleLikeFlake > 0 ? 'success' : 'info');
            log(`  💬 댓글 쓰기: ${commentFlake} FLAKE (${state.progress.comments}회 × 30)`, commentFlake > 0 ? 'success' : 'info');
            // 퀘스트 보상 로그 제거됨 (퀘스트 리워드 API 제거로 인해)
            log(`  📋 데일리 미션: ${state.earnings.dailyMissions} FLAKE`, state.earnings.dailyMissions > 0 ? 'success' : 'info');
            log(`  📰 컨텐츠 미션: ${state.earnings.contentMissions} FLAKE`, state.earnings.contentMissions > 0 ? 'success' : 'info');
            log(`  📅 위클리 미션: ${state.earnings.weeklyMissions} FLAKE`, state.earnings.weeklyMissions > 0 ? 'success' : 'info');
            log(`  🎉 이벤트 미션: ${state.earnings.eventMissions} FLAKE`, state.earnings.eventMissions > 0 ? 'success' : 'info');
            log(`  🎨 배너 미션: ${state.earnings.bannerMissions} FLAKE`, state.earnings.bannerMissions > 0 ? 'success' : 'info');
            log(`  📆 출석 미션: ${state.earnings.attendanceMissions} FLAKE`, state.earnings.attendanceMissions > 0 ? 'success' : 'info');
            const prizeEntrySign = state.earnings.prizeEntry >= 0 ? '+' : '';
            log(`  🎁 경품 응모: ${prizeEntrySign}${state.earnings.prizeEntry} FLAKE (응모비 제외)`, state.earnings.prizeEntry >= 0 ? 'success' : 'warning');
            log(`  🎰 룰렛 순수익: ${profitSign}${state.earnings.roulette} FLAKE`, state.earnings.roulette >= 0 ? 'success' : 'warning');
            log(`  🎁 룰렛 EXTRA: ${state.earnings.rouletteExtra} FLAKE`, state.earnings.rouletteExtra > 0 ? 'success' : 'info');
            log(`  💝 데일리 보상: ${state.earnings.dailyShop} FLAKE`, state.earnings.dailyShop > 0 ? 'success' : 'info');
            log(`  🎁 데일리 누적 보상: ${dailyAccumulatedFlake} FLAKE`, dailyAccumulatedFlake > 0 ? 'success' : 'info');
            log(`  🀄 마작 리워드: ${state.earnings.majak} FLAKE`, state.earnings.majak > 0 ? 'success' : 'info');
            log('───────────────────────────────────────', 'info');
            log(`  📊 총 순수익: ${profitSign}${totalEarnings} FLAKE`, totalEarnings >= 0 ? 'success' : 'warning');
            log('═══════════════════════════════════════', 'info');

            // Play completion sound
            playCompletionSound();

            // Ensure progress bar is at 100%
            state.completed.roulette = true;
            state.completed.dailyShop = true;
            state.completed.majak = true;

            // Force final progress update to 100%
            const progressFill = document.querySelector('.stove-progress-fill');
            if (progressFill) {
                progressFill.style.width = '100%';
            }
            const progressText = document.getElementById('stove-progress-text');
            if (progressText) {
                progressText.style.display = 'block';
                progressText.textContent = '100%';
            }

            // Refresh status
            log('', 'info');
            log('📊 상태 업데이트 중...', 'info');
            await checkAllStatus();
            log('✅ 상태 업데이트 완료!', 'success');

            // Display reward notice if in skip period
            if (skipRewards) {
                const skipReason = isRewardSkipPeriod() ? '새벽 0시~1시 사이' : '이미 수령 완료';
                log('', 'info');
                log('═══════════════════════════════════════', 'warning');
                log('⏰ 데일리 리워드 안내', 'warning');
                log('═══════════════════════════════════════', 'warning');
                if (isRewardSkipPeriod()) {
                    log('데일리 리워드(글쓰기, 댓글좋아요, 글좋아요, 태그팔로우)는', 'warning');
                    log('새벽 1시에 초기화됩니다.', 'warning');
                    log('해당 리워드를 놓칠 수 있으니 참고해주세요!', 'warning');
                } else {
                    log('데일리 리워드가 이미 모두 수령되었습니다.', 'info');
                    log('내일 다시 시도해주세요!', 'info');
                }
                log('═══════════════════════════════════════', 'warning');
            }

            log('', 'info');
            log('🎊 모든 작업이 완료되었습니다!', 'success');

        } catch (error) {
            log(`✗ 오류 발생: ${error.message}`, 'error');
        } finally {
            state.isRunning = false;
            setButtonState(false);
        }
    }

    // Core reward claiming logic (reusable) - with retry mechanism like roulette
    async function claimRewards(headers) {
        log('리워드 확인 중...', 'info');
        let totalFlakeEarned = 0;
        let roundCount = 0;
        const maxRounds = 3; // 최대 3회 시도

        try {
            // Keep checking and claiming until no remaining rewards
            while (true) {
                roundCount++;

                // Show round info
                if (roundCount === 1) {
                    log('퀘스트 리워드 수령 시작...', 'info');
                } else {
                    log(``, 'info'); // Empty line for separation
                    log(`[${roundCount}차] 퀘스트 상태 재확인...`, 'info');
                    await delay(CONFIG.delays.betweenActions * 2);
                }

                // Check quest status
                const questStatus = await getQuestStatus(headers);

                if (!questStatus || !questStatus.value || !questStatus.value.items) {
                    log('⚠️ 퀘스트 상태를 가져올 수 없습니다', 'warning');
                    break;
                }

                const items = questStatus.value.items;
                const questSeq = questStatus.value.quest_seq;
                const overallStatus = questStatus.value.status;

                // Find reward-ready items
                const rewardReadyItems = items.filter(item => item.status === 'REWARD_READY');

                if (roundCount === 1) {
                    log(`✓ 수령 가능한 아이템 리워드: ${rewardReadyItems.length}개`, 'success');
                } else {
                    log(`✓ [${roundCount}차] 남은 아이템 리워드: ${rewardReadyItems.length}개`, rewardReadyItems.length > 0 ? 'warning' : 'success');
                }

                // Check master reward status
                const masterRewardReady = overallStatus === 'REWARD_READY';

                // If no rewards available, we're done
                if (rewardReadyItems.length === 0 && !masterRewardReady) {
                    if (roundCount === 1) {
                        log('수령 가능한 리워드가 없습니다', 'info');
                    } else {
                        log('모든 리워드 수령 완료!', 'success');
                    }
                    break;
                }

                let roundFlakeEarned = 0;
                let roundSuccessCount = 0;

                // Claim item rewards
                for (const item of rewardReadyItems) {
                    try {
                        const result = await claimReward(headers, questSeq, item.item_seq);

                        if (result && result.value) {
                            const title = result.value.title || '알 수 없음';
                            const rewards = result.value.reward_value || [];
                            const flakeReward = rewards.find(r => r.type === 'FLAKE');
                            const flakeAmount = flakeReward ? flakeReward.quantity : 0;
                            roundFlakeEarned += flakeAmount;
                            roundSuccessCount++;

                            log(`✓ 리워드 수령 완료: ${title} (${flakeAmount} FLAKE)`, 'success');
                        }

                        await delay(CONFIG.delays.betweenActions);
                    } catch (e) {
                        log(`✗ 리워드 수령 실패 (item_seq: ${item.item_seq}): ${e.message}`, 'error');
                    }
                }

                // Try to claim master reward
                if (roundCount === 1 || masterRewardReady) {
                    if (roundCount > 1) {
                        log('마스터 리워드 재확인 중...', 'info');
                    } else {
                        log('마스터 리워드 확인 중...', 'info');
                    }

                    try {
                        await delay(CONFIG.delays.betweenActions);
                        const masterResult = await claimMasterReward(headers, questSeq);

                        if (masterResult && masterResult.value) {
                            const title = masterResult.value.title || '알 수 없음';
                            const rewards = masterResult.value.reward_value || [];
                            const flakeReward = rewards.find(r => r.type === 'FLAKE');
                            const flakeAmount = flakeReward ? flakeReward.quantity : 0;
                            roundFlakeEarned += flakeAmount;
                            roundSuccessCount++;

                            log(`🎁 마스터 리워드 수령 완료: ${title} (${flakeAmount} FLAKE)`, 'success');
                        }
                    } catch (e) {
                        // Master reward might not be available, that's okay
                        if (roundCount === 1) {
                            log(`마스터 리워드 없음 또는 이미 수령함`, 'info');
                        }
                    }
                }

                // Update total
                totalFlakeEarned += roundFlakeEarned;

                if (roundCount > 1 && roundSuccessCount > 0) {
                    log(`[${roundCount}차] ${roundSuccessCount}개 리워드 추가 수령 (${roundFlakeEarned} FLAKE)`, 'success');
                }

                // Check if we should continue
                if (roundCount >= maxRounds) {
                    log(`최대 시도 횟수 (${maxRounds}회) 도달`, 'info');
                    break;
                }

                // If nothing was claimed this round, no point in continuing
                if (roundCount > 1 && roundSuccessCount === 0) {
                    log('더 이상 수령할 리워드가 없습니다', 'info');
                    break;
                }
            }

            // Final summary
            if (roundCount > 1) {
                log('', 'info'); // Empty line for separation
                log(`🎁 최종 리워드 결과 (${roundCount}차 실행)`, 'success');
                log(`  📊 총 획득: ${totalFlakeEarned} FLAKE`, 'success');
            }

        } catch (e) {
            log(`✗ 리워드 확인 실패: ${e.message}`, 'error');
        }

        // state.earnings.quest 제거됨 (퀘스트 리워드 API 제거로 인해)
        log('✅ 리워드 수령 완료!', 'success');
        return totalFlakeEarned;
    }

    // Standalone reward claim function (for button)
    async function runRewardClaim() {
        if (state.isRunning) {
            log('⚠️ 이미 실행 중입니다', 'warning');
            return;
        }

        state.isRunning = true;
        setButtonState(true);

        try {
            log('🎁 리워드 수령 시작...', 'info');
            const headers = extractHeaders();
            await claimRewards(headers);
        } catch (error) {
            log(`✗ 오류 발생: ${error.message}`, 'error');
        } finally {
            state.isRunning = false;
            setButtonState(false);
        }
    }

    // Core roulette draws logic (reusable)
    async function runRouletteDraws(headers) {
        if (CONFIG.roulette.enabled) {
            log('룰렛 확인 중...', 'info');
            try {
                let totalRewards = 0;
                let totalSuccessCount = 0;
                let roundCount = 0;

                // Keep checking and drawing until no remaining draws
                while (true) {
                    roundCount++;

                    // Check remaining participation count
                    console.log(`\n[룰렛 실행 루프] ===== Round ${roundCount} 시작 =====`);
                    const participationInfo = await getRouletteParticipationCount(headers, CONFIG.roulette.subEventNo);

                    console.log(`[룰렛 실행 루프] participationInfo 검증:`, {
                        exists: !!participationInfo,
                        hasValue: participationInfo ? !!participationInfo.value : false,
                        type: typeof participationInfo,
                        keys: participationInfo ? Object.keys(participationInfo) : []
                    });

                    if (!participationInfo || !participationInfo.value) {
                        console.error(`[룰렛 실행 루프] ❌ 룰렛 정보 조회 실패 상세:`, {
                            roundCount: roundCount,
                            participationInfoIsNull: participationInfo === null,
                            participationInfoIsUndefined: participationInfo === undefined,
                            participationInfoValue: participationInfo,
                            valueProperty: participationInfo ? participationInfo.value : 'N/A',
                            timestamp: new Date().toISOString()
                        });
                        log('⚠️ 룰렛 정보를 가져올 수 없습니다', 'warning');
                        break;
                    }

                    const maxDraws = CONFIG.roulette.maxDraws; // 최대 룰렛 횟수
                    const current = participationInfo.value.participation_cnt || 0;
                    const remaining = Math.max(0, maxDraws - current);

                    console.log(`[룰렛 실행 루프] ✓ 참여 정보 파싱 성공:`, {
                        max_draws: maxDraws,
                        current: current,
                        remaining: remaining,
                        roundCount: roundCount
                    });

                    if (roundCount === 1) {
                        log(`✓ 룰렛 참여 가능 횟수: ${remaining}/${maxDraws} (현재: ${current})`, 'success');
                    } else {
                        log(`✓ [${roundCount}차] 남은 횟수 재확인: ${remaining}/${maxDraws} (현재: ${current})`, 'info');
                    }

                    // No more draws available (participation_cnt >= 30)
                    if (current >= maxDraws) {
                        if (roundCount === 1) {
                            log('오늘의 룰렛 참여 횟수를 모두 사용했습니다', 'info');
                        } else {
                            log('모든 룰렛 횟수를 소진했습니다', 'success');
                        }
                        break;
                    }

                    // Draw all remaining times
                    log(`룰렛 ${remaining}회 실행 시작...`, 'info');

                    let roundSuccessCount = 0;
                    let shouldStopRoulette = false;  // 룰렛 전체 중단 플래그

                    for (let i = 1; i <= remaining; i++) {
                        let drawSuccess = false;
                        let retryCount = 0;

                        // 재시도 루프
                        while (!drawSuccess && retryCount <= CONFIG.roulette.maxRetries) {
                            try {
                                if (retryCount > 0) {
                                    log(`🔄 룰렛 ${i}/${remaining} 재시도 (${retryCount}/${CONFIG.roulette.maxRetries})...`, 'warning');
                                    await delay(CONFIG.roulette.retryDelay);
                                }

                                const drawResult = await executeRouletteDraw(headers, CONFIG.roulette.subEventNo);

                                // Check for API error codes
                                if (drawResult && drawResult.code !== 0) {
                                    const errorCode = drawResult.code;
                                    const errorMessage = drawResult.message || '알 수 없는 오류';

                                    if (errorCode === 7019) {
                                        log(`⚠️ 룰렛 이벤트 기간이 아닙니다: ${errorMessage}`, 'warning');
                                        // Stop entire roulette process if event period has ended
                                        shouldStopRoulette = true;
                                        break;
                                    } else {
                                        log(`✗ 룰렛 ${i}/${remaining} API 오류 (코드: ${errorCode}): ${errorMessage}`, 'error');
                                        retryCount++;
                                        continue;
                                    }
                                }

                                if (drawResult && drawResult.value) {
                                    const giftPrice = drawResult.value.gift_info?.gift_price || 0;
                                    const giftName = drawResult.value.gift_info?.gift_name || '알 수 없음';
                                    totalRewards += giftPrice;
                                    roundSuccessCount++;
                                    totalSuccessCount++;

                                    log(`✓ 룰렛 ${i}/${remaining} 완료: ${giftName} (${giftPrice} FLAKE)`, 'success');
                                    drawSuccess = true;  // 성공
                                }

                                await delay(CONFIG.delays.betweenActions);
                            } catch (e) {
                                log(`✗ 룰렛 ${i}/${remaining} 실패: ${e.message}`, 'error');
                                retryCount++;

                                if (retryCount > CONFIG.roulette.maxRetries) {
                                    log(`❌ 룰렛 ${i}/${remaining} 최대 재시도 횟수 초과 - 전체 중단`, 'error');
                                    shouldStopRoulette = true;
                                    break;
                                }
                            }
                        }

                        // 전체 룰렛 프로세스 중단
                        if (shouldStopRoulette) {
                            log('🛑 룰렛 프로세스를 중단합니다', 'warning');
                            break;
                        }

                        // 재시도 실패 시에도 중단
                        if (!drawSuccess && retryCount > CONFIG.roulette.maxRetries) {
                            log(`🛑 룰렛 API 호출이 ${CONFIG.roulette.maxRetries}회 연속 실패하여 중단합니다`, 'error');
                            break;
                        }
                    }


                    log(`[${roundCount}차] ${roundSuccessCount}/${remaining} 성공`, 'info');

                    // 룰렛 프로세스 중단 플래그가 설정되면 외부 루프도 종료
                    if (shouldStopRoulette) {
                        break;
                    }

                    // Wait before checking again
                    await delay(CONFIG.delays.betweenActions);
                }

                // Final summary
                if (totalSuccessCount > 0) {
                    const totalCost = totalSuccessCount * CONFIG.roulette.drawCost;
                    const netProfit = totalRewards - totalCost;
                    const profitSign = netProfit >= 0 ? '+' : '';

                    log('', 'info'); // Empty line for separation
                    log(`🎰 최종 룰렛 결과 (${roundCount}차 실행)`, 'success');
                    log(`  🎯 총 실행: ${totalSuccessCount}회 성공`, 'success');
                    log(`  💰 총 획득: ${totalRewards} FLAKE`, 'success');
                    log(`  💸 총 비용: ${totalCost} FLAKE`, 'info');
                    log(`  📊 순수익: ${profitSign}${netProfit} FLAKE`, netProfit >= 0 ? 'success' : 'warning');

                    state.earnings.roulette = netProfit;
                    state.completed.roulette = true;
                    updateProgress(); // Update progress bar
                    return netProfit;
                }
            } catch (e) {
                log(`✗ 룰렛 실행 실패: ${e.message}`, 'error');
            }
        } else {
            log('⚠️ 룰렛 기능이 비활성화되어 있습니다', 'warning');
        }
        state.completed.roulette = true;
        updateProgress(); // Update progress bar
        log('✅ 룰렛 실행 완료!', 'success');
        return 0;
    }

    // ============================================
    // Daily Missions Execution Functions
    // ============================================
    async function executeVisitMission(mission) {
        const { mission_no, title, button_url } = mission;

        try {
            log(`🌐 ${title} 방문 중...`, 'info');

            // 백그라운드로 탭 열기
            const tab = openTabInBackground(button_url, false);

            // 지정된 시간만큼 대기 후 탭 닫기
            await closeTabAfterDelay(tab, CONFIG.dailyMissions.visitDelay);

            log(`✓ ${title} 방문 완료`, 'success');
            return true;
        } catch (e) {
            log(`✗ ${title} 방문 실패: ${e.message}`, 'error');
            return false;
        }
    }

    async function executeDailyMissions(headers) {
        if (!CONFIG.dailyMissions.enabled) {
            log('⏭️ 데일리 미션이 비활성화되어 있습니다', 'info');
            return;
        }

        log('📋 데일리 미션 시작...', 'info');
        let totalEarned = 0;

        try {
            // 1단계: 미션 목록 조회
            const missionData = await getDailyMissions(headers);
            if (!missionData || !missionData.missions) {
                log('✗ 미션 목록 조회 실패', 'error');
                return;
            }

            const missions = missionData.missions;
            log(`📝 총 ${missions.length}개 미션 확인`, 'info');

            // 2단계: 방문 미션 수행 (Mission 1, 2)
            const visitMissions = missions.filter(m =>
                CONFIG.dailyMissions.visitMissions.includes(m.mission_no) &&
                m.status === 'INCOMPLETE'
            );

            if (visitMissions.length > 0) {
                log(`🌐 방문 미션 ${visitMissions.length}개 수행 시작...`, 'info');

                for (const mission of visitMissions) {
                    await executeVisitMission(mission);
                    await delay(CONFIG.delays.betweenActions);
                }

                log('✅ 방문 미션 수행 완료', 'success');

                // 방문 후 상태 갱신을 위해 잠시 대기
                await delay(1000);
            } else {
                log('ℹ️ 수행할 방문 미션이 없습니다', 'info');
            }

            // 3단계: 미션 상태 재조회
            const updatedMissionData = await getDailyMissions(headers);
            if (!updatedMissionData || !updatedMissionData.missions) {
                log('✗ 미션 상태 재조회 실패', 'error');
                return;
            }

            // 4단계: 수령 가능한 미션 보상 수령
            const receivableMissions = updatedMissionData.missions.filter(m =>
                m.status === 'RECEIVABLE' &&
                !CONFIG.dailyMissions.skipMissions.includes(m.mission_no)
            );

            if (receivableMissions.length > 0) {
                log(`🎁 수령 가능한 보상 ${receivableMissions.length}개 발견`, 'info');

                for (const mission of receivableMissions) {
                    const result = await receiveMissionReward(headers, mission.mission_no, CONFIG.dailyMissions.componentNo);

                    if (result && result.reward_amount) {
                        totalEarned += result.reward_amount;
                    }

                    await delay(CONFIG.delays.betweenActions);
                }

                log(`✅ 데일리 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
            } else {
                log('ℹ️ 수령 가능한 보상이 없습니다', 'info');
            }

            // 상태 업데이트
            state.earnings.dailyMissions = totalEarned;
            state.completed.dailyMissions = true;

            // 완료 상태 표시
            const completedCount = updatedMissionData.missions.filter(m => m.status === 'COMPLETE').length;
            const totalCount = updatedMissionData.missions.length;
            log(`📊 미션 진행 상황: ${completedCount}/${totalCount} 완료`, 'info');

        } catch (error) {
            log(`✗ 데일리 미션 오류: ${error.message}`, 'error');
        }

        log('✅ 데일리 미션 처리 완료!', 'success');
    }

    async function executeContentMissions(headers) {
        if (!CONFIG.contentMissions.enabled) {
            log('⏭️ 컨텐츠 미션이 비활성화되어 있습니다', 'info');
            return;
        }

        log('📰 컨텐츠 미션 시작...', 'info');
        let totalEarned = 0;

        try {
            // 1단계: 미션 목록 조회
            const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.contentMissions.componentNo}`;

            const missionHeaders = {
                'Authorization': headers['Authorization'],
                'caller-id': 'flake-fe',
                'caller-detail': headers['X-UUID'] || headers['caller-detail'],
                'x-lang': 'ko',
                'x-nation': 'KR',
                'Accept': '*/*',
                'Origin': 'https://reward.onstove.com',
                'Referer': 'https://reward.onstove.com/'
            };

            const missionData = await apiRequest(url, 'GET', missionHeaders);

            if (!missionData || missionData.code !== 0 || !missionData.value || !missionData.value.missions) {
                log('✗ 컨텐츠 미션 목록 조회 실패', 'error');
                return;
            }

            const missions = missionData.value.missions;
            log(`📝 총 ${missions.length}개 컨텐츠 미션 확인`, 'info');

            // 2단계: INCOMPLETE 미션 방문 처리
            const incompleteMissions = missions.filter(m =>
                m.status === 'INCOMPLETE' && m.url && m.url.trim() !== ''
            );

            if (incompleteMissions.length > 0) {
                log(`🌐 미완료 컨텐츠 미션 ${incompleteMissions.length}개 방문 시작...`, 'info');

                for (const mission of incompleteMissions) {
                    try {
                        log(`  🌐 "${mission.title.substring(0, 30)}..." 방문 중...`, 'info');

                        // 백그라운드로 탭 열기
                        const tab = openTabInBackground(mission.url, false);

                        // 1초 대기 후 탭 닫기
                        await closeTabAfterDelay(tab, 1000);

                        log(`  ✓ "${mission.title.substring(0, 30)}..." 방문 완료`, 'success');
                    } catch (e) {
                        log(`  ✗ "${mission.title.substring(0, 30)}..." 방문 실패: ${e.message}`, 'error');
                    }

                    await delay(CONFIG.delays.betweenActions);
                }

                log('✅ 컨텐츠 미션 방문 완료', 'success');
                await delay(1000); // 상태 반영 대기
            } else {
                log('ℹ️ 방문할 미완료 컨텐츠 미션이 없습니다', 'info');
            }

            // 3단계: 미션 상태 재조회
            const updatedMissionData = await apiRequest(url, 'GET', missionHeaders);
            if (!updatedMissionData || updatedMissionData.code !== 0 || !updatedMissionData.value || !updatedMissionData.value.missions) {
                log('✗ 컨텐츠 미션 상태 재조회 실패', 'error');
                return;
            }

            // 4단계: 수령 가능한 미션 필터링
            const receivableMissions = updatedMissionData.value.missions.filter(m => m.status === 'RECEIVABLE');

            if (receivableMissions.length === 0) {
                log('ℹ️ 수령 가능한 컨텐츠 미션이 없습니다', 'info');
            } else {
                log(`🎁 수령 가능한 컨텐츠 미션 ${receivableMissions.length}개 발견`, 'info');

                // 5단계: 미션 보상 수령
                for (const mission of receivableMissions) {
                    const result = await receiveMissionReward(headers, mission.mission_no, CONFIG.contentMissions.componentNo);

                    if (result && result.reward_amount) {
                        totalEarned += result.reward_amount;
                        log(`  ✓ "${mission.title.substring(0, 30)}...": +${result.reward_amount} FLAKE`, 'success');
                    }

                    await delay(CONFIG.delays.betweenActions);
                }

                log(`✅ 컨텐츠 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
            }

            // 상태 업데이트
            state.earnings.contentMissions = totalEarned;
            state.completed.contentMissions = true;

            // 완료 상태 표시
            const completedCount = updatedMissionData.value.missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED').length;
            const totalCount = updatedMissionData.value.missions.length;
            log(`📊 컨텐츠 미션 진행 상황: ${completedCount}/${totalCount} 완료`, 'info');

        } catch (error) {
            log(`✗ 컨텐츠 미션 오류: ${error.message}`, 'error');
        }

        log('✅ 컨텐츠 미션 처리 완료!', 'success');
    }

    async function executeWeeklyMissions(headers) {
        if (!CONFIG.weeklyMissions.enabled) {
            log('⏭️ 위클리 미션이 비활성화되어 있습니다', 'info');
            return;
        }

        log('📅 위클리 미션 시작...', 'info');
        let totalEarned = 0;

        try {
            // 1단계: 미션 목록 조회
            const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.weeklyMissions.componentNo}`;

            const missionHeaders = {
                'Authorization': headers['Authorization'],
                'caller-id': 'flake-fe',
                'caller-detail': headers['X-UUID'] || headers['caller-detail'],
                'x-lang': 'ko',
                'x-nation': 'KR',
                'Accept': '*/*',
                'Origin': 'https://reward.onstove.com',
                'Referer': 'https://reward.onstove.com/'
            };

            const missionData = await apiRequest(url, 'GET', missionHeaders);

            if (!missionData || missionData.code !== 0 || !missionData.value || !missionData.value.missions) {
                log('✗ 위클리 미션 목록 조회 실패', 'error');
                return;
            }

            const missions = missionData.value.missions;
            log(`📝 총 ${missions.length}개 위클리 미션 확인`, 'info');

            // 2단계: 수령 가능한 미션 필터링 (RECEIVABLE 상태)
            const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

            if (receivableMissions.length === 0) {
                log('ℹ️ 수령 가능한 위클리 미션이 없습니다', 'info');
            } else {
                log(`🎁 수령 가능한 위클리 미션 ${receivableMissions.length}개 발견`, 'info');

                // 3단계: 미션 보상 수령
                for (const mission of receivableMissions) {
                    const result = await receiveMissionReward(headers, mission.mission_no, CONFIG.weeklyMissions.componentNo);

                    if (result && result.reward_amount) {
                        totalEarned += result.reward_amount;
                        log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success');
                    }

                    await delay(CONFIG.delays.betweenActions);
                }

                log(`✅ 위클리 미션 보상 수령 완료: +${totalEarned} FLAKE`, 'success');
            }

            // 상태 업데이트
            state.earnings.weeklyMissions = totalEarned;
            state.completed.weeklyMissions = true;

            // 완료 상태 표시
            const completedCount = missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED').length;
            const totalCount = missions.length;
            log(`📊 위클리 미션 진행 상황: ${completedCount}/${totalCount} 완료`, 'info');

            // 진행 중인 미션 상태 표시
            const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
            if (incompleteMissions.length > 0) {
                log(`ℹ️ 진행 중인 미션:`, 'info');
                for (const mission of incompleteMissions) {
                    const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_total_cnt || 0}`;
                    log(`  📌 ${mission.title}: ${progress}`, 'info');
                }
            }

        } catch (error) {
            log(`✗ 위클리 미션 오류: ${error.message}`, 'error');
        }

        log('✅ 위클리 미션 처리 완료!', 'success');
    }

    /**
     * 이벤트 미션 자동 수령 (component_no=9)
     * - RECEIVABLE 상태인 미션만 바로 수령
     * - INCOMPLETE, COMPLETE 상태는 스킵
     */
    async function executeEventMissions(headers) {
        if (!CONFIG.eventMissions.enabled) {
            log('⏭️ 이벤트 미션이 비활성화되어 있습니다', 'info');
            return;
        }

        log('🎉 이벤트 미션 시작...', 'info');
        let totalEarned = 0;

        try {
            // Step 1: 미션 목록 조회
            const missionHeaders = {
                ...headers,
                'accept': 'application/json',
                'content-type': 'application/json'
            };

            const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.eventMissions.componentNo}`;
            const missionData = await apiRequest(url, 'GET', missionHeaders);

            if (!missionData || !missionData.value || !missionData.value.missions) {
                log('⚠️ 이벤트 미션 데이터를 찾을 수 없습니다', 'warning');
                return;
            }

            const missions = missionData.value.missions;
            log(`📋 이벤트 미션 ${missions.length}개 발견`, 'info');

            // Step 2: RECEIVABLE 상태만 필터링 (INCOMPLETE, COMPLETE 스킵)
            const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

            if (receivableMissions.length === 0) {
                log('ℹ️ 수령 가능한 이벤트 미션이 없습니다', 'info');

                // 진행 중이거나 완료된 미션 표시
                const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
                const completeMissions = missions.filter(m => m.status === 'COMPLETE');

                if (incompleteMissions.length > 0) {
                    log(`  📌 진행 중: ${incompleteMissions.length}개`, 'info');
                }
                if (completeMissions.length > 0) {
                    log(`  ✓ 완료됨: ${completeMissions.length}개`, 'info');
                }
            } else {
                log(`💰 수령 가능한 미션: ${receivableMissions.length}개`, 'info');

                // Step 3: RECEIVABLE 미션 보상 수령
                for (const mission of receivableMissions) {
                    log(`⏳ "${mission.title}" 수령 중... (보상: ${mission.reward_amount} 플레이크)`, 'info');

                    const result = await receiveMissionReward(headers, mission.mission_no, CONFIG.eventMissions.componentNo);

                    if (result && result.reward_amount) {
                        totalEarned += result.reward_amount;
                        log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success');
                    } else {
                        log(`  ✗ "${mission.title}" 수령 실패`, 'error');
                    }

                    // API 부하 방지를 위한 짧은 대기
                    await delay(500);
                }
            }

            // Step 4: 결과 저장
            state.earnings.eventMissions = totalEarned;
            state.completed.eventMissions = true;

            if (totalEarned > 0) {
                log(`✅ 이벤트 미션 ${receivableMissions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, 'success');
            }

        } catch (error) {
            log(`✗ 이벤트 미션 오류: ${error.message}`, 'error');
            console.error('Event missions error details:', error);
        }

        log('✅ 이벤트 미션 처리 완료!', 'success');
    }

    /**
     * 배너 미션 자동 수령 (component_no=12)
     * - button_url을 백그라운드 탭에서 열고 1초 후 닫음
     * - 그 후 mission_no로 수령 API 호출
     */
    async function executeBannerMissions(headers) {
        if (!CONFIG.bannerMissions.enabled) {
            log('⏭️ 배너 미션이 비활성화되어 있습니다', 'info');
            return;
        }

        log('🎨 배너 미션 시작...', 'info');
        let totalEarned = 0;

        try {
            // Step 1: 미션 목록 조회
            const missionHeaders = {
                ...headers,
                'accept': 'application/json',
                'content-type': 'application/json'
            };

            const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.bannerMissions.componentNo}`;
            const missionData = await apiRequest(url, 'GET', missionHeaders);

            if (!missionData || !missionData.value || !missionData.value.missions) {
                log('⚠️ 배너 미션 데이터를 찾을 수 없습니다', 'warning');
                return;
            }

            const missions = missionData.value.missions;
            log(`📋 배너 미션 ${missions.length}개 발견`, 'info');

            if (missions.length === 0) {
                log('ℹ️ 처리할 배너 미션이 없습니다', 'info');
                return;
            }

            // Step 2: 모든 미션의 button_url을 백그라운드 탭에서 열기
            log(`🌐 배너 URL ${missions.length}개 방문 중...`, 'info');
            const tabs = [];

            for (const mission of missions) {
                if (mission.button_url && mission.button_url.trim() !== '') {
                    log(`  ⏳ "${mission.title.replace(/<br>/g, ' ')}" 방문 중...`, 'info');
                    const tab = openTabInBackground(mission.button_url, false);
                    tabs.push({ tab, mission });
                } else {
                    log(`  ⚠️ "${mission.title.replace(/<br>/g, ' ')}" - URL 없음, 스킵`, 'warning');
                }

                // 탭 열기 사이에 짧은 대기 (브라우저 부하 방지)
                await delay(200);
            }

            // Step 3: 설정된 시간만큼 대기 후 모든 탭 닫기
            if (tabs.length > 0) {
                log(`⏳ ${CONFIG.bannerMissions.visitDelay}ms 대기 후 탭 닫기...`, 'info');
                await delay(CONFIG.bannerMissions.visitDelay);

                for (const { tab, mission } of tabs) {
                    await closeTabAfterDelay(tab, 0); // 즉시 닫기
                    log(`  ✓ "${mission.title.replace(/<br>/g, ' ')}" 방문 완료`, 'success');
                }
            }

            // Step 4: 미션 보상 수령
            log(`💰 배너 미션 보상 수령 중...`, 'info');

            for (const mission of missions) {
                log(`⏳ "${mission.title.replace(/<br>/g, ' ')}" 수령 중... (보상: ${mission.reward_amount} 플레이크)`, 'info');

                const result = await receiveMissionReward(headers, mission.mission_no, CONFIG.bannerMissions.componentNo);

                if (result && result.reward_amount) {
                    totalEarned += result.reward_amount;
                    log(`  ✓ "${mission.title.replace(/<br>/g, ' ')}" 수령 완료: +${result.reward_amount} FLAKE`, 'success');
                } else {
                    log(`  ✗ "${mission.title.replace(/<br>/g, ' ')}" 수령 실패`, 'error');
                }

                // API 부하 방지를 위한 짧은 대기
                await delay(500);
            }

            // Step 5: 결과 저장
            state.earnings.bannerMissions = totalEarned;
            state.completed.bannerMissions = true;

            if (totalEarned > 0) {
                log(`✅ 배너 미션 ${missions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, 'success');
            }

        } catch (error) {
            log(`✗ 배너 미션 오류: ${error.message}`, 'error');
            console.error('Banner missions error details:', error);
        }

        log('✅ 배너 미션 처리 완료!', 'success');
    }

    /**
     * 출석 미션 자동 수령 (component_no=10)
     * - RECEIVABLE 상태인 미션만 바로 수령
     * - INCOMPLETE, COMPLETE 상태는 스킵
     */
    async function executeAttendanceMissions(headers) {
        if (!CONFIG.attendanceMissions.enabled) {
            log('⏭️ 출석 미션이 비활성화되어 있습니다', 'info');
            return;
        }

        log('📅 출석 미션 시작...', 'info');
        let totalEarned = 0;

        try {
            // Step 1: 미션 목록 조회
            const missionHeaders = {
                ...headers,
                'accept': 'application/json',
                'content-type': 'application/json'
            };

            const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.attendanceMissions.componentNo}`;
            const missionData = await apiRequest(url, 'GET', missionHeaders);

            if (!missionData || !missionData.value || !missionData.value.missions) {
                log('⚠️ 출석 미션 데이터를 찾을 수 없습니다', 'warning');
                return;
            }

            const missions = missionData.value.missions;
            log(`📋 출석 미션 ${missions.length}개 발견`, 'info');

            // Step 2: RECEIVABLE 상태만 필터링 (INCOMPLETE, COMPLETE 스킵)
            const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

            if (receivableMissions.length === 0) {
                log('ℹ️ 수령 가능한 출석 미션이 없습니다', 'info');

                // 진행 중이거나 완료된 미션 표시
                const incompleteMissions = missions.filter(m => m.status === 'INCOMPLETE');
                const completeMissions = missions.filter(m => m.status === 'COMPLETE');

                if (incompleteMissions.length > 0) {
                    for (const mission of incompleteMissions) {
                        const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_per_cnt || 0}`;
                        log(`  📌 ${mission.title}: ${progress} (목표: ${mission.milestone_total_cnt}회)`, 'info');
                    }
                }
                if (completeMissions.length > 0) {
                    log(`  ✓ 완료됨: ${completeMissions.length}개`, 'info');
                }
            } else {
                log(`💰 수령 가능한 미션: ${receivableMissions.length}개`, 'info');

                // Step 3: RECEIVABLE 미션 보상 수령
                for (const mission of receivableMissions) {
                    log(`⏳ "${mission.title}" 수령 중... (보상: ${mission.reward_amount} 플레이크)`, 'info');

                    const result = await receiveMissionReward(headers, mission.mission_no, CONFIG.attendanceMissions.componentNo);

                    if (result && result.reward_amount) {
                        totalEarned += result.reward_amount;
                        log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success');
                    } else {
                        log(`  ✗ "${mission.title}" 수령 실패`, 'error');
                    }

                    // API 부하 방지를 위한 짧은 대기
                    await delay(500);
                }
            }

            // Step 4: 결과 저장
            state.earnings.attendanceMissions = totalEarned;
            state.completed.attendanceMissions = true;

            if (totalEarned > 0) {
                log(`✅ 출석 미션 ${receivableMissions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, 'success');
            }

        } catch (error) {
            log(`✗ 출석 미션 오류: ${error.message}`, 'error');
            console.error('Attendance missions error details:', error);
        }

        log('✅ 출석 미션 처리 완료!', 'success');
    }

    /**
     * 경품 응모 자동화 (mission_no=8)
     * - KST 날짜 기준으로 하루 한 번만 실행
     * - sessionStorage에 날짜 기록하여 중복 방지
     * - 응모 후 RECEIVABLE 상태면 보상 수령
     */
    async function executePrizeEntry(headers) {
        if (!CONFIG.prizeEntry.enabled) {
            log('⏭️ 경품 응모가 비활성화되어 있습니다', 'info');
            return;
        }

        log('🎁 경품 응모 시작...', 'info');
        let netEarnings = 0; // Net profit (reward - cost)

        try {
            // Step 1: Check if already entered today (KST timezone)
            const today = getKSTDate();
            const lastEntryDate = sessionStorage.getItem('prize_entry_last_date');

            if (lastEntryDate === today) {
                log('ℹ️ 오늘 이미 경품 응모를 완료했습니다', 'info');
                log(`  📅 마지막 응모 날짜: ${lastEntryDate} (KST)`, 'info');
                state.completed.prizeEntry = true;
                return;
            }

            // Step 2: Apply for prize (costs 500 FLAKE)
            log(`⏳ 경품 응모 진행 중... (비용: ${CONFIG.prizeEntry.flakeCost} FLAKE)`, 'info');

            const applyHeaders = {
                ...headers,
                'accept': 'application/json',
                'content-type': 'application/json',
                'caller-id': 'flake-fe'
            };

            const applyUrl = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/apply/${CONFIG.prizeEntry.eventNo}`;
            const applyBody = {
                gift_no: CONFIG.prizeEntry.giftNo,
                req_cnt: 1
            };

            const applyResult = await apiRequest(applyUrl, 'POST', applyHeaders, applyBody);

            if (!applyResult || applyResult.code !== 0) {
                log(`✗ 경품 응모 실패: ${applyResult?.message || '알 수 없는 오류'}`, 'error');
                return;
            }

            log(`  ✓ 경품 응모 완료! (응모 번호: ${applyResult.value.user_apply_cnt})`, 'success');
            log(`  💰 잔여 FLAKE: ${applyResult.value.residue_flake}`, 'info');
            netEarnings -= CONFIG.prizeEntry.flakeCost; // Deduct cost

            // Step 3: Save today's date to sessionStorage
            sessionStorage.setItem('prize_entry_last_date', today);
            log(`  📅 응모 날짜 기록: ${today} (KST)`, 'info');

            // Step 4: Claim mission reward if RECEIVABLE
            log(`⏳ 경품 응모 미션 보상 확인 중...`, 'info');

            const result = await receiveMissionReward(headers, CONFIG.prizeEntry.missionNo, CONFIG.dailyMissions.componentNo);

            if (result && result.reward_amount) {
                netEarnings += result.reward_amount;
                log(`  ✓ 미션 보상 수령 완료: +${result.reward_amount} FLAKE`, 'success');
            } else {
                log(`  ℹ️ 미션 보상이 아직 수령 가능하지 않습니다`, 'info');
            }

            // Step 5: Save results
            state.earnings.prizeEntry = netEarnings;
            state.completed.prizeEntry = true;

            const profitSign = netEarnings >= 0 ? '+' : '';
            if (netEarnings !== 0) {
                log(`✅ 경품 응모 완료! 순수익: ${profitSign}${netEarnings} FLAKE (응모비 ${CONFIG.prizeEntry.flakeCost} 제외)`, netEarnings >= 0 ? 'success' : 'info');
            } else {
                log(`✅ 경품 응모 완료! 미션 보상은 추후 수령 가능`, 'info');
            }

        } catch (error) {
            log(`✗ 경품 응모 오류: ${error.message}`, 'error');
            console.error('Prize entry error details:', error);
        }

        log('✅ 경품 응모 처리 완료!', 'success');
    }

    // Standalone roulette function (for button)
    async function runRoulette() {
        if (state.isRunning) {
            log('⚠️ 이미 실행 중입니다', 'warning');
            return;
        }

        state.isRunning = true;
        setButtonState(true);

        try {
            log('🎰 룰렛 실행 시작...', 'info');
            const headers = extractHeaders();
            await runRouletteDraws(headers);
        } catch (error) {
            log(`✗ 오류 발생: ${error.message}`, 'error');
        } finally {
            state.isRunning = false;
            setButtonState(false);
        }
    }


    // Core daily shop reward claim logic (reusable)
    async function claimDailyShopRewards(headers) {
        log('데일리 보상 확인 중...', 'info');
        let dailyFlakeEarned = 0;

        try {
            const dailyShopData = await getDailyShopRewards(headers);

            if (dailyShopData && dailyShopData.value && dailyShopData.value.daily_attendances) {
                const rewards = dailyShopData.value.daily_attendances.rewards || [];

                // Get today's date in YYYY-MM-DD format
                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const day = String(today.getDate()).padStart(2, '0');
                const todayString = `${year}-${month}-${day}`;

                log(`오늘 날짜: ${todayString}`, 'info');

                // Filter: today's date + unclaimed (all reward types)
                const unclaimedRewards = rewards.filter(reward => {
                    const isToday = reward.attendance_date === todayString;
                    const isUnclaimed = !reward.is_received;

                    return isToday && isUnclaimed;
                });

                log(`✓ 오늘 수령 가능한 보상: ${unclaimedRewards.length}개`, 'success');

                if (unclaimedRewards.length === 0) {
                    log('오늘 수령 가능한 데일리 보상이 없습니다', 'info');
                    return dailyFlakeEarned;
                }

                let successCount = 0;

                // Claim each unclaimed reward
                for (const reward of unclaimedRewards) {

                    try {
                        // Determine reward type: flake, indie_sale_coupon, or coupon
                        let rewardType;
                        if (reward.item_type === 'FLAKE') {
                            rewardType = 'flake';
                        } else if (reward.item_type === 'INDIE_SALE_COUPON') {
                            rewardType = 'indie_sale_coupon';
                        } else {
                            rewardType = 'coupon';  // INDIE_GAME_COUPON 등 기타 쿠폰
                        }
                        const result = await claimDailyReward(headers, reward.item_no, rewardType);

                        if (result && result.code === 0) {
                            const rewardAmount = reward.flake_amount || 0;
                            const rewardName = reward.item_name || reward.item_type;
                            dailyFlakeEarned += rewardAmount;
                            successCount++;
                            log(`✓ 보상 수령 완료: ${rewardName} (${rewardAmount} FLAKE) (출석일: ${reward.attendance_date})`, 'success');
                        } else {
                            log(`✗ 보상 수령 실패 (item_no: ${reward.item_no})`, 'error');
                        }

                        await delay(CONFIG.delays.betweenActions);
                    } catch (e) {
                        log(`✗ 보상 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, 'error');
                    }
                }

                if (successCount > 0) {
                    log(`💰 총 ${successCount}개 보상 수령 완료: ${dailyFlakeEarned} FLAKE`, 'success');
                }
            } else {
                log('⚠️ 데일리 보상 정보를 가져올 수 없습니다', 'warning');
            }
        } catch (e) {
            log(`✗ 데일리 보상 확인 실패: ${e.message}`, 'error');
        }

        state.earnings.dailyShop = dailyFlakeEarned;
        state.completed.dailyShop = true;
        updateProgress(); // Update progress bar
        log('✅ 데일리 보상 처리 완료!', 'success');
        return dailyFlakeEarned;
    }

    // Core Majak daily shop reward claim logic (reusable)
    async function claimMajakDailyShopRewards(headers) {
        log('마작 리워드 확인 중...', 'info');
        let majakFlakeEarned = 0;

        try {
            let majakShopData = await getMajakDailyShopRewards(headers);

            if (majakShopData && majakShopData.value) {
                // ========== 일일 출석 보상 처리 (기존 로직) ==========
                if (majakShopData.value.daily_attendances) {
                    const rewards = majakShopData.value.daily_attendances.rewards || [];

                    // Get today's date in YYYY-MM-DD format
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = String(today.getMonth() + 1).padStart(2, '0');
                    const day = String(today.getDate()).padStart(2, '0');
                    const todayString = `${year}-${month}-${day}`;

                    log(`오늘 날짜: ${todayString}`, 'info');

                    // Filter: today's date + unclaimed (all reward types)
                    const unclaimedRewards = rewards.filter(reward => {
                        const isToday = reward.attendance_date === todayString;
                        const isUnclaimed = !reward.is_received;

                        return isToday && isUnclaimed;
                    });

                    log(`✓ 오늘 수령 가능한 마작 리워드: ${unclaimedRewards.length}개`, 'success');

                    if (unclaimedRewards.length > 0) {
                        let successCount = 0;

                        // Claim each unclaimed reward
                        for (const reward of unclaimedRewards) {
                            try {
                                // Determine reward type: flake, indie_sale_coupon, or coupon
                                let rewardType;
                                if (reward.item_type === 'FLAKE') {
                                    rewardType = 'flake';
                                } else if (reward.item_type === 'INDIE_SALE_COUPON') {
                                    rewardType = 'indie_sale_coupon';
                                } else {
                                    rewardType = 'coupon';  // INDIE_GAME_COUPON 등 기타 쿠폰
                                }
                                const result = await claimDailyReward(headers, reward.item_no, rewardType);

                                if (result && result.code === 0) {
                                    const rewardAmount = reward.flake_amount || 0;
                                    const rewardName = reward.item_name || reward.item_type;
                                    majakFlakeEarned += rewardAmount;
                                    successCount++;
                                    log(`✓ 마작 리워드 수령 완료: ${rewardName} (${rewardAmount} FLAKE) (출석일: ${reward.attendance_date})`, 'success');
                                } else {
                                    log(`✗ 마작 리워드 수령 실패 (item_no: ${reward.item_no})`, 'error');
                                }

                                await delay(CONFIG.delays.betweenActions);
                            } catch (e) {
                                log(`✗ 마작 리워드 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, 'error');
                            }
                        }

                        if (successCount > 0) {
                            log(`🀄 총 ${successCount}개 마작 일일 리워드 수령 완료`, 'success');

                            // Re-fetch majak shop data after claiming daily rewards
                            // because attendance days may have increased
                            log('', 'info');
                            log('📋 일일 리워드 수령 후 누적 출석 정보 재조회 중...', 'info');
                            majakShopData = await getMajakDailyShopRewards(headers);

                            if (!majakShopData || !majakShopData.value) {
                                log('⚠️ 누적 출석 정보 재조회 실패', 'warning');
                            }
                        }
                    } else {
                        log('오늘 수령 가능한 마작 일일 리워드가 없습니다', 'info');
                    }
                }

                // ========== 누적 출석 보상 처리 (신규 로직) ==========
                if (majakShopData && majakShopData.value && majakShopData.value.accumulated_attendances) {
                    const accumulatedRewards = majakShopData.value.accumulated_attendances.rewards || [];
                    const totalDays = majakShopData.value.accumulated_attendances.total_attendance_days || 0;

                    log('', 'info'); // Empty line for separation
                    log(`현재 누적 출석일: ${totalDays}일`, 'info');

                    // 수령 가능한 누적 보상 필터링 (출석일 달성 + 미수령)
                    const claimableAccumulated = accumulatedRewards.filter(reward =>
                        totalDays >= reward.rewardable_days && !reward.is_received
                    );

                    if (claimableAccumulated.length > 0) {
                        log(`✓ 수령 가능한 누적 보상: ${claimableAccumulated.length}개`, 'success');

                        let accumulatedSuccessCount = 0;

                        for (const reward of claimableAccumulated) {
                            try {
                                const result = await claimMajakAccumulatedReward(headers, reward.item_no);

                                if (result && result.code === 0) {
                                    const rewardAmount = reward.flake_amount || 0;
                                    majakFlakeEarned += rewardAmount;
                                    accumulatedSuccessCount++;

                                    // 보상 타입별 로그 메시지
                                    if (reward.item_type === 'FLAKE') {
                                        log(`✓ 마작 누적 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name} (${rewardAmount} FLAKE)`, 'success');
                                    } else {
                                        log(`✓ 마작 누적 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name}`, 'success');
                                    }
                                } else {
                                    const errorCode = result?.code || 'N/A';
                                    const errorMsg = result?.message || result?.msg || 'N/A';
                                    log(`✗ 마작 누적 보상 수령 실패 (item_no: ${reward.item_no}, 응답 코드: ${errorCode}, 메시지: ${errorMsg})`, 'error');
                                }

                                await delay(CONFIG.delays.betweenActions);
                            } catch (e) {
                                log(`✗ 마작 누적 보상 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, 'error');
                            }
                        }

                        if (accumulatedSuccessCount > 0) {
                            log(`🎁 총 ${accumulatedSuccessCount}개 마작 누적 보상 수령 완료`, 'success');
                        }
                    } else {
                        log('수령 가능한 마작 누적 보상이 없습니다', 'info');
                    }
                }
            } else {
                log('⚠️ 마작 리워드 정보를 가져올 수 없습니다', 'warning');
            }
        } catch (e) {
            log(`✗ 마작 리워드 확인 실패: ${e.message}`, 'error');
        }

        state.earnings.majak = majakFlakeEarned;
        state.completed.majak = true;
        updateProgress(); // Update progress bar
        log('✅ 마작 리워드 처리 완료!', 'success');
        return majakFlakeEarned;
    }

    // Core roulette extra rewards claim logic (reusable)
    async function claimRouletteExtraRewards(headers) {
        log('룰렛 EXTRA 확인 중...', 'info');
        let extraFlakeEarned = 0;

        try {
            const extraData = await getRouletteExtra(headers, CONFIG.roulette.extraSubEventNo);
            console.log('[룰렛 EXTRA] API Response:', extraData);

            if (!extraData) {
                log('⚠️ 룰렛 EXTRA API 응답이 없습니다', 'warning');
                console.error('[룰렛 EXTRA] No response from API');
                return extraFlakeEarned;
            }

            if (extraData.code !== 0) {
                log(`⚠️ 룰렛 EXTRA API 오류: ${extraData.message || 'Unknown error'}`, 'warning');
                console.error('[룰렛 EXTRA] API error code:', extraData.code, 'message:', extraData.message);
                return extraFlakeEarned;
            }

            if (extraData && extraData.value && extraData.value.milestones) {
                const currentCnt = extraData.value.current_cnt || 0;
                const currentCycle = extraData.value.current_cycle || 0;
                const milestones = extraData.value.milestones || [];

                log(`현재 카운트: ${currentCnt}`, 'info');
                log(`총 마일스톤: ${milestones.length}개`, 'info');

                // Filter claimable milestones (current_cnt >= milestone AND received_yn = false)
                const claimableMilestones = milestones.filter(m =>
                    currentCnt >= m.milestone && m.received_yn === false
                );

                if (claimableMilestones.length === 0) {
                    log('수령 가능한 룰렛 EXTRA가 없습니다', 'info');
                    return extraFlakeEarned;
                }

                log(`✓ 수령 가능한 EXTRA: ${claimableMilestones.length}개`, 'success');

                // Claim each milestone
                for (const milestone of claimableMilestones) {
                    try {
                        const result = await claimRouletteExtra(
                            headers,
                            CONFIG.roulette.extraSubEventNo,
                            milestone.gift_no,
                            currentCycle
                        );

                        if (result && result.code === 0) {
                            // Extract FLAKE amount from gift_name (e.g., "2,000 플레이크" -> 2000)
                            const giftName = milestone.gift_name || '';
                            const flakeMatch = giftName.match(/([0-9,]+)\s*플레이크/);
                            const flakeAmount = flakeMatch ? parseInt(flakeMatch[1].replace(/,/g, '')) : 0;

                            extraFlakeEarned += flakeAmount;
                            log(`✓ EXTRA 수령 완료: ${milestone.gift_name} (${flakeAmount} FLAKE)`, 'success');

                            // Check updated gift_price from response
                            if (result.value && result.value.gift_price) {
                                log(`  💰 누적 EXTRA 보상: ${result.value.gift_price.toLocaleString()} FLAKE`, 'info');
                            }
                        } else {
                            log(`✗ EXTRA 수령 실패 (milestone_no: ${milestone.milestone_no})`, 'error');
                            console.error('[룰렛 EXTRA] Claim failed:', result);
                        }

                        await delay(CONFIG.delays.betweenActions);
                    } catch (e) {
                        log(`✗ EXTRA 수령 오류 (milestone_no: ${milestone.milestone_no}): ${e.message}`, 'error');
                        console.error('[룰렛 EXTRA] Claim error:', e);
                    }
                }

                if (extraFlakeEarned > 0) {
                    log(`💰 총 EXTRA 수령: ${extraFlakeEarned} FLAKE`, 'success');
                }
            } else {
                log('⚠️ 룰렛 EXTRA 정보 구조가 올바르지 않습니다', 'warning');
                console.error('[룰렛 EXTRA] Invalid data structure:', extraData);
            }
        } catch (e) {
            log(`✗ 룰렛 EXTRA 확인 실패: ${e.message}`, 'error');
            console.error('[룰렛 EXTRA] Exception:', e);
        }

        state.earnings.rouletteExtra = extraFlakeEarned;
        log('✅ 룰렛 EXTRA 처리 완료!', 'success');
        return extraFlakeEarned;
    }

    // 리워드샵 방문
    function openRewardShop() {
        log('🏪 리워드샵 페이지를 새 탭에서 엽니다...', 'info');
        try {
            GM_openInTab('https://reward.onstove.com/ko', { active: true, insert: true });
            log('✅ 리워드샵 탭이 열렸습니다!', 'success');
        } catch (error) {
            log(`❌ 탭 열기 실패: ${error.message}`, 'error');
        }
    }

    // 탭 테스트 함수
    function testTabOpening() {
        log('🧪 탭 열기 테스트를 시작합니다...', 'info');
        log(`🔍 GM_openInTab 사용 가능 여부: ${typeof GM_openInTab !== 'undefined' ? '✅ 사용 가능' : '❌ 사용 불가'}`, 'info');

        try {
            log('📂 구글 페이지를 새 탭에서 엽니다...', 'info');
            const tab = GM_openInTab('https://www.google.com', {
                active: true,
                insert: true
            });
            log('✅ 탭 열기 성공!', 'success');
            log(`💡 탭 객체 타입: ${typeof tab}`, 'info');
            log('🎉 GM_openInTab이 정상 작동합니다!', 'success');
        } catch (error) {
            log(`❌ 탭 열기 실패: ${error.message}`, 'error');
        }
    }

    // ============================================
    // Status Check Functions
    // ============================================
    async function checkRouletteStatus(headers) {
        try {
            const participationInfo = await getRouletteParticipationCount(headers, CONFIG.roulette.subEventNo);
            if (participationInfo && participationInfo.value) {
                const maxDraws = CONFIG.roulette.maxDraws; // 최대 룰렛 횟수
                const current = participationInfo.value.participation_cnt || 0;
                const remaining = Math.max(0, maxDraws - current);
                return { success: true, current, limit: maxDraws, remaining };
            }
            return { success: false, error: '데이터 없음' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async function checkDailyShopStatus(headers) {
        try {
            const dailyShopData = await getDailyShopRewards(headers);
            console.log('[데일리 샵 상태 확인]', dailyShopData);

            if (dailyShopData && dailyShopData.value && dailyShopData.value.daily_attendances) {
                const rewards = dailyShopData.value.daily_attendances.rewards || [];
                const todayString = getTodayString();

                console.log(`[데일리 샵] 오늘 날짜: ${todayString}`);
                console.log(`[데일리 샵] 총 보상 개수: ${rewards.length}개`);
                console.log('[데일리 샵] 보상 목록:', rewards.map(r => ({ date: r.attendance_date, received: r.is_received })));

                // 오늘 날짜의 보상 찾기 (모든 타입 포함)
                const todayReward = rewards.find(reward =>
                    reward.attendance_date === todayString
                );

                if (todayReward) {
                    // 보상을 받았으면 완료, 받지 않았으면 미수령
                    const received = todayReward.is_received;
                    console.log(`[데일리 샵] 오늘 보상 찾음: received=${received}`);
                    return {
                        success: true,
                        received,
                        notReceived: !received
                    };
                } else {
                    // 오늘 보상이 없음
                    console.log('[데일리 샵] ⚠️ 오늘 날짜에 해당하는 보상이 없습니다');
                    return { success: true, received: false, notReceived: false, noRewardToday: true };
                }
            }
            console.log('[데일리 샵] ❌ API 응답 구조 오류');
            return { success: false, error: '데이터 없음' };
        } catch (e) {
            console.error('[데일리 샵] ❌ 오류:', e);
            return { success: false, error: e.message };
        }
    }

    async function checkMajakShopStatus(headers) {
        try {
            const majakShopData = await getMajakDailyShopRewards(headers);
            console.log('[마작 샵 상태 확인]', majakShopData);

            if (majakShopData && majakShopData.value && majakShopData.value.daily_attendances) {
                const rewards = majakShopData.value.daily_attendances.rewards || [];
                const todayString = getTodayString();

                console.log(`[마작 샵] 오늘 날짜: ${todayString}`);
                console.log(`[마작 샵] 총 보상 개수: ${rewards.length}개`);
                console.log('[마작 샵] 보상 목록:', rewards.map(r => ({ date: r.attendance_date, received: r.is_received })));

                // 오늘 날짜의 보상 찾기 (모든 타입 포함)
                const todayReward = rewards.find(reward =>
                    reward.attendance_date === todayString
                );

                if (todayReward) {
                    // 보상을 받았으면 완료, 받지 않았으면 미수령
                    const received = todayReward.is_received;
                    console.log(`[마작 샵] 오늘 보상 찾음: received=${received}`);
                    return {
                        success: true,
                        received,
                        notReceived: !received
                    };
                } else {
                    // 오늘 보상이 없음
                    console.log('[마작 샵] ⚠️ 오늘 날짜에 해당하는 보상이 없습니다');
                    return { success: true, received: false, notReceived: false, noRewardToday: true };
                }
            }
            console.log('[마작 샵] ❌ API 응답 구조 오류');
            return { success: false, error: '데이터 없음' };
        } catch (e) {
            console.error('[마작 샵] ❌ 오류:', e);
            return { success: false, error: e.message };
        }
    }

    // checkQuestRewardStatus 함수 제거됨 (퀘스트 리워드 API 제거로 인해)

    async function checkDailyMissionStatus(headers) {
        try {
            const allMissions = await getAllDailyMissions(headers);
            if (!allMissions || allMissions.length === 0) {
                return { success: false, error: '데이터 없음' };
            }

            // Categorize missions by component type
            const categories = {
                daily: { components: [], missions: [] },      // SINGLE
                weekly: { components: [], missions: [] },     // ACCUMULATION (위클리)
                achievement: { components: [], missions: [] }, // ACHIEVEMENT
                content: { components: [], missions: [] },    // CONTENT1
                attendance: { components: [], missions: [] }  // 출석 관련
            };

            // Group by category
            allMissions.forEach(comp => {
                const type = comp.component_info.component_type;
                const title = comp.component_info.title;
                const missions = comp.missions || [];

                if (type === 'SINGLE') {
                    categories.daily.components.push(comp.component_info);
                    categories.daily.missions.push(...missions);
                } else if (type === 'ACCUMULATION') {
                    if (title.includes('출석')) {
                        categories.attendance.components.push(comp.component_info);
                        categories.attendance.missions.push(...missions);
                    } else {
                        categories.weekly.components.push(comp.component_info);
                        categories.weekly.missions.push(...missions);
                    }
                } else if (type === 'ACHIEVEMENT') {
                    categories.achievement.components.push(comp.component_info);
                    categories.achievement.missions.push(...missions);
                } else if (type === 'CONTENT1') {
                    categories.content.components.push(comp.component_info);
                    categories.content.missions.push(...missions);
                }
            });

            // Calculate stats for each category
            const result = {};
            Object.keys(categories).forEach(key => {
                const missions = categories[key].missions;
                if (missions.length > 0) {
                    result[key] = {
                        total: missions.length,
                        completed: missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED').length,
                        receivable: missions.filter(m => m.status === 'RECEIVABLE').length,
                        incomplete: missions.filter(m => m.status === 'INCOMPLETE').length,
                        components: categories[key].components,
                        missions: missions
                    };
                }
            });

            return { success: true, categories: result };
        } catch (e) {
            console.error('[데일리 미션 상태 체크 오류]', e);
            return { success: false, error: e.message };
        }
    }

    // Auto-participate in SINGLE type missions (방문형, 게임 플레이 등 SINGLE 미션 자동 참여)
    async function autoParticipateVisitMissions(headers) {
        try {
            log('[SINGLE 미션] 자동 참여 시작', 'info');

            // Get all daily missions
            const allMissions = await getAllDailyMissions(headers);
            if (!allMissions || allMissions.length === 0) {
                log('[SINGLE 미션] 조회된 미션 없음', 'warning');
                return { success: false, participated: 0, completed: 0 };
            }

            // Find SINGLE type missions that are incomplete
            const singleMissions = [];
            allMissions.forEach(comp => {
                const missions = comp.missions || [];
                missions.forEach(mission => {
                    // SINGLE 타입이고 INCOMPLETE 상태인 미션만 필터링
                    if (mission.mission_type === 'SINGLE' && mission.status === 'INCOMPLETE') {
                        singleMissions.push({
                            mission_no: mission.mission_no,
                            component_no: comp.componentNo,
                            title: mission.title,
                            reward_amount: mission.reward_amount,
                            is_visit_mission: mission.is_visit_mission
                        });
                    }
                });
            });

            if (singleMissions.length === 0) {
                log('[SINGLE 미션] 참여 가능한 미션 없음', 'info');
                return { success: true, participated: 0, completed: 0 };
            }

            log(`[SINGLE 미션] ${singleMissions.length}개 발견`, 'info');

            // Participate in each mission
            let participated = 0;
            let completed = 0;
            for (const mission of singleMissions) {
                try {
                    log(`[SINGLE 미션] "${mission.title}" 참여 중... (보상: ${mission.reward_amount} 플레이크)`, 'info');
                    const result = await participateMission(headers, mission.mission_no, mission.component_no);

                    if (result && result.value) {
                        const status = result.value.status;

                        if (status === 'RECEIVABLE') {
                            // 방문형 미션: 참여만 완료, 별도 수령 필요
                            log(`[SINGLE 미션] ✅ "${mission.title}" 참여 완료 (수령 가능)`, 'success');
                            participated++;
                        } else if (status === 'COMPLETE' || status === 'COMPLETED') {
                            // 게임 플레이 등: 즉시 보상 지급
                            const residueFlake = result.value.residue_flake ? ` (잔액: ${result.value.residue_flake})` : '';
                            log(`[SINGLE 미션] 🎁 "${mission.title}" 보상 수령 완료 (+${mission.reward_amount} 플레이크)${residueFlake}`, 'success');
                            completed++;
                        } else {
                            log(`[SINGLE 미션] ⚠️ "${mission.title}" 참여 실패 (상태: ${status})`, 'warning');
                        }
                    } else {
                        log(`[SINGLE 미션] ⚠️ "${mission.title}" 응답 없음`, 'warning');
                    }

                    await delay(1000); // 1초 대기
                } catch (error) {
                    log(`[SINGLE 미션] ❌ "${mission.title}" 오류: ${error.message}`, 'error');
                }
            }

            log(`[SINGLE 미션] 총 참여: ${participated}개, 즉시 완료: ${completed}개 (전체: ${singleMissions.length})`, 'success');
            return { success: true, participated, completed, total: singleMissions.length };

        } catch (error) {
            log(`[SINGLE 미션] 오류: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    async function checkArticleWriteStatus(headers) {
        try {
            // 1. Get my profile to get user_id
            const profileData = await getMyProfile(headers);
            if (!profileData || !profileData.value || !profileData.value.user_id) {
                return { success: false, error: '프로필 정보 없음' };
            }

            const userId = profileData.value.user_id;

            // 2. Get my articles
            const articlesData = await getMyArticles(headers, userId, 10);
            if (!articlesData || !articlesData.value || !articlesData.value.list) {
                return { success: false, error: '게시글 목록 없음' };
            }

            const articles = articlesData.value.list;

            // 3. Check if any article was written today (using local timezone)
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const todayEnd = todayStart + 24 * 60 * 60 * 1000;

            // Debug logging for troubleshooting
            console.log('[오늘 글쓰기 확인]');
            console.log('  현재 시간:', now.toLocaleString('ko-KR'));
            console.log('  오늘 범위:', new Date(todayStart).toLocaleString('ko-KR'), '~', new Date(todayEnd).toLocaleString('ko-KR'));
            console.log('  확인할 게시글 수:', articles.length, '개');

            const todayArticles = articles.filter(article => {
                const articleTime = article.datetime;
                const isToday = articleTime >= todayStart && articleTime < todayEnd;

                console.log(`  - 게시글 ID ${article.article_id}:`, new Date(articleTime).toLocaleString('ko-KR'), isToday ? '✓ 오늘 작성' : '✗ 다른 날');

                return isToday;
            });

            const hasWrittenToday = todayArticles.length > 0;
            console.log(`  → 최종 결과: 오늘 ${todayArticles.length}개 작성`);

            return {
                success: true,
                hasWrittenToday,
                todayCount: todayArticles.length
            };
        } catch (e) {
            console.error('[오늘 글쓰기 확인 오류]', e);
            return { success: false, error: e.message };
        }
    }

    async function checkAllStatus() {
        console.log('[상태 확인 시작]');
        try {
            console.log('[상태 확인] 헤더 추출 중...');
            const headers = extractHeaders();
            console.log('[상태 확인] 헤더 추출 성공');

            // Show loading state
            console.log('[상태 확인] 로딩 상태 표시');
            updateStatusUI({
                articleWrite: { loading: true },
                dailyMission: { loading: true },
                roulette: { loading: true },
                dailyShop: { loading: true },
                majakShop: { loading: true }
            });

            // Fetch all statuses in parallel
            console.log('[상태 확인] API 호출 시작...');
            const [articleWriteStatus, dailyMissionStatus, rouletteStatus, dailyShopStatus, majakShopStatus] = await Promise.all([
                checkArticleWriteStatus(headers),
                checkDailyMissionStatus(headers),
                checkRouletteStatus(headers),
                checkDailyShopStatus(headers),
                checkMajakShopStatus(headers)
            ]);
            console.log('[상태 확인] API 호출 완료');

            // Update UI with results
            console.log('[상태 확인] UI 업데이트 중...');
            updateStatusUI({
                articleWrite: articleWriteStatus,
                dailyMission: dailyMissionStatus,
                roulette: rouletteStatus,
                dailyShop: dailyShopStatus,
                majakShop: majakShopStatus
            });
            console.log('[상태 확인] ✅ 완료');

        } catch (error) {
            console.error('[상태 확인 오류]', error);
            alert(`상태 확인 실패: ${error.message}`);
            updateStatusUI({
                articleWrite: { success: false, error: '확인 실패' },
                dailyMission: { success: false, error: '확인 실패' },
                roulette: { success: false, error: '확인 실패' },
                dailyShop: { success: false, error: '확인 실패' },
                majakShop: { success: false, error: '확인 실패' }
            });
        }
    }

    function updateStatusUI(statusData) {
        // Update article write status
        const articleWriteEl = document.getElementById('stove-status-article');
        if (articleWriteEl && statusData.articleWrite) {
            if (statusData.articleWrite.loading) {
                articleWriteEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
            } else if (statusData.articleWrite.success) {
                const { hasWrittenToday, todayCount } = statusData.articleWrite;

                if (hasWrittenToday) {
                    // 오늘 작성한 게시글 있음
                    articleWriteEl.innerHTML = `<span style="color: #10b981">✅ 오늘 ${todayCount}개 작성</span>`;
                } else {
                    // 오늘 작성한 게시글 없음
                    articleWriteEl.innerHTML = '<span style="color: #f59e0b">✍️ 아직 작성 안 함</span>';
                }
            } else {
                articleWriteEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
            }
        }

        // Update daily mission status by category
        if (statusData.dailyMission) {
            if (statusData.dailyMission.loading) {
                // Show loading for all categories
                ['daily', 'weekly', 'achievement', 'content', 'attendance'].forEach(cat => {
                    const el = document.getElementById(`stove-status-mission-${cat}`);
                    if (el) el.innerHTML = '<span style="color: #3b82f6">⏳</span>';
                });
            } else if (statusData.dailyMission.success && statusData.dailyMission.categories) {
                const categories = statusData.dailyMission.categories;

                // Update each category
                ['daily', 'weekly', 'achievement', 'content', 'attendance'].forEach(catKey => {
                    const el = document.getElementById(`stove-status-mission-${catKey}`);
                    const cat = categories[catKey];

                    if (el) {
                        if (!cat || cat.total === 0) {
                            el.innerHTML = '<span style="color: #6b7280">-</span>';
                            return;
                        }

                        const { completed, receivable, total, missions } = cat;

                        // Status text
                        let statusHTML = '';
                        if (completed === total) {
                            statusHTML = '<span style="color: #10b981">✅ 완료</span>';
                        } else if (receivable > 0) {
                            statusHTML = `<span style="color: #f59e0b">🎁 ${receivable}개</span>`;
                        } else if (completed === 0) {
                            statusHTML = '<span style="color: #6b7280">받을 보상 없음</span>';
                        } else {
                            statusHTML = `<span style="color: #6b7280">${completed}/${total}</span>`;
                        }

                        el.innerHTML = statusHTML;

                        // Create tooltip
                        const parentItem = el.closest('.stove-mission-item');
                        if (parentItem && missions && missions.length > 0) {
                            // Remove existing tooltip
                            const existingTooltip = parentItem.querySelector('.stove-mission-tooltip');
                            if (existingTooltip) existingTooltip.remove();

                            // Create new tooltip
                            const tooltip = document.createElement('div');
                            tooltip.className = 'stove-mission-tooltip';

                            let tooltipHTML = `<div class="stove-mission-tooltip-title">${catKey === 'daily' ? '📅 데일리 미션' :
                                catKey === 'weekly' ? '📆 위클리 미션' :
                                catKey === 'achievement' ? '🏆 업적' :
                                catKey === 'content' ? '💬 컨텐츠' : '📆 출석'}</div>`;

                            missions.forEach(mission => {
                                const statusIcon = (mission.status === 'COMPLETE' || mission.status === 'COMPLETED') ? '✅' :
                                                  mission.status === 'RECEIVABLE' ? '🎁' : '⏳';
                                const statusColor = (mission.status === 'COMPLETE' || mission.status === 'COMPLETED') ? '#10b981' :
                                                   mission.status === 'RECEIVABLE' ? '#f59e0b' : '#6b7280';

                                tooltipHTML += `
                                    <div class="stove-mission-tooltip-item">
                                        <span class="stove-mission-tooltip-name">${mission.title}</span>
                                        <span class="stove-mission-tooltip-status" style="color: ${statusColor}">${statusIcon}</span>
                                    </div>
                                `;
                            });

                            tooltip.innerHTML = tooltipHTML;
                            parentItem.appendChild(tooltip);
                        }
                    }
                });
            } else {
                // Show error for all categories
                ['daily', 'weekly', 'achievement', 'content', 'attendance'].forEach(cat => {
                    const el = document.getElementById(`stove-status-mission-${cat}`);
                    if (el) el.innerHTML = '<span style="color: #ef4444">❌</span>';
                });
            }
        }

        // Update roulette status
        const rouletteEl = document.getElementById('stove-status-roulette');
        if (rouletteEl && statusData.roulette) {
            if (statusData.roulette.loading) {
                rouletteEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
            } else if (statusData.roulette.success) {
                const { current, limit, remaining } = statusData.roulette;
                const color = remaining > 0 ? '#10b981' : '#6b7280';
                rouletteEl.innerHTML = `<span style="color: ${color}">${current}/${limit} (${remaining}회 남음)</span>`;
            } else {
                rouletteEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
            }
        }

        // Update daily shop status
        const dailyShopEl = document.getElementById('stove-status-daily');
        if (dailyShopEl && statusData.dailyShop) {
            if (statusData.dailyShop.loading) {
                dailyShopEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
            } else if (statusData.dailyShop.success) {
                const { received, notReceived, noRewardToday } = statusData.dailyShop;

                if (received) {
                    // 보상 받음 - 완료
                    dailyShopEl.innerHTML = '<span style="color: #10b981">✅ 전부 완료</span>';
                } else if (notReceived) {
                    // 보상 받지 않음 - 미수령
                    dailyShopEl.innerHTML = '<span style="color: #f59e0b">📦 보상 받지 않음</span>';
                } else if (noRewardToday) {
                    // 오늘 보상이 목록에 없음 (콘솔 확인 필요)
                    dailyShopEl.innerHTML = '<span style="color: #9ca3af">⚠️ 오늘 보상 없음</span>';
                } else {
                    // 알 수 없는 상태
                    dailyShopEl.innerHTML = '<span style="color: #6b7280">-</span>';
                }
            } else {
                dailyShopEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
            }
        }

        // Update majak shop status
        const majakShopEl = document.getElementById('stove-status-majak');
        if (majakShopEl && statusData.majakShop) {
            if (statusData.majakShop.loading) {
                majakShopEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
            } else if (statusData.majakShop.success) {
                const { received, notReceived, noRewardToday } = statusData.majakShop;

                if (received) {
                    // 보상 받음 - 완료
                    majakShopEl.innerHTML = '<span style="color: #10b981">✅ 전부 완료</span>';
                } else if (notReceived) {
                    // 보상 받지 않음 - 미수령
                    majakShopEl.innerHTML = '<span style="color: #f59e0b">🀄 보상 받지 않음</span>';
                } else if (noRewardToday) {
                    // 오늘 보상이 목록에 없음 (콘솔 확인 필요)
                    majakShopEl.innerHTML = '<span style="color: #9ca3af">⚠️ 오늘 보상 없음</span>';
                } else {
                    // 알 수 없는 상태
                    majakShopEl.innerHTML = '<span style="color: #6b7280">-</span>';
                }
            } else {
                majakShopEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
            }
        }

        // 퀘스트 리워드 상태 UI 업데이트 제거됨 (퀘스트 리워드 API 제거로 인해)
    }


    // ============================================
    // UI Injection
    // ============================================
    function createUI() {
        // Check if UI already exists
        if (document.getElementById('stove-quest-automation')) {
            return;
        }

        const container = document.createElement('div');
        container.id = 'stove-quest-automation';
        container.innerHTML = `
            <style>
                #stove-quest-automation {
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    border-radius: 12px;
                    padding: 24px;
                    margin: 24px 0;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    color: #e0e0e0;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    width: 100%;
                    box-sizing: border-box;
                }

                .stove-panel-header {
                    font-size: 20px;
                    font-weight: bold;
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    color: #ffffff;
                    border-bottom: 2px solid #2a2a2a;
                    padding-bottom: 12px;
                }

                .stove-panel-title {
                    flex: 1;
                }

                .stove-panel-version {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    font-size: 11px;
                    font-weight: normal;
                    color: #888888;
                    line-height: 1.4;
                    font-family: 'Courier New', monospace;
                }

                .stove-controls {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                    margin-bottom: 20px;
                }

                .stove-btn {
                    background: #2a2a2a;
                    border: 1px solid #3a3a3a;
                    color: #e0e0e0;
                    padding: 10px 20px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                    transition: all 0.2s ease;
                }

                .stove-btn:hover:not(:disabled) {
                    background: #3a3a3a;
                    border-color: #4a4a4a;
                    transform: translateY(-1px);
                }

                .stove-btn:active:not(:disabled) {
                    transform: translateY(0);
                }

                .stove-btn:disabled {
                    cursor: not-allowed;
                    opacity: 0.4;
                    background: #1f1f1f;
                }

                .stove-progress-section {
                    background: #232323;
                    border: 1px solid #2a2a2a;
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 16px;
                }

                .stove-progress-header {
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 12px;
                    color: #ffffff;
                }

                .stove-progress-bar {
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    border-radius: 8px;
                    height: 24px;
                    overflow: hidden;
                    margin-bottom: 12px;
                    position: relative;
                }

                .stove-progress-fill {
                    background: #10b981;
                    height: 100%;
                    width: 0%;
                    transition: width 0.5s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    font-weight: bold;
                    color: #ffffff;
                }

                .stove-task-list {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 8px;
                }

                .stove-task {
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 14px;
                    color: #d0d0d0;
                }

                .stove-log-section {
                    background: #0f0f0f;
                    border: 1px solid #2a2a2a;
                    border-radius: 8px;
                    padding: 16px;
                    max-height: 300px;
                    overflow-y: auto;
                    scroll-behavior: smooth;
                }

                .stove-log-header {
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    color: #ffffff;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .stove-log-copy-btn {
                    background: #2a2a2a;
                    border: 1px solid #3a3a3a;
                    color: #ffffff;
                    font-size: 14px;
                    padding: 4px 8px;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .stove-log-copy-btn:hover {
                    background: #3a3a3a;
                    border-color: #4a4a4a;
                    transform: scale(1.05);
                }

                .stove-log-copy-btn:active {
                    transform: scale(0.95);
                }

                #stove-log-content {
                    font-size: 13px;
                    line-height: 1.5;
                    font-family: 'Courier New', monospace;
                }

                /* Scrollbar styling */
                .stove-log-section::-webkit-scrollbar {
                    width: 8px;
                }

                .stove-log-section::-webkit-scrollbar-track {
                    background: #1a1a1a;
                    border-radius: 4px;
                }

                .stove-log-section::-webkit-scrollbar-thumb {
                    background: #3a3a3a;
                    border-radius: 4px;
                }

                .stove-log-section::-webkit-scrollbar-thumb:hover {
                    background: #4a4a4a;
                }

                .stove-status-section {
                    background: #232323;
                    border: 1px solid #2a2a2a;
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 16px;
                }

                .stove-status-header {
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 12px;
                    color: #ffffff;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }

                .stove-status-refresh {
                    background: #2a2a2a;
                    border: 1px solid #3a3a3a;
                    color: #e0e0e0;
                    padding: 4px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                    transition: all 0.2s ease;
                }

                .stove-status-refresh:hover {
                    background: #3a3a3a;
                    border-color: #4a4a4a;
                }

                .stove-status-list {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 8px;
                }

                .stove-status-item {
                    background: #1a1a1a;
                    border: 1px solid #2a2a2a;
                    padding: 10px 12px;
                    border-radius: 6px;
                    font-size: 14px;
                    color: #d0d0d0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .stove-status-label {
                    font-weight: 600;
                }

                .stove-status-value {
                    font-family: 'Courier New', monospace;
                }

                .stove-mission-item {
                    position: relative;
                    cursor: help;
                }

                .stove-mission-item:hover {
                    background: #252525;
                    border-color: #3a3a3a;
                }

                .stove-mission-tooltip {
                    position: absolute;
                    left: 0;
                    top: 100%;
                    margin-top: 8px;
                    background: #2a2a2a;
                    border: 1px solid #3a3a3a;
                    border-radius: 6px;
                    padding: 12px;
                    min-width: 300px;
                    max-width: 400px;
                    z-index: 10000;
                    font-size: 13px;
                    line-height: 1.5;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                    display: none;
                }

                .stove-mission-item:hover .stove-mission-tooltip {
                    display: block;
                }

                .stove-mission-tooltip-title {
                    font-weight: 600;
                    color: #10b981;
                    margin-bottom: 8px;
                    border-bottom: 1px solid #3a3a3a;
                    padding-bottom: 6px;
                }

                .stove-mission-tooltip-item {
                    padding: 4px 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .stove-mission-tooltip-name {
                    flex: 1;
                    color: #d0d0d0;
                }

                .stove-mission-tooltip-status {
                    margin-left: 12px;
                    font-size: 12px;
                }

                .stove-maintenance-notice {
                    background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%);
                    border: 2px solid #b71c1c;
                    border-radius: 8px;
                    padding: 20px;
                    margin-bottom: 20px;
                    text-align: center;
                    box-shadow: 0 4px 12px rgba(211, 47, 47, 0.3);
                }

                .stove-maintenance-icon {
                    font-size: 48px;
                    margin-bottom: 12px;
                    display: block;
                }

                .stove-maintenance-title {
                    font-size: 18px;
                    font-weight: bold;
                    color: #ffffff;
                    margin-bottom: 8px;
                }

                .stove-maintenance-message {
                    font-size: 14px;
                    color: #ffebee;
                    line-height: 1.6;
                }

            </style>

            <div class="stove-panel-header">
                <span class="stove-panel-title">🤖 STOVE 퀘스트 자동화</span>
                <span class="stove-panel-version">
                    <div>v${CONFIG.version}</div>
                    <div>Updated: ${CONFIG.lastUpdated}</div>
                </span>
            </div>

            <div id="stove-maintenance-notice" class="stove-maintenance-notice" style="display: none;">
                <span class="stove-maintenance-icon">🚧</span>
                <div class="stove-maintenance-title">점검 중</div>
                <div class="stove-maintenance-message">${CONFIG.maintenanceMode.message}</div>
            </div>

            <div class="stove-controls">
                <button id="stove-btn-start" class="stove-btn">🚀 전체 자동화</button>
                <button id="stove-btn-roulette" class="stove-btn">🎰 룰렛만</button>
                <button id="stove-btn-reward-shop" class="stove-btn">🏪 리워드샵 방문</button>
                <button id="stove-btn-test-tab" class="stove-btn" style="background: #8b5cf6;">🧪 탭 테스트</button>
            </div>

            <div class="stove-status-section">
                <div class="stove-status-header">
                    📊 현재 상태
                    <button id="stove-btn-status-refresh" class="stove-status-refresh">🔄 새로고침</button>
                </div>
                <div class="stove-status-list">
                    <div class="stove-status-item">
                        <span class="stove-status-label">✍️ 오늘 글쓰기</span>
                        <span class="stove-status-value" id="stove-status-article">-</span>
                    </div>
                    <div class="stove-status-item stove-mission-item" data-category="daily">
                        <span class="stove-status-label">📅 데일리</span>
                        <span class="stove-status-value" id="stove-status-mission-daily">-</span>
                    </div>
                    <div class="stove-status-item stove-mission-item" data-category="weekly">
                        <span class="stove-status-label">📆 위클리</span>
                        <span class="stove-status-value" id="stove-status-mission-weekly">-</span>
                    </div>
                    <div class="stove-status-item stove-mission-item" data-category="achievement">
                        <span class="stove-status-label">🏆 업적</span>
                        <span class="stove-status-value" id="stove-status-mission-achievement">-</span>
                    </div>
                    <div class="stove-status-item stove-mission-item" data-category="content">
                        <span class="stove-status-label">💬 컨텐츠</span>
                        <span class="stove-status-value" id="stove-status-mission-content">-</span>
                    </div>
                    <div class="stove-status-item stove-mission-item" data-category="attendance">
                        <span class="stove-status-label">📆 출석</span>
                        <span class="stove-status-value" id="stove-status-mission-attendance">-</span>
                    </div>
                    <div class="stove-status-item">
                        <span class="stove-status-label">🎰 룰렛 횟수</span>
                        <span class="stove-status-value" id="stove-status-roulette">-</span>
                    </div>
                    <div class="stove-status-item">
                        <span class="stove-status-label">💝 데일리 보상</span>
                        <span class="stove-status-value" id="stove-status-daily">-</span>
                    </div>
                    <div class="stove-status-item">
                        <span class="stove-status-label">🀄 마작 리워드</span>
                        <span class="stove-status-value" id="stove-status-majak">-</span>
                    </div>
                </div>
            </div>

            <div class="stove-progress-section">
                <div class="stove-progress-header">📊 커뮤니티 활동 진행 상황</div>
                <div class="stove-progress-bar">
                    <div class="stove-progress-fill">
                        <span id="stove-progress-text"></span>
                    </div>
                </div>
                <div class="stove-task-list">
                    <div class="stove-task">게시글 추천: <span id="stove-article-likes">0/${CONFIG.targets.articleLikes}</span></div>
                    <div class="stove-task">댓글 작성: <span id="stove-comments">0/${CONFIG.targets.comments}</span></div>
                    <div class="stove-task">새글 작성: <span id="stove-new-article">0/${CONFIG.targets.newArticle}</span></div>
                </div>
            </div>

            <div class="stove-log-section">
                <div class="stove-log-header">
                    <span>📝 로그</span>
                    <button id="stove-btn-copy-log" class="stove-log-copy-btn" title="로그 전체 복사">📋</button>
                </div>
                <div id="stove-log-content"></div>
            </div>
        `;

        // Find insertion point - insert at the beginning of inds-content-body
        const targetSelectors = [
            '.inds-content-body',
            'main',
            'body'
        ];

        let insertTarget = null;
        for (const selector of targetSelectors) {
            insertTarget = document.querySelector(selector);
            console.log(`[STOVE Automation] Checking selector "${selector}":`, !!insertTarget);
            if (insertTarget) {
                console.log(`[STOVE Automation] Selected target: ${selector}`);
                break;
            }
        }

        if (insertTarget) {
            try {
                // Insert as first child
                insertTarget.insertBefore(container, insertTarget.firstChild);
                console.log('[STOVE Automation] UI container inserted successfully');
            } catch (err) {
                console.error('[STOVE Automation] Error inserting UI:', err);
                // Fallback: append instead
                insertTarget.appendChild(container);
                console.log('[STOVE Automation] UI container appended as fallback');
            }
        } else {
            console.warn('[STOVE Automation] No target found, using body as fallback');
            document.body.insertBefore(container, document.body.firstChild);
        }

        // Verify UI is in DOM
        const uiElement = document.getElementById('stove-quest-automation');
        console.log('[STOVE Automation] UI element in DOM:', !!uiElement);
        if (uiElement) {
            console.log('[STOVE Automation] UI element dimensions:', {
                width: uiElement.offsetWidth,
                height: uiElement.offsetHeight,
                display: window.getComputedStyle(uiElement).display
            });
        }

        // Copy log function
        function copyLogToClipboard() {
            const logContent = document.getElementById('stove-log-content');
            if (!logContent) return;

            // Get all text content from log
            const logText = logContent.innerText || logContent.textContent;

            // Copy to clipboard
            navigator.clipboard.writeText(logText).then(() => {
                const btn = document.getElementById('stove-btn-copy-log');
                if (btn) {
                    const originalText = btn.textContent;
                    btn.textContent = '✓';
                    setTimeout(() => {
                        btn.textContent = originalText;
                    }, 1000);
                }
            }).catch(err => {
                console.error('로그 복사 실패:', err);
                alert('로그 복사에 실패했습니다.');
            });
        }

        // Attach event listeners
        const attachListener = (id, handler) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('click', handler);
                console.log(`[이벤트 등록] ${id} 성공`);
            } else {
                console.warn(`[이벤트 등록] ${id} 버튼을 찾을 수 없습니다`);
            }
        };

        // 점검 모드 체크 및 처리
        if (isMaintenanceMode()) {
            // 점검 안내 메시지 표시
            const maintenanceNotice = document.getElementById('stove-maintenance-notice');
            if (maintenanceNotice) {
                maintenanceNotice.style.display = 'block';
            }

            // 모든 버튼 비활성화
            const buttons = [
                'stove-btn-start',
                'stove-btn-roulette',
                'stove-btn-reward-shop',
                'stove-btn-status-refresh'
            ];

            buttons.forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.disabled = true;
                    console.log(`[점검 모드] ${id} 버튼 비활성화`);
                }
            });

            log('⚠️ 점검 모드 활성화: 모든 기능이 비활성화되었습니다', 'warning');
        } else {
            // 정상 모드: 이벤트 리스너 등록
            attachListener('stove-btn-start', runAutomation);
            attachListener('stove-btn-roulette', runRoulette);
            attachListener('stove-btn-reward-shop', openRewardShop);
            attachListener('stove-btn-test-tab', testTabOpening);
            attachListener('stove-btn-status-refresh', checkAllStatus);

            log('자동화 패널이 준비되었습니다', 'info');
        }

        attachListener('stove-btn-copy-log', copyLogToClipboard);

        // Auto-check status on initialization
        setTimeout(() => {
            checkAllStatus();
        }, 500);
    }

    // ============================================
    // Initialization
    // ============================================
    function init() {
        console.log('[STOVE Automation] Initializing...');
        console.log('[STOVE Automation] Current URL:', window.location.href);
        console.log('[STOVE Automation] Document ready state:', document.readyState);

        // Wait for page to be fully loaded
        if (document.readyState === 'loading') {
            console.log('[STOVE Automation] Waiting for DOMContentLoaded...');
            document.addEventListener('DOMContentLoaded', () => {
                console.log('[STOVE Automation] DOMContentLoaded triggered');
                tryCreateUI();
            });
        } else {
            console.log('[STOVE Automation] Document already loaded, creating UI...');
            tryCreateUI();
        }
    }

    function tryCreateUI(retries = 5) {
        console.log(`[STOVE Automation] Attempting to create UI (retries left: ${retries})`);

        // Check if target elements exist
        const contentBody = document.querySelector('.inds-content-body');
        const main = document.querySelector('main');

        console.log('[STOVE Automation] Found .inds-content-body:', !!contentBody);
        console.log('[STOVE Automation] Found main:', !!main);

        if (contentBody || main || retries <= 0) {
            createUI();
            console.log('[STOVE Automation] UI creation attempted');
        } else {
            console.log('[STOVE Automation] Target elements not found, retrying in 500ms...');
            setTimeout(() => tryCreateUI(retries - 1), 500);
        }
    }

    init();
})();
