// ==UserScript==
// @name         STOVE Quest Automation
// @namespace    https://profile.onstove.com/
// @version      2.5.1
// @author       prohyeon
// @description  STOVE 자동화 (게시글 추천 10회, 댓글 5회 작성, 새글 1회, 룰렛, 데일리 보상)
// @supportURL   https://github.com/prohyeon/public-flake/issues
// @downloadURL  https://github.com/prohyeon/public-flake/raw/refs/heads/main/stove-quest-automation.user.js
// @updateURL    https://github.com/prohyeon/public-flake/raw/refs/heads/main/stove-quest-automation.user.js
// @match        https://profile.onstove.com/ko*
// @connect      api.onstove.com
// @connect      reward.onstove.com
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    version: "2.5.1",
    lastUpdated: "2026-01-09",
    maintenanceMode: {
      enabled: false,
      startDate: "2025-11-01",
      message: "11월 플레이크 구조 확인중입니다, 업데이트 이후 사용할 수 있습니다"
    },
    api: {
      baseUrl: "https://api.onstove.com"
    },
    targets: {
      articleLikes: 10,
      comments: 5,
      newArticle: 1
    },
    delays: {
      betweenActions: 200,
      afterComment: 11e3
    },
    comment: "Nice!",
    roulette: {
      enabled: true,
      subEventNo: "1000000248",
      extraSubEventNo: "1000000250",
      drawCost: 100,
      maxDraws: 30,
      maxRetries: 3,
      retryDelay: 1e3
    },
    dailyMissions: {
      enabled: true,
      skipMissions: [],
      visitDelay: 3e3
    },
    contentMissions: {
      enabled: true
    },
    weeklyMissions: {
      enabled: true
    },
    bannerMissions: {
      enabled: true,
      visitDelay: 3e3
    },
    attendanceMissions: {
      enabled: true
    },
    surveyMissions: {
      enabled: true,
      voteStrategy: "highest"
    },
    prizeEntry: {
      enabled: true,
      missionNo: 8,
      eventNo: 1000000249,
      giftNo: 1000001247,
      targetGiftName: "스토브 5,000 포인트",
      flakeCost: 500
    }
  };
  function log(message, type = "info") {
    const logContent = document.getElementById("stove-log-content");
    if (!logContent) return;
    const icons = { success: "✓", error: "✗", info: "⏳", warning: "⚠️" };
    const colors = { success: "#10b981", error: "#ef4444", info: "#3b82f6", warning: "#f59e0b" };
    const entry = document.createElement("div");
    entry.style.color = colors[type];
    entry.style.padding = "4px 0";
    entry.textContent = `${icons[type]} ${message}`;
    logContent.appendChild(entry);
    const logSection = document.querySelector(".stove-log-section");
    if (logSection) {
      logSection.scrollTop = logSection.scrollHeight;
    }
  }
  const state = {
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
  function getKSTDate() {
    const now = /* @__PURE__ */ new Date();
    const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1e3);
    const year = kstTime.getUTCFullYear();
    const month = String(kstTime.getUTCMonth() + 1).padStart(2, "0");
    const day = String(kstTime.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function getTimestamp() {
    return Date.now();
  }
  function getCurrentMonthDateRange() {
    const now = /* @__PURE__ */ new Date();
    const kstOffset = 9 * 60 * 60 * 1e3;
    const kstNow = new Date(now.getTime() + kstOffset);
    const year = kstNow.getUTCFullYear();
    const month = kstNow.getUTCMonth();
    const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const startTimestamp = startDate.getTime() - kstOffset;
    const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    const endTimestamp = endDate.getTime() - kstOffset;
    return { startDate: startTimestamp, endDate: endTimestamp };
  }
  function getTodayString() {
    const today = /* @__PURE__ */ new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
  }
  function extractHeaders() {
    const token = getCookie("SUAT");
    const uuid = localStorage.getItem("sgs_da_uuid") || getCookie("sgs_da_uuid");
    if (!token) throw new Error("Authorization token (SUAT) not found");
    if (!uuid) throw new Error("UUID (sgs_da_uuid) not found");
    return {
      "Authorization": `Bearer ${token}`,
      "caller-id": "storee-lounge",
      "X-UUID": uuid,
      "x-lang": "ko",
      "x-nation": "KR",
      "x-device-type": "P01",
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "Origin": "https://lounge.onstove.com",
      "Referer": "https://lounge.onstove.com/"
    };
  }
  function playCompletionSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2);
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.log("[사운드 재생 실패]", e);
    }
  }
  function apiRequest(url, method, headers, body = null) {
    return new Promise((resolve, reject) => {
      const requestConfig = {
        method,
        url,
        headers,
        data: body ? JSON.stringify(body) : null,
        onload(response) {
          console.log(`[API Request] ${method} ${url} - Status: ${response.status}`);
          if (response.status >= 200 && response.status < 300) {
            try {
              const data = JSON.parse(response.responseText);
              resolve(data);
            } catch (e) {
              console.warn("[API Request] Failed to parse JSON response:", e);
              resolve({ success: true });
            }
          } else {
            console.error("[API Request] Error response:", response);
            reject(new Error(`API Error: ${response.status} ${response.statusText}`));
          }
        },
        onerror(error) {
          console.error("[API Request] Network error:", error);
          reject(new Error("Network error"));
        }
      };
      console.log("[API Request] Starting request:", { method, url, hasBody: !!body });
      GM_xmlhttpRequest(requestConfig);
    });
  }
  async function getArticleList(headers, size = 30) {
    var _a;
    const url = `${CONFIG.api.baseUrl}/postie/v2.0/interest/article/list?size=${size}&timestemp=${getTimestamp()}`;
    const response = await apiRequest(url, "GET", headers);
    return ((_a = response.value) == null ? void 0 : _a.list) || [];
  }
  async function likeArticle(headers, articleId) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/interaction/LIKE`;
    await apiRequest(url, "PUT", headers);
  }
  async function checkArticleLikeStatus(headers, articleIds) {
    if (!articleIds || articleIds.length === 0) return {};
    const ids = articleIds.join(",");
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${ids}/interaction/LIKE?timestemp=${getTimestamp()}`;
    const response = await apiRequest(url, "GET", headers);
    return response.value || {};
  }
  async function postComment(headers, articleId, content) {
    var _a;
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId}/comment`;
    const body = {
      article_id: articleId,
      content: `<p>${content}</p>`,
      attached: { media_ids: [] }
    };
    const response = await apiRequest(url, "POST", headers, body);
    return (_a = response.value) == null ? void 0 : _a.comment_id;
  }
  async function createArticle(headers, title, content, tags = []) {
    var _a;
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article`;
    const body = {
      title,
      content: `<p>${content}</p>`,
      attached: { media_ids: [], file_ids: [], poll_ids: [] },
      status: "PUBLISHED",
      category: null,
      coverage: "PUBLIC",
      learning_data: true,
      reservation: null,
      tags: tags.length > 0 ? tags : ["자유주제", "출석체크"]
    };
    console.log("[게시글 작성] URL:", url);
    const response = await apiRequest(url, "POST", headers, body);
    return (_a = response.value) == null ? void 0 : _a.article_id;
  }
  function makeMissionHeaders(headers) {
    return {
      "Authorization": headers["Authorization"],
      "caller-id": "flake-fe",
      "caller-detail": headers["X-UUID"] || headers["caller-detail"],
      "x-lang": "ko",
      "x-nation": "KR",
      "Accept": "*/*",
      "Origin": "https://reward.onstove.com",
      "Referer": "https://reward.onstove.com/"
    };
  }
  function isWeeklyAccumulation(startDt, endDt) {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const diffDays = (end - start) / (1e3 * 60 * 60 * 24);
    return diffDays <= 14;
  }
  function isComponentActive(startDt, endDt) {
    const now = /* @__PURE__ */ new Date();
    return now >= new Date(startDt) && now <= new Date(endDt);
  }
  async function getMissionComponentIds(headers) {
    var _a;
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/page?page_type=MISSION`;
    const missionHeaders = makeMissionHeaders(headers);
    console.log("[미션 컴포넌트 로드] URL:", url);
    try {
      const response = await apiRequest(url, "GET", missionHeaders);
      if (response && response.code === 0 && ((_a = response.value) == null ? void 0 : _a.component_list)) {
        const componentList = response.value.component_list;
        const components = {
          daily: null,
          content: null,
          weekly: null,
          survey: null,
          banner: null,
          attendance: null
        };
        for (const comp of componentList) {
          if (!isComponentActive(comp.start_dt, comp.end_dt)) {
            console.log(`[미션 컴포넌트] ⏭️ ${comp.type} (${comp.component_no}) - 비활성 기간`);
            continue;
          }
          switch (comp.type) {
            case "SINGLE":
              components.daily = comp.component_no;
              console.log(`[미션 컴포넌트] ✓ SINGLE → daily: ${comp.component_no}`);
              break;
            case "CONTENT1":
              components.content = comp.component_no;
              console.log(`[미션 컴포넌트] ✓ CONTENT1 → content: ${comp.component_no}`);
              break;
            case "SURVEY":
              components.survey = comp.component_no;
              console.log(`[미션 컴포넌트] ✓ SURVEY → survey: ${comp.component_no}`);
              break;
            case "BANNER":
              components.banner = comp.component_no;
              console.log(`[미션 컴포넌트] ✓ BANNER → banner: ${comp.component_no}`);
              break;
            case "ACCUMULATION":
              if (isWeeklyAccumulation(comp.start_dt, comp.end_dt)) {
                components.weekly = comp.component_no;
                const weekInfo = `${comp.start_dt.slice(5, 10)} ~ ${comp.end_dt.slice(5, 10)}`;
                console.log(`[미션 컴포넌트] ✓ ACCUMULATION (주간) → weekly: ${comp.component_no} (${weekInfo})`);
              } else {
                components.attendance = comp.component_no;
                console.log(`[미션 컴포넌트] ✓ ACCUMULATION (월간) → attendance: ${comp.component_no}`);
              }
              break;
            case "ACHIEVEMENT":
              console.log(`[미션 컴포넌트] ⏭️ ACHIEVEMENT (${comp.component_no}) - 제외됨`);
              break;
            default:
              console.log(`[미션 컴포넌트] ⚠️ 알 수 없는 타입: ${comp.type} (${comp.component_no})`);
          }
        }
        state.missionComponents = components;
        console.log("[미션 컴포넌트 로드] ✓ 완료:", components);
        return components;
      } else {
        console.error("[미션 컴포넌트 로드] ✗ API 오류:", response);
        return null;
      }
    } catch (e) {
      console.error("[미션 컴포넌트 로드] ✗ 실패:", e.message);
      return null;
    }
  }
  async function getDailyMissions(headers) {
    var _a;
    const componentNo = state.missionComponents.daily;
    if (!componentNo) {
      console.error("[데일리 미션 조회] ✗ componentNo가 로드되지 않음");
      return null;
    }
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
    const missionHeaders = makeMissionHeaders(headers);
    console.log(`[데일리 미션 조회] URL: ${url} (componentNo: ${componentNo})`);
    try {
      const response = await apiRequest(url, "GET", missionHeaders);
      if (response && response.code === 0 && response.value) {
        console.log(`[데일리 미션 조회] ✓ 미션 ${((_a = response.value.missions) == null ? void 0 : _a.length) || 0}개 조회 완료`);
        return response.value;
      } else {
        console.error("[데일리 미션 조회] ✗ API 오류:", response);
        return null;
      }
    } catch (e) {
      console.error("[데일리 미션 조회] ✗ 실패:", e.message);
      return null;
    }
  }
  async function receiveMissionReward(headers, missionNo, componentNo) {
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;
    const missionHeaders = {
      ...makeMissionHeaders(headers),
      "Accept": "application/json",
      "Content-Type": "application/json"
    };
    const body = { mission_no: missionNo, component_no: componentNo };
    console.log(`[미션 보상 수령] mission_no: ${missionNo}`);
    try {
      const response = await apiRequest(url, "POST", missionHeaders, body);
      if (response && response.code === 0 && response.value) {
        const reward = response.value.reward_amount || 0;
        console.log(`[미션 보상 수령] ✓ ${response.value.title}: ${reward} FLAKE`);
        return response.value;
      } else {
        console.error("[미션 보상 수령] ✗ API 오류:", response);
        return null;
      }
    } catch (e) {
      console.error("[미션 보상 수령] ✗ 실패:", e.message);
      return null;
    }
  }
  async function getDailyMissionStatus(headers, componentNo = 1) {
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
    const rewardHeaders = makeMissionHeaders(headers);
    const response = await apiRequest(url, "GET", rewardHeaders);
    return response;
  }
  async function getAllDailyMissions(headers) {
    const componentNos = Object.values(state.missionComponents).filter(Boolean);
    if (componentNos.length === 0) {
      console.log("[전체 미션 조회] 동적 ID 없음, 로드 시도...");
      await getMissionComponentIds(headers);
      const reloaded = Object.values(state.missionComponents).filter(Boolean);
      if (reloaded.length === 0) {
        console.error("[전체 미션 조회] 동적 component ID를 로드할 수 없습니다");
        return [];
      }
      componentNos.push(...reloaded);
    }
    console.log(`[전체 미션 조회] ${componentNos.length}개 component 조회 시작:`, componentNos);
    try {
      const results = await Promise.all(
        componentNos.map((no) => getDailyMissionStatus(headers, no).catch((err) => {
          console.error(`[전체 미션 조회] Component ${no} 실패:`, err);
          return null;
        }))
      );
      return results.map((result, index) => {
        if (result && result.value) {
          return { componentNo: componentNos[index], ...result.value };
        }
        return null;
      }).filter((r) => r !== null);
    } catch (error) {
      console.error("[전체 미션 조회] 오류:", error);
      return [];
    }
  }
  async function participateMission(headers, missionNo, componentNo) {
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;
    const rewardHeaders = {
      ...makeMissionHeaders(headers),
      "Accept": "application/json",
      "Content-Type": "application/json"
    };
    const body = { mission_no: missionNo, component_no: componentNo };
    console.log(`[미션 참여] mission_no: ${missionNo}, component_no: ${componentNo}`);
    const response = await apiRequest(url, "POST", rewardHeaders, body);
    if (response && response.value) {
      console.log(`[미션 참여] ${response.value.title} - 상태: ${response.value.status}`);
    }
    return response;
  }
  async function checkGameOwnership(headers, gameId) {
    const url = `${CONFIG.api.baseUrl}/ownership/v1/check_ownership_by_bgameid?game_id=${gameId}`;
    const eventHeaders = {
      "Authorization": headers["Authorization"],
      "caller-id": "event-hub",
      "caller-detail": headers["X-UUID"] || headers["caller-detail"],
      "X-Client-Lang": "ko",
      "X-Timezone": "Asia/Seoul",
      "X-Utc-Offset": "540",
      "X-Nation": "KR",
      "X-Lang": "ko",
      "X-Device-Type": "pc",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://event.onstove.com",
      "Referer": "https://event.onstove.com/"
    };
    const response = await apiRequest(url, "GET", eventHeaders);
    return response;
  }
  function makeRewardHeaders(headers) {
    return {
      "Authorization": headers["Authorization"],
      "caller-id": "flake-fe",
      "caller-detail": headers["X-UUID"] || headers["caller-detail"],
      "x-lang": "ko",
      "x-nation": "KR",
      "Accept": "*/*",
      "Origin": "https://reward.onstove.com",
      "Referer": "https://reward.onstove.com/"
    };
  }
  function getRouletteSubEventNo() {
    return state.rouletteEvents.draw || CONFIG.roulette.subEventNo;
  }
  function getRouletteExtraSubEventNo() {
    return state.rouletteEvents.extra || CONFIG.roulette.extraSubEventNo;
  }
  function getPrizeEventNo() {
    return state.prizeInfo.eventNo || state.rouletteEvents.apply || CONFIG.prizeEntry.eventNo;
  }
  function getPrizeGiftNo() {
    return state.prizeInfo.giftNo || CONFIG.prizeEntry.giftNo;
  }
  function getPrizeFlakeCost() {
    return state.prizeInfo.flakeCost || CONFIG.prizeEntry.flakeCost;
  }
  async function getRouletteEventIds(headers) {
    var _a, _b, _c, _d;
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/events?service_id1=STOVE_WEB&service_id2=FLAKE_WEB`;
    const eventHeaders = { ...makeRewardHeaders(headers), "Accept": "application/json" };
    console.log("[룰렛 이벤트 ID 로드] URL:", url);
    try {
      const response = await apiRequest(url, "GET", eventHeaders);
      if (response && response.code === 0 && response.value) {
        const value = response.value;
        const events = { draw: null, extra: null, apply: null, checkIn: null };
        if ((_a = value.draw_info) == null ? void 0 : _a.sub_event_no) {
          events.draw = String(value.draw_info.sub_event_no);
        }
        if ((_b = value.extra_info) == null ? void 0 : _b.sub_event_no) {
          events.extra = String(value.extra_info.sub_event_no);
        }
        if ((_c = value.apply_info) == null ? void 0 : _c.sub_event_no) {
          events.apply = String(value.apply_info.sub_event_no);
        }
        if ((_d = value.check_in_info) == null ? void 0 : _d.sub_event_no) {
          events.checkIn = String(value.check_in_info.sub_event_no);
        }
        state.rouletteEvents = events;
        console.log("[룰렛 이벤트 ID 로드] ✓ 완료:", events);
        return events;
      } else {
        console.error("[룰렛 이벤트 ID 로드] ✗ API 오류:", response);
        return null;
      }
    } catch (e) {
      console.error("[룰렛 이벤트 ID 로드] ✗ 실패:", e.message);
      return null;
    }
  }
  async function getPrizeInfo(headers) {
    var _a, _b;
    const eventNo = state.rouletteEvents.apply || CONFIG.prizeEntry.eventNo;
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/apply?sub_event_no=${eventNo}`;
    const prizeHeaders = makeRewardHeaders(headers);
    console.log("[경품 정보 로드] URL:", url);
    try {
      const response = await apiRequest(url, "GET", prizeHeaders);
      if (response && response.code === 0 && response.value) {
        const value = response.value;
        state.prizeInfo.eventNo = String(value.sub_event_no);
        if (((_a = value.participation_method_list) == null ? void 0 : _a.length) > 0) {
          state.prizeInfo.flakeCost = value.participation_method_list[0].participation_amount;
        }
        if (((_b = value.gift_list) == null ? void 0 : _b.length) > 0) {
          const targetGift = value.gift_list.find(
            (gift) => {
              var _a2, _b2;
              return ((_a2 = gift.gift_name) == null ? void 0 : _a2.includes("5,000")) && ((_b2 = gift.gift_name) == null ? void 0 : _b2.includes("포인트"));
            }
          );
          if (targetGift) {
            state.prizeInfo.giftNo = targetGift.gift_no;
            state.prizeInfo.giftName = targetGift.gift_name;
            console.log(`[경품 정보] ✓ 타겟 경품 발견: ${targetGift.gift_name}`);
          }
        }
        console.log("[경품 정보 로드] ✓ 완료:", state.prizeInfo);
        return state.prizeInfo;
      } else {
        console.error("[경품 정보 로드] ✗ API 오류:", response);
        return null;
      }
    } catch (e) {
      console.error("[경품 정보 로드] ✗ 실패:", e.message);
      return null;
    }
  }
  async function getRouletteParticipationCount(headers, subEventNo) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/participationCnt?sub_event_no=${subEventNo}`;
    const rewardHeaders = makeRewardHeaders(headers);
    console.log(`[룰렛 참여 횟수 조회] sub_event_no: ${subEventNo}`);
    try {
      const response = await apiRequest(url, "GET", rewardHeaders);
      console.log("[룰렛 참여 횟수 조회] ✅ Response received:", response);
      return response;
    } catch (error) {
      console.error("[룰렛 참여 횟수 조회] ❌ API 호출 실패:", error.message);
      throw error;
    }
  }
  async function executeRouletteDraw(headers, subEventNo) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/draw/${subEventNo}`;
    const rewardHeaders = {
      ...makeRewardHeaders(headers),
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    const body = { type_no: 1 };
    console.log(`[룰렛 뽑기 실행] sub_event_no: ${subEventNo}`);
    try {
      const response = await apiRequest(url, "POST", rewardHeaders, body);
      console.log("[룰렛 뽑기 실행] ✅ Response received:", response);
      if (response && response.code !== 0) {
        const errorCode = response.code;
        const errorMessage = response.message || "알 수 없는 오류";
        if (errorCode === 7019) {
          console.warn(`[룰렛 뽑기 실행] ⚠️ 이벤트 기간이 아닙니다: code=${errorCode}`);
        } else {
          console.error(`[룰렛 뽑기 실행] ❌ API 에러: code=${errorCode}, message=${errorMessage}`);
        }
      }
      return response;
    } catch (error) {
      console.error("[룰렛 뽑기 실행] ❌ API 호출 실패:", error.message);
      throw error;
    }
  }
  async function getRouletteExtra(headers, subEventNo) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/extra?sub_event_no=${subEventNo}`;
    const rewardHeaders = makeRewardHeaders(headers);
    console.log(`[룰렛 EXTRA 조회] sub_event_no: ${subEventNo}`);
    const response = await apiRequest(url, "GET", rewardHeaders);
    console.log("[룰렛 EXTRA 조회] Response:", response);
    return response;
  }
  async function claimRouletteExtra(headers, subEventNo, giftNo, currentCycle) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/extra/${subEventNo}`;
    const rewardHeaders = {
      ...makeRewardHeaders(headers),
      "Content-Type": "application/json"
    };
    const body = { gift_no: giftNo, current_cycle: currentCycle };
    const response = await apiRequest(url, "POST", rewardHeaders, body);
    console.log("[룰렛 EXTRA 수령] Response:", response);
    return response;
  }
  function updateProgress(task, current, total) {
    if (task) {
      const element = document.getElementById(`stove-${task}`);
      if (element) element.textContent = `${current}/${total}`;
    }
    const questTotalTasks = CONFIG.targets.articleLikes + CONFIG.targets.comments + CONFIG.targets.newArticle;
    const questCompletedTasks = state.progress.articleLikes + state.progress.comments + state.progress.newArticle;
    const additionalCompletedTasks = (state.completed.roulette ? 1 : 0) + (state.completed.dailyShop ? 1 : 0) + (state.completed.majak ? 1 : 0);
    const totalTasks = questTotalTasks + 3;
    const completedTasks = questCompletedTasks + additionalCompletedTasks;
    const percentage = Math.round(completedTasks / totalTasks * 100);
    const progressFill = document.querySelector(".stove-progress-fill");
    if (progressFill) progressFill.style.width = `${percentage}%`;
    const progressText = document.getElementById("stove-progress-text");
    if (progressText) {
      if (percentage < 10) {
        progressText.style.opacity = "0";
        progressText.textContent = "";
      } else {
        progressText.style.opacity = "1";
        progressText.textContent = `${percentage}%`;
      }
    }
  }
  function setButtonState(running) {
    const btnIds = ["stove-btn-start", "stove-btn-roulette", "stove-btn-reward-shop", "stove-btn-test-tab"];
    for (const id of btnIds) {
      const btn = document.getElementById(id);
      if (btn) {
        btn.disabled = running;
        btn.style.opacity = running ? "0.5" : "1";
      }
    }
  }
  async function runRouletteDraws(headers) {
    var _a, _b;
    log("룰렛 확인 중...", "info");
    try {
      let totalRewards = 0;
      let totalSuccessCount = 0;
      let roundCount = 0;
      while (true) {
        roundCount++;
        console.log(`
[룰렛 실행 루프] ===== Round ${roundCount} 시작 =====`);
        const participationInfo = await getRouletteParticipationCount(headers, getRouletteSubEventNo());
        if (!participationInfo || !participationInfo.value) {
          log("⚠️ 룰렛 정보를 가져올 수 없습니다", "warning");
          break;
        }
        const maxDraws = CONFIG.roulette.maxDraws;
        const current = participationInfo.value.participation_cnt || 0;
        const remaining = Math.max(0, maxDraws - current);
        if (roundCount === 1) {
          log(`✓ 룰렛 참여 가능 횟수: ${remaining}/${maxDraws} (현재: ${current})`, "success");
        } else {
          log(`✓ [${roundCount}차] 남은 횟수 재확인: ${remaining}/${maxDraws}`, "info");
        }
        if (current >= maxDraws) {
          log(roundCount === 1 ? "오늘의 룰렛 참여 횟수를 모두 사용했습니다" : "모든 룰렛 횟수를 소진했습니다", "info");
          break;
        }
        log(`룰렛 ${remaining}회 실행 시작...`, "info");
        let roundSuccessCount = 0;
        let shouldStopRoulette = false;
        for (let i = 1; i <= remaining; i++) {
          let drawSuccess = false;
          let retryCount = 0;
          while (!drawSuccess && retryCount <= CONFIG.roulette.maxRetries) {
            try {
              if (retryCount > 0) {
                log(`🔄 룰렛 ${i}/${remaining} 재시도 (${retryCount}/${CONFIG.roulette.maxRetries})...`, "warning");
                await delay(CONFIG.roulette.retryDelay);
              }
              const drawResult = await executeRouletteDraw(headers, getRouletteSubEventNo());
              if (drawResult && drawResult.code !== 0) {
                const errorCode = drawResult.code;
                if (errorCode === 7019) {
                  log(`⚠️ 룰렛 이벤트 기간이 아닙니다`, "warning");
                  shouldStopRoulette = true;
                  break;
                } else {
                  log(`✗ 룰렛 ${i}/${remaining} API 오류 (코드: ${errorCode})`, "error");
                  retryCount++;
                  continue;
                }
              }
              if (drawResult && drawResult.value) {
                const giftPrice = ((_a = drawResult.value.gift_info) == null ? void 0 : _a.gift_price) || 0;
                const giftName = ((_b = drawResult.value.gift_info) == null ? void 0 : _b.gift_name) || "알 수 없음";
                totalRewards += giftPrice;
                roundSuccessCount++;
                totalSuccessCount++;
                log(`✓ 룰렛 ${i}/${remaining} 완료: ${giftName} (${giftPrice} FLAKE)`, "success");
                drawSuccess = true;
              }
              await delay(CONFIG.delays.betweenActions);
            } catch (e) {
              log(`✗ 룰렛 ${i}/${remaining} 실패: ${e.message}`, "error");
              retryCount++;
              if (retryCount > CONFIG.roulette.maxRetries) {
                log(`❌ 룰렛 ${i}/${remaining} 최대 재시도 횟수 초과`, "error");
                shouldStopRoulette = true;
                break;
              }
            }
          }
          if (shouldStopRoulette) {
            log("🛑 룰렛 프로세스를 중단합니다", "warning");
            break;
          }
        }
        log(`[${roundCount}차] ${roundSuccessCount}/${remaining} 성공`, "info");
        if (shouldStopRoulette) break;
        await delay(CONFIG.delays.betweenActions);
      }
      if (totalSuccessCount > 0) {
        const totalCost = totalSuccessCount * CONFIG.roulette.drawCost;
        const netProfit = totalRewards - totalCost;
        const profitSign = netProfit >= 0 ? "+" : "";
        log("", "info");
        log(`🎰 최종 룰렛 결과 (${roundCount}차 실행)`, "success");
        log(`  🎯 총 실행: ${totalSuccessCount}회 성공`, "success");
        log(`  💰 총 획득: ${totalRewards} FLAKE`, "success");
        log(`  💸 총 비용: ${totalCost} FLAKE`, "info");
        log(`  📊 순수익: ${profitSign}${netProfit} FLAKE`, netProfit >= 0 ? "success" : "warning");
        state.earnings.roulette = netProfit;
        state.completed.roulette = true;
        updateProgress();
        return netProfit;
      }
    } catch (e) {
      log(`✗ 룰렛 실행 실패: ${e.message}`, "error");
    }
    state.completed.roulette = true;
    updateProgress();
    log("✅ 룰렛 실행 완료!", "success");
    return 0;
  }
  async function claimRouletteExtraRewards(headers) {
    var _a;
    log("룰렛 EXTRA 확인 중...", "info");
    let extraFlakeEarned = 0;
    try {
      const extraData = await getRouletteExtra(headers, getRouletteExtraSubEventNo());
      console.log("[룰렛 EXTRA] API Response:", extraData);
      if (!extraData) {
        log("⚠️ 룰렛 EXTRA API 응답이 없습니다", "warning");
        return extraFlakeEarned;
      }
      if (extraData.code !== 0) {
        log(`⚠️ 룰렛 EXTRA API 오류: ${extraData.message || "Unknown error"}`, "warning");
        return extraFlakeEarned;
      }
      if ((_a = extraData.value) == null ? void 0 : _a.milestones) {
        const currentCnt = extraData.value.current_cnt || 0;
        const currentCycle = extraData.value.current_cycle || 0;
        const milestones = extraData.value.milestones || [];
        log(`현재 카운트: ${currentCnt}`, "info");
        log(`총 마일스톤: ${milestones.length}개`, "info");
        const claimableMilestones = milestones.filter(
          (m) => currentCnt >= m.milestone && m.received_yn === false
        );
        if (claimableMilestones.length === 0) {
          log("수령 가능한 룰렛 EXTRA가 없습니다", "info");
          return extraFlakeEarned;
        }
        log(`✓ 수령 가능한 EXTRA: ${claimableMilestones.length}개`, "success");
        for (const milestone of claimableMilestones) {
          try {
            const result = await claimRouletteExtra(
              headers,
              getRouletteExtraSubEventNo(),
              milestone.gift_no,
              currentCycle
            );
            if (result && result.code === 0) {
              const giftName = milestone.gift_name || "";
              const flakeMatch = giftName.match(/([0-9,]+)\s*플레이크/);
              const flakeAmount = flakeMatch ? parseInt(flakeMatch[1].replace(/,/g, "")) : 0;
              extraFlakeEarned += flakeAmount;
              log(`✓ EXTRA 수령 완료: ${milestone.gift_name} (${flakeAmount} FLAKE)`, "success");
            } else {
              log(`✗ EXTRA 수령 실패 (milestone_no: ${milestone.milestone_no})`, "error");
            }
            await delay(CONFIG.delays.betweenActions);
          } catch (e) {
            log(`✗ EXTRA 수령 오류: ${e.message}`, "error");
          }
        }
        if (extraFlakeEarned > 0) {
          log(`💰 총 EXTRA 수령: ${extraFlakeEarned} FLAKE`, "success");
        }
      } else {
        log("⚠️ 룰렛 EXTRA 정보 구조가 올바르지 않습니다", "warning");
      }
    } catch (e) {
      log(`✗ 룰렛 EXTRA 확인 실패: ${e.message}`, "error");
    }
    state.earnings.rouletteExtra = extraFlakeEarned;
    log("✅ 룰렛 EXTRA 처리 완료!", "success");
    return extraFlakeEarned;
  }
  async function runRoulette() {
    if (state.isRunning) {
      log("⚠️ 이미 실행 중입니다", "warning");
      return;
    }
    state.isRunning = true;
    setButtonState(true);
    try {
      log("🎰 룰렛 실행 시작...", "info");
      const headers = extractHeaders();
      await runRouletteDraws(headers);
    } catch (error) {
      log(`✗ 오류 발생: ${error.message}`, "error");
    } finally {
      state.isRunning = false;
      setButtonState(false);
    }
  }
  function makeEventHeaders(headers) {
    return {
      "Authorization": headers["Authorization"],
      "caller-id": "event-hub",
      "caller-detail": headers["X-UUID"] || headers["caller-detail"],
      "X-Client-Lang": "ko",
      "X-Timezone": "Asia/Seoul",
      "X-Utc-Offset": "540",
      "X-Nation": "KR",
      "X-Lang": "ko",
      "X-Device-Type": "pc",
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://event.onstove.com",
      "Referer": "https://event.onstove.com/"
    };
  }
  async function getDailyShopRewards(headers) {
    const now = /* @__PURE__ */ new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/${yearMonth}/services/STOVEINDIE`;
    console.log("[데일리 보상 목록 조회] URL:", url);
    const response = await apiRequest(url, "GET", makeEventHeaders(headers));
    return response;
  }
  async function claimDailyReward(headers, itemNo, rewardType) {
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/daily/${rewardType}?item_no=${itemNo}&reward_type=${rewardType}`;
    const eventHeaders = {
      ...makeEventHeaders(headers),
      "Content-Type": "application/json"
    };
    const body = { item_no: itemNo, reward_type: rewardType };
    const response = await apiRequest(url, "POST", eventHeaders, body);
    return response;
  }
  async function getMajakDailyShopRewards(headers) {
    const now = /* @__PURE__ */ new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/${yearMonth}/services/RIICHICITY_IND`;
    console.log("[마작 리워드 목록 조회] URL:", url);
    const response = await apiRequest(url, "GET", makeEventHeaders(headers));
    return response;
  }
  async function claimDailyAccumulatedReward(headers, itemNo, itemType = "LIBRARY", guid = null, characterSeq = null) {
    let endpointType;
    if (itemType === "ITEMBOX") endpointType = "itembox";
    else if (itemType === "INDIE_GAME_COUPON") endpointType = "LIBRARY";
    else if (itemType === "FLAKE") endpointType = "flake";
    else if (itemType === "INDIE_SALE_COUPON") endpointType = "coupon";
    else endpointType = "LIBRARY";
    let queryParams = `item_no=${itemNo}`;
    if (guid && characterSeq) queryParams += `&guid=${guid}&character_seq=${characterSeq}`;
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/accumulate/${endpointType}?${queryParams}`;
    const eventHeaders = { ...makeEventHeaders(headers), "Content-Type": "application/json" };
    const body = { item_no: itemNo };
    if (guid && characterSeq) {
      body.guid = guid;
      body.character_seq = characterSeq;
    }
    const response = await apiRequest(url, "POST", eventHeaders, body);
    return response;
  }
  async function claimMajakAccumulatedReward(headers, itemNo, itemType = "COUPON") {
    let endpointType;
    if (itemType === "INDIE_GAME_COUPON") endpointType = "LIBRARY";
    else if (itemType === "FLAKE") endpointType = "flake";
    else if (itemType === "COUPON" || itemType === "INDIE_SALE_COUPON") endpointType = "coupon";
    else endpointType = "coupon";
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/accumulate/${endpointType}?item_no=${itemNo}`;
    const eventHeaders = { ...makeEventHeaders(headers), "Content-Type": "application/json" };
    const body = { item_no: itemNo };
    const response = await apiRequest(url, "POST", eventHeaders, body);
    return response;
  }
  async function claimDailyShopRewards(headers) {
    var _a;
    log("데일리 보상 확인 중...", "info");
    let dailyFlakeEarned = 0;
    try {
      const dailyShopData = await getDailyShopRewards(headers);
      if ((_a = dailyShopData == null ? void 0 : dailyShopData.value) == null ? void 0 : _a.daily_attendances) {
        const rewards = dailyShopData.value.daily_attendances.rewards || [];
        const todayString = getTodayString();
        log(`오늘 날짜: ${todayString}`, "info");
        const unclaimedRewards = rewards.filter(
          (reward) => reward.attendance_date === todayString && !reward.is_received
        );
        log(`✓ 오늘 수령 가능한 보상: ${unclaimedRewards.length}개`, "success");
        if (unclaimedRewards.length === 0) {
          log("오늘 수령 가능한 데일리 보상이 없습니다", "info");
          state.earnings.dailyShop = 0;
          state.completed.dailyShop = true;
          updateProgress();
          log("✅ 데일리 보상 처리 완료!", "success");
          return 0;
        }
        let successCount = 0;
        for (const reward of unclaimedRewards) {
          try {
            let rewardType;
            if (reward.item_type === "FLAKE") rewardType = "flake";
            else if (reward.item_type === "INDIE_SALE_COUPON") rewardType = "indie_sale_coupon";
            else rewardType = "coupon";
            const result = await claimDailyReward(headers, reward.item_no, rewardType);
            if (result && result.code === 0) {
              const rewardAmount = reward.flake_amount || 0;
              const rewardName = reward.item_name || reward.item_type;
              dailyFlakeEarned += rewardAmount;
              successCount++;
              log(`✓ 보상 수령 완료: ${rewardName} (${rewardAmount} FLAKE)`, "success");
            } else {
              log(`✗ 보상 수령 실패 (item_no: ${reward.item_no})`, "error");
            }
            await delay(CONFIG.delays.betweenActions);
          } catch (e) {
            log(`✗ 보상 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, "error");
          }
        }
        if (successCount > 0) {
          log(`💰 총 ${successCount}개 보상 수령 완료: ${dailyFlakeEarned} FLAKE`, "success");
        }
      } else {
        log("⚠️ 데일리 보상 정보를 가져올 수 없습니다", "warning");
      }
    } catch (e) {
      log(`✗ 데일리 보상 확인 실패: ${e.message}`, "error");
    }
    state.earnings.dailyShop = dailyFlakeEarned;
    state.completed.dailyShop = true;
    updateProgress();
    log("✅ 데일리 보상 처리 완료!", "success");
    return dailyFlakeEarned;
  }
  async function claimMajakDailyShopRewards(headers) {
    var _a;
    log("마작 리워드 확인 중...", "info");
    let majakFlakeEarned = 0;
    try {
      let majakShopData = await getMajakDailyShopRewards(headers);
      if (majakShopData == null ? void 0 : majakShopData.value) {
        if (majakShopData.value.daily_attendances) {
          const rewards = majakShopData.value.daily_attendances.rewards || [];
          const todayString = getTodayString();
          log(`오늘 날짜: ${todayString}`, "info");
          const unclaimedRewards = rewards.filter(
            (reward) => reward.attendance_date === todayString && !reward.is_received
          );
          log(`✓ 오늘 수령 가능한 마작 리워드: ${unclaimedRewards.length}개`, "success");
          if (unclaimedRewards.length > 0) {
            let successCount = 0;
            for (const reward of unclaimedRewards) {
              try {
                let rewardType;
                if (reward.item_type === "FLAKE") rewardType = "flake";
                else if (reward.item_type === "INDIE_SALE_COUPON") rewardType = "indie_sale_coupon";
                else rewardType = "coupon";
                const result = await claimDailyReward(headers, reward.item_no, rewardType);
                if (result && result.code === 0) {
                  const rewardAmount = reward.flake_amount || 0;
                  const rewardName = reward.item_name || reward.item_type;
                  majakFlakeEarned += rewardAmount;
                  successCount++;
                  log(`✓ 마작 리워드 수령 완료: ${rewardName} (${rewardAmount} FLAKE)`, "success");
                } else {
                  log(`✗ 마작 리워드 수령 실패 (item_no: ${reward.item_no})`, "error");
                }
                await delay(CONFIG.delays.betweenActions);
              } catch (e) {
                log(`✗ 마작 리워드 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, "error");
              }
            }
            if (successCount > 0) {
              log(`🀄 총 ${successCount}개 마작 일일 리워드 수령 완료`, "success");
              log("", "info");
              log("📋 일일 리워드 수령 후 누적 출석 정보 재조회 중...", "info");
              majakShopData = await getMajakDailyShopRewards(headers);
              if (!(majakShopData == null ? void 0 : majakShopData.value)) {
                log("⚠️ 누적 출석 정보 재조회 실패", "warning");
              }
            }
          } else {
            log("오늘 수령 가능한 마작 일일 리워드가 없습니다", "info");
          }
        }
        if ((_a = majakShopData == null ? void 0 : majakShopData.value) == null ? void 0 : _a.accumulated_attendances) {
          const accumulatedRewards = majakShopData.value.accumulated_attendances.rewards || [];
          const totalDays = majakShopData.value.accumulated_attendances.total_attendance_days || 0;
          log("", "info");
          log(`현재 누적 출석일: ${totalDays}일`, "info");
          const claimableAccumulated = accumulatedRewards.filter(
            (reward) => totalDays >= reward.rewardable_days && !reward.is_received
          );
          if (claimableAccumulated.length > 0) {
            log(`✓ 수령 가능한 누적 보상: ${claimableAccumulated.length}개`, "success");
            let accumulatedSuccessCount = 0;
            for (const reward of claimableAccumulated) {
              try {
                const result = await claimMajakAccumulatedReward(headers, reward.item_no, reward.item_type);
                if (result && result.code === 0) {
                  const rewardAmount = reward.flake_amount || 0;
                  majakFlakeEarned += rewardAmount;
                  accumulatedSuccessCount++;
                  if (reward.item_type === "FLAKE") {
                    log(`✓ 마작 누적 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name} (${rewardAmount} FLAKE)`, "success");
                  } else {
                    log(`✓ 마작 누적 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name}`, "success");
                  }
                } else {
                  const errorCode = (result == null ? void 0 : result.code) || "N/A";
                  log(`✗ 마작 누적 보상 수령 실패 (item_no: ${reward.item_no}, 코드: ${errorCode})`, "error");
                }
                await delay(CONFIG.delays.betweenActions);
              } catch (e) {
                log(`✗ 마작 누적 보상 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, "error");
              }
            }
            if (accumulatedSuccessCount > 0) {
              log(`🎁 총 ${accumulatedSuccessCount}개 마작 누적 보상 수령 완료`, "success");
            }
          } else {
            log("수령 가능한 마작 누적 보상이 없습니다", "info");
          }
        }
      } else {
        log("⚠️ 마작 리워드 정보를 가져올 수 없습니다", "warning");
      }
    } catch (e) {
      log(`✗ 마작 리워드 확인 실패: ${e.message}`, "error");
    }
    state.earnings.majak = majakFlakeEarned;
    state.completed.majak = true;
    updateProgress();
    log("✅ 마작 리워드 처리 완료!", "success");
    return majakFlakeEarned;
  }
  async function claimDailyAccumulatedRewards(headers) {
    var _a, _b, _c;
    log("🎁 데일리 누적 보상 수령 시작...", "info");
    let dailyAccumulatedFlake = 0;
    try {
      const dailyShopData = await getDailyShopRewards(headers);
      if ((_a = dailyShopData == null ? void 0 : dailyShopData.value) == null ? void 0 : _a.accumulated_attendances) {
        const accumulatedRewards = dailyShopData.value.accumulated_attendances.rewards || [];
        const totalDays = dailyShopData.value.accumulated_attendances.total_attendance_days || 0;
        log(`현재 누적 출석일: ${totalDays}일`, "info");
        const claimableRewards = accumulatedRewards.filter(
          (reward) => totalDays >= reward.rewardable_days && !reward.is_received
        );
        if (claimableRewards.length > 0) {
          log(`✓ 수령 가능한 누적 보상: ${claimableRewards.length}개`, "success");
          for (const reward of claimableRewards) {
            try {
              log(`📦 보상 정보: ${reward.item_name} (타입: ${reward.item_type}, ${reward.rewardable_days}일)`, "info");
              if (reward.item_type === "INDIE_GAME_COUPON" && reward.game_id) {
                const ownershipData = await checkGameOwnership(headers, reward.game_id);
                if (((_c = (_b = ownershipData == null ? void 0 : ownershipData.value) == null ? void 0 : _b.owner_list) == null ? void 0 : _c.length) > 0) {
                  log(`⚠️ 이미 소유한 게임: ${reward.item_name} - 수령 건너뜀`, "warning");
                  continue;
                }
              }
              const result = await claimDailyAccumulatedReward(headers, reward.item_no, reward.item_type);
              if (result && result.code === 0) {
                if (reward.item_type === "FLAKE") {
                  const rewardAmount = reward.flake_amount || 0;
                  dailyAccumulatedFlake += rewardAmount;
                  log(`✓ FLAKE 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name} (${rewardAmount.toLocaleString()} FLAKE)`, "success");
                } else {
                  log(`✓ 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name}`, "success");
                }
              } else {
                const errorCode = (result == null ? void 0 : result.code) || "N/A";
                const errorMsg = (result == null ? void 0 : result.message) || (result == null ? void 0 : result.msg) || "N/A";
                log(`✗ 보상 수령 실패: ${reward.item_name} (코드: ${errorCode}, 메시지: ${errorMsg})`, "error");
              }
              await delay(CONFIG.delays.betweenActions);
            } catch (e) {
              log(`✗ 보상 수령 오류 (${reward.item_name}): ${e.message}`, "error");
            }
          }
        } else {
          log("수령 가능한 누적 보상이 없습니다", "info");
        }
      } else {
        log("⚠️ 누적 보상 정보를 가져올 수 없습니다", "warning");
      }
    } catch (e) {
      log(`✗ 데일리 누적 보상 처리 실패: ${e.message}`, "error");
    }
    return dailyAccumulatedFlake;
  }
  function openRewardShop() {
    log("🏪 리워드샵 페이지를 새 탭에서 엽니다...", "info");
    try {
      GM_openInTab("https://reward.onstove.com/ko", { active: true, insert: true });
      log("✅ 리워드샵 탭이 열렸습니다!", "success");
    } catch (error) {
      log(`❌ 탭 열기 실패: ${error.message}`, "error");
    }
  }
  function openTabInBackground(url, active = false) {
    if (typeof GM_openInTab === "undefined") {
      console.warn("[Tab] GM_openInTab not available, using window.open");
      return window.open(url, "_blank");
    }
    const tab = GM_openInTab(url, { active, insert: true, setParent: true });
    console.log(`[Tab] ${active ? "포커스" : "백그라운드"}로 탭 열림: ${url}`);
    return tab;
  }
  function closeTab(tabs) {
    if (!tabs) {
      console.warn("[Tab] 닫을 탭이 없습니다");
      return 0;
    }
    const tabArray = Array.isArray(tabs) ? tabs : [tabs];
    let closedCount = 0;
    tabArray.forEach((tab, index) => {
      try {
        if (tab && typeof tab.close === "function") {
          tab.close();
          closedCount++;
          console.log(`[Tab] 탭 ${index + 1} 닫힘`);
        } else if (tab && typeof tab === "object") {
          console.warn(`[Tab] 탭 ${index + 1}은 close() 메서드가 없습니다`);
        }
      } catch (e) {
        console.error(`[Tab] 탭 ${index + 1} 닫기 실패:`, e.message);
      }
    });
    console.log(`[Tab] 총 ${closedCount}/${tabArray.length}개 탭 닫힘`);
    return closedCount;
  }
  async function closeTabAfterDelay(tabs, delayMs = 3e3) {
    console.log(`[Tab] ${delayMs}ms 후 탭 닫기 예약됨`);
    await delay(delayMs);
    return closeTab(tabs);
  }
  async function executeVisitMission(mission) {
    const { title, button_url } = mission;
    try {
      log(`🌐 ${title} 방문 중...`, "info");
      const tab = openTabInBackground(button_url, false);
      await closeTabAfterDelay(tab, CONFIG.dailyMissions.visitDelay);
      log(`✓ ${title} 방문 완료`, "success");
      return true;
    } catch (e) {
      log(`✗ ${title} 방문 실패: ${e.message}`, "error");
      return false;
    }
  }
  async function executeDailyMissions(headers) {
    log("📋 데일리 미션 시작...", "info");
    let totalEarned = 0;
    try {
      const missionData = await getDailyMissions(headers);
      if (!missionData || !missionData.missions) {
        log("✗ 미션 목록 조회 실패", "error");
        state.earnings.dailyMissions = 0;
        state.completed.dailyMissions = true;
        return;
      }
      const missions = missionData.missions;
      log(`📝 총 ${missions.length}개 미션 확인`, "info");
      const visitMissions = missions.filter(
        (m) => {
          var _a;
          return m.is_visit_mission === true && m.status === "INCOMPLETE" && ((_a = m.button_url) == null ? void 0 : _a.trim());
        }
      );
      if (visitMissions.length > 0) {
        log(`🌐 방문 미션 ${visitMissions.length}개 수행 시작...`, "info");
        for (const mission of visitMissions) {
          await executeVisitMission(mission);
          await delay(CONFIG.delays.betweenActions);
        }
        log("✅ 방문 미션 수행 완료", "success");
        await delay(1e3);
      } else {
        log("ℹ️ 수행할 방문 미션이 없습니다", "info");
      }
      const updatedMissionData = await getDailyMissions(headers);
      if (!updatedMissionData || !updatedMissionData.missions) {
        log("✗ 미션 상태 재조회 실패", "error");
        state.earnings.dailyMissions = 0;
        state.completed.dailyMissions = true;
        return;
      }
      const receivableMissions = updatedMissionData.missions.filter(
        (m) => m.status === "RECEIVABLE" && !CONFIG.dailyMissions.skipMissions.includes(m.mission_no)
      );
      if (receivableMissions.length > 0) {
        log(`🎁 수령 가능한 보상 ${receivableMissions.length}개 발견`, "info");
        for (const mission of receivableMissions) {
          const result = await receiveMissionReward(headers, mission.mission_no, state.missionComponents.daily);
          if (result && result.reward_amount) totalEarned += result.reward_amount;
          await delay(CONFIG.delays.betweenActions);
        }
        log(`✅ 데일리 미션 보상 수령 완료: +${totalEarned} FLAKE`, "success");
      } else {
        log("ℹ️ 수령 가능한 보상이 없습니다", "info");
      }
      state.earnings.dailyMissions = totalEarned;
      state.completed.dailyMissions = true;
      const completedCount = updatedMissionData.missions.filter((m) => m.status === "COMPLETE").length;
      log(`📊 미션 진행 상황: ${completedCount}/${updatedMissionData.missions.length} 완료`, "info");
    } catch (error) {
      log(`✗ 데일리 미션 오류: ${error.message}`, "error");
    }
    log("✅ 데일리 미션 처리 완료!", "success");
  }
  async function executeContentMissions(headers) {
    var _a, _b;
    log("📰 컨텐츠 미션 시작...", "info");
    let totalEarned = 0;
    const componentNo = state.missionComponents.content;
    if (!componentNo) {
      log("⚠️ 컨텐츠 미션 componentNo가 로드되지 않음", "warning");
      state.completed.contentMissions = true;
      return;
    }
    try {
      const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
      const missionHeaders = makeMissionHeaders(headers);
      const missionData = await apiRequest(url, "GET", missionHeaders);
      if (!missionData || missionData.code !== 0 || !((_a = missionData.value) == null ? void 0 : _a.missions)) {
        log("✗ 컨텐츠 미션 목록 조회 실패", "error");
        state.earnings.contentMissions = 0;
        state.completed.contentMissions = true;
        return;
      }
      const missions = missionData.value.missions;
      log(`📝 총 ${missions.length}개 컨텐츠 미션 확인`, "info");
      const incompleteMissions = missions.filter((m) => {
        var _a2;
        return m.status === "INCOMPLETE" && ((_a2 = m.url) == null ? void 0 : _a2.trim());
      });
      if (incompleteMissions.length > 0) {
        log(`🌐 미완료 컨텐츠 미션 ${incompleteMissions.length}개 방문 시작...`, "info");
        for (const mission of incompleteMissions) {
          try {
            log(`  🌐 "${mission.title.substring(0, 30)}..." 방문 중...`, "info");
            const tab = openTabInBackground(mission.url, false);
            await closeTabAfterDelay(tab, 3e3);
            log(`  ✓ "${mission.title.substring(0, 30)}..." 방문 완료`, "success");
          } catch (e) {
            log(`  ✗ 방문 실패: ${e.message}`, "error");
          }
          await delay(CONFIG.delays.betweenActions);
        }
        log("✅ 컨텐츠 미션 방문 완료", "success");
        await delay(1e3);
      } else {
        log("ℹ️ 방문할 미완료 컨텐츠 미션이 없습니다", "info");
      }
      const updatedMissionData = await apiRequest(url, "GET", missionHeaders);
      if (!updatedMissionData || updatedMissionData.code !== 0 || !((_b = updatedMissionData.value) == null ? void 0 : _b.missions)) {
        log("✗ 컨텐츠 미션 상태 재조회 실패", "error");
        return;
      }
      const receivableMissions = updatedMissionData.value.missions.filter((m) => m.status === "RECEIVABLE");
      if (receivableMissions.length > 0) {
        log(`🎁 수령 가능한 컨텐츠 미션 ${receivableMissions.length}개 발견`, "info");
        for (const mission of receivableMissions) {
          const result = await receiveMissionReward(headers, mission.mission_no, componentNo);
          if (result && result.reward_amount) {
            totalEarned += result.reward_amount;
            log(`  ✓ "${mission.title.substring(0, 30)}...": +${result.reward_amount} FLAKE`, "success");
          }
          await delay(CONFIG.delays.betweenActions);
        }
        log(`✅ 컨텐츠 미션 보상 수령 완료: +${totalEarned} FLAKE`, "success");
      } else {
        log("ℹ️ 수령 가능한 컨텐츠 미션이 없습니다", "info");
      }
      state.earnings.contentMissions = totalEarned;
      state.completed.contentMissions = true;
      const completedCount = updatedMissionData.value.missions.filter((m) => m.status === "COMPLETE" || m.status === "COMPLETED").length;
      log(`📊 컨텐츠 미션 진행 상황: ${completedCount}/${updatedMissionData.value.missions.length} 완료`, "info");
    } catch (error) {
      log(`✗ 컨텐츠 미션 오류: ${error.message}`, "error");
    }
    log("✅ 컨텐츠 미션 처리 완료!", "success");
  }
  async function executeWeeklyMissions(headers) {
    var _a;
    log("📅 위클리 미션 시작...", "info");
    let totalEarned = 0;
    const componentNo = state.missionComponents.weekly;
    if (!componentNo) {
      log("ℹ️ 위클리 미션: 현재 이용 불가 (API 응답 없음)", "info");
      state.completed.weeklyMissions = true;
      state.earnings.weeklyMissions = 0;
      return;
    }
    try {
      const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
      const missionHeaders = makeMissionHeaders(headers);
      const missionData = await apiRequest(url, "GET", missionHeaders);
      if (!missionData || missionData.code !== 0 || !((_a = missionData.value) == null ? void 0 : _a.missions)) {
        log("ℹ️ 위클리 미션: 현재 이용 불가", "info");
        state.earnings.weeklyMissions = 0;
        state.completed.weeklyMissions = true;
        return;
      }
      const missions = missionData.value.missions;
      log(`📝 총 ${missions.length}개 위클리 미션 확인`, "info");
      const receivableMissions = missions.filter((m) => m.status === "RECEIVABLE");
      if (receivableMissions.length > 0) {
        log(`🎁 수령 가능한 위클리 미션 ${receivableMissions.length}개 발견`, "info");
        for (const mission of receivableMissions) {
          const result = await receiveMissionReward(headers, mission.mission_no, componentNo);
          if (result && result.reward_amount) {
            totalEarned += result.reward_amount;
            log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, "success");
          }
          await delay(CONFIG.delays.betweenActions);
        }
        log(`✅ 위클리 미션 보상 수령 완료: +${totalEarned} FLAKE`, "success");
      } else {
        log("ℹ️ 수령 가능한 위클리 미션이 없습니다", "info");
      }
      state.earnings.weeklyMissions = totalEarned;
      state.completed.weeklyMissions = true;
      const completedCount = missions.filter((m) => m.status === "COMPLETE" || m.status === "COMPLETED").length;
      log(`📊 위클리 미션 진행 상황: ${completedCount}/${missions.length} 완료`, "info");
      const incompleteMissions = missions.filter((m) => m.status === "INCOMPLETE");
      if (incompleteMissions.length > 0) {
        log("ℹ️ 진행 중인 미션:", "info");
        for (const mission of incompleteMissions) {
          const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_total_cnt || 0}`;
          log(`  📌 ${mission.title}: ${progress}`, "info");
        }
      }
    } catch (error) {
      log("ℹ️ 위클리 미션: 현재 이용 불가", "info");
      state.earnings.weeklyMissions = 0;
      state.completed.weeklyMissions = true;
    }
    log("✅ 위클리 미션 처리 완료!", "success");
  }
  async function executeBannerMissions(headers) {
    var _a, _b;
    log("🎨 배너 미션 시작...", "info");
    let totalEarned = 0;
    const componentNo = state.missionComponents.banner;
    if (!componentNo) {
      log("⚠️ 배너 미션 componentNo가 로드되지 않음", "warning");
      state.completed.bannerMissions = true;
      return;
    }
    try {
      const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
      const missionData = await apiRequest(url, "GET", makeMissionHeaders(headers));
      if (!((_a = missionData == null ? void 0 : missionData.value) == null ? void 0 : _a.missions)) {
        log("⚠️ 배너 미션 데이터를 찾을 수 없습니다", "warning");
        state.earnings.bannerMissions = 0;
        state.completed.bannerMissions = true;
        return;
      }
      const missions = missionData.value.missions;
      log(`📋 배너 미션 ${missions.length}개 발견`, "info");
      const incompleteMissions = missions.filter((m) => m.status === "INCOMPLETE");
      const receivableMissions = missions.filter((m) => m.status === "RECEIVABLE");
      const completedMissions = missions.filter((m) => m.status === "COMPLETE" || m.status === "COMPLETED");
      if (completedMissions.length > 0) log(`  ✓ 이미 완료됨: ${completedMissions.length}개`, "info");
      if (incompleteMissions.length === 0 && receivableMissions.length === 0) {
        log("ℹ️ 수령 가능하거나 진행 필요한 배너 미션이 없습니다", "info");
        state.earnings.bannerMissions = 0;
        state.completed.bannerMissions = true;
        return;
      }
      const tabs = [];
      if (incompleteMissions.length > 0) {
        log(`🌐 배너 URL ${incompleteMissions.length}개 방문 중...`, "info");
        for (const mission of incompleteMissions) {
          if ((_b = mission.button_url) == null ? void 0 : _b.trim()) {
            log(`  ⏳ "${mission.title.replace(/<br>/g, " ")}" 방문 중...`, "info");
            const tab = openTabInBackground(mission.button_url, false);
            tabs.push({ tab, mission });
          } else {
            log(`  ⚠️ "${mission.title.replace(/<br>/g, " ")}" - URL 없음, 스킵`, "warning");
          }
          await delay(200);
        }
      }
      if (tabs.length > 0) {
        log(`⏳ ${CONFIG.bannerMissions.visitDelay}ms 대기 후 탭 닫기...`, "info");
        await delay(CONFIG.bannerMissions.visitDelay);
        for (const { tab, mission } of tabs) {
          await closeTabAfterDelay(tab, 0);
          log(`  ✓ "${mission.title.replace(/<br>/g, " ")}" 방문 완료`, "success");
        }
      }
      const claimableMissions = receivableMissions.length > 0 ? receivableMissions : missions.filter((m) => m.status === "RECEIVABLE");
      if (claimableMissions.length > 0) {
        log(`💰 배너 미션 보상 수령 중... (${claimableMissions.length}개)`, "info");
        for (const mission of claimableMissions) {
          const result = await receiveMissionReward(headers, mission.mission_no, componentNo);
          if (result && result.reward_amount) {
            totalEarned += result.reward_amount;
            log(`  ✓ "${mission.title.replace(/<br>/g, " ")}": +${result.reward_amount} FLAKE`, "success");
          } else {
            log(`  ✗ "${mission.title.replace(/<br>/g, " ")}" 수령 실패`, "error");
          }
          await delay(500);
        }
      }
      state.earnings.bannerMissions = totalEarned;
      state.completed.bannerMissions = true;
      if (totalEarned > 0) {
        log(`✅ 배너 미션 ${missions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, "success");
      }
    } catch (error) {
      log(`✗ 배너 미션 오류: ${error.message}`, "error");
    }
    log("✅ 배너 미션 처리 완료!", "success");
  }
  async function executeAttendanceMissions(headers) {
    var _a;
    log("📅 출석 미션 시작...", "info");
    let totalEarned = 0;
    const componentNo = state.missionComponents.attendance;
    if (!componentNo) {
      log("⚠️ 출석 미션 componentNo가 로드되지 않음", "warning");
      state.completed.attendanceMissions = true;
      return;
    }
    try {
      const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
      const missionData = await apiRequest(url, "GET", makeMissionHeaders(headers));
      if (!((_a = missionData == null ? void 0 : missionData.value) == null ? void 0 : _a.missions)) {
        log("⚠️ 출석 미션 데이터를 찾을 수 없습니다", "warning");
        state.earnings.attendanceMissions = 0;
        state.completed.attendanceMissions = true;
        return;
      }
      const missions = missionData.value.missions;
      log(`📋 출석 미션 ${missions.length}개 발견`, "info");
      const receivableMissions = missions.filter((m) => m.status === "RECEIVABLE");
      if (receivableMissions.length === 0) {
        log("ℹ️ 수령 가능한 출석 미션이 없습니다", "info");
        const incompleteMissions = missions.filter((m) => m.status === "INCOMPLETE");
        for (const mission of incompleteMissions) {
          const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_per_cnt || 0}`;
          log(`  📌 ${mission.title}: ${progress} (목표: ${mission.milestone_total_cnt}회)`, "info");
        }
      } else {
        log(`💰 수령 가능한 미션: ${receivableMissions.length}개`, "info");
        for (const mission of receivableMissions) {
          const result = await receiveMissionReward(headers, mission.mission_no, componentNo);
          if (result && result.reward_amount) {
            totalEarned += result.reward_amount;
            log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, "success");
          } else {
            log(`  ✗ "${mission.title}" 수령 실패`, "error");
          }
          await delay(500);
        }
      }
      state.earnings.attendanceMissions = totalEarned;
      state.completed.attendanceMissions = true;
      if (totalEarned > 0) {
        log(`✅ 출석 미션 ${receivableMissions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, "success");
      }
    } catch (error) {
      log(`✗ 출석 미션 오류: ${error.message}`, "error");
    }
    log("✅ 출석 미션 처리 완료!", "success");
  }
  function selectSurveyOption(surveyInfos, strategy = "highest") {
    if (!surveyInfos || surveyInfos.length === 0) return null;
    switch (strategy) {
      case "highest":
        return surveyInfos.reduce((max, info) => info.percent > max.percent ? info : max).content_no;
      case "lowest":
        return surveyInfos.reduce((min, info) => info.percent < min.percent ? info : min).content_no;
      case "random":
        return surveyInfos[Math.floor(Math.random() * surveyInfos.length)].content_no;
      default:
        return surveyInfos.reduce((max, info) => info.percent > max.percent ? info : max).content_no;
    }
  }
  async function executeSurveyMissions(headers) {
    var _a;
    log("📊 설문조사 미션 시작...", "info");
    let totalEarned = 0;
    const componentNo = state.missionComponents.survey;
    if (!componentNo) {
      log("⚠️ 설문조사 미션 componentNo가 로드되지 않음", "warning");
      state.completed.surveyMissions = true;
      return;
    }
    try {
      const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
      const missionHeaders = makeMissionHeaders(headers);
      const missionData = await apiRequest(url, "GET", missionHeaders);
      if (!missionData || missionData.code !== 0 || !((_a = missionData.value) == null ? void 0 : _a.missions)) {
        log("✗ 설문조사 미션 목록 조회 실패", "error");
        state.earnings.surveyMissions = 0;
        state.completed.surveyMissions = true;
        return;
      }
      const missions = missionData.value.missions;
      log(`📝 총 ${missions.length}개 설문조사 확인`, "info");
      const votableMissions = missions.filter((m) => m.status === "RECEIVABLE" && m.mission_type === "SURVEY");
      if (votableMissions.length === 0) {
        log("ℹ️ 투표 가능한 설문조사가 없습니다", "info");
        const completedMissions = missions.filter((m) => m.status === "COMPLETE" || m.status === "COMPLETED");
        if (completedMissions.length > 0) log(`  ✓ 이미 완료됨: ${completedMissions.length}개`, "info");
      } else {
        log(`🗳️ 투표 가능한 설문조사 ${votableMissions.length}개 발견`, "info");
        for (const mission of votableMissions) {
          try {
            log(`📊 "${mission.title}" 투표 중...`, "info");
            const selectedContentNo = selectSurveyOption(mission.survey_infos, CONFIG.surveyMissions.voteStrategy);
            const selectedOption = mission.survey_infos.find((info) => info.content_no === selectedContentNo);
            if (!selectedContentNo) {
              log("  ⚠️ 투표할 항목을 찾을 수 없습니다", "warning");
              continue;
            }
            log(`  🎯 선택: "${selectedOption.content}" (${selectedOption.percent}%)`, "info");
            const voteHeaders = {
              ...makeMissionHeaders(headers),
              "Accept": "application/json",
              "Content-Type": "application/json"
            };
            const voteBody = {
              mission_no: mission.mission_no,
              component_no: componentNo,
              content_nos: [selectedContentNo]
            };
            const voteUrl = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;
            const voteResult = await apiRequest(voteUrl, "POST", voteHeaders, voteBody);
            if (voteResult && voteResult.code === 0 && voteResult.value) {
              const reward = voteResult.value.reward_amount || 0;
              totalEarned += reward;
              log(`  ✓ 투표 완료: +${reward} FLAKE`, "success");
            } else {
              log("  ✗ 투표 실패", "error");
            }
          } catch (error) {
            log(`  ✗ "${mission.title}" 투표 실패: ${error.message}`, "error");
          }
          await delay(CONFIG.delays.betweenActions);
        }
        log(`✅ 설문조사 투표 완료: +${totalEarned} FLAKE`, "success");
      }
      state.earnings.surveyMissions = totalEarned;
      state.completed.surveyMissions = true;
      const completedCount = missions.filter((m) => m.status === "COMPLETE" || m.status === "COMPLETED").length;
      log(`📊 설문조사 진행 상황: ${completedCount}/${missions.length} 완료`, "info");
    } catch (error) {
      log(`✗ 설문조사 미션 오류: ${error.message}`, "error");
    }
    log("✅ 설문조사 미션 처리 완료!", "success");
  }
  async function executePrizeEntry(headers) {
    log("🎁 경품 응모 시작...", "info");
    let netEarnings = 0;
    try {
      const today = getKSTDate();
      const lastEntryDate = sessionStorage.getItem("prize_entry_last_date");
      if (lastEntryDate === today) {
        log("ℹ️ 오늘 이미 경품 응모를 완료했습니다", "info");
        state.earnings.prizeEntry = 0;
        state.completed.prizeEntry = true;
        return;
      }
      const eventNo = getPrizeEventNo();
      const giftNo = getPrizeGiftNo();
      const flakeCost = getPrizeFlakeCost();
      const giftName = state.prizeInfo.giftName || CONFIG.prizeEntry.targetGiftName || "스토브 5,000 포인트";
      log(`⏳ 경품 응모 진행 중... (${giftName}, 비용: ${flakeCost} FLAKE)`, "info");
      const applyHeaders = {
        ...makeMissionHeaders(headers),
        "Accept": "application/json",
        "Content-Type": "application/json"
      };
      const applyUrl = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/apply/${eventNo}`;
      const applyBody = { gift_no: giftNo, req_cnt: 1 };
      const applyResult = await apiRequest(applyUrl, "POST", applyHeaders, applyBody);
      if (!applyResult || applyResult.code !== 0) {
        log(`✗ 경품 응모 실패: ${(applyResult == null ? void 0 : applyResult.message) || "알 수 없는 오류"}`, "error");
        return;
      }
      log(`  ✓ 경품 응모 완료! (응모 번호: ${applyResult.value.user_apply_cnt})`, "success");
      log(`  💰 잔여 FLAKE: ${applyResult.value.residue_flake}`, "info");
      netEarnings -= flakeCost;
      sessionStorage.setItem("prize_entry_last_date", today);
      log(`  📅 응모 날짜 기록: ${today} (KST)`, "info");
      log("⏳ 경품 응모 미션 보상 확인 중...", "info");
      const result = await receiveMissionReward(headers, CONFIG.prizeEntry.missionNo, state.missionComponents.daily);
      if (result && result.reward_amount) {
        netEarnings += result.reward_amount;
        log(`  ✓ 미션 보상 수령 완료: +${result.reward_amount} FLAKE`, "success");
      }
      state.earnings.prizeEntry = netEarnings;
      state.completed.prizeEntry = true;
      const profitSign = netEarnings >= 0 ? "+" : "";
      if (netEarnings !== 0) {
        log(`✅ 경품 응모 완료! 순수익: ${profitSign}${netEarnings} FLAKE`, netEarnings >= 0 ? "success" : "info");
      }
    } catch (error) {
      log(`✗ 경품 응모 오류: ${error.message}`, "error");
    }
    log("✅ 경품 응모 처리 완료!", "success");
  }
  async function autoParticipateVisitMissions(headers) {
    try {
      log("[SINGLE 미션] 자동 참여 시작", "info");
      const allMissions = await getAllDailyMissions(headers);
      if (!allMissions || allMissions.length === 0) {
        log("[SINGLE 미션] 조회된 미션 없음", "warning");
        return { success: false, participated: 0, completed: 0 };
      }
      const singleMissions = [];
      allMissions.forEach((comp) => {
        const missions = comp.missions || [];
        missions.forEach((mission) => {
          if (mission.mission_type === "SINGLE" && mission.status === "INCOMPLETE" && !CONFIG.dailyMissions.skipMissions.includes(mission.mission_no)) {
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
        log("[SINGLE 미션] 참여 가능한 미션 없음", "info");
        return { success: true, participated: 0, completed: 0 };
      }
      log(`[SINGLE 미션] ${singleMissions.length}개 발견`, "info");
      let participated = 0;
      let completed = 0;
      for (const mission of singleMissions) {
        try {
          log(`[SINGLE 미션] "${mission.title}" 참여 중...`, "info");
          const result = await participateMission(headers, mission.mission_no, mission.component_no);
          if (result == null ? void 0 : result.value) {
            const status = result.value.status;
            if (status === "RECEIVABLE") {
              log(`[SINGLE 미션] ✅ "${mission.title}" 참여 완료 (수령 가능)`, "success");
              participated++;
            } else if (status === "COMPLETE" || status === "COMPLETED") {
              log(`[SINGLE 미션] 🎁 "${mission.title}" 보상 수령 완료 (+${mission.reward_amount} 플레이크)`, "success");
              completed++;
            } else {
              log(`[SINGLE 미션] ⚠️ "${mission.title}" 참여 실패 (상태: ${status})`, "warning");
            }
          } else {
            log(`[SINGLE 미션] ⚠️ "${mission.title}" 응답 없음`, "warning");
          }
          await delay(1e3);
        } catch (error) {
          log(`[SINGLE 미션] ❌ "${mission.title}" 오류: ${error.message}`, "error");
        }
      }
      log(`[SINGLE 미션] 총 참여: ${participated}개, 즉시 완료: ${completed}개`, "success");
      return { success: true, participated, completed, total: singleMissions.length };
    } catch (error) {
      log(`[SINGLE 미션] 오류: ${error.message}`, "error");
      return { success: false, error: error.message };
    }
  }
  async function getMyProfile(headers) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/user/me?timestemp=${getTimestamp()}`;
    const profileHeaders = {
      ...headers,
      "caller-id": "indie-web-my",
      "Origin": "https://profile.onstove.com",
      "Referer": "https://profile.onstove.com/"
    };
    if (profileHeaders["X-UUID"]) {
      profileHeaders["caller-detail"] = profileHeaders["X-UUID"];
      delete profileHeaders["X-UUID"];
    }
    const response = await apiRequest(url, "GET", profileHeaders);
    return response;
  }
  async function getMyArticles(headers, userId, size = 10) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/interest/user/${userId}/article/list?user_id=${userId}&sort=LATEST&size=${size}&type=WRITE&timestemp=${getTimestamp()}`;
    const myHeaders = {
      ...headers,
      "caller-id": "indie-my",
      "x-lang": "ko",
      "x-nation": "KR",
      "x-device-type": "P01",
      "Origin": "https://profile.onstove.com",
      "Referer": "https://profile.onstove.com/"
    };
    const response = await apiRequest(url, "GET", myHeaders);
    return response;
  }
  async function getMonthlyFlakeTotal(headers) {
    try {
      const dateRange = getCurrentMonthDateRange();
      const url = `${CONFIG.api.baseUrl}/mileage/v2.0/master/deposit/total?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY&start_date=${dateRange.startDate}&end_date=${dateRange.endDate}`;
      const mileageHeaders = {
        "Authorization": headers["Authorization"],
        "caller-id": "flake-fe",
        "caller-detail": headers["X-UUID"] || headers["caller-detail"],
        "Content-Type": "application/json;charset=utf-8",
        "Accept": "*/*",
        "Origin": "https://reward.onstove.com",
        "Referer": "https://reward.onstove.com/"
      };
      const response = await apiRequest(url, "GET", mileageHeaders);
      if (response && response.code === 0 && response.value) {
        return response.value.total_deposit_amount || 0;
      }
      return 0;
    } catch (error) {
      console.warn("[FLAKE] 월간 플레이크 조회 실패:", error.message);
      return 0;
    }
  }
  async function getTotalFlakeBalance(headers) {
    try {
      const url = `${CONFIG.api.baseUrl}/mileage/v1.0/balance?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY`;
      const mileageHeaders = {
        "Authorization": headers["Authorization"],
        "caller-id": "flake-fe",
        "caller-detail": headers["X-UUID"] || headers["caller-detail"],
        "Content-Type": "application/json;charset=utf-8",
        "Accept": "*/*",
        "Origin": "https://reward.onstove.com",
        "Referer": "https://reward.onstove.com/"
      };
      const response = await apiRequest(url, "GET", mileageHeaders);
      if (response && response.code === 0 && response.value) {
        return response.value.mileage_amount || 0;
      }
      return 0;
    } catch (error) {
      console.error("[FLAKE] 총 플레이크 조회 실패:", error);
      return 0;
    }
  }
  function updateStatusUI(statusData) {
    var _a, _b, _c, _d;
    const articleWriteEl = document.getElementById("stove-status-article");
    if (articleWriteEl && statusData.articleWrite) {
      if (statusData.articleWrite.loading) {
        articleWriteEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
      } else if (statusData.articleWrite.success) {
        const { hasWrittenToday, todayCount } = statusData.articleWrite;
        if (hasWrittenToday) {
          articleWriteEl.innerHTML = `<span style="color: #10b981">✅ 오늘 ${todayCount}개 작성</span>`;
        } else {
          articleWriteEl.innerHTML = '<span style="color: #f59e0b">✍️ 아직 작성 안 함</span>';
        }
      } else {
        articleWriteEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
      }
    }
    if (statusData.dailyMission) {
      if (statusData.dailyMission.loading) {
        ["daily", "weekly", "content", "attendance"].forEach((cat) => {
          const el = document.getElementById(`stove-status-mission-${cat}`);
          if (el) el.innerHTML = '<span style="color: #3b82f6">⏳</span>';
        });
      } else if (statusData.dailyMission.success && statusData.dailyMission.categories) {
        const categories = statusData.dailyMission.categories;
        ["daily", "weekly", "content", "attendance"].forEach((catKey) => {
          const el = document.getElementById(`stove-status-mission-${catKey}`);
          const cat = categories[catKey];
          if (el) {
            if (!cat || cat.total === 0) {
              el.innerHTML = '<span style="color: #6b7280">-</span>';
              return;
            }
            const { completed, receivable, total, missions } = cat;
            let statusHTML = "";
            if (catKey === "attendance") {
              const attendanceMission = missions.find((m) => m.milestone_per_cnt && m.user_complete_cnt !== void 0);
              if (attendanceMission) {
                statusHTML = `<span style="color: #6b7280">${attendanceMission.milestone_per_cnt}일중 ${attendanceMission.user_complete_cnt}일출석</span>`;
              } else if (receivable > 0) {
                statusHTML = `<span style="color: #f59e0b">🎁 ${receivable}개</span>`;
              } else {
                statusHTML = '<span style="color: #6b7280">-</span>';
              }
            } else {
              if (completed === total) {
                statusHTML = '<span style="color: #10b981">✅ 완료</span>';
              } else if (receivable > 0) {
                statusHTML = `<span style="color: #f59e0b">🎁 ${receivable}개</span>`;
              } else if (completed === 0) {
                statusHTML = '<span style="color: #6b7280">받을 보상 없음</span>';
              } else {
                statusHTML = `<span style="color: #6b7280">${completed}/${total}</span>`;
              }
            }
            el.innerHTML = statusHTML;
            const parentItem = el.closest(".stove-mission-item");
            if (parentItem && missions && missions.length > 0) {
              const existingTooltip = parentItem.querySelector(".stove-mission-tooltip");
              if (existingTooltip) existingTooltip.remove();
              const tooltip = document.createElement("div");
              tooltip.className = "stove-mission-tooltip";
              const catLabel = catKey === "daily" ? "📅 데일리 미션" : catKey === "weekly" ? "📆 위클리 미션" : catKey === "content" ? "💬 컨텐츠" : "📆 월간출석";
              let tooltipHTML = `<div class="stove-mission-tooltip-title">${catLabel}</div>`;
              missions.forEach((mission) => {
                const statusIcon = mission.status === "COMPLETE" || mission.status === "COMPLETED" ? "✅" : mission.status === "RECEIVABLE" ? "🎁" : "⏳";
                const statusColor = mission.status === "COMPLETE" || mission.status === "COMPLETED" ? "#10b981" : mission.status === "RECEIVABLE" ? "#f59e0b" : "#6b7280";
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
        ["daily", "weekly", "content", "attendance"].forEach((cat) => {
          const el = document.getElementById(`stove-status-mission-${cat}`);
          if (el) el.innerHTML = '<span style="color: #ef4444">❌</span>';
        });
      }
    }
    const rouletteEl = document.getElementById("stove-status-roulette");
    if (rouletteEl && statusData.roulette) {
      if (statusData.roulette.loading) {
        rouletteEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
      } else if (statusData.roulette.success) {
        const { current, limit, remaining } = statusData.roulette;
        const color = remaining > 0 ? "#10b981" : "#6b7280";
        rouletteEl.innerHTML = `<span style="color: ${color}">${current}/${limit} (${remaining}회 남음)</span>`;
      } else {
        rouletteEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
      }
    }
    const dailyShopEl = document.getElementById("stove-status-daily");
    if (dailyShopEl && statusData.dailyShop) {
      if (statusData.dailyShop.loading) {
        dailyShopEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
      } else if (statusData.dailyShop.success) {
        const { received, notReceived, noRewardToday } = statusData.dailyShop;
        if (received) {
          dailyShopEl.innerHTML = '<span style="color: #10b981">✅ 전부 완료</span>';
        } else if (notReceived) {
          dailyShopEl.innerHTML = '<span style="color: #f59e0b">📦 보상 받지 않음</span>';
        } else if (noRewardToday) {
          dailyShopEl.innerHTML = '<span style="color: #9ca3af">⚠️ 오늘 보상 없음</span>';
        } else {
          dailyShopEl.innerHTML = '<span style="color: #6b7280">-</span>';
        }
      } else {
        dailyShopEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
      }
    }
    const majakShopEl = document.getElementById("stove-status-majak");
    if (majakShopEl && statusData.majakShop) {
      if (statusData.majakShop.loading) {
        majakShopEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
      } else if (statusData.majakShop.success) {
        const { received, notReceived, noRewardToday } = statusData.majakShop;
        if (received) {
          majakShopEl.innerHTML = '<span style="color: #10b981">✅ 전부 완료</span>';
        } else if (notReceived) {
          majakShopEl.innerHTML = '<span style="color: #f59e0b">🀄 보상 받지 않음</span>';
        } else if (noRewardToday) {
          majakShopEl.innerHTML = '<span style="color: #9ca3af">⚠️ 오늘 보상 없음</span>';
        } else {
          majakShopEl.innerHTML = '<span style="color: #6b7280">-</span>';
        }
      } else {
        majakShopEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
      }
    }
    const surveyEl = document.getElementById("stove-status-survey");
    if (surveyEl && statusData.survey) {
      if (statusData.survey.loading) {
        surveyEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
      } else if (statusData.survey.success) {
        const { notAvailable, noMissions, completed, receivable, total, allCompleted } = statusData.survey;
        if (notAvailable) {
          surveyEl.innerHTML = '<span style="color: #6b7280">비활성화</span>';
        } else if (noMissions) {
          surveyEl.innerHTML = '<span style="color: #6b7280">미션 없음</span>';
        } else if (allCompleted) {
          surveyEl.innerHTML = '<span style="color: #10b981">✅ 전부 완료</span>';
        } else if (receivable > 0) {
          surveyEl.innerHTML = `<span style="color: #f59e0b">📊 ${receivable}개 투표 가능</span>`;
        } else if (completed > 0) {
          surveyEl.innerHTML = `<span style="color: #6b7280">${completed}/${total}</span>`;
        } else {
          surveyEl.innerHTML = '<span style="color: #6b7280">-</span>';
        }
      } else {
        surveyEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
      }
    }
    const totalFlakeEl = document.getElementById("stove-status-total-flake");
    if (totalFlakeEl && statusData.totalFlake !== void 0) {
      if ((_a = statusData.totalFlake) == null ? void 0 : _a.loading) {
        totalFlakeEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
      } else if ((_b = statusData.totalFlake) == null ? void 0 : _b.error) {
        totalFlakeEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
      } else {
        totalFlakeEl.innerHTML = `<span style="color: #10b981">${statusData.totalFlake.toLocaleString()} F</span>`;
      }
    }
    const monthlyFlakeEl = document.getElementById("stove-status-monthly-flake");
    if (monthlyFlakeEl && statusData.monthlyFlake !== void 0) {
      if ((_c = statusData.monthlyFlake) == null ? void 0 : _c.loading) {
        monthlyFlakeEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
      } else if ((_d = statusData.monthlyFlake) == null ? void 0 : _d.error) {
        monthlyFlakeEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
      } else {
        monthlyFlakeEl.innerHTML = `<span style="color: #10b981">+${statusData.monthlyFlake.toLocaleString()} F</span>`;
      }
    }
  }
  async function checkRouletteStatus(headers) {
    try {
      const participationInfo = await getRouletteParticipationCount(headers, getRouletteSubEventNo());
      if (participationInfo == null ? void 0 : participationInfo.value) {
        const maxDraws = CONFIG.roulette.maxDraws;
        const current = participationInfo.value.participation_cnt || 0;
        const remaining = Math.max(0, maxDraws - current);
        return { success: true, current, limit: maxDraws, remaining };
      }
      return { success: false, error: "데이터 없음" };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  async function checkDailyShopStatus(headers) {
    var _a;
    try {
      const dailyShopData = await getDailyShopRewards(headers);
      if ((_a = dailyShopData == null ? void 0 : dailyShopData.value) == null ? void 0 : _a.daily_attendances) {
        const rewards = dailyShopData.value.daily_attendances.rewards || [];
        const todayString = getTodayString();
        const todayReward = rewards.find((reward) => reward.attendance_date === todayString);
        if (todayReward) {
          return { success: true, received: todayReward.is_received, notReceived: !todayReward.is_received };
        } else {
          return { success: true, received: false, notReceived: false, noRewardToday: true };
        }
      }
      return { success: false, error: "데이터 없음" };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  async function checkMajakShopStatus(headers) {
    var _a;
    try {
      const majakShopData = await getMajakDailyShopRewards(headers);
      if ((_a = majakShopData == null ? void 0 : majakShopData.value) == null ? void 0 : _a.daily_attendances) {
        const rewards = majakShopData.value.daily_attendances.rewards || [];
        const todayString = getTodayString();
        const todayReward = rewards.find((reward) => reward.attendance_date === todayString);
        if (todayReward) {
          return { success: true, received: todayReward.is_received, notReceived: !todayReward.is_received };
        } else {
          return { success: true, received: false, notReceived: false, noRewardToday: true };
        }
      }
      return { success: false, error: "데이터 없음" };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  async function checkSurveyStatus(headers) {
    var _a;
    try {
      if (!CONFIG.surveyMissions.enabled) ;
      const componentNo = state.missionComponents.survey;
      if (!componentNo) return { success: true, notAvailable: true };
      const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
      const response = await apiRequest(url, "GET", headers);
      if ((response == null ? void 0 : response.code) === 0 && ((_a = response.value) == null ? void 0 : _a.missions)) {
        const missions = response.value.missions;
        if (missions.length === 0) return { success: true, noMissions: true };
        let completed = 0;
        let receivable = 0;
        const total = missions.length;
        missions.forEach((mission) => {
          if (mission.status === "COMPLETE" || mission.status === "COMPLETED") completed++;
          else if (mission.status === "RECEIVABLE") receivable++;
        });
        return { success: true, completed, receivable, total, allCompleted: completed === total };
      }
      return { success: false, error: "데이터 없음" };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  async function checkDailyMissionStatus(headers) {
    try {
      const allMissions = await getAllDailyMissions(headers);
      if (!allMissions || allMissions.length === 0) {
        return { success: false, error: "데이터 없음" };
      }
      const categories = {
        daily: { components: [], missions: [] },
        weekly: { components: [], missions: [] },
        content: { components: [], missions: [] },
        attendance: { components: [], missions: [] }
      };
      allMissions.forEach((comp) => {
        var _a;
        const type = (_a = comp.component_info) == null ? void 0 : _a.component_type;
        const componentNo = comp.componentNo;
        const missions = comp.missions || [];
        if (type === "SINGLE") {
          categories.daily.components.push(comp.component_info);
          categories.daily.missions.push(...missions);
        } else if (type === "ACCUMULATION") {
          const bucket = componentNo === state.missionComponents.weekly ? "weekly" : "attendance";
          categories[bucket].components.push(comp.component_info);
          categories[bucket].missions.push(...missions);
        } else if (type === "CONTENT1") {
          categories.content.components.push(comp.component_info);
          categories.content.missions.push(...missions);
        }
      });
      const result = {};
      Object.keys(categories).forEach((key) => {
        const missions = categories[key].missions;
        if (missions.length > 0) {
          result[key] = {
            total: missions.length,
            completed: missions.filter((m) => m.status === "COMPLETE" || m.status === "COMPLETED").length,
            receivable: missions.filter((m) => m.status === "RECEIVABLE").length,
            incomplete: missions.filter((m) => m.status === "INCOMPLETE").length,
            components: categories[key].components,
            missions
          };
        }
      });
      return { success: true, categories: result };
    } catch (e) {
      console.error("[데일리 미션 상태 체크 오류]", e);
      return { success: false, error: e.message };
    }
  }
  async function checkArticleWriteStatus(headers) {
    var _a, _b;
    try {
      const profileData = await getMyProfile(headers);
      if (!((_a = profileData == null ? void 0 : profileData.value) == null ? void 0 : _a.user_id)) {
        return { success: false, error: "프로필 정보 없음" };
      }
      const userId = profileData.value.user_id;
      const articlesData = await getMyArticles(headers, userId, 10);
      if (!((_b = articlesData == null ? void 0 : articlesData.value) == null ? void 0 : _b.list)) {
        return { success: false, error: "게시글 목록 없음" };
      }
      const articles = articlesData.value.list;
      const now = /* @__PURE__ */ new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const todayEnd = todayStart + 24 * 60 * 60 * 1e3;
      const todayArticles = articles.filter((article) => {
        const articleTime = article.datetime;
        return articleTime >= todayStart && articleTime < todayEnd;
      });
      return { success: true, hasWrittenToday: todayArticles.length > 0, todayCount: todayArticles.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  async function visitRequiredPages() {
    log("🌐 필수 페이지 방문 시작...", "info");
    try {
      log("  📋 리워드샵 페이지 방문 중...", "info");
      const rewardTab = openTabInBackground("https://reward.onstove.com/ko", false);
      log("  🏠 스토브 메인 페이지 방문 중...", "info");
      const stoveTab = openTabInBackground("https://www.onstove.com/ko", false);
      await delay(3e3);
      await closeTabAfterDelay(rewardTab, 0);
      await closeTabAfterDelay(stoveTab, 0);
      log("✓ 필수 페이지 방문 완료", "success");
    } catch (error) {
      log(`⚠️ 페이지 방문 중 오류: ${error.message}`, "warning");
    }
  }
  async function checkAllStatus() {
    console.log("[상태 확인 시작]");
    try {
      const headers = extractHeaders();
      updateStatusUI({
        articleWrite: { loading: true },
        dailyMission: { loading: true },
        roulette: { loading: true },
        dailyShop: { loading: true },
        majakShop: { loading: true },
        survey: { loading: true },
        totalFlake: { loading: true },
        monthlyFlake: { loading: true }
      });
      if (!Object.values(state.missionComponents).some(Boolean)) {
        await getMissionComponentIds(headers);
      }
      const [articleWriteStatus, dailyMissionStatus, rouletteStatus, dailyShopStatus, majakShopStatus, surveyStatus, totalFlake, monthlyFlake] = await Promise.all([
        checkArticleWriteStatus(headers),
        checkDailyMissionStatus(headers),
        checkRouletteStatus(headers),
        checkDailyShopStatus(headers),
        checkMajakShopStatus(headers),
        checkSurveyStatus(headers),
        getTotalFlakeBalance(headers),
        getMonthlyFlakeTotal(headers)
      ]);
      updateStatusUI({
        articleWrite: articleWriteStatus,
        dailyMission: dailyMissionStatus,
        roulette: rouletteStatus,
        dailyShop: dailyShopStatus,
        majakShop: majakShopStatus,
        survey: surveyStatus,
        totalFlake,
        monthlyFlake
      });
      console.log("[상태 확인] ✅ 완료");
    } catch (error) {
      console.error("[상태 확인 오류]", error);
      alert(`상태 확인 실패: ${error.message}`);
      updateStatusUI({
        articleWrite: { success: false, error: "확인 실패" },
        dailyMission: { success: false, error: "확인 실패" },
        roulette: { success: false, error: "확인 실패" },
        dailyShop: { success: false, error: "확인 실패" },
        majakShop: { success: false, error: "확인 실패" },
        survey: { success: false, error: "확인 실패" },
        totalFlake: { error: true },
        monthlyFlake: { error: true }
      });
    }
  }
  async function runAutomation() {
    if (state.isRunning) {
      log("이미 자동화가 실행 중입니다", "warning");
      return;
    }
    state.isRunning = true;
    setButtonState(true);
    const progressSection = document.querySelector(".stove-progress-section");
    if (progressSection) {
      const rect = progressSection.getBoundingClientRect();
      const offsetTop = window.pageYOffset + rect.top - window.innerHeight * 0.3 + rect.height / 2;
      window.scrollTo({ top: offsetTop, behavior: "smooth" });
    }
    state.earnings = {
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
    };
    try {
      log("🚀 전체 자동화 시작", "info");
      log("헤더 정보 추출 중...", "info");
      const headers = extractHeaders();
      log("✓ 헤더 정보 추출 완료", "success");
      log("", "info");
      log("📰 게시글 목록 가져오는 중...", "info");
      const articles = await getArticleList(headers, 30);
      log(`✓ 게시글 ${articles.length}개 발견`, "success");
      if (articles.length === 0) {
        log("❌ 게시글이 없습니다", "error");
        state.isRunning = false;
        setButtonState(false);
        return;
      }
      await delay(CONFIG.delays.betweenActions);
      log("💬 Step 0: 댓글 작성 시작 (10초 딜레이)...", "info");
      const maxComments = Math.min(CONFIG.targets.comments, articles.length);
      const commentPromise = (async () => {
        for (let i = 0; i < maxComments; i++) {
          try {
            const commentId = await postComment(headers, articles[i].article_id, CONFIG.comment);
            log(`✓ 댓글 작성 완료: ${commentId}`, "success");
            state.createdCommentIds.push(commentId);
            state.progress.comments++;
            updateProgress("comments", state.progress.comments, CONFIG.targets.comments);
          } catch (e) {
            log(`✗ 댓글 작성 실패: ${e.message}`, "error");
          }
          if (i < maxComments - 1) await delay(CONFIG.delays.afterComment);
        }
        log("✓ Step 0 완료: 모든 댓글 작성 완료", "success");
      })();
      log("", "info");
      log("✍️ Step 1: 새글 작성 시작...", "info");
      const writeStatus = await checkArticleWriteStatus(headers);
      if (writeStatus.success && writeStatus.hasWrittenToday) {
        log(`⏩ 오늘 이미 ${writeStatus.todayCount}개 글 작성 완료, 새글 작성 스킵`, "info");
        state.progress.newArticle = CONFIG.targets.newArticle;
        updateProgress("new-article", state.progress.newArticle, CONFIG.targets.newArticle);
      } else {
        try {
          const articleId = await createArticle(headers, "출석", "출석");
          if (articleId) {
            state.progress.newArticle++;
            updateProgress("new-article", state.progress.newArticle, CONFIG.targets.newArticle);
            log(`✓ Step 1 완료: 새글 작성 완료! 게시글 ID: ${articleId}`, "success");
          }
        } catch (e) {
          log(`✗ 새글 작성 실패: ${e.message}`, "error");
          log("⚠️ 새글 작성 실패했지만 자동화를 계속 진행합니다", "warning");
        }
      }
      await delay(CONFIG.delays.betweenActions);
      log("👍 Step 2: 게시글 추천 시작...", "info");
      const targetArticleLikes = CONFIG.targets.articleLikes;
      const candidateCount = Math.min(targetArticleLikes * 3, articles.length);
      const candidateArticles = articles.slice(0, candidateCount);
      const candidateArticleIds = candidateArticles.map((a) => a.article_id);
      const articleLikeStatuses = await checkArticleLikeStatus(headers, candidateArticleIds);
      const unlikedArticles = candidateArticles.filter(
        (article) => {
          var _a;
          return ((_a = articleLikeStatuses[article.article_id]) == null ? void 0 : _a.LIKE) !== true;
        }
      );
      log(`✓ 좋아요 안 누른 게시글 ${unlikedArticles.length}개 발견`, "success");
      const articlesToLike = unlikedArticles.slice(0, targetArticleLikes);
      for (let i = 0; i < articlesToLike.length; i++) {
        const articleId = articlesToLike[i].article_id;
        try {
          await likeArticle(headers, articleId);
          state.progress.articleLikes++;
          updateProgress("article-likes", state.progress.articleLikes, CONFIG.targets.articleLikes);
          log(`✓ 게시글 ${articleId} 좋아요 완료 (${state.progress.articleLikes}/${targetArticleLikes})`, "success");
        } catch (e) {
          log(`✗ 게시글 ${articleId} 좋아요 실패: ${e.message}`, "error");
        }
        if (i < articlesToLike.length - 1) await delay(CONFIG.delays.betweenActions);
      }
      while (state.progress.articleLikes < targetArticleLikes) {
        state.progress.articleLikes++;
        updateProgress("article-likes", state.progress.articleLikes, CONFIG.targets.articleLikes);
      }
      log("✓ Step 2 완료: 게시글 추천 완료", "success");
      await delay(CONFIG.delays.betweenActions);
      log("", "info");
      log("🎯 Step 3: SINGLE 미션 자동 참여 시작...", "info");
      await autoParticipateVisitMissions(headers);
      await delay(CONFIG.delays.betweenActions);
      log("✅ 퀘스트 주요 작업 완료!", "success");
      log("", "info");
      await visitRequiredPages();
      log("", "info");
      log("🔄 미션 컴포넌트 ID 로드 중...", "info");
      const missionComponents = await getMissionComponentIds(headers);
      if (!missionComponents) log("⚠️ 미션 컴포넌트 로드 실패 - 미션 기능이 제한될 수 있습니다", "warning");
      log("🎰 룰렛 이벤트 ID 로드 중...", "info");
      const rouletteEvents = await getRouletteEventIds(headers);
      if (!rouletteEvents) {
        log("⚠️ 룰렛 이벤트 ID 로드 실패 - CONFIG 값 사용", "warning");
      } else {
        log(`✓ 룰렛 ID: ${rouletteEvents.draw}, EXTRA ID: ${rouletteEvents.extra}`, "success");
      }
      if (CONFIG.prizeEntry.enabled) {
        log("🎁 경품 정보 로드 중...", "info");
        const prizeInfo = await getPrizeInfo(headers);
        if (!prizeInfo) {
          log("⚠️ 경품 정보 로드 실패 - CONFIG 값 사용", "warning");
        } else {
          log(`✓ 경품: ${prizeInfo.giftName || CONFIG.prizeEntry.targetGiftName}`, "success");
        }
      }
      log("", "info");
      await executePrizeEntry(headers);
      log("", "info");
      await executeDailyMissions(headers);
      log("", "info");
      await executeContentMissions(headers);
      log("", "info");
      await executeWeeklyMissions(headers);
      log("", "info");
      await executeBannerMissions(headers);
      log("", "info");
      await executeAttendanceMissions(headers);
      log("", "info");
      await executeSurveyMissions(headers);
      log("", "info");
      await runRouletteDraws(headers);
      log("", "info");
      log("📝 댓글 작성 완료 확인 중...", "info");
      await commentPromise;
      log("", "info");
      log("💝 데일리 보상 수령 시작...", "info");
      await claimDailyShopRewards(headers);
      log("", "info");
      log("🀄 마작 리워드 수령 시작...", "info");
      await claimMajakDailyShopRewards(headers);
      log("", "info");
      await claimRouletteExtraRewards(headers);
      log("", "info");
      const dailyAccumulatedFlake = await claimDailyAccumulatedRewards(headers);
      const articleWriteFlake = 200;
      const articleLikeFlake = state.progress.articleLikes * 3;
      const commentFlake = state.progress.comments * 30;
      const questActivityFlake = articleWriteFlake + articleLikeFlake + commentFlake;
      let totalEarnings = (questActivityFlake || 0) + (state.earnings.roulette || 0) + (state.earnings.rouletteExtra || 0) + (state.earnings.dailyShop || 0) + (state.earnings.majak || 0) + (state.earnings.dailyMissions || 0) + (state.earnings.contentMissions || 0) + (state.earnings.weeklyMissions || 0) + (state.earnings.bannerMissions || 0) + (state.earnings.attendanceMissions || 0) + (state.earnings.surveyMissions || 0) + (state.earnings.prizeEntry || 0) + (dailyAccumulatedFlake || 0);
      if (isNaN(totalEarnings)) {
        log("⚠️ 수익 계산 오류 발생 - 일부 값이 유효하지 않음", "warning");
        totalEarnings = 0;
      }
      const profitSign = totalEarnings >= 0 ? "+" : "";
      log("", "info");
      log("🎉 전체 자동화 완료!", "success");
      log("", "info");
      log("═══════════════════════════════════════", "info");
      log("💰 최종 FLAKE 수익 요약", "success");
      log("═══════════════════════════════════════", "info");
      log(`  ✍️  글쓰기: ${articleWriteFlake} FLAKE`, "success");
      log(`  👍 게시글 좋아요: ${articleLikeFlake} FLAKE (${state.progress.articleLikes}회 × 3)`, articleLikeFlake > 0 ? "success" : "info");
      log(`  💬 댓글 쓰기: ${commentFlake} FLAKE (${state.progress.comments}회 × 30)`, commentFlake > 0 ? "success" : "info");
      log(`  📋 데일리 미션: ${state.earnings.dailyMissions} FLAKE`, state.earnings.dailyMissions > 0 ? "success" : "info");
      log(`  📰 컨텐츠 미션: ${state.earnings.contentMissions} FLAKE`, state.earnings.contentMissions > 0 ? "success" : "info");
      log(`  📅 위클리 미션: ${state.earnings.weeklyMissions} FLAKE`, state.earnings.weeklyMissions > 0 ? "success" : "info");
      log(`  🎨 배너 미션: ${state.earnings.bannerMissions} FLAKE`, state.earnings.bannerMissions > 0 ? "success" : "info");
      log(`  📆 출석 미션: ${state.earnings.attendanceMissions} FLAKE`, state.earnings.attendanceMissions > 0 ? "success" : "info");
      log(`  📊 설문조사: ${state.earnings.surveyMissions} FLAKE`, state.earnings.surveyMissions > 0 ? "success" : "info");
      const prizeEntrySign = state.earnings.prizeEntry >= 0 ? "+" : "";
      log(`  🎁 경품 응모: ${prizeEntrySign}${state.earnings.prizeEntry} FLAKE`, state.earnings.prizeEntry >= 0 ? "success" : "warning");
      log(`  🎰 룰렛 순수익: ${profitSign}${state.earnings.roulette} FLAKE`, state.earnings.roulette >= 0 ? "success" : "warning");
      log(`  🎁 룰렛 EXTRA: ${state.earnings.rouletteExtra} FLAKE`, state.earnings.rouletteExtra > 0 ? "success" : "info");
      log(`  💝 데일리 보상: ${state.earnings.dailyShop} FLAKE`, state.earnings.dailyShop > 0 ? "success" : "info");
      log(`  🎁 데일리 누적 보상: ${dailyAccumulatedFlake} FLAKE`, dailyAccumulatedFlake > 0 ? "success" : "info");
      log(`  🀄 마작 리워드: ${state.earnings.majak} FLAKE`, state.earnings.majak > 0 ? "success" : "info");
      log("───────────────────────────────────────", "info");
      log(`  📊 총 순수익: ${profitSign}${totalEarnings} FLAKE`, totalEarnings >= 0 ? "success" : "warning");
      log("═══════════════════════════════════════", "info");
      playCompletionSound();
      state.completed.roulette = true;
      state.completed.dailyShop = true;
      state.completed.majak = true;
      const progressFill = document.querySelector(".stove-progress-fill");
      if (progressFill) progressFill.style.width = "100%";
      const progressText = document.getElementById("stove-progress-text");
      if (progressText) {
        progressText.style.display = "block";
        progressText.textContent = "100%";
      }
      log("", "info");
      log("📊 상태 업데이트 중...", "info");
      await checkAllStatus();
      log("✅ 상태 업데이트 완료!", "success");
      log("", "info");
      log("🎊 모든 작업이 완료되었습니다!", "success");
    } catch (error) {
      log(`✗ 오류 발생: ${error.message}`, "error");
    } finally {
      state.isRunning = false;
      setButtonState(false);
    }
  }
  function createUI() {
    if (document.getElementById("stove-quest-automation")) return;
    const container = document.createElement("div");
    container.id = "stove-quest-automation";
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
            .stove-panel-title { flex: 1; }
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
            .stove-btn:active:not(:disabled) { transform: translateY(0); }
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
            .stove-log-copy-btn:hover { background: #3a3a3a; border-color: #4a4a4a; }
            #stove-log-content {
                font-size: 13px;
                line-height: 1.5;
                font-family: 'Courier New', monospace;
            }
            .stove-log-section::-webkit-scrollbar { width: 8px; }
            .stove-log-section::-webkit-scrollbar-track { background: #1a1a1a; border-radius: 4px; }
            .stove-log-section::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 4px; }
            .stove-log-section::-webkit-scrollbar-thumb:hover { background: #4a4a4a; }
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
            .stove-status-refresh:hover { background: #3a3a3a; border-color: #4a4a4a; }
            .stove-status-list { display: grid; grid-template-columns: 1fr; gap: 8px; }
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
            .stove-status-label { font-weight: 600; }
            .stove-status-value { font-family: 'Courier New', monospace; }
            .stove-mission-item { position: relative; cursor: help; }
            .stove-mission-item:hover { background: #252525; border-color: #3a3a3a; }
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
            .stove-mission-item:hover .stove-mission-tooltip { display: block; }
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
            .stove-mission-tooltip-name { flex: 1; color: #d0d0d0; }
            .stove-mission-tooltip-status { margin-left: 12px; font-size: 12px; }
            .stove-maintenance-notice {
                background: linear-gradient(135deg, #d32f2f 0%, #c62828 100%);
                border: 2px solid #b71c1c;
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 20px;
                text-align: center;
            }
            .stove-maintenance-icon { font-size: 48px; margin-bottom: 12px; display: block; }
            .stove-maintenance-title { font-size: 18px; font-weight: bold; color: #ffffff; margin-bottom: 8px; }
            .stove-maintenance-message { font-size: 14px; color: #ffebee; line-height: 1.6; }
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
                <div class="stove-status-item stove-mission-item" data-category="content">
                    <span class="stove-status-label">💬 컨텐츠</span>
                    <span class="stove-status-value" id="stove-status-mission-content">-</span>
                </div>
                <div class="stove-status-item stove-mission-item" data-category="attendance">
                    <span class="stove-status-label">📆 월간출석</span>
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
                <div class="stove-status-item">
                    <span class="stove-status-label">📊 설문조사</span>
                    <span class="stove-status-value" id="stove-status-survey">-</span>
                </div>
                <div class="stove-status-item" style="border-top: 2px solid #3a3a3a; margin-top: 8px; padding-top: 16px;">
                    <span class="stove-status-label">💎 현재 보유</span>
                    <span class="stove-status-value" id="stove-status-total-flake">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">📅 이번 달 획득</span>
                    <span class="stove-status-value" id="stove-status-monthly-flake">-</span>
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
    const targetSelectors = [".inds-content-body", "main", "body"];
    let insertTarget = null;
    for (const selector of targetSelectors) {
      insertTarget = document.querySelector(selector);
      if (insertTarget) break;
    }
    if (insertTarget) {
      try {
        insertTarget.insertBefore(container, insertTarget.firstChild);
      } catch (err) {
        insertTarget.appendChild(container);
      }
    } else {
      document.body.insertBefore(container, document.body.firstChild);
    }
    function copyLogToClipboard() {
      const logContent = document.getElementById("stove-log-content");
      if (!logContent) return;
      const logText = logContent.innerText || logContent.textContent;
      navigator.clipboard.writeText(logText).then(() => {
        const btn = document.getElementById("stove-btn-copy-log");
        if (btn) {
          const original = btn.textContent;
          btn.textContent = "✓";
          setTimeout(() => {
            btn.textContent = original;
          }, 1e3);
        }
      }).catch((err) => {
        console.error("로그 복사 실패:", err);
      });
    }
    const attachListener = (id, handler) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener("click", handler);
      } else {
        console.warn(`[이벤트 등록] ${id} 버튼을 찾을 수 없습니다`);
      }
    };
    {
      attachListener("stove-btn-start", runAutomation);
      attachListener("stove-btn-roulette", runRoulette);
      attachListener("stove-btn-reward-shop", openRewardShop);
      attachListener("stove-btn-status-refresh", checkAllStatus);
      log("자동화 패널이 준비되었습니다", "info");
    }
    attachListener("stove-btn-copy-log", copyLogToClipboard);
    setTimeout(() => {
      checkAllStatus();
    }, 500);
  }
  function tryCreateUI(retries = 5) {
    const contentBody = document.querySelector(".inds-content-body");
    const main = document.querySelector("main");
    if (contentBody || main || retries <= 0) {
      createUI();
    } else {
      setTimeout(() => tryCreateUI(retries - 1), 500);
    }
  }
  function init() {
    console.log("[STOVE Automation] Initializing...");
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => tryCreateUI());
    } else {
      tryCreateUI();
    }
  }
  init();

})();