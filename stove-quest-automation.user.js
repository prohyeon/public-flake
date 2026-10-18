// ==UserScript==
// @name         STOVE Quest Automation
// @namespace    https://profile.onstove.com/
// @version      2.13.1
// @author       prohyeon
// @description  STOVE 자동화 (게시글 추천, 댓글, 글쓰기, 인기글 부스트 하루 5회, 게임 리뷰 이벤트 댓글, 룰렛, 데일리 보상)
// @supportURL   https://github.com/prohyeon/public-flake/issues
// @downloadURL  https://github.com/prohyeon/public-flake/raw/refs/heads/main/stove-quest-automation.user.js
// @updateURL    https://github.com/prohyeon/public-flake/raw/refs/heads/main/stove-quest-automation.user.js
// @match        https://profile.onstove.com/*
// @connect      api.onstove.com
// @connect      reward.onstove.com
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    version: "2.13.1",
    lastUpdated: "2026-10-18",
    debug: false,
    // 미션·이벤트별 중복 방지 기록(stove-boost-v1:*, stove-review-v1:*)은 마지막 시도 후 이 일수가
    // 지나면 지운다. 지금 진행 중인 미션·이벤트의 기록은 지우지 않는다.
    storageRetentionDays: 7,
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
    commentPool: [
      "굿",
      "굿굿",
      "ㅋㅋㅋㅋ",
      "좋네요",
      "오 좋다",
      "잘봤어요",
      "인정",
      "나이스",
      "괜찮네요",
      "오호"
    ],
    roulette: {
      enabled: true,
      subEventNo: "1000000353",
      extraSubEventNo: "1000000357",
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
    boostMission: {
      enabled: true,
      // 미션이 없거나 이미 끝나도 하루(KST) 이 횟수까지 실시간 인기글에 부스트한다(잔여 횟수 안에서,
      // 글마다 1번). 0이면 오늘의 1등 미션이 0/1일 때만 1번 부스트한다.
      dailyBoosts: 5,
      boostDelay: 1e3,
      // 오늘 저장된 후보가 없을 때의 조회 횟수. 저장된 후보가 있으면 1번만 조회해 합친다.
      rankingQueries: 5,
      queryDelay: 2e3,
      rankingCacheMaxAge: 60 * 60 * 1e3,
      // 저장·부스트 여부 조회에 쓰는 후보 상한(온도 순). 부스트 여부는 한 요청에 id를 이어 붙여 조회한다.
      rankingCacheSize: 20,
      maxRankingAge: 10 * 60 * 1e3,
      verifyAttempts: 3,
      verifyDelay: 1e3
    },
    reviewEvent: {
      enabled: true,
      stickerUrl: "https://d2x8kymwjom7h7.cloudfront.net/live/application_no/10009/partners-sns-api/sp7HsnbTri6Q.png",
      visitDelay: 3e3,
      maxEventPages: 20,
      maxCommentPages: 100,
      verifyAttempts: 3,
      verifyDelay: 1e3
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
      missionNo: 359,
      eventNo: 1000000354,
      giftNo: 1000001776,
      missionTitle: "경품 응모하기",
      targetGiftName: "스토브 5,000 포인트",
      flakeCost: 500
    },
    preRegistration: {
      enabled: true,
      // month(KST YYYYMM)에만, endDate(KST, 당일부터 중지) 전까지만 요청한다. 새 사전등록은 여기에 추가한다.
      campaigns: [
        { month: "202610", key: "luvplace", title: "luvplace 사전등록", shopItemId: 14203, endDate: "2026-10-15" }
      ]
    },
    pointExchange: {
      enabled: true,
      clientId: "M_STOVE_COMMUNITY",
      fromUseRuleId: "ML_STOVE_COMMUNITY_MILE_PLAY",
      toDepositRuleId: "PL_STOVE_COMMUNITY_MILE_PAID",
      pointAmount: 7700,
      requiredFlakeAmount: 192500,
      description: "플레이크 전환"
    },
    lostArkCashCharge: {
      enabled: true,
      gameCode: "45",
      pointClientId: "M_STOVE_PC",
      pointUseRuleId: "ML_STOVE_PC_MILE_PAID",
      pointAmount: 7700,
      cashAmount: 7700,
      productName: "7,700 로열 크리스탈",
      paytoolCode: 58,
      pgpCode: "POQ",
      pgCode: "SP_CREDITCARD_PLCC",
      mallId: "spay_la6",
      pointPaytoolCode: 99,
      pointPgCode: "STOVE_MILEAGE",
      pointMallId: "STOVE_MILEAGE"
    }
  };
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const ICONS = { success: "✓", error: "✗", info: "⏳", warning: "⚠️" };
  const LEADING_ICONS = ["✓", "✗", "⏳", "⚠️", "✅", "❌"];
  function decodeHtmlEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
      if (name[0] === "#") {
        const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code <= 1114111 ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    });
  }
  function formatLogEntry(message, type = "info") {
    const text = decodeHtmlEntities(message);
    return LEADING_ICONS.some((icon) => text.startsWith(icon)) ? text : `${ICONS[type]} ${text}`;
  }
  function log(message, type = "info") {
    const logContent = document.getElementById("stove-log-content");
    if (!logContent) return;
    const colors = { success: "#10b981", error: "#ef4444", info: "#3b82f6", warning: "#f59e0b" };
    const entry = document.createElement("div");
    entry.style.color = colors[type];
    entry.style.padding = "4px 0";
    entry.dataset.type = type;
    entry.textContent = formatLogEntry(message, type);
    logContent.appendChild(entry);
    const logSection = document.querySelector(".stove-log-section");
    if (logSection) {
      logSection.scrollTop = logSection.scrollHeight;
    }
  }
  const DEBUG_STORAGE_KEY = "stove-quest-automation:debug";
  function isDebugEnabled() {
    var _a;
    try {
      return ((_a = globalThis.localStorage) == null ? void 0 : _a.getItem(DEBUG_STORAGE_KEY)) === "1";
    } catch {
      return false;
    }
  }
  function debugLog(...args) {
    if (isDebugEnabled()) console.log(...args);
  }
  function apiRequest(url, method, headers, body = null, options = {}) {
    return new Promise((resolve, reject) => {
      const requestConfig = {
        method,
        url,
        headers,
        anonymous: true,
        data: body ? JSON.stringify(body) : null,
        onload(response) {
          debugLog(`[API Request] ${method} ${url} - Status: ${response.status}`);
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
        ontimeout() {
          reject(new Error("API request timed out"));
        },
        onabort() {
          reject(new Error("API request aborted"));
        },
        onerror(error) {
          console.error("[API Request] Network error:", error);
          reject(new Error("Network error"));
        }
      };
      if (Number.isFinite(options.timeout) && options.timeout > 0) {
        requestConfig.timeout = options.timeout;
      }
      debugLog("[API Request] Starting request:", { method, url, hasBody: !!body });
      GM_xmlhttpRequest(requestConfig);
    });
  }
  function callerDetail(headers) {
    return headers["X-UUID"] || headers["caller-detail"];
  }
  function makeRewardPageHeaders(headers) {
    return {
      "Authorization": headers["Authorization"],
      "caller-id": "flake-fe",
      "caller-detail": callerDetail(headers),
      "x-lang": "ko",
      "x-nation": "KR",
      "Accept": "*/*",
      "Origin": "https://reward.onstove.com",
      "Referer": "https://reward.onstove.com/"
    };
  }
  function makeRewardPageJsonHeaders(headers) {
    return {
      ...makeRewardPageHeaders(headers),
      "Accept": "application/json",
      "Content-Type": "application/json"
    };
  }
  function makeMileageHeaders(headers) {
    return {
      "Authorization": headers["Authorization"],
      "caller-id": "flake-fe",
      "caller-detail": callerDetail(headers),
      "Content-Type": "application/json;charset=utf-8",
      "Accept": "*/*",
      "Origin": "https://reward.onstove.com",
      "Referer": "https://reward.onstove.com/"
    };
  }
  function makeEventHubHeaders(headers) {
    return {
      "Authorization": headers["Authorization"],
      "caller-id": "event-hub",
      "caller-detail": callerDetail(headers),
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
  function withEventHubOrigin(headers) {
    return {
      ...headers,
      "caller-id": "event-hub",
      "caller-detail": headers["X-UUID"],
      Origin: "https://event.onstove.com",
      Referer: "https://event.onstove.com/",
      "X-Timezone": "Asia/Seoul",
      "X-Utc-Offset": "540"
    };
  }
  const PRE_REGISTRATION_ALREADY_JOINED = 90605;
  async function registerPreRegistration(headers, campaign) {
    var _a;
    if (!/^\d{6}$/.test(String(campaign == null ? void 0 : campaign.month)) || !/^[a-z0-9-]+$/i.test(String(campaign == null ? void 0 : campaign.key))) {
      throw new Error("사전등록 캠페인 설정 확인 실패");
    }
    const response = await apiRequest(
      `${CONFIG.api.baseUrl}/dailyshop/v1.0/campaigns/${campaign.month}/${campaign.key}/register`,
      "POST",
      withEventHubOrigin(headers),
      null,
      { timeout: 15e3 }
    );
    if ((response == null ? void 0 : response.code) === 0 && Number.isSafeInteger((_a = response.value) == null ? void 0 : _a.registration_no)) {
      return { registered: true, registrationNo: response.value.registration_no };
    }
    if ((response == null ? void 0 : response.code) === PRE_REGISTRATION_ALREADY_JOINED) return { alreadyJoined: true };
    throw new Error(`사전등록 응답 확인 실패 (code=${(response == null ? void 0 : response.code) ?? "없음"})`);
  }
  async function addIndieWishlist(headers, shopItemId) {
    if (!Number.isSafeInteger(shopItemId) || shopItemId <= 0) throw new Error("찜하기 상품 번호 확인 실패");
    const ids = [{ shop_item_id: shopItemId }];
    const response = await apiRequest(
      `${CONFIG.api.baseUrl}/shop/v2.0/indie/wishlist/add`,
      "POST",
      { ...withEventHubOrigin(headers), "Content-Type": "application/json" },
      { shop_key: "indie", shop_item_ids: ids, shop_item_ids_str: JSON.stringify(ids) },
      { timeout: 15e3 }
    );
    if ((response == null ? void 0 : response.response_code) !== 0) {
      throw new Error(`찜하기 응답 확인 실패 (code=${(response == null ? void 0 : response.response_code) ?? "없음"})`);
    }
    return true;
  }
  function getKSTDate() {
    const now = /* @__PURE__ */ new Date();
    const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1e3);
    const year = kstTime.getUTCFullYear();
    const month = String(kstTime.getUTCMonth() + 1).padStart(2, "0");
    const day2 = String(kstTime.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day2}`;
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function getTimestamp() {
    return Date.now();
  }
  function getTodayString() {
    const today = /* @__PURE__ */ new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day2 = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day2}`;
  }
  function getTodayKSTString() {
    const today = /* @__PURE__ */ new Date();
    const kstOffset = 9 * 60;
    const kstDate = new Date(today.getTime() + kstOffset * 60 * 1e3);
    return kstDate.toISOString().split("T")[0];
  }
  function isPreRegistrationActive(campaign, today = getTodayKSTString()) {
    if (today.slice(0, 7).replace("-", "") !== String(campaign == null ? void 0 : campaign.month)) return false;
    return !campaign.endDate || today < campaign.endDate;
  }
  async function runPreRegistrations(headers, deps = {}) {
    const settings = deps.config || CONFIG.preRegistration;
    const register = deps.register || registerPreRegistration;
    const addWishlist = deps.addWishlist || addIndieWishlist;
    const writeLog = deps.writeLog || log;
    const today = deps.today || getTodayKSTString();
    const results = [];
    if (!(settings == null ? void 0 : settings.enabled)) return { success: true, results };
    for (const campaign of settings.campaigns || []) {
      const name = campaign.title || campaign.key;
      if (!isPreRegistrationActive(campaign, today)) {
        results.push({ key: campaign.key, skipped: true });
        continue;
      }
      try {
        const result = await register(headers, campaign);
        if (result.alreadyJoined) {
          writeLog(`사전등록 이미 완료: ${name}`, "info");
          results.push({ key: campaign.key, alreadyJoined: true });
          continue;
        }
        writeLog(`✓ 사전등록 완료: ${name} (등록번호 ${result.registrationNo})`, "success");
        const entry = { key: campaign.key, registered: true, registrationNo: result.registrationNo };
        if (campaign.shopItemId) {
          try {
            await addWishlist(headers, campaign.shopItemId);
            entry.wishlisted = true;
          } catch (error) {
            writeLog(`사전등록 찜하기 실패: ${name} - ${error.message}`, "warning");
            entry.wishlistError = error.message;
          }
        }
        results.push(entry);
      } catch (error) {
        writeLog(`✗ 사전등록 실패: ${name} - ${error.message}`, "error");
        results.push({ key: campaign.key, error: error.message });
      }
    }
    const failed = results.filter((result) => result.error);
    return {
      success: failed.length === 0,
      results,
      error: failed.map((result) => `${result.key}: ${result.error}`).join(", ") || void 0
    };
  }
  function createInitialState() {
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
  const state = createInitialState();
  function resetRunProgress(target = state) {
    const initial = createInitialState();
    target.progress = initial.progress;
    target.createdCommentIds = initial.createdCommentIds;
    target.completed = initial.completed;
    target.earnings = initial.earnings;
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
  function makeLoungeHeaders(headers) {
    return { ...headers, "caller-id": "lounge", "x-lang": "KO" };
  }
  async function getArticleList(headers, size = 30) {
    var _a;
    const url = `${CONFIG.api.baseUrl}/stadium-api/v1.0/today/all?size=${size}`;
    const response = await apiRequest(url, "GET", makeLoungeHeaders(headers));
    return ((_a = response.value) == null ? void 0 : _a.list) || [];
  }
  async function likeArticle(headers, articleId2) {
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId2}/interaction/LIKE`;
    await apiRequest(url, "PUT", headers);
  }
  async function checkArticleLikeStatus(headers, articleIds) {
    if (!articleIds || articleIds.length === 0) return {};
    const ids = articleIds.join(",");
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${ids}/interaction/LIKE?timestemp=${getTimestamp()}`;
    const response = await apiRequest(url, "GET", headers);
    return response.value || {};
  }
  async function postComment(headers, articleId2, content) {
    var _a;
    const url = `${CONFIG.api.baseUrl}/postie/v1.0/article/${articleId2}/comment`;
    const body = {
      article_id: articleId2,
      content: `<p>${content}</p>`,
      attached: { media_ids: [] }
    };
    const response = await apiRequest(url, "POST", makeLoungeHeaders(headers), body);
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
    debugLog("[게시글 작성] URL:", url);
    const response = await apiRequest(url, "POST", headers, body);
    return (_a = response.value) == null ? void 0 : _a.article_id;
  }
  const makeMissionHeaders = makeRewardPageHeaders;
  const makeMissionJsonHeaders = makeRewardPageJsonHeaders;
  function missionComponentUrl(componentNo) {
    return `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
  }
  function missionParticipateUrl() {
    return `${CONFIG.api.baseUrl}/flake-shop/v1/mission/participate`;
  }
  function isWeeklyAccumulation(startDt, endDt) {
    const start = new Date(startDt);
    const end = new Date(endDt);
    const diffDays = (end - start) / (1e3 * 60 * 60 * 24);
    return diffDays <= 14;
  }
  function isComponentActive(startDt, endDt, now = /* @__PURE__ */ new Date()) {
    return now >= new Date(startDt) && now <= new Date(endDt);
  }
  function pushUniqueComponentNo(componentNos, componentNo) {
    if (Array.isArray(componentNo)) {
      componentNo.forEach((no) => pushUniqueComponentNo(componentNos, no));
      return;
    }
    if (componentNo != null && !componentNos.includes(componentNo)) {
      componentNos.push(componentNo);
    }
  }
  function getDailyComponentNos(missionComponents = state.missionComponents) {
    const componentNos = [];
    pushUniqueComponentNo(componentNos, missionComponents.dailyComponents);
    pushUniqueComponentNo(componentNos, missionComponents.daily);
    return componentNos;
  }
  function getMissionComponentNos(missionComponents = state.missionComponents) {
    const componentNos = [];
    getDailyComponentNos(missionComponents).forEach((componentNo) => pushUniqueComponentNo(componentNos, componentNo));
    pushUniqueComponentNo(componentNos, missionComponents.content);
    pushUniqueComponentNo(componentNos, missionComponents.weekly);
    pushUniqueComponentNo(componentNos, missionComponents.survey);
    pushUniqueComponentNo(componentNos, missionComponents.banner);
    pushUniqueComponentNo(componentNos, missionComponents.attendance);
    return componentNos;
  }
  function mapMissionComponentIds(componentList = [], options = {}) {
    const now = options.now || /* @__PURE__ */ new Date();
    const components = {
      daily: null,
      dailyComponents: [],
      content: null,
      weekly: null,
      survey: null,
      banner: null,
      attendance: null
    };
    for (const comp of componentList) {
      if (!isComponentActive(comp.start_dt, comp.end_dt, now)) {
        continue;
      }
      switch (comp.type) {
        case "SINGLE":
          components.daily = comp.component_no;
          pushUniqueComponentNo(components.dailyComponents, comp.component_no);
          break;
        case "CONTENT1":
          components.content = comp.component_no;
          break;
        case "SURVEY":
          components.survey = comp.component_no;
          break;
        case "BANNER":
          components.banner = comp.component_no;
          break;
        case "ACCUMULATION":
          if (isWeeklyAccumulation(comp.start_dt, comp.end_dt)) {
            components.weekly = comp.component_no;
          } else {
            components.attendance = comp.component_no;
          }
          break;
      }
    }
    return components;
  }
  async function getMissionComponentIds(headers) {
    var _a;
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/page?page_type=MISSION`;
    const missionHeaders = makeMissionHeaders(headers);
    debugLog("[미션 컴포넌트 로드] URL:", url);
    try {
      const response = await apiRequest(url, "GET", missionHeaders);
      if (response && response.code === 0 && ((_a = response.value) == null ? void 0 : _a.component_list)) {
        const components = mapMissionComponentIds(response.value.component_list);
        state.missionComponents = components;
        debugLog("[미션 컴포넌트 로드] ✓ 완료:", components);
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
    const componentNos = getDailyComponentNos();
    if (componentNos.length === 0) {
      console.error("[데일리 미션 조회] ✗ componentNo가 로드되지 않음");
      return null;
    }
    const missionHeaders = makeMissionHeaders(headers);
    debugLog(`[데일리 미션 조회] componentNos: ${componentNos.join(", ")}`);
    try {
      const values = [];
      for (const componentNo of componentNos) {
        const response = await apiRequest(missionComponentUrl(componentNo), "GET", missionHeaders);
        if (response && response.code === 0 && response.value) {
          values.push({
            componentNo,
            ...response.value,
            missions: (response.value.missions || []).map((mission) => ({
              ...mission,
              component_no: mission.component_no || componentNo
            }))
          });
        } else {
          console.error(`[데일리 미션 조회] ✗ API 오류 (componentNo: ${componentNo}):`, response);
        }
      }
      if (values.length === 0) {
        return null;
      }
      const missions = values.flatMap((value) => value.missions || []);
      debugLog(`[데일리 미션 조회] ✓ 미션 ${missions.length}개 조회 완료`);
      return values.length === 1 ? values[0] : {
        componentNo: state.missionComponents.daily,
        component_info: {
          component_no: state.missionComponents.daily,
          component_type: "SINGLE"
        },
        components: values,
        missions
      };
    } catch (e) {
      console.error("[데일리 미션 조회] ✗ 실패:", e.message);
      return null;
    }
  }
  async function receiveMissionReward(headers, missionNo, componentNo) {
    const body = { mission_no: missionNo, component_no: componentNo };
    debugLog(`[미션 보상 수령] mission_no: ${missionNo}`);
    try {
      const response = await apiRequest(missionParticipateUrl(), "POST", makeMissionJsonHeaders(headers), body);
      if (response && response.code === 0 && response.value) {
        const reward = response.value.reward_amount || 0;
        debugLog(`[미션 보상 수령] ✓ ${response.value.title}: ${reward} FLAKE`);
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
    return apiRequest(missionComponentUrl(componentNo), "GET", makeMissionHeaders(headers));
  }
  async function getAllDailyMissions(headers) {
    const componentNos = getMissionComponentNos();
    if (componentNos.length === 0) {
      debugLog("[전체 미션 조회] 동적 ID 없음, 로드 시도...");
      await getMissionComponentIds(headers);
      const reloaded = getMissionComponentNos();
      if (reloaded.length === 0) {
        console.error("[전체 미션 조회] 동적 component ID를 로드할 수 없습니다");
        return [];
      }
      componentNos.push(...reloaded);
    }
    debugLog(`[전체 미션 조회] ${componentNos.length}개 component 조회 시작:`, componentNos);
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
    const body = { mission_no: missionNo, component_no: componentNo };
    debugLog(`[미션 참여] mission_no: ${missionNo}, component_no: ${componentNo}`);
    const response = await apiRequest(missionParticipateUrl(), "POST", makeMissionJsonHeaders(headers), body);
    if (response && response.value) {
      debugLog(`[미션 참여] ${response.value.title} - 상태: ${response.value.status}`);
    }
    return response;
  }
  async function checkGameOwnership(headers, gameId) {
    const url = `${CONFIG.api.baseUrl}/ownership/v1/check_ownership_by_bgameid?game_id=${gameId}`;
    return apiRequest(url, "GET", makeEventHubHeaders(headers));
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
    const eventHeaders = { ...makeRewardPageHeaders(headers), "Accept": "application/json" };
    debugLog("[룰렛 이벤트 ID 로드] URL:", url);
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
        debugLog("[룰렛 이벤트 ID 로드] ✓ 완료:", events);
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
    const prizeHeaders = makeRewardPageHeaders(headers);
    debugLog("[경품 정보 로드] URL:", url);
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
            debugLog(`[경품 정보] ✓ 타겟 경품 발견: ${targetGift.gift_name}`);
          }
        }
        debugLog("[경품 정보 로드] ✓ 완료:", state.prizeInfo);
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
    const rewardHeaders = makeRewardPageHeaders(headers);
    debugLog(`[룰렛 참여 횟수 조회] sub_event_no: ${subEventNo}`);
    try {
      const response = await apiRequest(url, "GET", rewardHeaders);
      debugLog("[룰렛 참여 횟수 조회] ✅ Response received:", response);
      return response;
    } catch (error) {
      console.error("[룰렛 참여 횟수 조회] ❌ API 호출 실패:", error.message);
      throw error;
    }
  }
  async function executeRouletteDraw(headers, subEventNo) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/draw/${subEventNo}`;
    const rewardHeaders = makeRewardPageJsonHeaders(headers);
    const body = { type_no: 1 };
    debugLog(`[룰렛 뽑기 실행] sub_event_no: ${subEventNo}`);
    try {
      const response = await apiRequest(url, "POST", rewardHeaders, body);
      debugLog("[룰렛 뽑기 실행] ✅ Response received:", response);
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
    const rewardHeaders = makeRewardPageHeaders(headers);
    debugLog(`[룰렛 EXTRA 조회] sub_event_no: ${subEventNo}`);
    const response = await apiRequest(url, "GET", rewardHeaders);
    debugLog("[룰렛 EXTRA 조회] Response:", response);
    return response;
  }
  async function claimRouletteExtra(headers, subEventNo, giftNo, currentCycle) {
    const url = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/extra/${subEventNo}`;
    const rewardHeaders = {
      ...makeRewardPageHeaders(headers),
      "Content-Type": "application/json"
    };
    const body = { gift_no: giftNo, current_cycle: currentCycle };
    const response = await apiRequest(url, "POST", rewardHeaders, body);
    debugLog("[룰렛 EXTRA 수령] Response:", response);
    return response;
  }
  function formatNumber$1(value) {
    return Number(value).toLocaleString("ko-KR");
  }
  function toFiniteNumber$1(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function isPointCashChargeAvailable(availableFlake, requiredFlake = CONFIG.pointExchange.requiredFlakeAmount) {
    const available = toFiniteNumber$1(availableFlake);
    return available !== null && available >= requiredFlake;
  }
  function updatePointCashChargeButtonAvailability(availableFlake, options = {}) {
    const requiredFlake = options.requiredFlake ?? CONFIG.pointExchange.requiredFlakeAmount;
    const isRunning = options.running ?? state.isRunning;
    const available = toFiniteNumber$1(availableFlake);
    const hasRequiredFlake = isPointCashChargeAvailable(available, requiredFlake);
    const shortage = available === null ? null : Math.max(0, requiredFlake - available);
    state.pointCashCharge.availableFlake = available;
    state.pointCashCharge.hasRequiredFlake = hasRequiredFlake;
    const button = document.getElementById("stove-btn-point-cash-charge");
    const status = document.getElementById("stove-btn-point-cash-charge-status");
    if (button) {
      button.disabled = isRunning || !hasRequiredFlake;
      button.style.opacity = isRunning ? "0.5" : hasRequiredFlake ? "1" : "0.45";
      button.title = hasRequiredFlake ? `${formatNumber$1(requiredFlake)} 플레이크 보유: 충전 가능` : available === null ? `${formatNumber$1(requiredFlake)} 플레이크 이상일 때 충전 가능` : `${formatNumber$1(requiredFlake)} 플레이크 필요 (현재 ${formatNumber$1(available)})`;
    }
    if (status) {
      status.textContent = hasRequiredFlake ? "충전 가능" : shortage === null ? "플레이크 확인 중" : `${formatNumber$1(shortage)} 플레이크 부족`;
      status.style.color = hasRequiredFlake ? "#a7f3d0" : "#fbbf24";
    }
    return hasRequiredFlake;
  }
  function updateProgress(task2, current, total) {
    if (task2) {
      const element = document.getElementById(`stove-${task2}`);
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
    const btnIds = ["stove-btn-start", "stove-btn-reward-shop", "stove-btn-status-refresh"];
    for (const id2 of btnIds) {
      const btn = document.getElementById(id2);
      if (btn) {
        btn.disabled = running;
        btn.style.opacity = running ? "0.5" : "1";
      }
    }
    updatePointCashChargeButtonAvailability(state.pointCashCharge.availableFlake, { running });
  }
  async function getDailyShopRewards(headers) {
    const now = /* @__PURE__ */ new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/${yearMonth}/services/STOVEINDIE`;
    debugLog("[데일리 보상 목록 조회] URL:", url);
    const response = await apiRequest(url, "GET", makeEventHubHeaders(headers));
    return response;
  }
  async function claimDailyReward(headers, itemNo, rewardType) {
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/daily/${rewardType}?item_no=${itemNo}&reward_type=${rewardType}`;
    const eventHeaders = {
      ...makeEventHubHeaders(headers),
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
    debugLog("[마작 리워드 목록 조회] URL:", url);
    const response = await apiRequest(url, "GET", makeEventHubHeaders(headers));
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
    const eventHeaders = { ...makeEventHubHeaders(headers), "Content-Type": "application/json" };
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
    const eventHeaders = { ...makeEventHubHeaders(headers), "Content-Type": "application/json" };
    const body = { item_no: itemNo };
    const response = await apiRequest(url, "POST", eventHeaders, body);
    return response;
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
      const now = /* @__PURE__ */ new Date();
      const yyyyMM = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      const tzOffset = now.getTimezoneOffset() * -1;
      const url = `${CONFIG.api.baseUrl}/mileage/v2.0/master/deposit/total?client_id=M_STOVE_COMMUNITY&use_rule_id=ML_STOVE_COMMUNITY_MILE_PLAY&tz_offset=${tzOffset}&yyyyMM=${yyyyMM}`;
      const response = await apiRequest(url, "GET", makeMileageHeaders(headers));
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
      const response = await apiRequest(url, "GET", makeMileageHeaders(headers));
      if (response && response.code === 0 && response.value) {
        return response.value.mileage_amount || 0;
      }
      return 0;
    } catch (error) {
      console.error("[FLAKE] 총 플레이크 조회 실패:", error);
      return 0;
    }
  }
  function openTabInBackground(url, active = false) {
    if (typeof GM_openInTab === "undefined") {
      console.warn("[Tab] GM_openInTab not available, using window.open");
      return window.open(url, "_blank");
    }
    const tab = GM_openInTab(url, { active, insert: true, setParent: true });
    debugLog(`[Tab] ${active ? "포커스" : "백그라운드"}로 탭 열림: ${url}`);
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
          debugLog(`[Tab] 탭 ${index + 1} 닫힘`);
        } else if (tab && typeof tab === "object") {
          console.warn(`[Tab] 탭 ${index + 1}은 close() 메서드가 없습니다`);
        }
      } catch (e) {
        console.error(`[Tab] 탭 ${index + 1} 닫기 실패:`, e.message);
      }
    });
    debugLog(`[Tab] 총 ${closedCount}/${tabArray.length}개 탭 닫힘`);
    return closedCount;
  }
  function dailySuffix(status) {
    const today = status.dailyBoosts || [];
    if (today.length === 0) return "";
    const confirmed = today.filter((attempt) => attempt.status === "confirmed").length;
    const pending = today.length > confirmed ? " · 확인 대기" : "";
    return ` · 오늘 부스트 ${confirmed}/${CONFIG.boostMission.dailyBoosts}${pending}`;
  }
  function renderSelectedArticle(selected, status) {
    var _a;
    if (!status.selectedArticle) {
      selected.textContent = "자동화 실행 후 표시";
      return;
    }
    const article = status.selectedArticle;
    const link = document.createElement("a");
    link.href = `https://lounge.onstove.com/view/${article.articleId}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.color = "#93c5fd";
    link.textContent = `${article.title || article.articleId} · ${article.score}℃`;
    selected.appendChild(link);
    const others = (((_a = status.dailyBoosts) == null ? void 0 : _a.length) || 0) - 1;
    if (others > 0) selected.append(` 외 ${others}개`);
    selected.title = status.verificationPending ? "실행 결과 반영 확인 대기" : "오늘 자동화에서 선택한 글과 선택 당시 온도";
  }
  function updateBoostStatus(status) {
    var _a, _b;
    const progress = document.getElementById("stove-status-boost");
    const reward = document.getElementById("stove-status-boost-reward");
    const selected = document.getElementById("stove-status-boost-target");
    if (!progress || !reward || !selected) return;
    for (const element of [progress, reward, selected]) {
      element.replaceChildren();
      element.title = "";
      element.style.color = "#9ca3af";
    }
    if (status.loading) {
      for (const element of [progress, reward, selected]) element.textContent = "⏳ 확인 중...";
      return;
    }
    if (!status.success) {
      for (const element of [progress, reward, selected]) {
        element.textContent = "⚠️ 확인 실패";
        element.style.color = "#ef4444";
        element.title = status.error || "서버 상태 확인 실패";
      }
      return;
    }
    if (status.notAvailable) {
      progress.textContent = `미션 없음 · 잔여 ${status.remainingCount}회${dailySuffix(status)}`;
      reward.textContent = "-";
      renderSelectedArticle(selected, status);
      return;
    }
    const { mission } = status;
    progress.textContent = `${mission.current}/${mission.required} · 잔여 ${status.remainingCount}회`;
    progress.style.color = mission.current >= mission.required ? "#10b981" : "#f59e0b";
    if (status.nextChargeAt) {
      progress.title = `다음 충전: ${new Date(status.nextChargeAt).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })}`;
    }
    const amount = mission.rewardAmount.toLocaleString("ko-KR");
    if (mission.rewarded) {
      reward.textContent = `✅ ${amount} F 수령 완료`;
      reward.style.color = "#10b981";
    } else if ((_a = status.record) == null ? void 0 : _a.reward) {
      reward.textContent = "⏳ 보상 수령 상태 확인 대기";
      reward.style.color = "#f59e0b";
    } else if (mission.allCompleted) {
      reward.textContent = `🎁 ${amount} F 수령 가능`;
      reward.style.color = "#f59e0b";
    } else {
      reward.textContent = `조건 진행 중 · ${amount} F`;
    }
    reward.title = mission.details.map((detail) => `${detail.label}: ${detail.current_count}/${detail.required_count}`).join("\n");
    if (((_b = status.record) == null ? void 0 : _b.boost) && mission.current < mission.required) {
      progress.textContent += " · 반영 확인 대기";
    }
    progress.textContent += dailySuffix(status);
    renderSelectedArticle(selected, status);
  }
  function updateReviewEventStatus(status) {
    const progress = document.getElementById("stove-status-review-event");
    const period = document.getElementById("stove-status-review-period");
    const target = document.getElementById("stove-status-review-target");
    if (!progress || !period || !target) return;
    for (const element of [progress, period, target]) {
      element.replaceChildren();
      element.title = "";
      element.style.color = "#9ca3af";
    }
    if (status.loading) {
      progress.textContent = "⏳ 확인 중...";
      period.textContent = target.textContent = "-";
      return;
    }
    if (!status.success) {
      progress.textContent = "⚠️ 확인 필요";
      progress.style.color = "#ef4444";
      progress.title = status.error || "이벤트 상태 확인 실패";
      period.textContent = target.textContent = "-";
      return;
    }
    const labels = {
      disabled: "비활성화",
      noEvent: "진행 중인 대상 없음",
      upcoming: "시작 전 · 건너뜀",
      expired: "기간 종료 · 건너뜀",
      inactive: "진행 중 아님 · 건너뜀",
      completed: "✅ 댓글 등록 완료",
      pending: "⏳ 등록 결과 확인 대기",
      noPermission: "댓글 작성 권한 없음",
      ready: "0/1 · 참여 전"
    };
    progress.textContent = labels[status.reason] || "⚠️ 확인 필요";
    progress.style.color = status.reason === "completed" ? "#10b981" : status.reason === "ready" || status.reason === "pending" ? "#f59e0b" : "#9ca3af";
    if (status.reason === "completed") progress.title = "댓글 등록을 확인했습니다. 플레이크 지급 여부는 별도 확인이 필요합니다.";
    if (status.reason === "pending") progress.title = "이전 댓글 요청 결과가 불확실하여 추가 댓글을 작성하지 않습니다.";
    const event = status.event;
    period.textContent = event ? `${event.startDate} ~ ${event.endDate} (한국 시간)` : "-";
    period.title = event ? "이벤트 배너의 노출 기간을 자동화 실행 조건으로 사용합니다." : "";
    if (event && /^https:\/\/page\.onstove\.com\/quarter\/kr\/view\/\d+$/.test(event.url)) {
      const link = document.createElement("a");
      link.href = event.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.color = "#93c5fd";
      link.textContent = status.articleTitle || "대상 게임 리뷰";
      target.appendChild(link);
    } else target.textContent = "-";
  }
  function updateStatusUI(statusData) {
    var _a, _b, _c, _d;
    if (statusData.boost) updateBoostStatus(statusData.boost);
    if (statusData.reviewEvent) updateReviewEventStatus(statusData.reviewEvent);
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
  function makeBoostHeaders(headers) {
    const uuid = headers["X-UUID"] || headers["caller-detail"];
    if (!headers.Authorization || !uuid) throw new Error("부스트 인증 정보가 없습니다");
    return {
      Authorization: headers.Authorization,
      "caller-id": "lounge",
      "X-UUID": uuid,
      "x-device-type": "P01",
      "x-lang": "KO",
      "x-nation": "KR",
      Accept: "application/json, text/plain, */*",
      Origin: "https://lounge.onstove.com",
      Referer: "https://lounge.onstove.com/"
    };
  }
  async function request$1(headers, path, method = "GET") {
    const query = method === "GET" ? `${path.includes("?") ? "&" : "?"}timestemp=${Date.now()}` : "";
    const response = await apiRequest(
      `${CONFIG.api.baseUrl}/stadium-api/v1.0/${path}${query}`,
      method,
      makeBoostHeaders(headers),
      null,
      { timeout: 1e4 }
    );
    if ((response == null ? void 0 : response.code) !== 0 || !response.value || typeof response.value !== "object") {
      const error = new Error((response == null ? void 0 : response.message) || "부스트 API 응답을 확인할 수 없습니다");
      error.code = response == null ? void 0 : response.code;
      error.definiteFailure = Number.isFinite(response == null ? void 0 : response.code) && response.code !== 0;
      throw error;
    }
    return response.value;
  }
  function articleId(value) {
    if (!/^\d+$/.test(String(value ?? ""))) throw new Error("잘못된 게시글 ID");
    return String(value);
  }
  function balance(value) {
    if (!Number.isInteger(value.remaining_count) || value.remaining_count < 0 || value.next_charge_at != null && !Number.isFinite(value.next_charge_at)) {
      throw new Error("부스트 잔여 횟수 응답이 올바르지 않습니다");
    }
    return { remainingCount: value.remaining_count, nextChargeAt: value.next_charge_at ?? null };
  }
  async function getBoostMissions(headers) {
    const value = await request$1(headers, "missions");
    if (!Array.isArray(value.missions)) throw new Error("부스트 미션 목록이 없습니다");
    return value.missions;
  }
  async function getBoostBalance(headers) {
    return balance(await request$1(headers, "boost/balance"));
  }
  async function getBoostRanking(headers) {
    const value = await request$1(headers, "recommend/articles/realtime-ranking");
    if (!Array.isArray(value.articles) || !Number.isFinite(value.generated_at) || value.generated_at <= 0) {
      throw new Error("실시간 후보 또는 집계 시각이 없습니다");
    }
    return { articles: value.articles, generatedAt: value.generated_at };
  }
  async function getArticleBoostStatuses(headers, ids) {
    if (ids.length === 0) return {};
    const validated = ids.map(articleId);
    const value = await request$1(headers, `article/${validated.join(",")}/interaction/BOOST`);
    if (validated.some((id2) => {
      var _a;
      return typeof ((_a = value[id2]) == null ? void 0 : _a.BOOST) !== "boolean";
    })) {
      throw new Error("게시글 부스트 여부를 확인할 수 없습니다");
    }
    return value;
  }
  async function boostArticle(headers, id2) {
    return balance(await request$1(headers, `boost/${articleId(id2)}`, "PUT"));
  }
  async function receiveBoostMissionReward(headers, missionId) {
    const value = await request$1(headers, `missions/${articleId(missionId)}/reward`, "POST");
    if (String(value.mission_id) !== String(missionId) || !Array.isArray(value.rewards) || value.rewards.some((reward) => !Number.isFinite(reward.amount) || reward.amount < 0)) {
      throw new Error("부스트 미션 보상 응답이 올바르지 않습니다");
    }
    const amount = value.rewards.filter((reward) => reward.type === "FLAKE").reduce((sum, reward) => sum + reward.amount, 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("수령한 플레이크 금액을 확인할 수 없습니다");
    return amount;
  }
  const DAY = 24 * 60 * 60 * 1e3;
  function pruneOldRecords(storage, prefix, { now, timestamps, keep = () => false }) {
    try {
      if (!storage || typeof storage.key !== "function") return [];
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (typeof key === "string" && key.startsWith(prefix)) keys.push(key);
      }
      const maxAge = CONFIG.storageRetentionDays * DAY;
      const removed = [];
      for (const key of keys) {
        if (keep(key)) continue;
        let record = null;
        try {
          record = JSON.parse(storage.getItem(key));
        } catch {
        }
        const times = record && typeof record === "object" ? timestamps(record).filter(Number.isFinite) : [];
        const newest = times.length > 0 ? Math.max(...times) : -Infinity;
        if (now - newest > maxAge) {
          storage.removeItem(key);
          removed.push(key);
        }
      }
      return removed;
    } catch {
      return [];
    }
  }
  const KST_OFFSET = 9 * 60 * 60 * 1e3;
  const BOOST_ACTION = "ARTICLE_BOOST_ADD";
  const day$1 = (timestamp) => new Date(timestamp + KST_OFFSET).toISOString().slice(0, 10);
  function normalizeBoostMission(missions, now = Date.now()) {
    const candidates = missions.filter((mission2) => Array.isArray(mission2 == null ? void 0 : mission2.details) && mission2.details.some((detail) => detail.action_type === BOOST_ACTION) && Number.isFinite(mission2.start_dt) && Number.isFinite(mission2.end_dt) && mission2.start_dt <= now && now < mission2.end_dt);
    candidates.sort((a, b) => (b.created_at ?? b.start_dt) - (a.created_at ?? a.start_dt));
    const mission = candidates[0];
    if (!mission) return null;
    if (!/^\d+$/.test(String(mission.mission_id ?? "")) || typeof mission.is_rewarded !== "boolean" || typeof mission.is_completed !== "boolean" || mission.details.some((detail) => !Number.isInteger(detail.current_count) || detail.current_count < 0 || !Number.isInteger(detail.required_count) || detail.required_count < 1) || !Array.isArray(mission.rewards) || mission.rewards.some((reward) => !Number.isFinite(reward.amount) || reward.amount < 0)) {
      throw new Error("부스트 미션 진행도 응답이 올바르지 않습니다");
    }
    const boost = mission.details.find((detail) => detail.action_type === BOOST_ACTION);
    return {
      id: String(mission.mission_id),
      title: mission.title,
      rewarded: mission.is_rewarded,
      completed: mission.is_completed,
      allCompleted: mission.details.every((detail) => detail.current_count >= detail.required_count),
      current: boost.current_count,
      required: boost.required_count,
      details: mission.details,
      rewardAmount: mission.rewards.filter((reward) => reward.type === "FLAKE").reduce((sum, reward) => sum + reward.amount, 0)
    };
  }
  function getEligibleBoostCandidates(articles, userId, now = Date.now()) {
    return articles.filter((article) => {
      var _a, _b;
      return /^\d+$/.test(String((article == null ? void 0 : article.article_id) ?? "")) && Number.isFinite(article.score) && article.score >= 0 && Number.isFinite(article.datetime) && article.datetime <= now && day$1(article.datetime) === day$1(now) && article.today_contest_agree === true && article.source === "postoffice" && article.status === "PUBLISHED" && article.coverage === "PUBLIC" && /^\d+$/.test(String(((_a = article.profile) == null ? void 0 : _a.id) ?? "")) && String(article.profile.id) !== String(userId) && !["OFFICIAL", "BOT"].includes((_b = article.profile) == null ? void 0 : _b.badge);
    }).sort((a, b) => b.score - a.score || String(a.article_id).localeCompare(String(b.article_id)));
  }
  const BOOST_RANKING_CACHE_KEY = "stove-boost-ranking-v1";
  function slimCandidate(article, seenAt) {
    var _a, _b;
    return {
      article_id: article.article_id,
      title: article.title,
      score: article.score,
      datetime: article.datetime,
      today_contest_agree: article.today_contest_agree,
      source: article.source,
      status: article.status,
      coverage: article.coverage,
      profile: { id: (_a = article.profile) == null ? void 0 : _a.id, badge: (_b = article.profile) == null ? void 0 : _b.badge },
      seenAt
    };
  }
  function readRankingCache(storage, now) {
    try {
      const text = storage == null ? void 0 : storage.getItem(BOOST_RANKING_CACHE_KEY);
      if (!text) return [];
      let record = null;
      try {
        record = JSON.parse(text);
      } catch {
      }
      const fresh = (record == null ? void 0 : record.date) === day$1(now) && Array.isArray(record.articles) ? record.articles.filter((article) => Number.isFinite(article == null ? void 0 : article.seenAt) && article.seenAt <= now + 6e4 && now - article.seenAt <= CONFIG.boostMission.rankingCacheMaxAge) : [];
      if (fresh.length === 0) storage.removeItem(BOOST_RANKING_CACHE_KEY);
      else if (fresh.length < record.articles.length) {
        storage.setItem(BOOST_RANKING_CACHE_KEY, JSON.stringify({ ...record, articles: fresh }));
      }
      return fresh;
    } catch {
      return [];
    }
  }
  function mergeRankingCandidates(articles) {
    const byId = /* @__PURE__ */ new Map();
    for (const article of articles) {
      const id2 = String((article == null ? void 0 : article.article_id) ?? "");
      const known = byId.get(id2);
      if (!known || article.seenAt >= known.seenAt) byId.set(id2, article);
    }
    return [...byId.values()];
  }
  function saveRankingCache(storage, now, articles) {
    const kept = getEligibleBoostCandidates(articles, "", now).slice(0, CONFIG.boostMission.rankingCacheSize);
    try {
      storage.setItem(BOOST_RANKING_CACHE_KEY, JSON.stringify({ date: day$1(now), articles: kept }));
    } catch {
    }
  }
  function boostRecordKey(userId, missionId) {
    return `stove-boost-v1:${userId}:${missionId}`;
  }
  function boostDailyKey(userId) {
    return `stove-boost-daily-v1:${userId}`;
  }
  function readRecord$1(storage, key) {
    if (!storage) throw new Error("부스트 실행 기록을 저장할 수 없습니다");
    const text = storage.getItem(key);
    if (!text) return {};
    const record = JSON.parse(text);
    if (!record || typeof record !== "object" || Array.isArray(record) || record.boost && (!/^\d+$/.test(record.boost.articleId) || !["pending", "confirmed"].includes(record.boost.status)) || record.reward && !["pending", "confirmed"].includes(record.reward.status)) {
      throw new Error("부스트 실행 기록을 확인할 수 없습니다");
    }
    return record;
  }
  function dailyBoostLimit() {
    return Math.max(0, Math.floor(Number(CONFIG.boostMission.dailyBoosts)) || 0);
  }
  function isValidAttempt(attempt) {
    return Boolean(attempt) && typeof attempt === "object" && /^\d+$/.test(String(attempt.articleId ?? "")) && ["pending", "confirmed"].includes(attempt.status);
  }
  function readDailyRecord(storage, key, today) {
    if (!storage) throw new Error("부스트 실행 기록을 저장할 수 없습니다");
    const text = storage.getItem(key);
    if (!text) return null;
    let record = JSON.parse(text);
    if (record && typeof record === "object" && !Array.isArray(record.boosts) && "articleId" in record) {
      const { date, ...attempt } = record;
      record = { date, boosts: [attempt] };
    }
    if (!record || typeof record !== "object" || typeof record.date !== "string" || !Array.isArray(record.boosts) || !record.boosts.every(isValidAttempt)) {
      throw new Error("부스트 실행 기록을 확인할 수 없습니다");
    }
    return record.date === today ? record : null;
  }
  function services$5(deps) {
    return {
      getBoostMissions,
      getBoostBalance,
      getBoostRanking,
      getArticleBoostStatuses,
      boostArticle,
      receiveBoostMissionReward,
      getMyProfile,
      delay,
      log,
      now: () => Date.now(),
      storage: globalThis.localStorage,
      publish: (status) => {
        if (typeof document !== "undefined") updateStatusUI({ boost: status });
      },
      withLock: async (key, work) => {
        var _a, _b;
        if (!((_b = (_a = globalThis.navigator) == null ? void 0 : _a.locks) == null ? void 0 : _b.request)) {
          throw new Error("부스트 중복 실행 잠금을 사용할 수 없습니다");
        }
        return globalThis.navigator.locks.request(key, { ifAvailable: true }, (lock) => lock ? work() : { success: false, reason: "alreadyRunning" });
      },
      ...deps
    };
  }
  async function checkBoostStatus(headers, deps = {}) {
    var _a, _b;
    const io = services$5(deps);
    try {
      const [missions, balance2, profile] = await Promise.all([
        io.getBoostMissions(headers),
        io.getBoostBalance(headers),
        io.getMyProfile(headers)
      ]);
      const userId = (_a = profile == null ? void 0 : profile.value) == null ? void 0 : _a.user_id;
      if ((profile == null ? void 0 : profile.code) !== 0 || !/^\d+$/.test(String(userId ?? ""))) throw new Error("부스트 계정을 확인할 수 없습니다");
      const dailyKey = boostDailyKey(userId);
      const dailyBoosts = ((_b = readDailyRecord(io.storage, dailyKey, day$1(io.now()))) == null ? void 0 : _b.boosts) || [];
      readRankingCache(io.storage, io.now());
      const dailyPending = dailyBoosts.some((attempt) => attempt.status === "pending");
      const firstDaily = dailyBoosts[0] || null;
      const mission = normalizeBoostMission(missions, io.now());
      pruneOldRecords(io.storage, "stove-boost-v1:", {
        now: io.now(),
        timestamps: (record2) => {
          var _a2, _b2;
          return [(_a2 = record2.boost) == null ? void 0 : _a2.attemptedAt, (_b2 = record2.reward) == null ? void 0 : _b2.attemptedAt];
        },
        keep: (key2) => Boolean(mission) && key2.endsWith(`:${mission.id}`)
      });
      if (!mission) {
        return {
          success: true,
          notAvailable: true,
          userId: String(userId),
          ...balance2,
          dailyKey,
          dailyBoosts,
          verificationPending: dailyPending,
          selectedArticle: firstDaily
        };
      }
      const key = boostRecordKey(userId, mission.id);
      const record = readRecord$1(io.storage, key);
      const missionBoostToday = record.boost && Number.isFinite(record.boost.attemptedAt) && day$1(record.boost.attemptedAt) === day$1(io.now()) ? record.boost : null;
      return {
        success: true,
        userId: String(userId),
        mission,
        ...balance2,
        key,
        record,
        dailyKey,
        dailyBoosts,
        verificationPending: Boolean(record.boost && mission.current < mission.required || record.reward && !mission.rewarded || dailyPending),
        selectedArticle: firstDaily || missionBoostToday
      };
    } catch (error) {
      return { success: false, unknown: true, error: error.message };
    }
  }
  function requireStatus$1(status) {
    if (!status.success) throw new Error(status.error || "부스트 상태 확인 실패");
    return status;
  }
  function save$1(io, context, record) {
    io.storage.setItem(context.key, JSON.stringify(record));
  }
  function saveDaily(io, context, record) {
    io.storage.setItem(context.dailyKey, JSON.stringify(record));
  }
  async function locked(headers, deps, work, { requireMission = true } = {}) {
    const io = services$5(deps);
    try {
      const initial = requireStatus$1(await checkBoostStatus(headers, io));
      io.publish(initial);
      if (initial.notAvailable && requireMission) return { success: true, skipped: true, reason: "noMission" };
      return await io.withLock(initial.key || initial.dailyKey, async () => {
        const context = requireStatus$1(await checkBoostStatus(headers, io));
        if (context.userId !== initial.userId || context.key !== initial.key || context.notAvailable && requireMission) throw new Error("부스트 계정 또는 미션이 변경되었습니다");
        io.publish(context);
        return work(context, io);
      });
    } catch (error) {
      io.log(`부스트 처리 중단: ${error.message}`, "warning");
      io.publish({ success: false, unknown: true, error: error.message });
      return { success: false, reason: "statusUnknown", error: error.message };
    }
  }
  async function verifyBoost(headers, context, io, articleId2, missionCounts) {
    var _a;
    let latest = context;
    for (let i = 0; i < CONFIG.boostMission.verifyAttempts; i++) {
      if (i > 0) await io.delay(CONFIG.boostMission.verifyDelay);
      latest = await checkBoostStatus(headers, io);
      if (latest.success && (latest.userId !== context.userId || missionCounts && (latest.notAvailable || latest.key !== context.key))) {
        return { confirmed: false, status: { success: false, unknown: true, error: "부스트 계정 또는 미션이 변경되었습니다" } };
      }
      if (missionCounts && latest.success && latest.mission.current >= latest.mission.required) {
        return { confirmed: true, status: latest };
      }
      try {
        const interactions = await io.getArticleBoostStatuses(headers, [articleId2]);
        if (((_a = interactions[articleId2]) == null ? void 0 : _a.BOOST) === true) return { confirmed: true, status: latest };
      } catch {
      }
    }
    return { confirmed: false, status: latest };
  }
  async function verifyReward(headers, context, io) {
    let latest = context;
    for (let i = 0; i < CONFIG.boostMission.verifyAttempts; i++) {
      if (i > 0) await io.delay(CONFIG.boostMission.verifyDelay);
      latest = await checkBoostStatus(headers, io);
      if (latest.success && !latest.notAvailable && latest.key === context.key) {
        if (latest.mission.rewarded) return { confirmed: true, status: latest };
      } else if (latest.success) {
        return { confirmed: false, status: { success: false, unknown: true, error: "부스트 계정 또는 미션이 변경되었습니다" } };
      }
    }
    return { confirmed: false, status: latest };
  }
  function saveDailyBoosts(io, context, boosts) {
    if (boosts.length === 0) io.storage.removeItem(context.dailyKey);
    else saveDaily(io, context, { date: day$1(io.now()), boosts });
  }
  function confirmAttempt(io, context, boosts, record, articleId2) {
    var _a;
    const attempt = boosts.find((item) => item.articleId === articleId2);
    if (attempt) {
      attempt.status = "confirmed";
      saveDailyBoosts(io, context, boosts);
    }
    if (((_a = record == null ? void 0 : record.boost) == null ? void 0 : _a.articleId) === articleId2) {
      record.boost.status = "confirmed";
      save$1(io, context, record);
    }
  }
  async function reviewPendingBoosts(headers, context, io, boosts, record) {
    const missionWaiting = Boolean(context.mission && record.boost && context.mission.current < context.mission.required);
    const attempts = boosts.filter((attempt) => attempt.status === "pending");
    if (missionWaiting && !attempts.some((attempt) => attempt.articleId === record.boost.articleId)) attempts.push(record.boost);
    if (attempts.length === 0) return { hadPending: false, allConfirmed: true };
    let allConfirmed = true;
    let latest = context;
    for (const attempt of attempts) {
      const missionCounts = missionWaiting && record.boost.articleId === attempt.articleId;
      const result = await verifyBoost(headers, context, io, attempt.articleId, missionCounts);
      latest = result.status;
      if (result.confirmed) confirmAttempt(io, context, boosts, record, attempt.articleId);
      else allConfirmed = false;
    }
    io.publish(latest);
    io.log(
      allConfirmed ? "기존 부스트 실행을 확인했습니다" : "이전 부스트의 반영 확인 대기 중입니다. 추가 부스트는 하지 않습니다",
      allConfirmed ? "success" : "warning"
    );
    return { hadPending: true, allConfirmed };
  }
  async function executeBoostMission(headers, deps = {}) {
    return locked(headers, deps, async (initialContext, io) => {
      const cached = readRankingCache(io.storage, io.now());
      let context = initialContext;
      let record = context.record || {};
      let boosts = context.dailyBoosts.map((attempt) => ({ ...attempt }));
      const reviewed = await reviewPendingBoosts(headers, context, io, boosts, record);
      if (reviewed.hadPending) {
        if (!reviewed.allConfirmed) return { success: false, skipped: true, reason: "previousAttempt" };
        context = requireStatus$1(await checkBoostStatus(headers, io));
        if (context.userId !== initialContext.userId || context.key !== initialContext.key) {
          throw new Error("부스트 계정 또는 미션이 변경되었습니다");
        }
        record = context.record || {};
        boosts = context.dailyBoosts.map((attempt) => ({ ...attempt }));
      }
      const { mission } = context;
      const limit = dailyBoostLimit();
      const missionNeedsBoost = Boolean(mission && !mission.rewarded && !mission.completed && mission.current === 0 && mission.required === 1 && !record.boost);
      const wanted = Math.max(limit - boosts.length, missionNeedsBoost ? 1 : 0);
      if (wanted < 1) {
        if (reviewed.hadPending) return { success: true, skipped: true, reason: "previousAttempt" };
        if (boosts.length > 0) return { success: true, skipped: true, reason: "alreadyBoostedToday" };
        if (!mission || mission.rewarded || mission.completed || mission.current >= mission.required) {
          return { success: true, skipped: true, reason: "alreadyCompleted" };
        }
        io.log("부스트 0/1 및 잔여 횟수 조건을 충족하지 않아 건너뜁니다", "info");
        return { success: true, skipped: true, reason: "notActionable" };
      }
      if (context.remainingCount < 1) {
        io.log("부스트 잔여 횟수가 없어 건너뜁니다", "info");
        return { success: true, skipped: true, reason: "notActionable" };
      }
      const count = Math.min(wanted, context.remainingCount);
      if (limit > 0) io.log(`오늘의 인기글 부스트: 오늘 ${boosts.length}/${limit}회, 이번에 최대 ${count}회`, "info");
      const queries = cached.length > 0 ? 1 : CONFIG.boostMission.rankingQueries;
      if (cached.length > 0) io.log(`저장된 인기글 후보 ${cached.length}개와 합쳐 실시간 후보는 1번만 조회합니다`, "info");
      const seen = [...cached];
      let ranking;
      for (let i = 0; i < queries; i++) {
        if (i > 0) await io.delay(CONFIG.boostMission.queryDelay);
        const next = await io.getBoostRanking(headers);
        const age = io.now() - next.generatedAt;
        if (age > CONFIG.boostMission.maxRankingAge || age < -6e4 || ranking && next.generatedAt < ranking.generatedAt) throw new Error("실시간 후보 집계가 오래되었거나 역전되었습니다");
        const repeated = (ranking == null ? void 0 : ranking.generatedAt) === next.generatedAt;
        ranking = next;
        seen.push(...next.articles.map((article) => slimCandidate(article, next.generatedAt)));
        io.log(`실시간 후보 조회 ${i + 1}/${queries}${repeated ? " (같은 집계 시각)" : ""}`, "info");
      }
      const merged = mergeRankingCandidates(seen);
      saveRankingCache(io.storage, io.now(), merged);
      const candidates = getEligibleBoostCandidates(merged, context.userId, io.now()).slice(0, CONFIG.boostMission.rankingCacheSize);
      if (candidates.length === 0) {
        io.log("조회한 후보 중 부스트 가능한 글이 없습니다", "warning");
        return { success: true, skipped: true, reason: "noCandidates" };
      }
      const interactions = await io.getArticleBoostStatuses(headers, candidates.map((article) => article.article_id));
      const targets2 = candidates.filter((article) => {
        var _a;
        return ((_a = interactions[article.article_id]) == null ? void 0 : _a.BOOST) === false && !boosts.some((attempt) => attempt.articleId === String(article.article_id));
      }).slice(0, count);
      if (targets2.length === 0) return { success: true, skipped: true, reason: "alreadyBoosted" };
      const boostedIds = [];
      let expectedRemaining = context.remainingCount;
      let allConfirmed = true;
      let stopReason = null;
      for (const [index, selected] of targets2.entries()) {
        if (index > 0) await io.delay(CONFIG.boostMission.boostDelay);
        const forMission = missionNeedsBoost && index === 0;
        const fresh = requireStatus$1(await checkBoostStatus(headers, io));
        if (fresh.userId !== context.userId || fresh.key !== context.key) throw new Error("부스트 계정 또는 미션이 변경되었습니다");
        if (fresh.remainingCount < 1 || fresh.remainingCount < expectedRemaining || fresh.dailyBoosts.length !== boosts.length || forMission && (fresh.mission.current !== mission.current || fresh.mission.rewarded !== mission.rewarded || fresh.mission.completed !== mission.completed || Boolean(fresh.record.boost))) {
          stopReason = "stateChanged";
          break;
        }
        if (!getEligibleBoostCandidates([selected], fresh.userId, io.now()).length) {
          stopReason = "candidateExpired";
          break;
        }
        if (io.now() - ranking.generatedAt > CONFIG.boostMission.maxRankingAge) {
          throw new Error("실행 직전 후보 집계가 만료되었습니다");
        }
        const articleId2 = String(selected.article_id);
        const attempt = {
          status: "pending",
          articleId: articleId2,
          title: selected.title,
          score: selected.score,
          attemptedAt: io.now(),
          generatedAt: ranking.generatedAt
        };
        boosts.push(attempt);
        saveDailyBoosts(io, context, boosts);
        if (forMission) {
          record.boost = { ...attempt };
          save$1(io, context, record);
        }
        io.log(`부스트 대상: ${selected.title} (${selected.score}℃)`, "info");
        try {
          await io.boostArticle(headers, selected.article_id);
        } catch (error) {
          if (error.definiteFailure && error.code !== 81333) {
            boosts.pop();
            saveDailyBoosts(io, context, boosts);
            if (forMission) {
              delete record.boost;
              save$1(io, context, record);
            }
            throw error;
          }
          io.log("부스트 응답이 불확실하여 서버 상태만 재확인합니다", "warning");
        }
        const result = await verifyBoost(headers, { ...context, record }, io, articleId2, forMission);
        if (!result.confirmed) {
          allConfirmed = false;
          break;
        }
        confirmAttempt(io, context, boosts, record, articleId2);
        boostedIds.push(articleId2);
        expectedRemaining -= 1;
      }
      io.publish(await checkBoostStatus(headers, io));
      if (boostedIds.length > 0) {
        io.log(`부스트 ${boostedIds.length}회 실행을 확인했습니다${limit > 0 ? ` (오늘 ${boosts.length}/${limit})` : ""}`, "success");
      }
      if (!allConfirmed) io.log("부스트 상태 반영 대기 중입니다. 추가 부스트는 하지 않습니다", "warning");
      if (stopReason && boostedIds.length === 0) return { success: true, skipped: true, reason: stopReason };
      return {
        success: allConfirmed,
        boosted: boostedIds.length,
        articleIds: boostedIds,
        articleId: boostedIds[0] ?? targets2[0].article_id,
        ...stopReason ? { stopped: stopReason } : {}
      };
    }, { requireMission: false });
  }
  async function claimBoostMissionReward(headers, deps = {}) {
    return locked(headers, deps, async (context, io) => {
      const { mission, record } = context;
      if (mission.rewarded) return { success: true, skipped: true, reason: "alreadyRewarded" };
      if (record.reward) {
        const result2 = await verifyReward(headers, context, io);
        if (result2.confirmed) {
          record.reward.status = "confirmed";
          save$1(io, context, record);
        }
        io.publish(await checkBoostStatus(headers, io));
        if (!result2.confirmed) io.log("이전 보상 수령의 상태 확인 대기 중입니다. 중복 수령 요청은 하지 않습니다", "warning");
        return { success: result2.confirmed, skipped: true, reason: "previousRewardAttempt" };
      }
      if (!mission.allCompleted) {
        io.log("오늘의 1등 미션의 부스트·댓글·글쓰기 조건이 아직 완료되지 않았습니다", "info");
        return { success: true, skipped: true, reason: "requirementsIncomplete" };
      }
      record.reward = { status: "pending", attemptedAt: io.now() };
      save$1(io, context, record);
      let rewardAmount = 0;
      try {
        rewardAmount = await io.receiveBoostMissionReward(headers, mission.id);
        record.reward = { ...record.reward, status: "confirmed", amount: rewardAmount };
        save$1(io, context, record);
        state.earnings.boostMission = (state.earnings.boostMission || 0) + rewardAmount;
        io.log(`오늘의 1등 미션 보상 수령: ${rewardAmount} FLAKE`, "success");
      } catch (error) {
        if (error.definiteFailure) {
          delete record.reward;
          save$1(io, context, record);
          throw error;
        }
        io.log("보상 수령 응답이 불확실하여 서버 상태만 재확인합니다", "warning");
      }
      const result = await verifyReward(headers, context, io);
      if (result.confirmed) {
        record.reward.status = "confirmed";
        save$1(io, context, record);
      }
      io.publish(await checkBoostStatus(headers, io));
      if (!result.confirmed) io.log("보상 수령 상태 반영 대기 중입니다. 추가 수령 요청은 하지 않습니다", "warning");
      return { success: result.confirmed, rewardAmount, verificationPending: !result.confirmed };
    });
  }
  function id(value) {
    if (!/^\d+$/.test(String(value ?? ""))) throw new Error("게임 리뷰 ID가 올바르지 않습니다");
    return String(value);
  }
  function makeReviewHeaders(headers, eventHub = false) {
    const common = {
      "caller-id": eventHub ? "event-hub" : "storee-cp",
      "X-Lang": "KO",
      "X-Nation": "KR",
      "X-Device-Type": "P01",
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: eventHub ? "https://event.onstove.com" : "https://page.onstove.com",
      Referer: eventHub ? "https://event.onstove.com/" : "https://page.onstove.com/"
    };
    if (eventHub) return common;
    const uuid = headers["X-UUID"] || headers["caller-detail"];
    if (!headers.Authorization || !uuid) throw new Error("게임 리뷰 인증 정보가 없습니다");
    return { ...common, Authorization: headers.Authorization, "X-UUID": uuid };
  }
  async function request(headers, path, method = "GET", body = null, eventHub = false) {
    const query = method === "GET" ? `${path.includes("?") ? "&" : "?"}timestemp=${Date.now()}` : "";
    const response = await apiRequest(
      `${CONFIG.api.baseUrl}/${path}${query}`,
      method,
      makeReviewHeaders(headers, eventHub),
      body,
      { timeout: 1e4 }
    );
    if ((response == null ? void 0 : response.code) !== 0 || response.value == null) {
      throw new Error((response == null ? void 0 : response.message) || "게임 리뷰 API 응답을 확인할 수 없습니다");
    }
    return response.value;
  }
  async function getReviewEvents(headers) {
    const events = /* @__PURE__ */ new Map();
    for (let page = 0; page < CONFIG.reviewEvent.maxEventPages; page++) {
      const value = await request(
        headers,
        `eventhub/v1.0/promotion/events/ON?page=${page}&service_id=STOVEINDIE`,
        "GET",
        null,
        true
      );
      if (!Number.isInteger(value.total_event_cnt) || value.total_event_cnt < 0 || !Array.isArray(value.promotion_events)) throw new Error("이벤트 목록 응답이 올바르지 않습니다");
      const before = events.size;
      for (const event of value.promotion_events) events.set(id(event == null ? void 0 : event.event_no), event);
      if (events.size >= value.total_event_cnt) return [...events.values()];
      if (events.size === before) throw new Error("이벤트 목록 전체를 확인하지 못했습니다");
    }
    throw new Error("이벤트 조회 페이지 한도를 초과했습니다");
  }
  async function getReviewArticle(headers, articleId2) {
    const value = await request(headers, `cwms/v3.0/article?article_id=${id(articleId2)}&request_id=CM`);
    if (String(value.article_id) !== String(articleId2) || value.community_key !== "quarter" || value.channel_key !== "kr" || value.article_status_code !== "PUBLISHED" || value.coverage_code !== "PUBLIC" || !/^\d+$/.test(String(value.board_seq ?? "")) || !/^\d+$/.test(String(value.channel_seq ?? "")) || typeof value.title !== "string") {
      throw new Error("공개 게임 리뷰 게시글을 확인할 수 없습니다");
    }
    return value;
  }
  async function getReviewMember(headers, channelSeq) {
    var _a;
    const value = await request(headers, `cwms/v1.0/user/CHANNEL/${id(channelSeq)}`);
    return id((_a = value.user_info) == null ? void 0 : _a.member_no);
  }
  async function canWriteReviewComment(headers, boardSeq) {
    var _a, _b;
    const value = await request(headers, `cwms/v1.0/user/board/permission?board_seq_list=${id(boardSeq)}`);
    const permission = Array.isArray(value) && value.find((board) => String(board.board_seq) === String(boardSeq));
    const allowed = (_b = (_a = permission == null ? void 0 : permission.user_permission_info) == null ? void 0 : _a.comment) == null ? void 0 : _b.write;
    if (typeof allowed !== "boolean") throw new Error("게임 리뷰 댓글 작성 권한을 확인할 수 없습니다");
    return allowed;
  }
  async function getReviewCommentPage(headers, articleId2, page) {
    if (!Number.isInteger(page) || page < 1) throw new Error("댓글 페이지가 올바르지 않습니다");
    const value = await request(
      headers,
      `cwms/v1.1/article/${id(articleId2)}/comment/list?size=20&page=${page}&sort_type_code=LATEST&request_id=CM`
    );
    if (!Number.isInteger(value.total) || value.total < 0 || !Number.isInteger(value.display_total) || value.display_total < 0 || value.display_total > value.total || value.page !== page || value.size !== 20 || !["Y", "N"].includes(value.next_yn) || !(Array.isArray(value.list) || value.total === 0 && value.list == null)) {
      throw new Error("게임 리뷰 댓글 목록을 확인할 수 없습니다");
    }
    const list = value.list || [];
    if (list.some((comment) => {
      var _a;
      return !/^\d+$/.test(String((comment == null ? void 0 : comment.comment_id) ?? "")) || !/^\d+$/.test(String(((_a = comment.user_info) == null ? void 0 : _a.member_no) ?? "")) || typeof comment.comment_status_code !== "string";
    })) throw new Error("댓글 작성자를 확인할 수 없습니다");
    return { ...value, list };
  }
  async function postReviewSticker(headers, articleId2) {
    const image = CONFIG.reviewEvent.stickerUrl;
    if (!/^https:\/\/d2x8kymwjom7h7\.cloudfront\.net\/live\/application_no\/10009\/partners-sns-api\/[A-Za-z0-9_-]+\.png$/.test(image)) {
      throw new Error("게임 리뷰 스티커 주소가 올바르지 않습니다");
    }
    const value = await request(headers, `cwms/v1.0/article/${id(articleId2)}/comment`, "POST", {
      comment: `<p><img src="${image}" class="js-is-emoji emoji__img emoji-wrap" data-sticker=""><br></p>`,
      attach_info: { media_info: null, poll_info: null, quote_info: null },
      request_id: "CM",
      view_mode: "EDITOR"
    });
    return { commentId: id(value.comment_id) };
  }
  const day = (timestamp) => new Date(timestamp + 9 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && (/* @__PURE__ */ new Date(`${value}T00:00:00Z`)).toISOString().slice(0, 10) === value;
  }
  function reviewEventWindow(event, now = Date.now()) {
    if (!validDate(event == null ? void 0 : event.startDate) || !validDate(event == null ? void 0 : event.endDate) || event.startDate > event.endDate) {
      throw new Error("게임 리뷰 이벤트 날짜를 확인할 수 없습니다");
    }
    const today = day(now);
    if (today < event.startDate) return "upcoming";
    if (today > event.endDate) return "expired";
    return event.status === "ONGOING" ? "active" : "inactive";
  }
  function selectReviewEvent(events, now = Date.now()) {
    const matching = events.filter((event2) => {
      const title = String((event2 == null ? void 0 : event2.title) ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return (event2 == null ? void 0 : event2.service_id) === "STOVEINDIE" && event2.language === "ko" && Array.isArray(event2.benefits) && event2.benefits.includes("FLAKE") && title.includes("게임 리뷰 읽고") && title.includes("댓글 달면 플레이크 GET!");
    });
    if (!matching.length) return null;
    if (matching.length !== 1) throw new Error("게임 리뷰 이벤트 대상이 여러 개입니다");
    const raw = matching[0];
    const url = new URL(raw.link_url);
    const match = /^\/quarter\/kr\/view\/(\d+)\/?$/.exec(url.pathname);
    if (url.origin !== "https://page.onstove.com" || url.username || url.password || !match || !/^\d+$/.test(String(raw.event_no ?? ""))) throw new Error("게임 리뷰 이벤트 링크가 올바르지 않습니다");
    const event = {
      eventNo: String(raw.event_no),
      articleId: match[1],
      url: `${url.origin}/quarter/kr/view/${match[1]}`,
      title: "게임 리뷰 댓글 이벤트",
      startDate: raw.expose_start_at,
      endDate: raw.expose_end_at,
      status: raw.status
    };
    return { ...event, window: reviewEventWindow(event, now) };
  }
  const reviewRecordKey = (memberNo, articleId2) => `stove-review-v1:${memberNo}:${articleId2}`;
  function readRecord(storage, key) {
    if (!storage) throw new Error("게임 리뷰 참여 기록을 저장할 수 없습니다");
    const text = storage.getItem(key);
    if (!text) return null;
    const value = JSON.parse(text);
    if (!value || !["pending", "confirmed"].includes(value.status) || !Number.isFinite(value.attemptedAt) || !/^\d+$/.test(String(value.eventNo ?? "")) || value.status === "confirmed" && !/^\d+$/.test(String(value.commentId ?? "")) || value.commentId != null && !/^\d+$/.test(String(value.commentId))) {
      throw new Error("게임 리뷰 참여 기록을 확인할 수 없습니다");
    }
    return value;
  }
  function save(io, key, record) {
    const text = JSON.stringify(record);
    io.storage.setItem(key, text);
    if (io.storage.getItem(key) !== text) throw new Error("게임 리뷰 참여 기록 저장에 실패했습니다");
  }
  function services$4(deps) {
    return {
      getReviewEvents,
      getReviewArticle,
      getReviewMember,
      canWriteReviewComment,
      getReviewCommentPage,
      postReviewSticker,
      delay,
      openTabInBackground,
      closeTab,
      log,
      now: () => Date.now(),
      storage: globalThis.localStorage,
      publish: (status) => {
        if (typeof document !== "undefined") updateStatusUI({ reviewEvent: status });
      },
      withLock: async (key, work) => {
        var _a, _b;
        if (!((_b = (_a = globalThis.navigator) == null ? void 0 : _a.locks) == null ? void 0 : _b.request)) throw new Error("게임 리뷰 중복 실행 잠금을 사용할 수 없습니다");
        return globalThis.navigator.locks.request(key, { ifAvailable: true }, (lock) => lock ? work() : { success: false, reason: "alreadyRunning" });
      },
      ...deps
    };
  }
  async function findOwnReviewComment(headers, articleId2, memberNo, io) {
    const seen = /* @__PURE__ */ new Set();
    for (let page = 1; page <= CONFIG.reviewEvent.maxCommentPages; page++) {
      const value = await io.getReviewCommentPage(headers, articleId2, page);
      const own = value.list.find((comment) => String(comment.user_info.member_no) === String(memberNo));
      if (own) return String(own.comment_id);
      const before = seen.size;
      for (const comment of value.list) seen.add(String(comment.comment_id));
      if (value.next_yn === "N") {
        if (seen.size < value.display_total) throw new Error("댓글 목록 전체를 확인하지 못했습니다");
        return null;
      }
      if (seen.size === before) throw new Error("댓글 조회 페이지가 반복되었습니다");
    }
    throw new Error("댓글 조회 페이지 한도를 초과했습니다");
  }
  async function checkReviewEventStatus(headers, deps = {}) {
    const io = services$4(deps);
    try {
      if (!CONFIG.reviewEvent.enabled) ;
      const event = selectReviewEvent(await io.getReviewEvents(headers), io.now());
      pruneOldRecords(io.storage, "stove-review-v1:", {
        now: io.now(),
        timestamps: (record2) => [record2.attemptedAt],
        keep: (key2) => Boolean(event) && key2.endsWith(`:${event.articleId}`)
      });
      if (!event) return { success: true, reason: "noEvent", actionable: false };
      if (event.window !== "active") return { success: true, event, reason: event.window, actionable: false };
      const article = await io.getReviewArticle(headers, event.articleId);
      const [memberNo, allowed] = await Promise.all([
        io.getReviewMember(headers, article.channel_seq),
        io.canWriteReviewComment(headers, article.board_seq)
      ]);
      const key = reviewRecordKey(memberNo, event.articleId);
      const record = readRecord(io.storage, key);
      const context = {
        success: true,
        event,
        articleTitle: article.title,
        channelSeq: article.channel_seq,
        memberNo,
        key,
        record,
        actionable: false,
        rewardVerified: false
      };
      if ((record == null ? void 0 : record.status) === "confirmed") return { ...context, reason: "completed", commentId: record.commentId };
      const commentId = await findOwnReviewComment(headers, event.articleId, memberNo, io);
      if (commentId) return { ...context, reason: "completed", commentId };
      if (record) return { ...context, reason: "pending" };
      if (!allowed) return { ...context, reason: "noPermission" };
      const window2 = reviewEventWindow(event, io.now());
      return { ...context, reason: window2 === "active" ? "ready" : window2, actionable: window2 === "active" };
    } catch (error) {
      return { success: false, unknown: true, actionable: false, error: error.message };
    }
  }
  function requireStatus(status) {
    if (!status.success) throw new Error(status.error || "게임 리뷰 상태 확인 실패");
    return status;
  }
  async function executeReviewEvent(headers, deps = {}) {
    const io = services$4(deps);
    let tab;
    let context;
    try {
      const initial = requireStatus(await checkReviewEventStatus(headers, io));
      io.publish(initial);
      if (!initial.actionable) return { ...initial, skipped: true };
      return await io.withLock(initial.key, async () => {
        context = requireStatus(await checkReviewEventStatus(headers, io));
        if (!context.actionable) {
          io.publish(context);
          return { ...context, skipped: true };
        }
        if (context.key !== initial.key || context.event.eventNo !== initial.event.eventNo) {
          throw new Error("게임 리뷰 계정 또는 대상 이벤트가 변경되었습니다");
        }
        io.log(`게임 리뷰 방문: ${context.articleTitle}`, "info");
        tab = io.openTabInBackground(context.event.url, false);
        if (!tab) throw new Error("게임 리뷰 방문 탭을 열지 못했습니다");
        await io.delay(CONFIG.reviewEvent.visitDelay);
        const fresh = requireStatus(await checkReviewEventStatus(headers, io));
        io.publish(fresh);
        if (!fresh.actionable) return { ...fresh, skipped: true };
        if (fresh.key !== context.key || fresh.event.eventNo !== context.event.eventNo) {
          throw new Error("게임 리뷰 계정 또는 대상 이벤트가 변경되었습니다");
        }
        context = fresh;
        const memberNo = await io.getReviewMember(headers, context.channelSeq);
        if (String(memberNo) !== String(context.memberNo)) throw new Error("게임 리뷰 계정이 변경되었습니다");
        if (reviewEventWindow(context.event, io.now()) !== "active") {
          const expired = { ...context, actionable: false, reason: reviewEventWindow(context.event, io.now()) };
          io.publish(expired);
          return { ...expired, skipped: true };
        }
        if (readRecord(io.storage, context.key)) throw new Error("게임 리뷰 참여 기록이 변경되었습니다");
        const record = { status: "pending", eventNo: context.event.eventNo, attemptedAt: io.now() };
        save(io, context.key, record);
        io.publish({ ...context, record, actionable: false, reason: "pending" });
        let accepted = false;
        let failure;
        try {
          const result = await io.postReviewSticker(headers, context.event.articleId);
          accepted = true;
          record.commentId = result.commentId;
          save(io, context.key, record);
        } catch (error) {
          failure = error.message;
          io.log(`게임 리뷰 댓글 결과 확인 대기: ${error.message}`, "warning");
        }
        for (let i = 0; i < CONFIG.reviewEvent.verifyAttempts; i++) {
          try {
            if (i > 0) await io.delay(CONFIG.reviewEvent.verifyDelay);
            const commentId = await findOwnReviewComment(headers, context.event.articleId, context.memberNo, io);
            if (commentId) {
              save(io, context.key, { ...record, status: "confirmed", commentId });
              io.publish({ ...context, reason: "completed", actionable: false, commentId });
              io.log("게임 리뷰 스티커 댓글 등록 완료 · 플레이크 지급 여부는 별도 확인이 필요합니다", "success");
              return { success: true, accepted, commented: true, commentId, rewardVerified: false };
            }
          } catch {
          }
        }
        io.publish({ ...context, record, actionable: false, reason: "pending" });
        return { success: false, accepted, reason: "pending", error: failure || "댓글 등록 결과 반영 확인 대기" };
      });
    } catch (error) {
      io.log(`게임 리뷰 자동화 중단: ${error.message}`, "warning");
      io.publish({ success: false, unknown: true, actionable: false, error: error.message });
      return { success: false, reason: "unknown", error: error.message };
    } finally {
      if (tab) io.closeTab(tab);
    }
  }
  const STATUS_KEYS = ["articleWrite", "dailyMission", "roulette", "dailyShop", "majakShop", "survey", "boost", "reviewEvent"];
  const BALANCE_KEYS = ["totalFlake", "monthlyFlake"];
  function services$3(deps = {}) {
    return {
      getRouletteParticipationCount,
      getDailyShopRewards,
      getMajakDailyShopRewards,
      apiRequest,
      getAllDailyMissions,
      getMyProfile,
      getMyArticles,
      getTodayString,
      ...deps
    };
  }
  async function checkTodayAttendanceStatus(io, readShop) {
    var _a;
    try {
      const shopData = await readShop();
      if ((_a = shopData == null ? void 0 : shopData.value) == null ? void 0 : _a.daily_attendances) {
        const rewards = shopData.value.daily_attendances.rewards || [];
        const todayString = io.getTodayString();
        const todayReward = rewards.find((reward) => reward.attendance_date === todayString);
        if (todayReward) {
          return { success: true, received: todayReward.is_received, notReceived: !todayReward.is_received };
        }
        return { success: true, received: false, notReceived: false, noRewardToday: true };
      }
      return { success: false, error: "데이터 없음" };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  async function checkRouletteStatus(headers, deps = {}) {
    const io = services$3(deps);
    try {
      const participationInfo = await io.getRouletteParticipationCount(headers, getRouletteSubEventNo());
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
  async function checkDailyShopStatus(headers, deps = {}) {
    const io = services$3(deps);
    return checkTodayAttendanceStatus(io, () => io.getDailyShopRewards(headers));
  }
  async function checkMajakShopStatus(headers, deps = {}) {
    const io = services$3(deps);
    return checkTodayAttendanceStatus(io, () => io.getMajakDailyShopRewards(headers));
  }
  async function checkSurveyStatus(headers, deps = {}) {
    var _a;
    const io = services$3(deps);
    try {
      if (!CONFIG.surveyMissions.enabled) ;
      const componentNo = state.missionComponents.survey;
      if (!componentNo) return { success: true, notAvailable: true };
      const response = await io.apiRequest(missionComponentUrl(componentNo), "GET", headers);
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
  async function checkDailyMissionStatus(headers, deps = {}) {
    const io = services$3(deps);
    try {
      const allMissions = await io.getAllDailyMissions(headers);
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
  async function checkArticleWriteStatus(headers, deps = {}) {
    var _a, _b;
    const io = services$3(deps);
    try {
      const profileData = await io.getMyProfile(headers);
      if (!((_a = profileData == null ? void 0 : profileData.value) == null ? void 0 : _a.user_id)) {
        return { success: false, error: "프로필 정보 없음" };
      }
      const userId = profileData.value.user_id;
      const articlesData = await io.getMyArticles(headers, userId, 10);
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
    log("🌐 필수 페이지 탭 열기...", "info");
    const tabs = [];
    try {
      log("  📋 리워드샵 페이지 방문 중...", "info");
      tabs.push(openTabInBackground("https://reward.onstove.com/ko", false));
      log("  🏠 스토브 메인 페이지 방문 중...", "info");
      tabs.push(openTabInBackground("https://store.onstove.com/", false));
      log("✓ 필수 페이지 탭 열림", "success");
    } catch (error) {
      log(`⚠️ 페이지 방문 중 오류: ${error.message}`, "warning");
    }
    return tabs;
  }
  async function checkAllStatus() {
    console.log("[상태 확인 시작]");
    try {
      const headers = extractHeaders();
      updateStatusUI(Object.fromEntries([...STATUS_KEYS, ...BALANCE_KEYS].map((key) => [key, { loading: true }])));
      if (getMissionComponentNos().length === 0) {
        await getMissionComponentIds(headers);
      }
      const [articleWriteStatus, dailyMissionStatus, rouletteStatus, dailyShopStatus, majakShopStatus, surveyStatus, totalFlake, monthlyFlake, boostStatus, reviewEventStatus] = await Promise.all([
        checkArticleWriteStatus(headers),
        checkDailyMissionStatus(headers),
        checkRouletteStatus(headers),
        checkDailyShopStatus(headers),
        checkMajakShopStatus(headers),
        checkSurveyStatus(headers),
        getTotalFlakeBalance(headers),
        getMonthlyFlakeTotal(headers),
        checkBoostStatus(headers),
        checkReviewEventStatus(headers)
      ]);
      updateStatusUI({
        articleWrite: articleWriteStatus,
        dailyMission: dailyMissionStatus,
        roulette: rouletteStatus,
        dailyShop: dailyShopStatus,
        majakShop: majakShopStatus,
        survey: surveyStatus,
        boost: boostStatus,
        reviewEvent: reviewEventStatus,
        totalFlake,
        monthlyFlake
      });
      updatePointCashChargeButtonAvailability(totalFlake);
      console.log("[상태 확인] ✅ 완료");
    } catch (error) {
      console.error("[상태 확인 오류]", error);
      alert(`상태 확인 실패: ${error.message}`);
      updateStatusUI(Object.fromEntries([
        ...STATUS_KEYS.map((key) => [key, { success: false, error: "확인 실패" }]),
        ...BALANCE_KEYS.map((key) => [key, { error: true }])
      ]));
      updatePointCashChargeButtonAvailability(null);
    }
  }
  const SNAPSHOT_CATEGORIES = ["daily", "content", "weekly", "banner", "attendance", "survey", "other"];
  const COMPLETE_STATUSES$1 = /* @__PURE__ */ new Set(["COMPLETE", "COMPLETED"]);
  const DONE_STATUSES = /* @__PURE__ */ new Set(["COMPLETE", "COMPLETED"]);
  const defaultServices = {
    checkReviewEventStatus,
    checkBoostStatus,
    checkArticleWriteStatus,
    getAllDailyMissions,
    getMissionComponentIds,
    getRouletteParticipationCount,
    getRouletteSubEventNo,
    getRouletteExtra,
    getRouletteExtraSubEventNo,
    getDailyShopRewards,
    getMajakDailyShopRewards,
    getTotalFlakeBalance,
    getMonthlyFlakeTotal
  };
  function emptyCategories() {
    return Object.fromEntries(
      SNAPSHOT_CATEGORIES.map((category) => [
        category,
        { all: [], complete: [], receivable: [], incomplete: [] }
      ])
    );
  }
  function getMissionCategory(componentNo, componentType, missionComponents = state.missionComponents) {
    switch (componentType) {
      case "SINGLE":
        return "daily";
      case "CONTENT1":
        return "content";
      case "SURVEY":
        return "survey";
      case "BANNER":
        return "banner";
      case "ACCUMULATION":
        return componentNo === missionComponents.weekly ? "weekly" : "attendance";
      default:
        return "other";
    }
  }
  function isReceived(value) {
    if (value === true || value === 1) return true;
    if (typeof value === "string") {
      return ["Y", "YES", "TRUE", "1"].includes(value.toUpperCase());
    }
    return false;
  }
  function toFiniteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }
    return null;
  }
  function serializeError(error) {
    return {
      name: (error == null ? void 0 : error.name) || "Error",
      message: (error == null ? void 0 : error.message) || String(error)
    };
  }
  function makeSnapshotError(section, message, extra = {}) {
    return {
      name: "SnapshotValidationError",
      message,
      section,
      ...extra
    };
  }
  function failedSection(error, extra = {}) {
    return {
      success: false,
      error,
      ...extra
    };
  }
  function normalizeRoulette(rouletteResult) {
    if (!rouletteResult.ok) {
      return failedSection(rouletteResult.error, {
        raw: null,
        current: 0,
        limit: CONFIG.roulette.maxDraws,
        remaining: 0,
        unknown: true
      });
    }
    if (rouletteResult.error) {
      return failedSection(rouletteResult.error, {
        raw: rouletteResult.value ?? null,
        current: 0,
        limit: CONFIG.roulette.maxDraws,
        remaining: 0,
        unknown: true
      });
    }
    const current = rouletteResult.value.value.participation_cnt;
    const limit = CONFIG.roulette.maxDraws;
    return {
      success: true,
      raw: rouletteResult.value,
      current,
      limit,
      remaining: Math.max(0, limit - current),
      unknown: false
    };
  }
  function normalizeRouletteExtra(extraResult) {
    var _a;
    if (!extraResult.ok) {
      return failedSection(extraResult.error, {
        raw: null,
        current: 0,
        currentCycle: null,
        milestones: [],
        claimable: []
      });
    }
    if (extraResult.error) {
      return failedSection(extraResult.error, {
        raw: extraResult.value ?? null,
        current: 0,
        currentCycle: null,
        milestones: [],
        claimable: []
      });
    }
    const value = ((_a = extraResult.value) == null ? void 0 : _a.value) || {};
    const current = value.current_cnt || 0;
    const milestones = Array.isArray(value.milestones) ? value.milestones : [];
    const claimable = milestones.filter(
      (milestone) => current >= (milestone.milestone || 0) && !isReceived(milestone.received_yn ?? milestone.is_received)
    );
    return {
      success: true,
      raw: extraResult.value,
      current,
      currentCycle: value.current_cycle ?? null,
      milestones,
      claimable
    };
  }
  function normalizeShop(shopResult) {
    var _a;
    const todayString = getTodayKSTString();
    if (!shopResult.ok) {
      return failedSection(shopResult.error, {
        raw: null,
        date: todayString,
        dailyAttendances: null,
        accumulatedAttendances: null,
        unclaimedDaily: []
      });
    }
    if (shopResult.error) {
      return failedSection(shopResult.error, {
        raw: shopResult.value ?? null,
        date: todayString,
        dailyAttendances: null,
        accumulatedAttendances: null,
        unclaimedDaily: []
      });
    }
    const value = ((_a = shopResult.value) == null ? void 0 : _a.value) || {};
    const dailyAttendances = value.daily_attendances || null;
    const accumulatedAttendances = value.accumulated_attendances || null;
    const dailyRewards = Array.isArray(dailyAttendances == null ? void 0 : dailyAttendances.rewards) ? dailyAttendances.rewards : [];
    const unclaimedDaily = dailyRewards.filter(
      (reward) => reward.attendance_date === todayString && !isReceived(reward.is_received)
    );
    return {
      success: true,
      raw: shopResult.value,
      date: todayString,
      dailyAttendances,
      accumulatedAttendances,
      unclaimedDaily
    };
  }
  async function settleSnapshotPart(factory) {
    try {
      return { ok: true, value: await factory(), error: null };
    } catch (error) {
      return { ok: false, value: null, error: serializeError(error) };
    }
  }
  function hasNonzeroCode(value) {
    return Object.hasOwn(value || {}, "code") && value.code !== 0;
  }
  function validateCodeResult(section, result) {
    if (!result.ok) return result;
    if (!result.value) {
      return {
        ...result,
        error: makeSnapshotError(section, `${section} returned empty payload`)
      };
    }
    if (hasNonzeroCode(result.value)) {
      return {
        ...result,
        error: makeSnapshotError(section, result.value.message || `${section} returned nonzero code`, {
          code: result.value.code
        })
      };
    }
    return result;
  }
  function validateRouletteResult(result) {
    var _a, _b;
    const validated = validateCodeResult("roulette", result);
    if (!validated.ok || validated.error) return validated;
    const participationCount = (_b = (_a = validated.value) == null ? void 0 : _a.value) == null ? void 0 : _b.participation_cnt;
    if (!Number.isFinite(participationCount)) {
      return {
        ...validated,
        error: makeSnapshotError("roulette", "Roulette payload missing valid participation count")
      };
    }
    return validated;
  }
  function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }
  function validateRouletteExtraResult(result) {
    var _a;
    const validated = validateCodeResult("rouletteExtra", result);
    if (!validated.ok || validated.error) return validated;
    const value = (_a = validated.value) == null ? void 0 : _a.value;
    if (!isRecord(value) || !Array.isArray(value.milestones)) {
      return {
        ...validated,
        error: makeSnapshotError("rouletteExtra", "Roulette extra payload missing milestones array")
      };
    }
    return validated;
  }
  function validateAttendanceShopResult(section, result) {
    var _a;
    const validated = validateCodeResult(section, result);
    if (!validated.ok || validated.error) return validated;
    const value = (_a = validated.value) == null ? void 0 : _a.value;
    if (!isRecord(value)) {
      return {
        ...validated,
        error: makeSnapshotError(section, `${section} payload missing attendance data`)
      };
    }
    const attendanceKeys = ["daily_attendances", "accumulated_attendances"];
    const recognizedKeys = attendanceKeys.filter((key) => Object.hasOwn(value, key));
    const malformedKey = recognizedKeys.find((key) => !isRecord(value[key]));
    if (recognizedKeys.length === 0 || malformedKey) {
      return {
        ...validated,
        error: makeSnapshotError(section, `${section} payload contained invalid attendance data`)
      };
    }
    return validated;
  }
  function hasComponentIds(value) {
    return Boolean(value && typeof value === "object" && Object.values(value).some(
      (componentNo) => Array.isArray(componentNo) ? componentNo.length > 0 : componentNo != null
    ));
  }
  function extractNumericFlake(raw) {
    if (typeof raw === "number") return raw;
    const value = raw == null ? void 0 : raw.value;
    if (typeof value === "number") return value;
    if (typeof (value == null ? void 0 : value.mileage_amount) === "number") return value.mileage_amount;
    if (typeof (value == null ? void 0 : value.total_deposit_amount) === "number") return value.total_deposit_amount;
    if (typeof (value == null ? void 0 : value.amount) === "number") return value.amount;
    return null;
  }
  function normalizeFlake(totalResult, monthlyResult) {
    const errors = {};
    if (!totalResult.ok) errors.total = totalResult.error;
    if (!monthlyResult.ok) errors.monthly = monthlyResult.error;
    const total = totalResult.ok ? extractNumericFlake(totalResult.value) : null;
    const monthly = monthlyResult.ok ? extractNumericFlake(monthlyResult.value) : null;
    if (totalResult.ok && total === null) {
      errors.total = makeSnapshotError("flake", "Unable to extract total flake balance");
    }
    if (monthlyResult.ok && monthly === null) {
      errors.monthly = makeSnapshotError("flake", "Unable to extract monthly flake total");
    }
    return {
      success: totalResult.ok && monthlyResult.ok && Object.keys(errors).length === 0,
      error: Object.keys(errors).length > 0 ? errors : void 0,
      total,
      monthly,
      rawTotal: totalResult.ok ? totalResult.value : null,
      rawMonthly: monthlyResult.ok ? monthlyResult.value : null
    };
  }
  function normalizeMissionSnapshot(components = [], options = {}) {
    var _a;
    const missionComponents = options.missionComponents || state.missionComponents;
    const categories = emptyCategories();
    const byMissionNo = {};
    for (const component of Array.isArray(components) ? components : []) {
      const componentNo = component == null ? void 0 : component.componentNo;
      const componentType = (_a = component == null ? void 0 : component.component_info) == null ? void 0 : _a.component_type;
      const category = getMissionCategory(componentNo, componentType, missionComponents);
      const missions = Array.isArray(component == null ? void 0 : component.missions) ? component.missions : [];
      for (const mission of missions) {
        const normalized = {
          missionNo: mission.mission_no,
          componentNo,
          componentType,
          category,
          title: mission.title,
          status: mission.status,
          missionType: mission.mission_type,
          isVisitMission: mission.is_visit_mission === true,
          rewardAmount: mission.reward_amount || 0,
          userCompleteCount: toFiniteNumber(mission.user_complete_cnt),
          milestonePerCount: toFiniteNumber(mission.milestone_per_cnt),
          milestoneTotalCount: toFiniteNumber(mission.milestone_total_cnt),
          buttonUrl: mission.button_url || mission.url || null
        };
        categories[category].all.push(normalized);
        byMissionNo[normalized.missionNo] = normalized;
        if (COMPLETE_STATUSES$1.has(normalized.status)) {
          categories[category].complete.push(normalized);
        } else if (normalized.status === "RECEIVABLE") {
          categories[category].receivable.push(normalized);
        } else if (normalized.status === "INCOMPLETE") {
          categories[category].incomplete.push(normalized);
        }
      }
    }
    return { success: true, categories, byMissionNo };
  }
  async function captureAutomationSnapshot(headers, deps = {}) {
    var _a, _b, _c, _d, _e, _f;
    const services2 = { ...defaultServices, ...deps };
    const errors = {};
    const settle = (name, factory) => {
      if (!services2.onSectionTime) return settleSnapshotPart(factory);
      const begin = getTimestamp();
      return settleSnapshotPart(factory).then((result) => {
        services2.onSectionTime(name, getTimestamp() - begin);
        return result;
      });
    };
    const missionComponentResult = await settle("missionComponents", () => services2.getMissionComponentIds(headers));
    let missionComponentIds = state.missionComponents;
    if (missionComponentResult.ok && hasComponentIds(missionComponentResult.value)) {
      missionComponentIds = missionComponentResult.value;
    } else if (!missionComponentResult.ok) {
      errors.missionComponents = missionComponentResult.error;
    } else {
      errors.missionComponents = makeSnapshotError("missionComponents", "Mission component refresh returned no component IDs");
    }
    const [
      articleWrite,
      missionComponents,
      rawRouletteResult,
      rawRouletteExtraResult,
      rawShopResult,
      rawMajakResult,
      flakeTotal,
      flakeMonthly,
      boostResult,
      reviewEventResult
    ] = await Promise.all([
      settle("articleWrite", () => services2.checkArticleWriteStatus(headers)),
      settle("missions", () => services2.getAllDailyMissions(headers)),
      settle("roulette", () => services2.getRouletteParticipationCount(headers, services2.getRouletteSubEventNo())),
      settle("rouletteExtra", () => services2.getRouletteExtra(headers, services2.getRouletteExtraSubEventNo())),
      settle("shop", () => services2.getDailyShopRewards(headers)),
      settle("majak", () => services2.getMajakDailyShopRewards(headers)),
      settle("flakeTotal", () => services2.getTotalFlakeBalance(headers)),
      settle("flakeMonthly", () => services2.getMonthlyFlakeTotal(headers)),
      settle("boost", () => services2.checkBoostStatus(headers)),
      settle("reviewEvent", () => services2.checkReviewEventStatus(headers))
    ]);
    const rouletteResult = validateRouletteResult(rawRouletteResult);
    const rouletteExtraResult = validateRouletteExtraResult(rawRouletteExtraResult);
    const shopResult = validateAttendanceShopResult("shop", rawShopResult);
    const majakResult = validateAttendanceShopResult("majak", rawMajakResult);
    const articleWriteError = articleWrite.ok && (!articleWrite.value || articleWrite.value.success === false) ? makeSnapshotError("articleWrite", ((_a = articleWrite.value) == null ? void 0 : _a.error) || ((_b = articleWrite.value) == null ? void 0 : _b.message) || "Article write status returned unsuccessful payload") : null;
    let missionsError = null;
    if (missionComponents.ok && !Array.isArray(missionComponents.value)) {
      missionsError = makeSnapshotError("missions", "Missions payload was not an array");
    } else if (missionComponents.ok && Object.hasOwn(errors, "missionComponents") && Array.isArray(missionComponents.value) && missionComponents.value.length === 0) {
      missionsError = makeSnapshotError("missions", "Missions payload was empty after component refresh failed");
    }
    const sectionResults = {
      articleWrite: articleWriteError ? { ...articleWrite, error: articleWriteError } : articleWrite,
      missions: missionComponents,
      roulette: rouletteResult,
      rouletteExtra: rouletteExtraResult,
      shop: shopResult,
      majak: majakResult
    };
    for (const [sectionName, result] of Object.entries(sectionResults)) {
      if (!result.ok || result.error) errors[sectionName] = result.error;
    }
    if (missionsError) errors.missions = missionsError;
    const flake = normalizeFlake(flakeTotal, flakeMonthly);
    if (!flake.success) {
      errors.flake = flake.error;
    }
    const boostError = !boostResult.ok ? boostResult.error : ((_c = boostResult.value) == null ? void 0 : _c.success) !== true ? makeSnapshotError("boost", ((_d = boostResult.value) == null ? void 0 : _d.error) || "부스트 상태 확인 실패") : null;
    if (boostError) errors.boost = boostError;
    const reviewEventError = !reviewEventResult.ok ? reviewEventResult.error : ((_e = reviewEventResult.value) == null ? void 0 : _e.success) !== true ? makeSnapshotError("reviewEvent", ((_f = reviewEventResult.value) == null ? void 0 : _f.error) || "게임 리뷰 이벤트 상태 확인 실패") : null;
    if (reviewEventError) errors.reviewEvent = reviewEventError;
    const missions = missionComponents.ok && !missionsError ? normalizeMissionSnapshot(missionComponents.value, { missionComponents: missionComponentIds }) : failedSection(missionComponents.error || missionsError, {
      categories: emptyCategories(),
      byMissionNo: {}
    });
    return {
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      degraded: Object.keys(errors).length > 0,
      errors,
      articleWrite: articleWrite.ok && !articleWriteError ? articleWrite.value : failedSection(articleWrite.error || articleWriteError, articleWrite.value || {}),
      missions,
      roulette: normalizeRoulette(rouletteResult),
      rouletteExtra: normalizeRouletteExtra(rouletteExtraResult),
      shop: normalizeShop(shopResult),
      majak: normalizeShop(majakResult),
      boost: boostError ? failedSection(boostError, { unknown: true }) : boostResult.value,
      reviewEvent: reviewEventError ? failedSection(reviewEventError, { unknown: true, actionable: false }) : reviewEventResult.value,
      flake
    };
  }
  function compareMonthlyAttendanceProgress(before, after) {
    var _a, _b;
    const beforeMissions = Object.values(((_a = before == null ? void 0 : before.missions) == null ? void 0 : _a.byMissionNo) || {});
    const afterMissions = ((_b = after == null ? void 0 : after.missions) == null ? void 0 : _b.byMissionNo) || {};
    const notIncreasedMissionNos = [];
    const unknownMissionNos = [];
    let checked = 0;
    let increased = 0;
    for (const mission of beforeMissions) {
      if (mission.category !== "attendance" || mission.status !== "INCOMPLETE" || !Number.isFinite(mission.userCompleteCount)) {
        continue;
      }
      checked += 1;
      const afterMission = afterMissions[mission.missionNo];
      if (!afterMission || !Number.isFinite(afterMission.userCompleteCount)) {
        unknownMissionNos.push(mission.missionNo);
        continue;
      }
      if (afterMission.userCompleteCount - mission.userCompleteCount >= 1) {
        increased += 1;
      } else {
        notIncreasedMissionNos.push(mission.missionNo);
      }
    }
    return {
      checked,
      increased,
      notIncreasedMissionNos,
      unknownMissionNos
    };
  }
  function compareSnapshots(before, after, plan = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    const plannedMissionNos = plan.plannedMissionNos || [];
    const afterMissions = ((_a = after == null ? void 0 : after.missions) == null ? void 0 : _a.byMissionNo) || {};
    const incompleteMissionNos = plannedMissionNos.filter((missionNo) => {
      const mission = afterMissions[missionNo];
      return !mission || !DONE_STATUSES.has(mission.status);
    });
    return {
      articleStillMissing: ((_b = before == null ? void 0 : before.articleWrite) == null ? void 0 : _b.hasWrittenToday) === false && ((_c = after == null ? void 0 : after.articleWrite) == null ? void 0 : _c.hasWrittenToday) === false,
      rouletteStillRemaining: (((_d = after == null ? void 0 : after.roulette) == null ? void 0 : _d.remaining) || 0) > 0,
      incompleteMissionNos,
      unclaimedDailyShop: ((_f = (_e = after == null ? void 0 : after.shop) == null ? void 0 : _e.unclaimedDaily) == null ? void 0 : _f.length) || 0,
      unclaimedMajakShop: ((_h = (_g = after == null ? void 0 : after.majak) == null ? void 0 : _g.unclaimedDaily) == null ? void 0 : _h.length) || 0,
      claimableExtra: ((_j = (_i = after == null ? void 0 : after.rouletteExtra) == null ? void 0 : _i.claimable) == null ? void 0 : _j.length) || 0,
      monthlyAttendanceProgress: compareMonthlyAttendanceProgress(before, after)
    };
  }
  function getSnapshotSummary(snapshot) {
    var _a, _b, _c;
    const missions = Object.values(((_a = snapshot == null ? void 0 : snapshot.missions) == null ? void 0 : _a.byMissionNo) || {});
    return {
      articleWritten: ((_b = snapshot == null ? void 0 : snapshot.articleWrite) == null ? void 0 : _b.hasWrittenToday) === true,
      rouletteRemaining: ((_c = snapshot == null ? void 0 : snapshot.roulette) == null ? void 0 : _c.remaining) || 0,
      missions: {
        complete: missions.filter((mission) => COMPLETE_STATUSES$1.has(mission.status)).length,
        receivable: missions.filter((mission) => mission.status === "RECEIVABLE").length,
        incomplete: missions.filter((mission) => mission.status === "INCOMPLETE").length
      }
    };
  }
  function task(id2, kind, meta = {}) {
    return { id: id2, kind, ...meta };
  }
  function group(id2, concurrency, tasks) {
    const filteredTasks = tasks.filter(Boolean);
    if (filteredTasks.length === 0) return null;
    return { id: id2, concurrency, tasks: filteredTasks };
  }
  function filterGroups(groups) {
    return groups.filter(Boolean);
  }
  function isSectionKnown(section) {
    return Boolean(section) && section.success !== false && section.unknown !== true;
  }
  const MISSION_TASK_CATEGORIES = {
    dailyMissions: "daily",
    contentMissions: "content",
    bannerMissions: "banner",
    weeklyMissions: "weekly",
    attendanceMissions: "attendance",
    surveyMissions: "survey"
  };
  function isCategoryDone(snapshot, category) {
    var _a;
    if (!isSectionKnown(snapshot == null ? void 0 : snapshot.missions)) return false;
    const missions = (_a = snapshot.missions.categories) == null ? void 0 : _a[category];
    return Boolean(missions) && missions.all.length > 0 && missions.complete.length === missions.all.length;
  }
  function getVisitMissionNos(snapshot) {
    var _a;
    return Object.values(((_a = snapshot == null ? void 0 : snapshot.missions) == null ? void 0 : _a.byMissionNo) || {}).filter(
      (mission) => mission.category === "daily" && (mission.status === "INCOMPLETE" || mission.status === "RECEIVABLE") && mission.isVisitMission === true
    ).map((mission) => mission.missionNo);
  }
  function isConfiguredPrizeMission(mission) {
    var _a, _b;
    const configuredMissionNo = (_a = CONFIG.prizeEntry) == null ? void 0 : _a.missionNo;
    const configuredMissionTitle = (_b = CONFIG.prizeEntry) == null ? void 0 : _b.missionTitle;
    return configuredMissionNo != null && String(mission == null ? void 0 : mission.missionNo) === String(configuredMissionNo) || Boolean(configuredMissionTitle) && (mission == null ? void 0 : mission.title) === configuredMissionTitle;
  }
  function getPrizeEntryMission$1(snapshot) {
    var _a;
    return Object.values(((_a = snapshot == null ? void 0 : snapshot.missions) == null ? void 0 : _a.byMissionNo) || {}).find(isConfiguredPrizeMission);
  }
  function shouldScheduleBoost(boost) {
    if (!isSectionKnown(boost)) return false;
    const today = boost.dailyBoosts || [];
    if (today.some((attempt) => attempt.status === "pending")) return true;
    if (!(boost.remainingCount > 0)) return false;
    const mission = boost.notAvailable ? null : boost.mission;
    const missionNeedsBoost = Boolean(mission) && mission.rewarded === false && mission.completed !== true && mission.current === 0 && mission.required === 1;
    return missionNeedsBoost || today.length < dailyBoostLimit();
  }
  function shouldSchedulePrizeEntry(snapshot) {
    var _a;
    if (!isSectionKnown(snapshot == null ? void 0 : snapshot.missions)) return false;
    return ((_a = getPrizeEntryMission$1(snapshot)) == null ? void 0 : _a.status) === "INCOMPLETE";
  }
  function buildAutomationPlan(snapshot = {}, options = {}) {
    var _a, _b;
    const plannedMissionNos = getVisitMissionNos(snapshot);
    const community = options.community || {};
    const skippedDone = Object.keys(MISSION_TASK_CATEGORIES).filter((kind) => isCategoryDone(snapshot, MISSION_TASK_CATEGORIES[kind]));
    const missionTask = (id2, kind, meta) => skippedDone.includes(kind) ? null : task(id2, kind, meta);
    const articleWrite = snapshot.articleWrite;
    const roulette = snapshot.roulette;
    const rouletteExtra = snapshot.rouletteExtra;
    const shop = snapshot.shop;
    const majak = snapshot.majak;
    const shouldRunRouletteDraws = isSectionKnown(roulette) && roulette.remaining > 0;
    const groups = filterGroups([
      // These legacy tasks are safe/idempotent and may internally no-op on initial runs.
      group("setup", 3, [
        task("setup:requiredPages", "requiredPages"),
        task("setup:componentRefresh", "componentRefresh"),
        task("setup:eventRefresh", "eventRefresh")
      ]),
      group("community", 3, [
        isSectionKnown(articleWrite) && articleWrite.hasWrittenToday === false ? task("community:articleWrite", "articleWrite") : null,
        community.likesRemaining === 0 ? null : task("community:articleLikes", "articleLikes"),
        community.commentsRemaining === 0 ? null : task("community:comments", "comments", {
          background: true,
          rateLimited: true,
          nonAuthoritativeRepair: true
        })
      ]),
      group("visits", plannedMissionNos.length > 0 ? 1 : 4, [
        plannedMissionNos.length > 0 ? task("visits:singleVisits", "singleVisits", { missionNos: plannedMissionNos }) : null,
        missionTask("visits:dailyMissions", "dailyMissions"),
        missionTask("visits:contentMissions", "contentMissions"),
        missionTask("visits:bannerMissions", "bannerMissions")
      ]),
      group("boost", 1, [
        shouldScheduleBoost(snapshot.boost) ? task("boost:boostMission", "boostMission", { consumesBoost: true }) : null
      ]),
      group("missionClaims", 2, [
        missionTask("missionClaims:weeklyMissions", "weeklyMissions"),
        missionTask("missionClaims:attendanceMissions", "attendanceMissions"),
        missionTask("missionClaims:surveyMissions", "surveyMissions")
      ]),
      group("flakeSpending", 1, [
        shouldRunRouletteDraws ? task("flakeSpending:rouletteDraws", "rouletteDraws", { spendsFlake: true }) : null,
        shouldRunRouletteDraws ? task("flakeSpending:rouletteExtra", "rouletteExtra", { afterRouletteDraws: true }) : null,
        shouldSchedulePrizeEntry(snapshot) ? task("flakeSpending:prizeEntry", "prizeEntry", { spendsFlake: true }) : null
      ]),
      group("followups", 1, [
        !shouldRunRouletteDraws && isSectionKnown(rouletteExtra) && (((_a = rouletteExtra.claimable) == null ? void 0 : _a.length) || 0) > 0 ? task("followups:rouletteExtra", "rouletteExtra") : null,
        isSectionKnown(shop) && (((_b = shop.unclaimedDaily) == null ? void 0 : _b.length) || 0) > 0 ? task("followups:dailyShop", "dailyShop") : null,
        isSectionKnown(shop) ? task("followups:dailyAccumulatedShop", "dailyAccumulatedShop") : null,
        isSectionKnown(majak) ? task("followups:majakShop", "majakShop") : null
      ]),
      group("reviewEvent", 1, [
        isSectionKnown(snapshot.reviewEvent) && snapshot.reviewEvent.actionable === true ? task("reviewEvent:comment", "reviewEvent", { nonAuthoritativeRepair: true }) : null
      ])
    ]);
    return { plannedMissionNos, groups, skippedDone };
  }
  function buildRepairPlan(diff = {}) {
    const plannedMissionNos = diff.incompleteMissionNos || [];
    const tasks = [
      diff.articleStillMissing ? task("repairSafe:articleWrite", "articleWrite") : null,
      plannedMissionNos.length > 0 ? task("repairSafe:singleVisits", "singleVisits", { missionNos: plannedMissionNos }) : null,
      diff.unclaimedDailyShop > 0 ? task("repairSafe:dailyShop", "dailyShop") : null,
      diff.claimableExtra > 0 ? task("repairSafe:rouletteExtra", "rouletteExtra") : null,
      diff.unclaimedMajakShop > 0 ? task("repairSafe:majakShop", "majakShop") : null
    ];
    const groups = filterGroups([
      group("repairSafe", 1, tasks)
    ]);
    return { plannedMissionNos, groups };
  }
  async function executeTask(task2) {
    try {
      const value = await task2.run();
      return { id: task2.id, status: "fulfilled", value };
    } catch (reason) {
      return { id: task2.id, status: "rejected", reason };
    }
  }
  async function runTask(task2) {
    if (task2.background) {
      return {
        id: task2.id,
        status: "background",
        promise: executeTask(task2)
      };
    }
    return executeTask(task2);
  }
  async function runLimited(tasks, concurrency = 1) {
    if (tasks.length === 0) return [];
    const limit = Math.min(tasks.length, Math.max(1, Math.floor(concurrency) || 1));
    const results = new Array(tasks.length);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < tasks.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await runTask(tasks[index]);
      }
    }
    await Promise.all(Array.from({ length: limit }, () => worker()));
    return results;
  }
  async function runTaskGroups(groups, hooks = {}) {
    var _a, _b;
    const groupResults = [];
    for (const group2 of groups) {
      (_a = hooks.onGroupStart) == null ? void 0 : _a.call(hooks, group2);
      const results = await runLimited(group2.tasks || [], group2.concurrency);
      (_b = hooks.onGroupDone) == null ? void 0 : _b.call(hooks, group2, results);
      groupResults.push({ groupId: group2.id, results });
    }
    return groupResults;
  }
  function flattenTaskResults(groupResults) {
    return groupResults.flatMap(
      (groupResult) => groupResult.results.map((result) => ({
        ...result,
        groupId: groupResult.groupId
      }))
    );
  }
  async function waitForBackgroundTasks(groupResults, hooks = {}) {
    var _a, _b;
    const awaitedGroups = [];
    for (const groupResult of groupResults) {
      const backgroundResults = (groupResult.results || []).filter((result) => result.status === "background" && result.promise);
      if (backgroundResults.length === 0) continue;
      (_a = hooks.onGroupStart) == null ? void 0 : _a.call(hooks, groupResult, backgroundResults);
      const results = await Promise.all(backgroundResults.map(async (result) => {
        const settled = await result.promise;
        return {
          ...settled,
          id: result.id
        };
      }));
      (_b = hooks.onGroupDone) == null ? void 0 : _b.call(hooks, groupResult, results);
      awaitedGroups.push({
        groupId: groupResult.groupId,
        results
      });
    }
    return awaitedGroups;
  }
  const SECTION_ORDER = ["준비", "그룹", "백그라운드", "마무리"];
  function formatSeconds(ms) {
    return `${(Math.max(0, ms) / 1e3).toFixed(1)}초`;
  }
  function shortTaskId(id2) {
    return String(id2).split(":").pop();
  }
  function createRunTiming(now = getTimestamp) {
    const startedAt = now();
    const phases = [];
    const taskMs = /* @__PURE__ */ new Map();
    const tracked = /* @__PURE__ */ new Set();
    const groupStartedAt = /* @__PURE__ */ new Map();
    const details = [];
    function record(section, label, ms) {
      if (section) phases.push({ section, label, ms });
      return ms;
    }
    return {
      /**
       * Starts a step; the returned function records and returns its elapsed ms. The step keeps its
       * start position in the summary, so steps that overlap are listed in a stable order.
       */
      start(section, label) {
        const begin = now();
        const phase = { section, label, ms: null };
        phases.push(phase);
        return () => {
          phase.ms = now() - begin;
          return phase.ms;
        };
      },
      startGroup(id2) {
        groupStartedAt.set(id2, now());
      },
      /** Elapsed ms since startGroup(id); recorded under `section` unless it is null. */
      endGroup(section, id2) {
        const begin = groupStartedAt.get(id2) ?? now();
        return record(section, id2, now() - begin);
      },
      record,
      /** Launches a task ahead of its group (e.g. comments) and times it from that launch. */
      track(id2, launch) {
        const begin = now();
        const promise = launch();
        const settle = () => {
          taskMs.set(id2, now() - begin);
        };
        tracked.add(id2);
        promise.then(settle, settle);
        return promise;
      },
      /** One extra summary line, e.g. the slowest snapshot sections: parts are { label, ms }. */
      addDetail(label, parts, lead = "") {
        details.push({ label, parts, lead });
      },
      /** Copies the plan so each task records how long its run() took to settle. */
      timeTasks(plan) {
        const groups = plan.groups.map((group2) => ({
          ...group2,
          tasks: group2.tasks.map((task2) => tracked.has(task2.id) ? task2 : {
            ...task2,
            run: () => {
              const begin = now();
              const settle = () => {
                taskMs.set(task2.id, now() - begin);
              };
              let result;
              try {
                result = task2.run();
              } catch (error) {
                settle();
                throw error;
              }
              if (result && typeof result.then === "function") result.then(settle, settle);
              else settle();
              return result;
            }
          })
        }));
        return { ...plan, groups };
      },
      taskMs(id2) {
        return taskMs.get(id2);
      },
      /** " · 1.2초", plus per-task times when more than one foreground task ran. */
      groupSuffix(ms, results = []) {
        const timed = results.filter((result) => result.status !== "background" && taskMs.has(result.id)).map((result) => `${shortTaskId(result.id)} ${formatSeconds(taskMs.get(result.id))}`);
        return ` · ${formatSeconds(ms)}${timed.length > 1 ? ` (${timed.join(" · ")})` : ""}`;
      },
      summaryLines() {
        const lines = [`⏱ 단계별 소요 시간 · 총 ${formatSeconds(now() - startedAt)}`];
        const sections = [.../* @__PURE__ */ new Set([...SECTION_ORDER, ...phases.map((phase) => phase.section)])];
        for (const section of sections) {
          const items = phases.filter((phase) => phase.section === section && phase.ms !== null);
          if (items.length === 0) continue;
          lines.push(`  ${section}: ${items.map((item) => `${shortTaskId(item.label)} ${formatSeconds(item.ms)}`).join(" · ")}`);
        }
        for (const { label, parts, lead } of details) {
          const text = parts.map((part) => `${part.label} ${formatSeconds(part.ms)}`).join(" · ");
          lines.push(`  ${label}: ${lead}${text}`);
        }
        return lines;
      }
    };
  }
  const communityQuotaKey = (userId) => `stove-community-quota-v1:${userId}`;
  const KINDS = ["likes", "comments"];
  function targets() {
    return { likes: CONFIG.targets.articleLikes, comments: CONFIG.targets.comments };
  }
  function readCommunityQuota(storage, key, today) {
    const empty = { likes: 0, comments: 0 };
    try {
      const text = storage == null ? void 0 : storage.getItem(key);
      if (!text) return empty;
      const record = JSON.parse(text);
      if (!record || record.date !== today) return empty;
      return Object.fromEntries(KINDS.map((kind) => [
        kind,
        Number.isInteger(record[kind]) && record[kind] > 0 ? record[kind] : 0
      ]));
    } catch {
      return empty;
    }
  }
  function createCommunityQuota(context) {
    const goal = targets();
    if (!(context == null ? void 0 : context.storage) || !/^\d+$/.test(String(context.userId ?? ""))) {
      return { done: { likes: 0, comments: 0 }, remaining: (kind) => goal[kind], add() {
      } };
    }
    const key = communityQuotaKey(context.userId);
    const done = readCommunityQuota(context.storage, key, context.today);
    return {
      done,
      remaining: (kind) => Math.max(0, goal[kind] - done[kind]),
      add(kind) {
        done[kind] += 1;
        try {
          context.storage.setItem(key, JSON.stringify({ date: context.today, ...done }));
        } catch {
        }
      }
    };
  }
  function getCommentPool(pool, fallbackComment) {
    const candidates = Array.isArray(pool) ? pool : [];
    const normalized = candidates.map((comment) => String(comment || "").trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : [fallbackComment || "Nice!"];
  }
  function pickRandomComment(pool = CONFIG.commentPool, randomFn = Math.random, fallbackComment = CONFIG.comment) {
    const comments = getCommentPool(pool, fallbackComment);
    const rawIndex = Math.floor(randomFn() * comments.length);
    const index = Math.min(comments.length - 1, Math.max(0, rawIndex));
    return comments[index];
  }
  async function postCommentsSerially(options = {}) {
    const {
      headers,
      articles = [],
      targetComments = CONFIG.targets.comments,
      delayMs = CONFIG.delays.afterComment,
      commentPool = CONFIG.commentPool,
      fallbackComment = CONFIG.comment,
      randomFn = Math.random,
      stateRef = state,
      postCommentFn = postComment,
      delayFn = delay,
      onPosted = () => {
      },
      logFn = log,
      updateProgressFn = updateProgress
    } = options;
    const maxComments = Math.min(targetComments, articles.length);
    const errors = [];
    const commentIds = [];
    for (let i = 0; i < maxComments; i++) {
      const articleId2 = articles[i].article_id;
      const content = pickRandomComment(commentPool, randomFn, fallbackComment);
      try {
        const commentId = await postCommentFn(headers, articleId2, content);
        logFn(`댓글 작성 완료: ${commentId}`, "success");
        stateRef.createdCommentIds.push(commentId);
        stateRef.progress.comments++;
        commentIds.push(commentId);
        onPosted(commentId);
        updateProgressFn("comments", stateRef.progress.comments, CONFIG.targets.comments);
      } catch (e) {
        errors.push({ articleId: articleId2, message: e.message });
        logFn(`댓글 작성 실패: ${e.message}`, "error");
      }
      if (i < maxComments - 1) await delayFn(delayMs);
    }
    return { attempted: maxComments, commentIds, errors };
  }
  function services$2(deps = {}) {
    return {
      getRouletteParticipationCount,
      executeRouletteDraw,
      getRouletteExtra,
      claimRouletteExtra,
      delay,
      log,
      updateProgress,
      ...deps
    };
  }
  async function runRouletteDraws(headers, deps = {}) {
    var _a, _b;
    const io = services$2(deps);
    io.log("룰렛 확인 중...", "info");
    try {
      let totalRewards = 0;
      let totalSuccessCount = 0;
      let roundCount = 0;
      let previousCount = null;
      while (true) {
        roundCount++;
        debugLog(`
[룰렛 실행 루프] ===== Round ${roundCount} 시작 =====`);
        const participationInfo = await io.getRouletteParticipationCount(headers, getRouletteSubEventNo());
        if (!participationInfo || !participationInfo.value) {
          io.log("⚠️ 룰렛 정보를 가져올 수 없습니다", "warning");
          break;
        }
        const maxDraws = CONFIG.roulette.maxDraws;
        const current = participationInfo.value.participation_cnt || 0;
        const remaining = Math.max(0, maxDraws - current);
        if (roundCount === 1) {
          io.log(`✓ 룰렛 참여 가능 횟수: ${remaining}/${maxDraws} (현재: ${current})`, "success");
        } else {
          io.log(`✓ [${roundCount}차] 남은 횟수 재확인: ${remaining}/${maxDraws}`, "info");
        }
        if (current >= maxDraws) {
          io.log(roundCount === 1 ? "오늘의 룰렛 참여 횟수를 모두 사용했습니다" : "모든 룰렛 횟수를 소진했습니다", "info");
          break;
        }
        if (previousCount !== null && current <= previousCount) {
          io.log(`⚠️ 직전 라운드 후 참여 횟수가 늘지 않아 룰렛을 중단합니다 (현재: ${current})`, "warning");
          break;
        }
        previousCount = current;
        io.log(`룰렛 ${remaining}회 실행 시작...`, "info");
        let roundSuccessCount = 0;
        let shouldStopRoulette = false;
        let outcomeUnknown = false;
        for (let i = 1; i <= remaining; i++) {
          let drawSuccess = false;
          let retryCount = 0;
          while (!drawSuccess && retryCount <= CONFIG.roulette.maxRetries) {
            try {
              if (retryCount > 0) {
                io.log(`🔄 룰렛 ${i}/${remaining} 재시도 (${retryCount}/${CONFIG.roulette.maxRetries})...`, "warning");
                await io.delay(CONFIG.roulette.retryDelay);
              }
              const drawResult = await io.executeRouletteDraw(headers, getRouletteSubEventNo());
              if (drawResult && drawResult.code !== 0) {
                const errorCode = drawResult.code;
                if (errorCode === 7019) {
                  io.log(`⚠️ 룰렛 이벤트 기간이 아닙니다`, "warning");
                  shouldStopRoulette = true;
                  break;
                } else {
                  io.log(`✗ 룰렛 ${i}/${remaining} API 오류 (코드: ${errorCode})`, "error");
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
                io.log(`✓ 룰렛 ${i}/${remaining} 완료: ${giftName} (${giftPrice} FLAKE)`, "success");
                drawSuccess = true;
              } else {
                io.log(`⚠️ 룰렛 ${i}/${remaining} 결과를 확인할 수 없어 참여 횟수를 다시 확인합니다`, "warning");
                outcomeUnknown = true;
                break;
              }
              await io.delay(CONFIG.delays.betweenActions);
            } catch (e) {
              io.log(`✗ 룰렛 ${i}/${remaining} 실패: ${e.message}`, "error");
              retryCount++;
              if (retryCount > CONFIG.roulette.maxRetries) {
                io.log(`❌ 룰렛 ${i}/${remaining} 최대 재시도 횟수 초과`, "error");
                shouldStopRoulette = true;
                break;
              }
            }
          }
          if (shouldStopRoulette) {
            io.log("🛑 룰렛 프로세스를 중단합니다", "warning");
            break;
          }
          if (outcomeUnknown) break;
        }
        io.log(`[${roundCount}차] ${roundSuccessCount}/${remaining} 성공`, "info");
        if (shouldStopRoulette) break;
        await io.delay(CONFIG.delays.betweenActions);
      }
      if (totalSuccessCount > 0) {
        const totalCost = totalSuccessCount * CONFIG.roulette.drawCost;
        const netProfit = totalRewards - totalCost;
        const profitSign = netProfit >= 0 ? "+" : "";
        io.log("", "info");
        io.log(`🎰 최종 룰렛 결과 (${roundCount}차 실행)`, "success");
        io.log(`  🎯 총 실행: ${totalSuccessCount}회 성공`, "success");
        io.log(`  💰 총 획득: ${totalRewards} FLAKE`, "success");
        io.log(`  💸 총 비용: ${totalCost} FLAKE`, "info");
        io.log(`  📊 순수익: ${profitSign}${netProfit} FLAKE`, netProfit >= 0 ? "success" : "warning");
        state.earnings.roulette = netProfit;
        state.completed.roulette = true;
        io.updateProgress();
        return netProfit;
      }
    } catch (e) {
      io.log(`✗ 룰렛 실행 실패: ${e.message}`, "error");
    }
    state.completed.roulette = true;
    io.updateProgress();
    io.log("✅ 룰렛 실행 완료!", "success");
    return 0;
  }
  async function claimRouletteExtraRewards(headers, deps = {}) {
    var _a;
    const io = services$2(deps);
    io.log("룰렛 EXTRA 확인 중...", "info");
    let extraFlakeEarned = 0;
    try {
      const extraData = await io.getRouletteExtra(headers, getRouletteExtraSubEventNo());
      debugLog("[룰렛 EXTRA] API Response:", extraData);
      if (!extraData) {
        io.log("⚠️ 룰렛 EXTRA API 응답이 없습니다", "warning");
        return extraFlakeEarned;
      }
      if (extraData.code !== 0) {
        io.log(`⚠️ 룰렛 EXTRA API 오류: ${extraData.message || "Unknown error"}`, "warning");
        return extraFlakeEarned;
      }
      if ((_a = extraData.value) == null ? void 0 : _a.milestones) {
        const currentCnt = extraData.value.current_cnt || 0;
        const currentCycle = extraData.value.current_cycle || 0;
        const milestones = extraData.value.milestones || [];
        io.log(`현재 카운트: ${currentCnt}`, "info");
        io.log(`총 마일스톤: ${milestones.length}개`, "info");
        const claimableMilestones = milestones.filter(
          (m) => currentCnt >= m.milestone && m.received_yn === false
        );
        if (claimableMilestones.length === 0) {
          io.log("수령 가능한 룰렛 EXTRA가 없습니다", "info");
          return extraFlakeEarned;
        }
        io.log(`✓ 수령 가능한 EXTRA: ${claimableMilestones.length}개`, "success");
        for (const milestone of claimableMilestones) {
          try {
            const result = await io.claimRouletteExtra(
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
              io.log(`✓ EXTRA 수령 완료: ${milestone.gift_name} (${flakeAmount} FLAKE)`, "success");
            } else {
              io.log(`✗ EXTRA 수령 실패 (milestone_no: ${milestone.milestone_no})`, "error");
            }
            await io.delay(CONFIG.delays.betweenActions);
          } catch (e) {
            io.log(`✗ EXTRA 수령 오류: ${e.message}`, "error");
          }
        }
        if (extraFlakeEarned > 0) {
          io.log(`💰 총 EXTRA 수령: ${extraFlakeEarned} FLAKE`, "success");
        }
      } else {
        io.log("⚠️ 룰렛 EXTRA 정보 구조가 올바르지 않습니다", "warning");
      }
    } catch (e) {
      io.log(`✗ 룰렛 EXTRA 확인 실패: ${e.message}`, "error");
    }
    state.earnings.rouletteExtra = extraFlakeEarned;
    io.log("✅ 룰렛 EXTRA 처리 완료!", "success");
    return extraFlakeEarned;
  }
  const REWARD_SHOP_URL$1 = "https://reward.onstove.com/ko";
  function services$1(deps = {}) {
    return {
      getDailyShopRewards,
      claimDailyReward,
      getMajakDailyShopRewards,
      claimMajakAccumulatedReward,
      claimDailyAccumulatedReward,
      checkGameOwnership,
      getTodayString,
      delay,
      log,
      updateProgress,
      ...deps
    };
  }
  function toDailyRewardType(itemType) {
    if (itemType === "FLAKE") return "flake";
    if (itemType === "INDIE_SALE_COUPON") return "indie_sale_coupon";
    return "coupon";
  }
  function todayUnclaimedRewards(rewards, todayString) {
    return rewards.filter((reward) => reward.attendance_date === todayString && !reward.is_received);
  }
  async function claimTodayAttendanceRewards(io, headers, rewards, label) {
    let earned = 0;
    let successCount = 0;
    for (const reward of rewards) {
      try {
        const result = await io.claimDailyReward(headers, reward.item_no, toDailyRewardType(reward.item_type));
        if (result && result.code === 0) {
          const rewardAmount = reward.flake_amount || 0;
          const rewardName = reward.item_name || reward.item_type;
          earned += rewardAmount;
          successCount++;
          io.log(`✓ ${label} 수령 완료: ${rewardName} (${rewardAmount} FLAKE)`, "success");
        } else {
          io.log(`✗ ${label} 수령 실패 (item_no: ${reward.item_no})`, "error");
        }
        await io.delay(CONFIG.delays.betweenActions);
      } catch (e) {
        io.log(`✗ ${label} 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, "error");
      }
    }
    return { earned, successCount };
  }
  async function claimDailyShopRewards(headers, deps = {}) {
    var _a;
    const io = services$1(deps);
    io.log("데일리 보상 확인 중...", "info");
    let dailyFlakeEarned = 0;
    try {
      const dailyShopData = await io.getDailyShopRewards(headers);
      if ((_a = dailyShopData == null ? void 0 : dailyShopData.value) == null ? void 0 : _a.daily_attendances) {
        const rewards = dailyShopData.value.daily_attendances.rewards || [];
        const todayString = io.getTodayString();
        io.log(`오늘 날짜: ${todayString}`, "info");
        const unclaimedRewards = todayUnclaimedRewards(rewards, todayString);
        io.log(`✓ 오늘 수령 가능한 보상: ${unclaimedRewards.length}개`, "success");
        if (unclaimedRewards.length === 0) {
          io.log("오늘 수령 가능한 데일리 보상이 없습니다", "info");
          state.earnings.dailyShop = 0;
          state.completed.dailyShop = true;
          io.updateProgress();
          io.log("✅ 데일리 보상 처리 완료!", "success");
          return 0;
        }
        const { earned, successCount } = await claimTodayAttendanceRewards(io, headers, unclaimedRewards, "보상");
        dailyFlakeEarned += earned;
        if (successCount > 0) {
          io.log(`💰 총 ${successCount}개 보상 수령 완료: ${dailyFlakeEarned} FLAKE`, "success");
        }
      } else {
        io.log("⚠️ 데일리 보상 정보를 가져올 수 없습니다", "warning");
      }
    } catch (e) {
      io.log(`✗ 데일리 보상 확인 실패: ${e.message}`, "error");
    }
    state.earnings.dailyShop = dailyFlakeEarned;
    state.completed.dailyShop = true;
    io.updateProgress();
    io.log("✅ 데일리 보상 처리 완료!", "success");
    return dailyFlakeEarned;
  }
  async function claimMajakDailyShopRewards(headers, deps = {}) {
    var _a;
    const io = services$1(deps);
    io.log("마작 리워드 확인 중...", "info");
    let majakFlakeEarned = 0;
    try {
      let majakShopData = await io.getMajakDailyShopRewards(headers);
      if (majakShopData == null ? void 0 : majakShopData.value) {
        if (majakShopData.value.daily_attendances) {
          const rewards = majakShopData.value.daily_attendances.rewards || [];
          const todayString = io.getTodayString();
          io.log(`오늘 날짜: ${todayString}`, "info");
          const unclaimedRewards = todayUnclaimedRewards(rewards, todayString);
          io.log(`✓ 오늘 수령 가능한 마작 리워드: ${unclaimedRewards.length}개`, "success");
          if (unclaimedRewards.length > 0) {
            const { earned, successCount } = await claimTodayAttendanceRewards(io, headers, unclaimedRewards, "마작 리워드");
            majakFlakeEarned += earned;
            if (successCount > 0) {
              io.log(`🀄 총 ${successCount}개 마작 일일 리워드 수령 완료`, "success");
              io.log("", "info");
              io.log("📋 일일 리워드 수령 후 누적 출석 정보 재조회 중...", "info");
              majakShopData = await io.getMajakDailyShopRewards(headers);
              if (!(majakShopData == null ? void 0 : majakShopData.value)) {
                io.log("⚠️ 누적 출석 정보 재조회 실패", "warning");
              }
            }
          } else {
            io.log("오늘 수령 가능한 마작 일일 리워드가 없습니다", "info");
          }
        }
        if ((_a = majakShopData == null ? void 0 : majakShopData.value) == null ? void 0 : _a.accumulated_attendances) {
          const accumulatedRewards = majakShopData.value.accumulated_attendances.rewards || [];
          const totalDays = majakShopData.value.accumulated_attendances.total_attendance_days || 0;
          io.log("", "info");
          io.log(`현재 누적 출석일: ${totalDays}일`, "info");
          const claimableAccumulated = accumulatedRewards.filter(
            (reward) => totalDays >= reward.rewardable_days && !reward.is_received
          );
          if (claimableAccumulated.length > 0) {
            io.log(`✓ 수령 가능한 누적 보상: ${claimableAccumulated.length}개`, "success");
            let accumulatedSuccessCount = 0;
            for (const reward of claimableAccumulated) {
              try {
                const result = await io.claimMajakAccumulatedReward(headers, reward.item_no, reward.item_type);
                if (result && result.code === 0) {
                  const rewardAmount = reward.flake_amount || 0;
                  majakFlakeEarned += rewardAmount;
                  accumulatedSuccessCount++;
                  if (reward.item_type === "FLAKE") {
                    io.log(`✓ 마작 누적 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name} (${rewardAmount} FLAKE)`, "success");
                  } else {
                    io.log(`✓ 마작 누적 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name}`, "success");
                  }
                } else {
                  const errorCode = (result == null ? void 0 : result.code) || "N/A";
                  io.log(`✗ 마작 누적 보상 수령 실패 (item_no: ${reward.item_no}, 코드: ${errorCode})`, "error");
                }
                await io.delay(CONFIG.delays.betweenActions);
              } catch (e) {
                io.log(`✗ 마작 누적 보상 수령 오류 (item_no: ${reward.item_no}): ${e.message}`, "error");
              }
            }
            if (accumulatedSuccessCount > 0) {
              io.log(`🎁 총 ${accumulatedSuccessCount}개 마작 누적 보상 수령 완료`, "success");
            }
          } else {
            io.log("수령 가능한 마작 누적 보상이 없습니다", "info");
          }
        }
      } else {
        io.log("⚠️ 마작 리워드 정보를 가져올 수 없습니다", "warning");
      }
    } catch (e) {
      io.log(`✗ 마작 리워드 확인 실패: ${e.message}`, "error");
    }
    state.earnings.majak = majakFlakeEarned;
    state.completed.majak = true;
    io.updateProgress();
    io.log("✅ 마작 리워드 처리 완료!", "success");
    return majakFlakeEarned;
  }
  async function claimDailyAccumulatedRewards(headers, deps = {}) {
    var _a, _b, _c;
    const io = services$1(deps);
    io.log("🎁 데일리 누적 보상 수령 시작...", "info");
    let dailyAccumulatedFlake = 0;
    try {
      const dailyShopData = await io.getDailyShopRewards(headers);
      if ((_a = dailyShopData == null ? void 0 : dailyShopData.value) == null ? void 0 : _a.accumulated_attendances) {
        const accumulatedRewards = dailyShopData.value.accumulated_attendances.rewards || [];
        const totalDays = dailyShopData.value.accumulated_attendances.total_attendance_days || 0;
        io.log(`현재 누적 출석일: ${totalDays}일`, "info");
        const claimableRewards = accumulatedRewards.filter(
          (reward) => totalDays >= reward.rewardable_days && !reward.is_received
        );
        if (claimableRewards.length > 0) {
          io.log(`✓ 수령 가능한 누적 보상: ${claimableRewards.length}개`, "success");
          for (const reward of claimableRewards) {
            try {
              io.log(`📦 보상 정보: ${reward.item_name} (타입: ${reward.item_type}, ${reward.rewardable_days}일)`, "info");
              if (reward.item_type === "INDIE_GAME_COUPON" && reward.game_id) {
                const ownershipData = await io.checkGameOwnership(headers, reward.game_id);
                if (((_c = (_b = ownershipData == null ? void 0 : ownershipData.value) == null ? void 0 : _b.owner_list) == null ? void 0 : _c.length) > 0) {
                  io.log(`⚠️ 이미 소유한 게임: ${reward.item_name} - 수령 건너뜀`, "warning");
                  continue;
                }
              }
              const result = await io.claimDailyAccumulatedReward(headers, reward.item_no, reward.item_type);
              if (result && result.code === 0) {
                if (reward.item_type === "FLAKE") {
                  const rewardAmount = reward.flake_amount || 0;
                  dailyAccumulatedFlake += rewardAmount;
                  io.log(`✓ FLAKE 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name} (${rewardAmount.toLocaleString()} FLAKE)`, "success");
                } else {
                  io.log(`✓ 보상 수령 완료 (${reward.rewardable_days}일): ${reward.item_name}`, "success");
                }
              } else {
                const errorCode = (result == null ? void 0 : result.code) || "N/A";
                const errorMsg = (result == null ? void 0 : result.message) || (result == null ? void 0 : result.msg) || "N/A";
                io.log(`✗ 보상 수령 실패: ${reward.item_name} (코드: ${errorCode}, 메시지: ${errorMsg})`, "error");
              }
              await io.delay(CONFIG.delays.betweenActions);
            } catch (e) {
              io.log(`✗ 보상 수령 오류 (${reward.item_name}): ${e.message}`, "error");
            }
          }
        } else {
          io.log("수령 가능한 누적 보상이 없습니다", "info");
        }
      } else {
        io.log("⚠️ 누적 보상 정보를 가져올 수 없습니다", "warning");
      }
    } catch (e) {
      io.log(`✗ 데일리 누적 보상 처리 실패: ${e.message}`, "error");
    }
    state.earnings.dailyAccumulated = dailyAccumulatedFlake;
    return dailyAccumulatedFlake;
  }
  function openRewardShop() {
    log("🏪 리워드샵 페이지를 새 탭에서 엽니다...", "info");
    try {
      GM_openInTab(REWARD_SHOP_URL$1, { active: true, insert: true });
      log("✅ 리워드샵 탭이 열렸습니다!", "success");
    } catch (error) {
      log(`❌ 탭 열기 실패: ${error.message}`, "error");
    }
  }
  const COMPLETE_STATUSES = /* @__PURE__ */ new Set(["COMPLETE", "COMPLETED"]);
  function services(deps = {}) {
    return {
      apiRequest,
      getDailyMissions,
      getAllDailyMissions,
      participateMission,
      receiveMissionReward,
      openTabInBackground,
      delay,
      log,
      ...deps
    };
  }
  function isMissionStepEnabled(stepConfig, label, io) {
    if (stepConfig.enabled) return true;
    io.log(`⏭️ ${label}이 비활성화되어 있습니다`, "info");
    return false;
  }
  function requireMissionComponent(io, componentKey, stepKey, label) {
    const componentNo = state.missionComponents[componentKey];
    if (!componentNo) {
      io.log(`⚠️ ${label} componentNo가 로드되지 않음`, "warning");
      state.completed[stepKey] = true;
    }
    return componentNo;
  }
  function finishMissionStep(stepKey, earned) {
    state.earnings[stepKey] = earned;
    state.completed[stepKey] = true;
  }
  async function readComponentMissions(io, headers, componentNo, { requireOk = true } = {}) {
    var _a;
    const response = await io.apiRequest(missionComponentUrl(componentNo), "GET", makeMissionHeaders(headers));
    if (requireOk && (response == null ? void 0 : response.code) !== 0) return null;
    return ((_a = response == null ? void 0 : response.value) == null ? void 0 : _a.missions) || null;
  }
  async function claimMissionRewards(io, headers, missions, { componentNo, delayMs, onClaimed, onFailed }) {
    let earned = 0;
    for (const mission of missions) {
      const result = await io.receiveMissionReward(headers, mission.mission_no, componentNo(mission));
      if (result && result.reward_amount) {
        earned += result.reward_amount;
        onClaimed == null ? void 0 : onClaimed(mission, result);
      } else {
        onFailed == null ? void 0 : onFailed(mission, result);
      }
      await io.delay(delayMs);
    }
    return earned;
  }
  function countCompleted(missions) {
    return missions.filter((mission) => COMPLETE_STATUSES.has(mission.status)).length;
  }
  const contentTitle = (mission) => `${mission.title.substring(0, 30)}...`;
  const bannerTitle = (mission) => mission.title.replace(/<br>/g, " ");
  function isPrizeEntryMission(mission) {
    return mission.mission_no === CONFIG.prizeEntry.missionNo || mission.title === CONFIG.prizeEntry.missionTitle;
  }
  function getSingleMissionSkipReason(mission) {
    var _a;
    if (isPrizeEntryMission(mission)) return "경품 응모 전용 단계에서 처리";
    if ((_a = mission.title) == null ? void 0 : _a.includes("앱 로그인")) return "스토브 앱 로그인 필요";
    return "방문형 자동 참여 대상 아님";
  }
  async function getPrizeEntryMission(headers, io) {
    var _a;
    try {
      const missionData = await io.getDailyMissions(headers);
      const mission = (_a = missionData == null ? void 0 : missionData.missions) == null ? void 0 : _a.find(isPrizeEntryMission);
      if (mission) {
        io.log(`  ✓ 경품 응모 미션 확인: ${mission.mission_no} (${mission.status})`, "info");
        return { ...mission, component_no: mission.component_no || state.missionComponents.daily };
      }
    } catch (error) {
      io.log(`  ⚠️ 경품 응모 미션 조회 실패: ${error.message}`, "warning");
    }
    io.log(`  ⚠️ 경품 응모 미션을 찾지 못해 fallback mission_no ${CONFIG.prizeEntry.missionNo} 사용`, "warning");
    return {
      mission_no: CONFIG.prizeEntry.missionNo,
      component_no: state.missionComponents.daily,
      title: CONFIG.prizeEntry.missionTitle,
      reward_amount: 0,
      status: null
    };
  }
  async function executeVisitMission(mission, deps = {}) {
    const io = services(deps);
    const { title, button_url } = mission;
    try {
      io.log(`🌐 ${title} 방문 중...`, "info");
      const tab = io.openTabInBackground(button_url, false);
      io.log(`✓ ${title} 탭 열림`, "success");
      return { success: true, tab };
    } catch (e) {
      io.log(`✗ ${title} 방문 실패: ${e.message}`, "error");
      return { success: false, tab: null };
    }
  }
  async function executeDailyMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.dailyMissions, "데일리 미션", io)) return;
    io.log("📋 데일리 미션 시작...", "info");
    const openedTabs = [];
    try {
      const missionData = await io.getDailyMissions(headers);
      if (!missionData || !missionData.missions) {
        io.log("✗ 미션 목록 조회 실패", "error");
        finishMissionStep("dailyMissions", 0);
        return;
      }
      const missions = missionData.missions;
      io.log(`📝 총 ${missions.length}개 미션 확인`, "info");
      const visitMissions = missions.filter(
        (m) => {
          var _a;
          return m.is_visit_mission === true && m.status === "INCOMPLETE" && ((_a = m.button_url) == null ? void 0 : _a.trim());
        }
      );
      if (visitMissions.length > 0) {
        io.log(`🌐 방문 미션 ${visitMissions.length}개 탭 열기 시작...`, "info");
        for (const mission of visitMissions) {
          const result = await executeVisitMission(mission, deps);
          if (result.tab) openedTabs.push(result.tab);
          await io.delay(CONFIG.delays.betweenActions);
        }
        io.log("✅ 방문 미션 탭 열기 완료", "success");
        await io.delay(CONFIG.dailyMissions.visitDelay);
      } else {
        io.log("ℹ️ 수행할 방문 미션이 없습니다", "info");
      }
      const updatedMissionData = await io.getDailyMissions(headers);
      if (!updatedMissionData || !updatedMissionData.missions) {
        io.log("✗ 미션 상태 재조회 실패", "error");
        finishMissionStep("dailyMissions", 0);
        return;
      }
      const receivableMissions = updatedMissionData.missions.filter(
        (m) => m.status === "RECEIVABLE" && !CONFIG.dailyMissions.skipMissions.includes(m.mission_no)
      );
      let totalEarned = 0;
      if (receivableMissions.length > 0) {
        io.log(`🎁 수령 가능한 보상 ${receivableMissions.length}개 발견`, "info");
        totalEarned = await claimMissionRewards(io, headers, receivableMissions, {
          componentNo: (mission) => mission.component_no || state.missionComponents.daily,
          delayMs: CONFIG.delays.betweenActions
        });
        io.log(`✅ 데일리 미션 보상 수령 완료: +${totalEarned} FLAKE`, "success");
      } else {
        io.log("ℹ️ 수령 가능한 보상이 없습니다", "info");
      }
      finishMissionStep("dailyMissions", totalEarned);
      const completedCount = updatedMissionData.missions.filter((m) => m.status === "COMPLETE").length;
      io.log(`📊 미션 진행 상황: ${completedCount}/${updatedMissionData.missions.length} 완료`, "info");
    } catch (error) {
      io.log(`✗ 데일리 미션 오류: ${error.message}`, "error");
    }
    io.log("✅ 데일리 미션 처리 완료!", "success");
    return openedTabs;
  }
  async function executeContentMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.contentMissions, "컨텐츠 미션", io)) return;
    io.log("📰 컨텐츠 미션 시작...", "info");
    const openedTabs = [];
    const componentNo = requireMissionComponent(io, "content", "contentMissions", "컨텐츠 미션");
    if (!componentNo) return;
    try {
      const missions = await readComponentMissions(io, headers, componentNo);
      if (!missions) {
        io.log("✗ 컨텐츠 미션 목록 조회 실패", "error");
        finishMissionStep("contentMissions", 0);
        return;
      }
      io.log(`📝 총 ${missions.length}개 컨텐츠 미션 확인`, "info");
      const incompleteMissions = missions.filter((m) => {
        var _a;
        return m.status === "INCOMPLETE" && ((_a = m.url) == null ? void 0 : _a.trim());
      });
      if (incompleteMissions.length > 0) {
        io.log(`🌐 미완료 컨텐츠 미션 ${incompleteMissions.length}개 탭 열기 시작...`, "info");
        for (const mission of incompleteMissions) {
          try {
            io.log(`  🌐 "${contentTitle(mission)}" 방문 중...`, "info");
            openedTabs.push(io.openTabInBackground(mission.url, false));
            io.log(`  ✓ "${contentTitle(mission)}" 탭 열림`, "success");
          } catch (e) {
            io.log(`  ✗ 방문 실패: ${e.message}`, "error");
          }
          await io.delay(CONFIG.delays.betweenActions);
        }
        io.log("✅ 컨텐츠 미션 탭 열기 완료", "success");
        await io.delay(3e3);
      } else {
        io.log("ℹ️ 방문할 미완료 컨텐츠 미션이 없습니다", "info");
      }
      const updatedMissions = await readComponentMissions(io, headers, componentNo);
      if (!updatedMissions) {
        io.log("✗ 컨텐츠 미션 상태 재조회 실패", "error");
        return;
      }
      const receivableMissions = updatedMissions.filter((m) => m.status === "RECEIVABLE");
      let totalEarned = 0;
      if (receivableMissions.length > 0) {
        io.log(`🎁 수령 가능한 컨텐츠 미션 ${receivableMissions.length}개 발견`, "info");
        totalEarned = await claimMissionRewards(io, headers, receivableMissions, {
          componentNo: () => componentNo,
          delayMs: CONFIG.delays.betweenActions,
          onClaimed: (mission, result) => io.log(`  ✓ "${contentTitle(mission)}": +${result.reward_amount} FLAKE`, "success")
        });
        io.log(`✅ 컨텐츠 미션 보상 수령 완료: +${totalEarned} FLAKE`, "success");
      } else {
        io.log("ℹ️ 수령 가능한 컨텐츠 미션이 없습니다", "info");
      }
      finishMissionStep("contentMissions", totalEarned);
      io.log(`📊 컨텐츠 미션 진행 상황: ${countCompleted(updatedMissions)}/${updatedMissions.length} 완료`, "info");
    } catch (error) {
      io.log(`✗ 컨텐츠 미션 오류: ${error.message}`, "error");
    }
    io.log("✅ 컨텐츠 미션 처리 완료!", "success");
    return openedTabs;
  }
  async function executeWeeklyMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.weeklyMissions, "위클리 미션", io)) return;
    io.log("📅 위클리 미션 시작...", "info");
    const componentNo = state.missionComponents.weekly;
    if (!componentNo) {
      io.log("ℹ️ 위클리 미션: 현재 이용 불가 (API 응답 없음)", "info");
      finishMissionStep("weeklyMissions", 0);
      return;
    }
    try {
      const missions = await readComponentMissions(io, headers, componentNo);
      if (!missions) {
        io.log("ℹ️ 위클리 미션: 현재 이용 불가", "info");
        finishMissionStep("weeklyMissions", 0);
        return;
      }
      io.log(`📝 총 ${missions.length}개 위클리 미션 확인`, "info");
      const receivableMissions = missions.filter((m) => m.status === "RECEIVABLE");
      let totalEarned = 0;
      if (receivableMissions.length > 0) {
        io.log(`🎁 수령 가능한 위클리 미션 ${receivableMissions.length}개 발견`, "info");
        totalEarned = await claimMissionRewards(io, headers, receivableMissions, {
          componentNo: () => componentNo,
          delayMs: CONFIG.delays.betweenActions,
          onClaimed: (mission, result) => io.log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, "success")
        });
        io.log(`✅ 위클리 미션 보상 수령 완료: +${totalEarned} FLAKE`, "success");
      } else {
        io.log("ℹ️ 수령 가능한 위클리 미션이 없습니다", "info");
      }
      finishMissionStep("weeklyMissions", totalEarned);
      io.log(`📊 위클리 미션 진행 상황: ${countCompleted(missions)}/${missions.length} 완료`, "info");
      const incompleteMissions = missions.filter((m) => m.status === "INCOMPLETE");
      if (incompleteMissions.length > 0) {
        io.log("ℹ️ 진행 중인 미션:", "info");
        for (const mission of incompleteMissions) {
          const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_total_cnt || 0}`;
          io.log(`  📌 ${mission.title}: ${progress}`, "info");
        }
      }
    } catch (error) {
      io.log("ℹ️ 위클리 미션: 현재 이용 불가", "info");
      finishMissionStep("weeklyMissions", 0);
    }
    io.log("✅ 위클리 미션 처리 완료!", "success");
  }
  async function executeBannerMissions(headers, deps = {}) {
    var _a;
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.bannerMissions, "배너 미션", io)) return;
    io.log("🎨 배너 미션 시작...", "info");
    const openedTabs = [];
    const componentNo = requireMissionComponent(io, "banner", "bannerMissions", "배너 미션");
    if (!componentNo) return;
    try {
      const missions = await readComponentMissions(io, headers, componentNo, { requireOk: false });
      if (!missions) {
        io.log("⚠️ 배너 미션 데이터를 찾을 수 없습니다", "warning");
        finishMissionStep("bannerMissions", 0);
        return;
      }
      let latestMissions = missions;
      io.log(`📋 배너 미션 ${missions.length}개 발견`, "info");
      const incompleteMissions = missions.filter((m) => m.status === "INCOMPLETE");
      const receivableMissions = missions.filter((m) => m.status === "RECEIVABLE");
      const completedCount = countCompleted(missions);
      if (completedCount > 0) io.log(`  ✓ 이미 완료됨: ${completedCount}개`, "info");
      if (incompleteMissions.length === 0 && receivableMissions.length === 0) {
        io.log("ℹ️ 수령 가능하거나 진행 필요한 배너 미션이 없습니다", "info");
        finishMissionStep("bannerMissions", 0);
        return;
      }
      if (incompleteMissions.length > 0) {
        io.log(`🌐 배너 URL ${incompleteMissions.length}개 방문 중...`, "info");
        for (const mission of incompleteMissions) {
          if ((_a = mission.button_url) == null ? void 0 : _a.trim()) {
            io.log(`  ⏳ "${bannerTitle(mission)}" 방문 중...`, "info");
            openedTabs.push(io.openTabInBackground(mission.button_url, false));
            io.log(`  ✓ "${bannerTitle(mission)}" 탭 열림`, "success");
          } else {
            io.log(`  ⚠️ "${bannerTitle(mission)}" - URL 없음, 스킵`, "warning");
          }
          await io.delay(200);
        }
        if (openedTabs.length > 0) {
          io.log(`⏳ ${CONFIG.bannerMissions.visitDelay}ms 동안 배너 방문 반영 대기...`, "info");
          await io.delay(CONFIG.bannerMissions.visitDelay);
          try {
            const updatedMissions = await readComponentMissions(io, headers, componentNo, { requireOk: false });
            if (updatedMissions) {
              latestMissions = updatedMissions;
              io.log("✓ 배너 미션 상태 재조회 완료", "success");
            } else {
              io.log("⚠️ 배너 미션 상태 재조회 실패 - 기존 수령 가능 항목만 처리합니다", "warning");
            }
          } catch (error) {
            io.log(`⚠️ 배너 미션 상태 재조회 실패: ${error.message} - 기존 수령 가능 항목만 처리합니다`, "warning");
          }
        }
      }
      const claimableMissions = latestMissions.filter((m) => m.status === "RECEIVABLE");
      let totalEarned = 0;
      if (claimableMissions.length > 0) {
        io.log(`💰 배너 미션 보상 수령 중... (${claimableMissions.length}개)`, "info");
        totalEarned = await claimMissionRewards(io, headers, claimableMissions, {
          componentNo: () => componentNo,
          delayMs: 500,
          onClaimed: (mission, result) => io.log(`  ✓ "${bannerTitle(mission)}": +${result.reward_amount} FLAKE`, "success"),
          onFailed: (mission) => io.log(`  ✗ "${bannerTitle(mission)}" 수령 실패`, "error")
        });
      } else {
        io.log("ℹ️ 수령 가능한 배너 미션이 없습니다", "info");
      }
      finishMissionStep("bannerMissions", totalEarned);
      if (totalEarned > 0) {
        io.log(`✅ 배너 미션 ${missions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, "success");
      }
    } catch (error) {
      io.log(`✗ 배너 미션 오류: ${error.message}`, "error");
    }
    io.log("✅ 배너 미션 처리 완료!", "success");
    return openedTabs;
  }
  async function executeAttendanceMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.attendanceMissions, "출석 미션", io)) return;
    io.log("📅 출석 미션 시작...", "info");
    const componentNo = requireMissionComponent(io, "attendance", "attendanceMissions", "출석 미션");
    if (!componentNo) return;
    try {
      const missions = await readComponentMissions(io, headers, componentNo, { requireOk: false });
      if (!missions) {
        io.log("⚠️ 출석 미션 데이터를 찾을 수 없습니다", "warning");
        finishMissionStep("attendanceMissions", 0);
        return;
      }
      io.log(`📋 출석 미션 ${missions.length}개 발견`, "info");
      const receivableMissions = missions.filter((m) => m.status === "RECEIVABLE");
      let totalEarned = 0;
      if (receivableMissions.length === 0) {
        io.log("ℹ️ 수령 가능한 출석 미션이 없습니다", "info");
        const incompleteMissions = missions.filter((m) => m.status === "INCOMPLETE");
        for (const mission of incompleteMissions) {
          const progress = `${mission.user_complete_cnt || 0}/${mission.milestone_per_cnt || 0}`;
          io.log(`  📌 ${mission.title}: ${progress} (목표: ${mission.milestone_total_cnt}회)`, "info");
        }
      } else {
        io.log(`💰 수령 가능한 미션: ${receivableMissions.length}개`, "info");
        totalEarned = await claimMissionRewards(io, headers, receivableMissions, {
          componentNo: () => componentNo,
          delayMs: 500,
          onClaimed: (mission, result) => io.log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, "success"),
          onFailed: (mission) => io.log(`  ✗ "${mission.title}" 수령 실패`, "error")
        });
      }
      finishMissionStep("attendanceMissions", totalEarned);
      if (totalEarned > 0) {
        io.log(`✅ 출석 미션 ${receivableMissions.length}개 완료! 총 ${totalEarned} FLAKE 획득`, "success");
      }
    } catch (error) {
      io.log(`✗ 출석 미션 오류: ${error.message}`, "error");
    }
    io.log("✅ 출석 미션 처리 완료!", "success");
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
  async function voteSurveyMission(io, headers, mission, componentNo) {
    io.log(`📊 "${mission.title}" 투표 중...`, "info");
    const selectedContentNo = selectSurveyOption(mission.survey_infos, CONFIG.surveyMissions.voteStrategy);
    const selectedOption = mission.survey_infos.find((info) => info.content_no === selectedContentNo);
    if (!selectedContentNo) {
      io.log("  ⚠️ 투표할 항목을 찾을 수 없습니다", "warning");
      return { voted: false };
    }
    io.log(`  🎯 선택: "${selectedOption.content}" (${selectedOption.percent}%)`, "info");
    const voteBody = {
      mission_no: mission.mission_no,
      component_no: componentNo,
      content_nos: [selectedContentNo]
    };
    const voteResult = await io.apiRequest(missionParticipateUrl(), "POST", makeMissionJsonHeaders(headers), voteBody);
    if (voteResult && voteResult.code === 0 && voteResult.value) {
      const reward = voteResult.value.reward_amount || 0;
      io.log(`  ✓ 투표 완료: +${reward} FLAKE`, "success");
      return { voted: true, reward };
    }
    io.log("  ✗ 투표 실패", "error");
    return { voted: true, reward: 0 };
  }
  async function executeSurveyMissions(headers, deps = {}) {
    const io = services(deps);
    if (!isMissionStepEnabled(CONFIG.surveyMissions, "설문조사 미션", io)) return;
    io.log("📊 설문조사 미션 시작...", "info");
    const componentNo = requireMissionComponent(io, "survey", "surveyMissions", "설문조사 미션");
    if (!componentNo) return;
    try {
      const missions = await readComponentMissions(io, headers, componentNo);
      if (!missions) {
        io.log("✗ 설문조사 미션 목록 조회 실패", "error");
        finishMissionStep("surveyMissions", 0);
        return;
      }
      io.log(`📝 총 ${missions.length}개 설문조사 확인`, "info");
      const votableMissions = missions.filter((m) => m.status === "RECEIVABLE" && m.mission_type === "SURVEY");
      let totalEarned = 0;
      if (votableMissions.length === 0) {
        io.log("ℹ️ 투표 가능한 설문조사가 없습니다", "info");
        const completedCount = countCompleted(missions);
        if (completedCount > 0) io.log(`  ✓ 이미 완료됨: ${completedCount}개`, "info");
      } else {
        io.log(`🗳️ 투표 가능한 설문조사 ${votableMissions.length}개 발견`, "info");
        for (const mission of votableMissions) {
          try {
            const vote = await voteSurveyMission(io, headers, mission, componentNo);
            if (!vote.voted) continue;
            totalEarned += vote.reward;
          } catch (error) {
            io.log(`  ✗ "${mission.title}" 투표 실패: ${error.message}`, "error");
          }
          await io.delay(CONFIG.delays.betweenActions);
        }
        io.log(`✅ 설문조사 투표 완료: +${totalEarned} FLAKE`, "success");
      }
      finishMissionStep("surveyMissions", totalEarned);
      io.log(`📊 설문조사 진행 상황: ${countCompleted(missions)}/${missions.length} 완료`, "info");
    } catch (error) {
      io.log(`✗ 설문조사 미션 오류: ${error.message}`, "error");
    }
    io.log("✅ 설문조사 미션 처리 완료!", "success");
  }
  async function executePrizeEntry(headers, deps = {}) {
    const io = services(deps);
    io.log("🎁 경품 응모 시작...", "info");
    let netEarnings = 0;
    try {
      const today = getKSTDate();
      const lastEntryDate = sessionStorage.getItem("prize_entry_last_date");
      if (lastEntryDate === today) {
        io.log("ℹ️ 오늘 이미 경품 응모를 완료했습니다", "info");
        finishMissionStep("prizeEntry", 0);
        return;
      }
      const eventNo = getPrizeEventNo();
      const giftNo = getPrizeGiftNo();
      const flakeCost = getPrizeFlakeCost();
      const giftName = state.prizeInfo.giftName || CONFIG.prizeEntry.targetGiftName || "스토브 5,000 포인트";
      const prizeMission = await getPrizeEntryMission(headers, io);
      io.log(`⏳ 경품 응모 진행 중... (${giftName}, 비용: ${flakeCost} FLAKE)`, "info");
      const applyUrl = `${CONFIG.api.baseUrl}/emsbackapi/v3.0/apply/${eventNo}`;
      const applyBody = { gift_no: giftNo, req_cnt: 1 };
      const applyResult = await io.apiRequest(applyUrl, "POST", makeMissionJsonHeaders(headers), applyBody);
      if (!applyResult || applyResult.code !== 0) {
        io.log(`✗ 경품 응모 실패: ${(applyResult == null ? void 0 : applyResult.message) || "알 수 없는 오류"}`, "error");
        return;
      }
      io.log(`  ✓ 경품 응모 완료! (응모 번호: ${applyResult.value.user_apply_cnt})`, "success");
      io.log(`  💰 잔여 FLAKE: ${applyResult.value.residue_flake}`, "info");
      netEarnings -= flakeCost;
      sessionStorage.setItem("prize_entry_last_date", today);
      io.log(`  📅 응모 날짜 기록: ${today} (KST)`, "info");
      io.log("⏳ 경품 응모 미션 보상 확인 중...", "info");
      const result = await io.receiveMissionReward(headers, prizeMission.mission_no, prizeMission.component_no);
      if (result && result.reward_amount) {
        netEarnings += result.reward_amount;
        io.log(`  ✓ 미션 보상 수령 완료: +${result.reward_amount} FLAKE`, "success");
      }
      finishMissionStep("prizeEntry", netEarnings);
      const profitSign = netEarnings >= 0 ? "+" : "";
      if (netEarnings !== 0) {
        io.log(`✅ 경품 응모 완료! 순수익: ${profitSign}${netEarnings} FLAKE`, netEarnings >= 0 ? "success" : "info");
      }
    } catch (error) {
      io.log(`✗ 경품 응모 오류: ${error.message}`, "error");
    }
    io.log("✅ 경품 응모 처리 완료!", "success");
  }
  function normalizeSingleVisitMissionOptions(options = {}) {
    var _a;
    const source = Array.isArray(options == null ? void 0 : options.missionNos) ? options : Array.isArray((_a = options == null ? void 0 : options.meta) == null ? void 0 : _a.missionNos) ? options.meta : {};
    const targetMissionNos = [...new Set((source.missionNos || []).filter((missionNo) => missionNo !== null && missionNo !== void 0))];
    const targetMissionNoSet = new Set(targetMissionNos.map((missionNo) => String(missionNo)));
    return {
      targeted: targetMissionNos.length > 0,
      targetMissionNos,
      targetMissionNoSet
    };
  }
  function isTargetedSingleVisitMission(mission, options) {
    if (!(options == null ? void 0 : options.targeted)) return true;
    return options.targetMissionNoSet.has(String(mission.mission_no));
  }
  const ACTIONABLE_SINGLE_VISIT_STATUSES = /* @__PURE__ */ new Set(["INCOMPLETE", "RECEIVABLE"]);
  function getMissionResultStatus(result) {
    var _a, _b;
    return ((_a = result == null ? void 0 : result.value) == null ? void 0 : _a.status) || (result == null ? void 0 : result.status) || ((_b = result == null ? void 0 : result.missionInfo) == null ? void 0 : _b.status) || null;
  }
  function claimedRewardAmount(result) {
    var _a;
    const amount = Number((result == null ? void 0 : result.reward_amount) ?? ((_a = result == null ? void 0 : result.value) == null ? void 0 : _a.reward_amount));
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }
  function isRewardClaimResult(result) {
    var _a;
    const status = getMissionResultStatus(result);
    return COMPLETE_STATUSES.has(status) || (result == null ? void 0 : result.reward_amount) !== void 0 || ((_a = result == null ? void 0 : result.value) == null ? void 0 : _a.reward_amount) !== void 0;
  }
  async function autoParticipateVisitMissions(headers, options = {}) {
    var _a;
    const missionOptions = normalizeSingleVisitMissionOptions(options);
    const { targeted, targetMissionNos } = missionOptions;
    const io = services(options.deps);
    try {
      log("[SINGLE 미션] 자동 참여 시작", "info");
      if (targeted) {
        log(`[SINGLE 미션] 처리 대상 미션: ${targetMissionNos.length}개`, "info");
      }
      const allMissions = await io.getAllDailyMissions(headers);
      if (!allMissions || allMissions.length === 0) {
        log("[SINGLE 미션] 조회된 미션 없음", "warning");
        return { success: false, participated: 0, completed: 0, skipped: 0, total: 0, targeted, targetMissionNos };
      }
      const singleMissions = [];
      const skippedMissions = [];
      allMissions.forEach((comp) => {
        const missions = comp.missions || [];
        missions.forEach((mission) => {
          if (!isTargetedSingleVisitMission(mission, missionOptions)) return;
          if (mission.mission_type === "SINGLE" && ACTIONABLE_SINGLE_VISIT_STATUSES.has(mission.status) && !CONFIG.dailyMissions.skipMissions.includes(mission.mission_no)) {
            const normalizedMission = {
              mission_no: mission.mission_no,
              component_no: comp.componentNo,
              title: mission.title,
              status: mission.status,
              reward_amount: mission.reward_amount,
              is_visit_mission: mission.is_visit_mission,
              button_url: mission.button_url
            };
            if (mission.is_visit_mission === true) {
              singleMissions.push(normalizedMission);
            } else {
              skippedMissions.push({
                ...normalizedMission,
                reason: getSingleMissionSkipReason(mission)
              });
            }
          }
        });
      });
      skippedMissions.forEach((mission) => {
        log(`[SINGLE 미션] ⏭️ "${mission.title}" 스킵 (${mission.reason})`, "info");
      });
      if (singleMissions.length === 0) {
        log("[SINGLE 미션] 자동 참여 가능한 방문형 미션 없음", "info");
        return { success: true, participated: 0, completed: 0, skipped: skippedMissions.length, total: 0, targeted, targetMissionNos };
      }
      log(`[SINGLE 미션] ${singleMissions.length}개 발견`, "info");
      let participated = 0;
      let completed = 0;
      let earned = 0;
      const claimReward = async (mission) => {
        const claimResult = await io.receiveMissionReward(headers, mission.mission_no, mission.component_no);
        if (!isRewardClaimResult(claimResult)) return;
        completed++;
        const amount = claimedRewardAmount(claimResult);
        earned += amount;
        log(`[SINGLE 미션] 🎁 "${mission.title}" 보상 수령 (+${amount} FLAKE)`, "success");
      };
      for (const mission of singleMissions) {
        try {
          log(`[SINGLE 미션] "${mission.title}" 참여 중...`, "info");
          if (mission.status === "RECEIVABLE") {
            await claimReward(mission);
            await io.delay(1e3);
            continue;
          }
          const result = await io.participateMission(headers, mission.mission_no, mission.component_no);
          if ((_a = mission.button_url) == null ? void 0 : _a.trim()) {
            io.openTabInBackground(mission.button_url, false);
          }
          if (result == null ? void 0 : result.value) {
            const status = result.value.status;
            if (status === "RECEIVABLE") {
              log(`[SINGLE 미션] ✅ "${mission.title}" 참여 완료 (수령 가능)`, "success");
              await claimReward(mission);
              participated++;
            } else if (status === "COMPLETE" || status === "COMPLETED") {
              log(`[SINGLE 미션] 🎁 "${mission.title}" 보상 수령 완료 (+${mission.reward_amount} 플레이크)`, "success");
              earned += claimedRewardAmount(result.value);
              completed++;
            } else {
              log(`[SINGLE 미션] ⚠️ "${mission.title}" 참여 실패 (상태: ${status})`, "warning");
            }
          } else {
            log(`[SINGLE 미션] ⚠️ "${mission.title}" 응답 없음`, "warning");
          }
          if (!(result == null ? void 0 : result.value)) await claimReward(mission);
          await io.delay(1e3);
        } catch (error) {
          log(`[SINGLE 미션] ❌ "${mission.title}" 오류: ${error.message}`, "error");
        }
      }
      state.earnings.visitMissions = (state.earnings.visitMissions || 0) + earned;
      log(`[SINGLE 미션] 총 참여: ${participated}개, 즉시 완료: ${completed}개, 스킵: ${skippedMissions.length}개, 보상: ${earned} FLAKE`, "success");
      return { success: true, participated, completed, skipped: skippedMissions.length, total: singleMissions.length, targeted, targetMissionNos };
    } catch (error) {
      log(`[SINGLE 미션] 오류: ${error.message}`, "error");
      return { success: false, participated: 0, completed: 0, skipped: 0, total: 0, targeted, targetMissionNos, error: error.message };
    }
  }
  const AUTOMATION_SIGNAL = Object.freeze({
    running: "[SG_RUNNING]",
    done: "[SG_DONE]",
    error: "[SG_ERROR]"
  });
  Object.freeze({
    [AUTOMATION_SIGNAL.running]: "running",
    [AUTOMATION_SIGNAL.done]: "done",
    [AUTOMATION_SIGNAL.error]: "error"
  });
  const SIGNAL_PATTERN = /^\[SG_(RUNNING|DONE|ERROR)\]\s*/;
  function normalizeSignal(signal) {
    if (AUTOMATION_SIGNAL[signal]) return AUTOMATION_SIGNAL[signal];
    return signal || "";
  }
  function stripAutomationSignalTitle(title = "") {
    const source = String(title || "").trim();
    const match = source.match(SIGNAL_PATTERN);
    if (!match) return source;
    const rest = source.slice(match[0].length);
    const baseTitleIndex = rest.indexOf(" | ");
    if (baseTitleIndex === -1) return "";
    return rest.slice(baseTitleIndex + 3).trim();
  }
  function buildAutomationSignalTitle(signal, message = "", baseTitle = "") {
    const prefix = normalizeSignal(signal);
    const text = String(message || "").trim();
    const cleanBaseTitle = stripAutomationSignalTitle(baseTitle);
    const signalTitle = [prefix, text].filter(Boolean).join(" ");
    return cleanBaseTitle ? `${signalTitle} | ${cleanBaseTitle}` : signalTitle;
  }
  function setAutomationSignal(signal, message = "", targetDocument) {
    const doc = typeof document === "undefined" ? null : document;
    if (!doc) return "";
    doc.title = buildAutomationSignalTitle(signal, message, doc.title);
    return doc.title;
  }
  const MONTHLY_ATTENDANCE_RECHECK_ATTEMPTS = 3;
  const MONTHLY_ATTENDANCE_RECHECK_DELAY_MS = 3e3;
  const monthlyAttendanceRecordKey = (userId) => `stove-monthly-attendance-v1:${userId}`;
  function attendanceCount(snapshot, missionNo) {
    var _a, _b, _c;
    const count = (_c = (_b = (_a = snapshot == null ? void 0 : snapshot.missions) == null ? void 0 : _a.byMissionNo) == null ? void 0 : _b[missionNo]) == null ? void 0 : _c.userCompleteCount;
    return Number.isFinite(count) ? count : null;
  }
  function readMonthlyAttendanceRecord(storage, key, today) {
    try {
      const text = storage == null ? void 0 : storage.getItem(key);
      if (!text) return null;
      const record = JSON.parse(text);
      if (!record || record.date !== today || typeof record.counts !== "object" || record.counts === null || Array.isArray(record.counts)) {
        return null;
      }
      return record;
    } catch {
      return null;
    }
  }
  async function loadMonthlyAttendanceContext(headers, deps = {}) {
    var _a;
    const fetchProfile = deps.getMyProfile || getMyProfile;
    const storage = deps.storage === void 0 ? globalThis.localStorage : deps.storage;
    const today = deps.today || getTodayKSTString();
    try {
      const profile = await fetchProfile(headers);
      const userId = (_a = profile == null ? void 0 : profile.value) == null ? void 0 : _a.user_id;
      if ((profile == null ? void 0 : profile.code) !== 0 || !/^\d+$/.test(String(userId ?? "")) || !storage) return null;
      const key = monthlyAttendanceRecordKey(userId);
      return { storage, key, today, userId: String(userId), record: readMonthlyAttendanceRecord(storage, key, today) };
    } catch {
      return null;
    }
  }
  function applyMonthlyAttendanceRecord(diff, afterSnapshot, context) {
    var _a;
    const progress = diff == null ? void 0 : diff.monthlyAttendanceProgress;
    const counts = (_a = context == null ? void 0 : context.record) == null ? void 0 : _a.counts;
    if (!progress || !counts) return diff;
    const notIncreasedMissionNos = [];
    const alreadyCountedMissionNos = [...progress.alreadyCountedMissionNos || []];
    for (const missionNo of progress.notIncreasedMissionNos || []) {
      const confirmed = counts[missionNo];
      const current = attendanceCount(afterSnapshot, missionNo);
      if (Number.isFinite(confirmed) && current !== null && current >= confirmed) {
        alreadyCountedMissionNos.push(missionNo);
      } else {
        notIncreasedMissionNos.push(missionNo);
      }
    }
    return {
      ...diff,
      monthlyAttendanceProgress: { ...progress, notIncreasedMissionNos, alreadyCountedMissionNos }
    };
  }
  function markMonthlyAttendanceUnverified(diff) {
    const progress = diff == null ? void 0 : diff.monthlyAttendanceProgress;
    if (!progress || !(progress.notIncreasedMissionNos || []).length) return diff;
    return {
      ...diff,
      monthlyAttendanceProgress: {
        ...progress,
        notIncreasedMissionNos: [],
        unverifiedMissionNos: [
          ...progress.unverifiedMissionNos || [],
          ...progress.notIncreasedMissionNos
        ]
      }
    };
  }
  function saveMonthlyAttendanceRecord(context, beforeSnapshot, afterSnapshot, diff) {
    var _a, _b;
    const progress = diff == null ? void 0 : diff.monthlyAttendanceProgress;
    if (!(context == null ? void 0 : context.storage) || !progress) return null;
    const pending = /* @__PURE__ */ new Set([
      ...progress.notIncreasedMissionNos || [],
      ...progress.unknownMissionNos || []
    ]);
    const counts = { ...((_a = context.record) == null ? void 0 : _a.counts) || {} };
    for (const mission of Object.values(((_b = beforeSnapshot == null ? void 0 : beforeSnapshot.missions) == null ? void 0 : _b.byMissionNo) || {})) {
      if (mission.category !== "attendance" || pending.has(mission.missionNo)) continue;
      const before = mission.userCompleteCount;
      const after = attendanceCount(afterSnapshot, mission.missionNo);
      const alreadyCounted = [
        ...progress.alreadyCountedMissionNos || [],
        ...progress.unverifiedMissionNos || []
      ].includes(mission.missionNo);
      if (after !== null && (alreadyCounted || Number.isFinite(before) && after - before >= 1)) {
        counts[mission.missionNo] = Math.max(after, counts[mission.missionNo] ?? after);
      }
    }
    if (Object.keys(counts).length === 0) return null;
    const record = { date: context.today, counts };
    try {
      context.storage.setItem(context.key, JSON.stringify(record));
      context.record = record;
      return record;
    } catch {
      return null;
    }
  }
  const REWARD_SHOP_URL = "https://reward.onstove.com/ko";
  function taskServices(deps = {}) {
    return {
      visitRequiredPages,
      getMissionComponentIds,
      getRouletteEventIds,
      getPrizeInfo,
      checkArticleWriteStatus,
      createArticle,
      checkArticleLikeStatus,
      likeArticle,
      postCommentsSerially,
      executeBoostMission,
      executeReviewEvent,
      autoParticipateVisitMissions,
      executeDailyMissions,
      executeContentMissions,
      executeBannerMissions,
      executeWeeklyMissions,
      executeAttendanceMissions,
      executeSurveyMissions,
      runRouletteDraws,
      executePrizeEntry,
      claimRouletteExtraRewards,
      claimDailyShopRewards,
      claimDailyAccumulatedRewards,
      claimMajakDailyShopRewards,
      delay,
      log,
      updateProgress,
      ...deps
    };
  }
  function createAutomationTaskHandlers({
    headers,
    articles = [],
    allTabs = [],
    deps = {},
    commentTask: startedCommentTask,
    quota
  }) {
    const io = taskServices(deps);
    let commentTask = startedCommentTask;
    const collectTabs = (tabs) => {
      if (tabs == null ? void 0 : tabs.length) allTabs.push(...tabs);
      return { tabCount: (tabs == null ? void 0 : tabs.length) || 0 };
    };
    return {
      requiredPages: async () => collectTabs(await io.visitRequiredPages()),
      componentRefresh: async () => io.getMissionComponentIds(headers),
      eventRefresh: async () => {
        const events = await io.getRouletteEventIds(headers);
        {
          await io.getPrizeInfo(headers);
        }
        return events;
      },
      articleWrite: async () => {
        const writeStatus = await io.checkArticleWriteStatus(headers);
        if (writeStatus.success && writeStatus.hasWrittenToday) {
          return { skipped: true, reason: "alreadyWritten", writeStatus };
        }
        try {
          const articleId2 = await io.createArticle(headers, "출석", "출석");
          if (articleId2) {
            state.progress.newArticle++;
            io.updateProgress("new-article", state.progress.newArticle, CONFIG.targets.newArticle);
            return { articleId: articleId2 };
          }
          return { error: true, message: "Article creation returned no article id" };
        } catch (e) {
          io.log(`새글 작성 실패: ${e.message}`, "error");
          io.log("새글 작성 실패했지만 자동화를 계속 진행합니다", "warning");
          return { error: true, message: e.message };
        }
      },
      articleLikes: async () => {
        const targetArticleLikes = quota ? quota.remaining("likes") : CONFIG.targets.articleLikes;
        const candidateCount = Math.min(targetArticleLikes * 3, articles.length);
        const candidateArticles = articles.slice(0, candidateCount);
        const candidateArticleIds = candidateArticles.map((a) => a.article_id);
        if (candidateArticleIds.length === 0) {
          return { attempted: 0, liked: 0, errors: [] };
        }
        const articleLikeStatuses = await io.checkArticleLikeStatus(headers, candidateArticleIds);
        const unlikedArticles = candidateArticles.filter(
          (article) => {
            var _a;
            return ((_a = articleLikeStatuses[article.article_id]) == null ? void 0 : _a.LIKE) !== true;
          }
        );
        const articlesToLike = unlikedArticles.slice(0, targetArticleLikes);
        const errors = [];
        let liked = 0;
        for (let i = 0; i < articlesToLike.length; i++) {
          const articleId2 = articlesToLike[i].article_id;
          try {
            await io.likeArticle(headers, articleId2);
            state.progress.articleLikes++;
            liked++;
            quota == null ? void 0 : quota.add("likes");
            io.updateProgress("article-likes", state.progress.articleLikes, CONFIG.targets.articleLikes);
            io.log(`게시글 ${articleId2} 좋아요 완료 (${state.progress.articleLikes}/${targetArticleLikes})`, "success");
          } catch (e) {
            errors.push({ articleId: articleId2, message: e.message });
            io.log(`게시글 ${articleId2} 좋아요 실패: ${e.message}`, "error");
          }
          if (i < articlesToLike.length - 1) await io.delay(CONFIG.delays.betweenActions);
        }
        return { attempted: articlesToLike.length, liked, errors };
      },
      comments: () => {
        if (!commentTask) commentTask = io.postCommentsSerially({ headers, articles });
        return commentTask;
      },
      boostMission: async () => io.executeBoostMission(headers),
      reviewEvent: async () => {
        const comments = await commentTask;
        if ((comments == null ? void 0 : comments.attempted) > 0) await io.delay(CONFIG.delays.afterComment);
        return io.executeReviewEvent(headers);
      },
      singleVisits: async (task2) => io.autoParticipateVisitMissions(headers, task2),
      dailyMissions: async () => collectTabs(await io.executeDailyMissions(headers)),
      contentMissions: async () => collectTabs(await io.executeContentMissions(headers)),
      bannerMissions: async () => collectTabs(await io.executeBannerMissions(headers)),
      weeklyMissions: async () => io.executeWeeklyMissions(headers),
      attendanceMissions: async () => io.executeAttendanceMissions(headers),
      surveyMissions: async () => io.executeSurveyMissions(headers),
      rouletteDraws: async () => io.runRouletteDraws(headers),
      prizeEntry: async () => io.executePrizeEntry(headers),
      rouletteExtra: async () => io.claimRouletteExtraRewards(headers),
      dailyShop: async () => io.claimDailyShopRewards(headers),
      dailyAccumulatedShop: async () => io.claimDailyAccumulatedRewards(headers),
      majakShop: async () => io.claimMajakDailyShopRewards(headers)
    };
  }
  function bindTaskHandlers(plan = {}, handlers = {}) {
    const groups = (plan.groups || []).map((group2) => {
      const tasks = (group2.tasks || []).filter((task2) => handlers[task2.kind]).map((task2) => ({
        ...task2,
        run: () => handlers[task2.kind](task2)
      }));
      return { ...group2, tasks };
    }).filter((group2) => group2.tasks.length > 0);
    return { ...plan, groups };
  }
  function hasSafeRepairableItems(diff = {}) {
    return Boolean(
      diff.articleStillMissing || (diff.incompleteMissionNos || []).length > 0 || diff.unclaimedDailyShop > 0 || diff.unclaimedMajakShop > 0 || diff.claimableExtra > 0
    );
  }
  function hasMonthlyAttendanceVerificationIssue(diff = {}) {
    const progress = diff.monthlyAttendanceProgress || {};
    return Boolean(
      (progress.notIncreasedMissionNos || []).length > 0 || (progress.unknownMissionNos || []).length > 0
    );
  }
  function hasSnapshotDiffWarning(diff = {}) {
    return hasSafeRepairableItems(diff) || hasMonthlyAttendanceVerificationIssue(diff);
  }
  function focusRewardShopForMonthlyAttendanceIfNeeded(diff = {}, deps = {}) {
    if (!hasMonthlyAttendanceVerificationIssue(diff)) return null;
    const writeLog = deps.writeLog || log;
    const openRewardShop2 = deps.openRewardShop || openTabInBackground;
    writeLog("월간출석 +1 확인이 안 되어 리워드샵으로 포커스를 이동합니다", "warning");
    return openRewardShop2(REWARD_SHOP_URL, true);
  }
  async function recheckMonthlyAttendance({ afterSnapshot, diff, capture, compare, deps = {} }) {
    var _a, _b;
    const wait = deps.delay || delay;
    const writeLog = deps.writeLog || log;
    const attempts = deps.attempts ?? MONTHLY_ATTENDANCE_RECHECK_ATTEMPTS;
    const delayMs = deps.delayMs ?? MONTHLY_ATTENDANCE_RECHECK_DELAY_MS;
    let currentSnapshot = afterSnapshot;
    let currentDiff = diff;
    for (let attempt = 1; attempt <= attempts && hasMonthlyAttendanceVerificationIssue(currentDiff); attempt++) {
      await wait(delayMs);
      const snapshot = await capture();
      if (((_a = snapshot == null ? void 0 : snapshot.missions) == null ? void 0 : _a.success) === false) continue;
      currentSnapshot = snapshot;
      currentDiff = compare(snapshot);
      writeLog(
        `월간출석 재확인 ${attempt}/${attempts}: ${formatMonthlyAttendanceProgress(currentDiff.monthlyAttendanceProgress)}`,
        hasMonthlyAttendanceVerificationIssue(currentDiff) ? "warning" : "success"
      );
    }
    const unverified = ((_b = currentDiff.monthlyAttendanceProgress) == null ? void 0 : _b.notIncreasedMissionNos) || [];
    if (unverified.length > 0) {
      currentDiff = markMonthlyAttendanceUnverified(currentDiff);
      writeLog(`월간출석 +1을 확인하지 못했습니다. 오늘 이미 출석했을 수 있어 실패로 처리하지 않습니다 (미션 ${unverified.join(", ")})`, "warning");
    }
    return { afterSnapshot: currentSnapshot, diff: currentDiff };
  }
  function isFailedTask(result) {
    var _a, _b, _c, _d;
    return Boolean(result.status === "rejected" || ((_a = result.value) == null ? void 0 : _a.error) || ((_b = result.value) == null ? void 0 : _b.success) === false || ((_d = (_c = result.value) == null ? void 0 : _c.errors) == null ? void 0 : _d.length) > 0);
  }
  function getAutomationOutcome({
    snapshot,
    diff,
    plan,
    groupResults = [],
    boostRewardResult,
    preRegistrationResult,
    rouletteEnabled = CONFIG.roulette.enabled
  }) {
    var _a;
    const issues = [];
    const failedTasks = flattenTaskResults(groupResults).filter(isFailedTask);
    if (failedTasks.length > 0) issues.push(`작업 실패 ${failedTasks.length}개`);
    if (snapshot == null ? void 0 : snapshot.degraded) issues.push("최종 상태 확인 불가");
    if (hasSafeRepairableItems(diff)) issues.push("글·미션·보상 미완료");
    if (hasMonthlyAttendanceVerificationIssue(diff)) issues.push("월간출석 확인 필요");
    const roulettePlanned = (_a = plan == null ? void 0 : plan.groups) == null ? void 0 : _a.some((group2) => {
      var _a2;
      return (_a2 = group2.tasks) == null ? void 0 : _a2.some((task2) => task2.kind === "rouletteDraws");
    });
    if (rouletteEnabled && roulettePlanned && (diff == null ? void 0 : diff.rouletteStillRemaining)) {
      issues.push("룰렛 미완료");
    }
    if ((boostRewardResult == null ? void 0 : boostRewardResult.success) === false) issues.push("오늘의 1등 보상 확인 필요");
    if ((preRegistrationResult == null ? void 0 : preRegistrationResult.success) === false) issues.push("사전등록 확인 필요");
    return { success: issues.length === 0, issues };
  }
  function describeFailedTask(result) {
    var _a, _b, _c, _d, _e;
    const reason = result.reason || ((_a = result.value) == null ? void 0 : _a.message) || ((_b = result.value) == null ? void 0 : _b.error) || ((_e = (_d = (_c = result.value) == null ? void 0 : _c.errors) == null ? void 0 : _d[0]) == null ? void 0 : _e.message) || "작업 결과 확인 필요";
    const message = (reason == null ? void 0 : reason.message) || String(reason);
    return `${result.groupId}/${result.id}: ${message}`;
  }
  function logFailedTasks(groupResults) {
    const rejected = flattenTaskResults(groupResults).filter(isFailedTask);
    for (const result of rejected) {
      log(`작업 실패: ${describeFailedTask(result)}`, "error");
    }
  }
  function logSnapshotSummary(label, snapshot) {
    const summary = getSnapshotSummary(snapshot);
    log(
      `${label}: 글작성 ${summary.articleWritten ? "완료" : "미완료"}, 룰렛 ${summary.rouletteRemaining}회, 미션 완료 ${summary.missions.complete}/수령가능 ${summary.missions.receivable}/미완료 ${summary.missions.incomplete}`,
      "info"
    );
  }
  function formatMonthlyAttendanceProgress(progress = {}) {
    var _a, _b, _c, _d;
    const checked = progress.checked || 0;
    if (checked === 0) return "월간출석 +1 대상없음";
    const notIncreased = ((_a = progress.notIncreasedMissionNos) == null ? void 0 : _a.length) || 0;
    const unknown = ((_b = progress.unknownMissionNos) == null ? void 0 : _b.length) || 0;
    const alreadyCounted = ((_c = progress.alreadyCountedMissionNos) == null ? void 0 : _c.length) || 0;
    const unverified = ((_d = progress.unverifiedMissionNos) == null ? void 0 : _d.length) || 0;
    const suffix = (notIncreased > 0 || unknown > 0 ? ` (미증가 ${notIncreased}개, 확인불가 ${unknown}개)` : "") + (alreadyCounted > 0 ? ` (오늘 이미 반영 ${alreadyCounted}개)` : "") + (unverified > 0 ? ` (리워드샵 확인 후에도 미증가 ${unverified}개: 오늘 이미 출석했을 수 있음)` : "");
    return `월간출석 +1 ${progress.increased || 0}/${checked}${suffix}`;
  }
  function logSnapshotDiff(label, diff) {
    log(
      `${label}: 글 ${diff.articleStillMissing ? "미완료" : "확인"}, 미션 ${diff.incompleteMissionNos.length}개, 데일리 ${diff.unclaimedDailyShop}개, 마작 ${diff.unclaimedMajakShop}개, EXTRA ${diff.claimableExtra}개, ${formatMonthlyAttendanceProgress(diff.monthlyAttendanceProgress)}`,
      hasSnapshotDiffWarning(diff) ? "warning" : "success"
    );
  }
  const SNAPSHOT_SECTION_ORDER = [
    "articleWrite",
    "missions",
    "roulette",
    "rouletteExtra",
    "shop",
    "majak",
    "flakeTotal",
    "flakeMonthly",
    "boost",
    "reviewEvent"
  ];
  function addSnapshotDetail(timing, label, sections) {
    const lead = sections.find((section) => section.label === "missionComponents");
    const order = (name) => SNAPSHOT_SECTION_ORDER.indexOf(name);
    const slowest = sections.filter((section) => section !== lead).sort((a, b) => b.ms - a.ms || order(a.label) - order(b.label)).slice(0, 4);
    timing.addDetail(label, slowest, lead ? `missionComponents ${formatSeconds(lead.ms)} → ` : "");
  }
  function snapshotSectionRecorder() {
    const sections = [];
    return { sections, onSectionTime: (label, ms) => sections.push({ label, ms }) };
  }
  async function runAutomation() {
    var _a, _b, _c, _d;
    if (state.isRunning) {
      log("이미 자동화가 실행 중입니다", "warning");
      return;
    }
    state.isRunning = true;
    setAutomationSignal(AUTOMATION_SIGNAL.running, "전체 자동화 실행 중");
    setButtonState(true);
    resetRunProgress();
    const timing = createRunTiming();
    const allTabs = [];
    const progressSection = document.querySelector(".stove-progress-section");
    if (progressSection) {
      const rect = progressSection.getBoundingClientRect();
      const offsetTop = window.pageYOffset + rect.top - window.innerHeight * 0.3 + rect.height / 2;
      window.scrollTo({ top: offsetTop, behavior: "smooth" });
    }
    try {
      log("🚀 전체 자동화 시작", "info");
      log("헤더 정보 추출 중...", "info");
      const headers = extractHeaders();
      log("✓ 헤더 정보 추출 완료", "success");
      let rewardShopFocusedForMonthlyAttendance = false;
      const focusRewardShopAfterDiff = (currentDiff) => {
        if (rewardShopFocusedForMonthlyAttendance) return;
        const tab = focusRewardShopForMonthlyAttendanceIfNeeded(currentDiff);
        if (tab) rewardShopFocusedForMonthlyAttendance = true;
      };
      log("", "info");
      log("초기 스냅샷 수집 중...", "info");
      const endBeforeSnapshot = timing.start("준비", "초기 스냅샷");
      const beforeSections = snapshotSectionRecorder();
      const beforeSnapshotTask = captureAutomationSnapshot(headers, { onSectionTime: beforeSections.onSectionTime }).then((snapshot) => {
        endBeforeSnapshot();
        return snapshot;
      });
      log("", "info");
      log("게시글 목록 가져오는 중...", "info");
      const endMonthlyContext = timing.start("준비", "월간 출석 기록");
      const endArticles = timing.start("준비", "게시글 목록");
      let monthlyAttendanceContext;
      let articles;
      try {
        [monthlyAttendanceContext, articles] = await Promise.all([
          loadMonthlyAttendanceContext(headers).then((context) => {
            endMonthlyContext();
            return context;
          }),
          getArticleList(headers, 30).then((list) => {
            endArticles();
            return list;
          })
        ]);
      } catch (error) {
        await beforeSnapshotTask;
        throw error;
      }
      log(`게시글 ${articles.length}개 발견`, "success");
      if (articles.length === 0) {
        logSnapshotSummary("초기 스냅샷", await beforeSnapshotTask);
        setAutomationSignal(AUTOMATION_SIGNAL.error, "게시글 없음");
        log("게시글이 없습니다", "error");
        return;
      }
      const quota = createCommunityQuota(monthlyAttendanceContext);
      const likesRemaining = quota.remaining("likes");
      const commentsRemaining = quota.remaining("comments");
      if (quota.done.likes > 0 || quota.done.comments > 0) {
        log(`오늘 이미 한 활동: 좋아요 ${quota.done.likes}/${CONFIG.targets.articleLikes}, 댓글 ${quota.done.comments}/${CONFIG.targets.comments} · 남은 것만 진행합니다`, "info");
      }
      let commentTask;
      if (commentsRemaining > 0) {
        commentTask = timing.track("community:comments", () => postCommentsSerially({
          headers,
          articles,
          targetComments: commentsRemaining,
          onPosted: () => quota.add("comments")
        }));
      }
      const beforeSnapshot = await beforeSnapshotTask;
      logSnapshotSummary("초기 스냅샷", beforeSnapshot);
      addSnapshotDetail(timing, "초기 스냅샷 세부", beforeSections.sections);
      const compareWithAttendanceRecord = (snapshot) => applyMonthlyAttendanceRecord(
        compareSnapshots(beforeSnapshot, snapshot, plan),
        snapshot,
        monthlyAttendanceContext
      );
      const plan = buildAutomationPlan(beforeSnapshot, { community: { likesRemaining, commentsRemaining } });
      if (plan.skippedDone.length > 0) {
        for (const kind of plan.skippedDone) state.completed[kind] = true;
        log(`오늘 이미 완료되어 건너뜀: ${plan.skippedDone.join(", ")}`, "info");
      }
      const handlers = createAutomationTaskHandlers({ headers, articles, allTabs, commentTask, quota });
      const executablePlan = timing.timeTasks(bindTaskHandlers(plan, handlers));
      log("", "info");
      log(`자동화 그룹 ${executablePlan.groups.length}개 실행`, "info");
      const groupResults = await runTaskGroups(executablePlan.groups, {
        onGroupStart: (group2) => {
          timing.startGroup(group2.id);
          log(`그룹 시작: ${group2.id}`, "info");
        },
        onGroupDone: (group2, results) => {
          const rejectedCount = results.filter(isFailedTask).length;
          const backgroundCount = results.filter((result) => result.status === "background").length;
          const foregroundCount = results.length - backgroundCount;
          const suffix = backgroundCount > 0 ? `, 백그라운드 ${backgroundCount}개` : "";
          const elapsed = timing.groupSuffix(timing.endGroup("그룹", group2.id), results);
          log(`그룹 완료: ${group2.id} (${foregroundCount - rejectedCount}/${foregroundCount}${suffix})${elapsed}`, rejectedCount > 0 ? "warning" : "success");
        }
      });
      logFailedTasks(groupResults);
      const backgroundResults = await waitForBackgroundTasks(groupResults, {
        onGroupStart: (groupResult, results) => {
          timing.startGroup(`background:${groupResult.groupId}`);
          log(`백그라운드 작업 대기: ${groupResult.groupId} (${results.length}개)`, "info");
        },
        onGroupDone: (groupResult, results) => {
          const rejectedCount = results.filter(isFailedTask).length;
          const waitedMs = timing.endGroup(null, `background:${groupResult.groupId}`);
          const timedTasks = results.filter((result) => timing.taskMs(result.id) !== void 0);
          for (const result of timedTasks) timing.record("백그라운드", result.id, timing.taskMs(result.id));
          timing.record("백그라운드", "종료 대기", waitedMs);
          const taskTimes = timedTasks.map((result) => `${result.id.split(":").pop()} ${formatSeconds(timing.taskMs(result.id))}`);
          const detail = taskTimes.length > 0 ? ` (${taskTimes.join(" · ")})` : "";
          log(`백그라운드 작업 완료: ${groupResult.groupId} (${results.length - rejectedCount}/${results.length}) · 대기 ${formatSeconds(waitedMs)}${detail}`, rejectedCount > 0 ? "warning" : "success");
        }
      });
      logFailedTasks(backgroundResults);
      const allGroupResults = [...groupResults, ...backgroundResults];
      let boostRewardResult;
      if (((_a = beforeSnapshot.boost) == null ? void 0 : _a.success) && !beforeSnapshot.boost.notAvailable) {
        const endBoostReward = timing.start("마무리", "1등 보상");
        boostRewardResult = await claimBoostMissionReward(headers);
        endBoostReward();
        if (!boostRewardResult.success) log("오늘의 1등 보상 상태를 확인하지 못했습니다. 대시보드를 확인해 주세요", "warning");
      }
      log("", "info");
      log("최종 스냅샷 수집 중...", "info");
      const statusRefreshTask = checkAllStatus();
      let changedAfterSnapshot = false;
      const endAfterSnapshot = timing.start("마무리", "최종 스냅샷");
      const afterSections = snapshotSectionRecorder();
      let afterSnapshot = await captureAutomationSnapshot(headers, { onSectionTime: afterSections.onSectionTime });
      endAfterSnapshot();
      addSnapshotDetail(timing, "최종 스냅샷 세부", afterSections.sections);
      logSnapshotSummary("최종 스냅샷", afterSnapshot);
      let diff = compareWithAttendanceRecord(afterSnapshot);
      logSnapshotDiff("스냅샷 비교", diff);
      focusRewardShopAfterDiff(diff);
      if (hasSafeRepairableItems(diff)) {
        changedAfterSnapshot = true;
        const endRepair = timing.start("마무리", "복구");
        log("안전 복구 대상 확인 중...", "warning");
        await delay(CONFIG.delays.betweenActions);
        afterSnapshot = await captureAutomationSnapshot(headers);
        diff = compareWithAttendanceRecord(afterSnapshot);
        logSnapshotDiff("재확인 결과", diff);
        focusRewardShopAfterDiff(diff);
        if (hasSafeRepairableItems(diff)) {
          const repairPlan = buildRepairPlan(diff);
          const executableRepairPlan = timing.timeTasks(bindTaskHandlers(repairPlan, handlers));
          if (executableRepairPlan.groups.length > 0) {
            log(`복구 그룹 ${executableRepairPlan.groups.length}개 실행`, "warning");
            const repairResults = await runTaskGroups(executableRepairPlan.groups, {
              onGroupStart: (group2) => {
                timing.startGroup(`repair:${group2.id}`);
                log(`복구 시작: ${group2.id}`, "info");
              },
              onGroupDone: (group2, results) => {
                const rejectedCount = results.filter(isFailedTask).length;
                const elapsed = timing.groupSuffix(timing.endGroup(null, `repair:${group2.id}`), results);
                log(`복구 완료: ${group2.id} (${results.length - rejectedCount}/${results.length})${elapsed}`, rejectedCount > 0 ? "warning" : "success");
              }
            });
            logFailedTasks(repairResults);
            allGroupResults.push(...repairResults);
            afterSnapshot = await captureAutomationSnapshot(headers);
            logSnapshotSummary("복구 후 스냅샷", afterSnapshot);
            diff = compareWithAttendanceRecord(afterSnapshot);
            logSnapshotDiff("복구 후 비교", diff);
            focusRewardShopAfterDiff(diff);
          }
        }
        endRepair();
      }
      if (rewardShopFocusedForMonthlyAttendance && hasMonthlyAttendanceVerificationIssue(diff)) {
        changedAfterSnapshot = true;
        const endRecheck = timing.start("마무리", "월간 출석 재확인");
        ({ afterSnapshot, diff } = await recheckMonthlyAttendance({
          afterSnapshot,
          diff,
          capture: () => captureAutomationSnapshot(headers),
          compare: compareWithAttendanceRecord
        }));
        endRecheck();
      }
      saveMonthlyAttendanceRecord(monthlyAttendanceContext, beforeSnapshot, afterSnapshot, diff);
      const endPreRegistration = timing.start("마무리", "사전등록");
      const preRegistrationResult = await runPreRegistrations(headers);
      endPreRegistration();
      if ((preRegistrationResult.results || []).some((result) => result.registered || result.error)) {
        changedAfterSnapshot = true;
      }
      const outcome = getAutomationOutcome({
        snapshot: afterSnapshot,
        diff,
        plan,
        groupResults: allGroupResults,
        boostRewardResult,
        preRegistrationResult
      });
      const dailyAccumulatedFlake = state.earnings.dailyAccumulated || 0;
      const articleWriteFlake = state.progress.newArticle > 0 ? 200 : 0;
      const articleLikeFlake = state.progress.articleLikes * 3;
      const commentFlake = state.progress.comments * 30;
      const questActivityFlake = articleWriteFlake + articleLikeFlake + commentFlake;
      let totalEarnings = (questActivityFlake || 0) + (state.earnings.roulette || 0) + (state.earnings.rouletteExtra || 0) + (state.earnings.dailyShop || 0) + (state.earnings.majak || 0) + (state.earnings.dailyMissions || 0) + (state.earnings.visitMissions || 0) + (state.earnings.contentMissions || 0) + (state.earnings.weeklyMissions || 0) + (state.earnings.bannerMissions || 0) + (state.earnings.attendanceMissions || 0) + (state.earnings.surveyMissions || 0) + (state.earnings.prizeEntry || 0) + (state.earnings.boostMission || 0) + (dailyAccumulatedFlake || 0);
      if (isNaN(totalEarnings)) {
        log("⚠️ 수익 계산 오류 발생 - 일부 값이 유효하지 않음", "warning");
        totalEarnings = 0;
      }
      const profitSign = totalEarnings >= 0 ? "+" : "";
      log("", "info");
      log(outcome.success ? "🎉 전체 자동화 완료!" : `전체 자동화 종료 · 확인 필요: ${outcome.issues.join(", ")}`, outcome.success ? "success" : "warning");
      log("", "info");
      log("═══════════════════════════════════════", "info");
      log("💰 최종 FLAKE 수익 요약", "success");
      log("═══════════════════════════════════════", "info");
      log(`  ✍️  글쓰기: ${articleWriteFlake} FLAKE`, "success");
      log(`  👍 게시글 좋아요: ${articleLikeFlake} FLAKE (${state.progress.articleLikes}회 × 3)`, articleLikeFlake > 0 ? "success" : "info");
      log(`  💬 댓글 쓰기: ${commentFlake} FLAKE (${state.progress.comments}회 × 30)`, commentFlake > 0 ? "success" : "info");
      log(`  📋 데일리 미션: ${state.earnings.dailyMissions} FLAKE`, state.earnings.dailyMissions > 0 ? "success" : "info");
      const visitMissionFlake = state.earnings.visitMissions || 0;
      log(`  🚶 방문 미션: ${visitMissionFlake} FLAKE`, visitMissionFlake > 0 ? "success" : "info");
      log(`  📰 컨텐츠 미션: ${state.earnings.contentMissions} FLAKE`, state.earnings.contentMissions > 0 ? "success" : "info");
      log(`  📅 위클리 미션: ${state.earnings.weeklyMissions} FLAKE`, state.earnings.weeklyMissions > 0 ? "success" : "info");
      log(`  🎨 배너 미션: ${state.earnings.bannerMissions} FLAKE`, state.earnings.bannerMissions > 0 ? "success" : "info");
      log(`  📆 출석 미션: ${state.earnings.attendanceMissions} FLAKE`, state.earnings.attendanceMissions > 0 ? "success" : "info");
      log(`  📊 설문조사: ${state.earnings.surveyMissions} FLAKE`, state.earnings.surveyMissions > 0 ? "success" : "info");
      log(`  🔥 오늘의 1등 미션: ${state.earnings.boostMission} FLAKE`, state.earnings.boostMission > 0 ? "success" : "info");
      const prizeEntrySign = state.earnings.prizeEntry >= 0 ? "+" : "";
      log(`  🎁 경품 응모: ${prizeEntrySign}${state.earnings.prizeEntry} FLAKE`, state.earnings.prizeEntry >= 0 ? "success" : "warning");
      log(`  🎰 룰렛 순수익: ${state.earnings.roulette >= 0 ? "+" : ""}${state.earnings.roulette} FLAKE`, state.earnings.roulette >= 0 ? "success" : "warning");
      log(`  🎁 룰렛 EXTRA: ${state.earnings.rouletteExtra} FLAKE`, state.earnings.rouletteExtra > 0 ? "success" : "info");
      log(`  💝 데일리 보상: ${state.earnings.dailyShop} FLAKE`, state.earnings.dailyShop > 0 ? "success" : "info");
      log(`  🎁 데일리 누적 보상: ${dailyAccumulatedFlake} FLAKE`, dailyAccumulatedFlake > 0 ? "success" : "info");
      log(`  🀄 마작 리워드: ${state.earnings.majak} FLAKE`, state.earnings.majak > 0 ? "success" : "info");
      log("───────────────────────────────────────", "info");
      log(`  📊 총 순수익: ${profitSign}${totalEarnings} FLAKE`, totalEarnings >= 0 ? "success" : "warning");
      log("═══════════════════════════════════════", "info");
      if (outcome.success) playCompletionSound();
      state.completed.roulette = ((_b = afterSnapshot.roulette) == null ? void 0 : _b.success) === true && (!CONFIG.roulette.enabled || !diff.rouletteStillRemaining);
      state.completed.dailyShop = ((_c = afterSnapshot.shop) == null ? void 0 : _c.success) === true && diff.unclaimedDailyShop === 0;
      state.completed.majak = ((_d = afterSnapshot.majak) == null ? void 0 : _d.success) === true && diff.unclaimedMajakShop === 0;
      updateProgress();
      const progressFill = document.querySelector(".stove-progress-fill");
      if (progressFill && outcome.success) progressFill.style.width = "100%";
      const progressText = document.getElementById("stove-progress-text");
      if (progressText) {
        progressText.style.display = "block";
        progressText.style.opacity = "1";
        progressText.textContent = outcome.success ? "100%" : "확인 필요";
      }
      log("", "info");
      log("📊 상태 업데이트 중...", "info");
      const endStatusUpdate = timing.start("마무리", "상태 업데이트");
      await statusRefreshTask;
      if (changedAfterSnapshot) await checkAllStatus();
      endStatusUpdate();
      log("✅ 상태 업데이트 완료!", "success");
      log("", "info");
      if (!preRegistrationResult.success) {
        log(`사전등록 확인 필요: ${preRegistrationResult.error}`, "warning");
      }
      if (outcome.success) {
        log("🎊 모든 작업이 완료되었습니다!", "success");
        setAutomationSignal(AUTOMATION_SIGNAL.done, "전체 자동화 완료");
      } else {
        log(`일부 작업이 실패했거나 확인이 필요합니다: ${outcome.issues.join(", ")}`, "warning");
        setAutomationSignal(AUTOMATION_SIGNAL.error, outcome.issues.join(", "));
      }
    } catch (error) {
      setAutomationSignal(AUTOMATION_SIGNAL.error, error.message || "자동화 실패");
      log(`✗ 오류 발생: ${error.message}`, "error");
    } finally {
      if (allTabs.length > 0) {
        log(`🔒 열린 탭 ${allTabs.length}개 닫는 중...`, "info");
        closeTab(allTabs);
        log("✓ 모든 탭 닫힘", "success");
      }
      log("", "info");
      for (const line of timing.summaryLines()) log(line, "info");
      state.isRunning = false;
      setButtonState(false);
    }
  }
  function showSuccessNotice(message) {
    const existing = document.getElementById("stove-success-notice");
    if (existing) existing.remove();
    const notice = document.createElement("div");
    notice.id = "stove-success-notice";
    notice.className = "stove-success-notice";
    notice.textContent = message;
    const panel = document.getElementById("stove-quest-automation");
    if (panel) {
      panel.insertBefore(notice, panel.firstChild);
    } else {
      document.body.appendChild(notice);
    }
    setTimeout(() => {
      notice.classList.add("stove-success-notice--hide");
      setTimeout(() => notice.remove(), 300);
    }, 6e3);
  }
  function getPointExchangeConfig(overrides = {}) {
    return { ...CONFIG.pointExchange, ...overrides };
  }
  function numberOrNull$1(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function makePointExchangeHeaders(headers) {
    return {
      Authorization: headers.Authorization || headers.authorization,
      "caller-id": "billuser",
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }
  function buildPointExchangeRateUrl(configOverrides = {}) {
    const config = getPointExchangeConfig(configOverrides);
    const params = new URLSearchParams({
      from_use_rule_id: config.fromUseRuleId,
      to_deposit_rule_id: config.toDepositRuleId,
      client_id: config.clientId
    });
    return `${CONFIG.api.baseUrl}/mileage/v1.0/exchange?${params.toString()}`;
  }
  function buildBillFlakeBalanceUrl(configOverrides = {}) {
    const config = getPointExchangeConfig(configOverrides);
    const params = new URLSearchParams({
      client_id: config.clientId,
      use_rule_id: config.fromUseRuleId
    });
    return `${CONFIG.api.baseUrl}/mileage/v1.0/balance?${params.toString()}`;
  }
  function calculateRequiredFlake(pointAmount, exchangeRate) {
    const fromAmount = numberOrNull$1(exchangeRate == null ? void 0 : exchangeRate.from_amount);
    const toAmount = numberOrNull$1(exchangeRate == null ? void 0 : exchangeRate.to_amount);
    const targetPoints = numberOrNull$1(pointAmount);
    if (!targetPoints || !fromAmount || !toAmount) {
      throw new Error("Invalid point exchange rate");
    }
    const requiredFlake = targetPoints * (fromAmount / toAmount);
    if (!Number.isInteger(requiredFlake)) {
      throw new Error("Point exchange amount must resolve to a whole flake amount");
    }
    return requiredFlake;
  }
  function createPointExchangePlan(exchangeRate, configOverrides = {}) {
    const config = getPointExchangeConfig(configOverrides);
    const pointAmount = numberOrNull$1(config.pointAmount);
    const minAmount = numberOrNull$1(exchangeRate == null ? void 0 : exchangeRate.min_exchange_amount);
    const maxAmount = numberOrNull$1(exchangeRate == null ? void 0 : exchangeRate.max_exchange_amount);
    const exchangeId = numberOrNull$1(exchangeRate == null ? void 0 : exchangeRate.exchange_id);
    if (!pointAmount || !exchangeId) {
      throw new Error("Invalid point exchange target");
    }
    if (minAmount !== null && pointAmount < minAmount) {
      throw new Error(`Target point amount is below minimum exchange amount ${minAmount}`);
    }
    if (maxAmount !== null && pointAmount > maxAmount) {
      throw new Error(`Target point amount exceeds maximum exchange amount ${maxAmount}`);
    }
    const fromAmount = calculateRequiredFlake(pointAmount, exchangeRate);
    const expectedFlake = numberOrNull$1(config.requiredFlakeAmount);
    if (expectedFlake !== null && fromAmount !== expectedFlake) {
      throw new Error(`Expected ${expectedFlake} flake but exchange rate requires ${fromAmount}`);
    }
    return { exchangeId, pointAmount, fromAmount };
  }
  function buildPointExchangePayload({ exchangeId, fromAmount }, configOverrides = {}) {
    const config = getPointExchangeConfig(configOverrides);
    return {
      client_id: config.clientId,
      exchange_id: Number(exchangeId),
      from_amount: Number(fromAmount),
      descriptions: config.description
    };
  }
  function extractBillFlakeBalance(response) {
    var _a;
    const balance2 = numberOrNull$1((_a = response == null ? void 0 : response.value) == null ? void 0 : _a.mileage_amount);
    return balance2 === null ? null : balance2;
  }
  async function getPointExchangeRate(headers) {
    return apiRequest(buildPointExchangeRateUrl(), "GET", makePointExchangeHeaders(headers));
  }
  async function getBillFlakeBalance(headers) {
    return apiRequest(buildBillFlakeBalanceUrl(), "GET", makePointExchangeHeaders(headers));
  }
  async function exchangeFlakeForPoints(headers, plan) {
    const url = `${CONFIG.api.baseUrl}/mileage/v1.0/exchange/point`;
    const payload = buildPointExchangePayload(plan);
    return apiRequest(url, "POST", makePointExchangeHeaders(headers), payload);
  }
  function getLostArkCashChargeConfig(overrides = {}) {
    return { ...CONFIG.lostArkCashCharge, ...overrides };
  }
  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function extractBearerToken(headers) {
    const authorization = headers.Authorization || headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : authorization;
  }
  function makeLostArkPaymentHeaders(headers) {
    return {
      "Content-Type": "application/json",
      Authorization: headers.Authorization || headers.authorization,
      "X-Lang": headers["X-Lang"] || headers["x-lang"] || "ko",
      "X-Nation": headers["X-Nation"] || headers["x-nation"] || "KR",
      "caller-id": "bill-payweb",
      "caller-detail": headers["caller-detail"] || headers["X-UUID"] || ""
    };
  }
  function buildLostArkPointBalanceUrl(configOverrides = {}) {
    const config = getLostArkCashChargeConfig(configOverrides);
    const params = new URLSearchParams({
      client_id: config.pointClientId,
      use_rule_id: config.pointUseRuleId
    });
    return `${CONFIG.api.baseUrl}/point/v1.0/balance?${params.toString()}`;
  }
  function buildLostArkCashChargeUrl(configOverrides = {}) {
    const config = getLostArkCashChargeConfig(configOverrides);
    return `${CONFIG.api.baseUrl}/pay/v1.0/payment/${config.gameCode}/request/direct`;
  }
  function buildLostArkPointCashChargePayload({ accessToken }, configOverrides = {}) {
    const config = getLostArkCashChargeConfig(configOverrides);
    return {
      speed_charge_flag: "Y",
      access_token: accessToken,
      return_url: "",
      is_channeling: false,
      cp_item_id: 0,
      coupon_info: null,
      location_code: "1",
      prod_name: config.productName,
      sales_prod_name: config.productName,
      multi_pay_list: [
        {
          paytool_code: config.pointPaytoolCode,
          pg_code: config.pointPgCode,
          mall_id: config.pointMallId,
          cash_amt: config.cashAmount,
          pay_amt: 0
        }
      ],
      paytool_code: config.paytoolCode,
      pgp_code: config.pgpCode,
      pg_code: config.pgCode,
      mall_id: config.mallId,
      total_pay_amt: config.cashAmount,
      currency_code: "KRW",
      pay_amt: 0,
      cash_amt: 0,
      cash_unit_price: 1,
      display_digit_num: -2,
      game_cash_unit_price: 1,
      min_pay_amt: 100,
      max_pay_amt: null,
      is_mobile: false,
      is_gift: false,
      request_url: "https://pay.onstove.com",
      position: "PCWEB",
      is_client: false,
      auth_confirm_order_no: "",
      game_point_use_flag: null
    };
  }
  function extractStovePointBalance(response) {
    var _a;
    const balance2 = numberOrNull((_a = response == null ? void 0 : response.value) == null ? void 0 : _a.mileage_amount);
    return balance2 === null ? null : balance2;
  }
  function extractLostArkOrderNo(response) {
    var _a;
    const orderNo = (_a = response == null ? void 0 : response.value) == null ? void 0 : _a.order_no;
    return orderNo == null || orderNo === "" ? null : String(orderNo);
  }
  async function getLostArkPointBalance(headers) {
    return apiRequest(buildLostArkPointBalanceUrl(), "GET", makeLostArkPaymentHeaders(headers));
  }
  async function chargeLostArkCashWithPoints(headers) {
    const payload = buildLostArkPointCashChargePayload({
      accessToken: extractBearerToken(headers)
    });
    return apiRequest(
      buildLostArkCashChargeUrl(),
      "POST",
      makeLostArkPaymentHeaders(headers),
      payload
    );
  }
  function formatNumber(value) {
    return Number(value).toLocaleString("ko-KR");
  }
  function getExchangeErrorMessage(code, fallback) {
    const messages = {
      55002: "플레이크 잔액이 부족합니다",
      55018: "최저 전환 금액보다 작습니다",
      55019: "최대 전환 금액을 초과했습니다",
      55021: "플레이크 사용 일일 한도를 초과했습니다",
      55022: "플레이크 사용 월간 한도를 초과했습니다",
      55024: "포인트 적립 일일 한도를 초과했습니다",
      55025: "포인트 적립 월간 한도를 초과했습니다"
    };
    return messages[code] || fallback || "알 수 없는 오류";
  }
  async function exchangeConfiguredPoints(headers, deps = {}) {
    var _a, _b, _c;
    const {
      getBillFlakeBalance: fetchBalance = getBillFlakeBalance,
      getPointExchangeRate: fetchRate = getPointExchangeRate,
      exchangeFlakeForPoints: postExchange = exchangeFlakeForPoints,
      log: log$1 = log
    } = deps;
    if (!CONFIG.pointExchange.enabled) {
      log$1("⏭️ 포인트 교환 기능이 비활성화되어 있습니다", "info");
      return { success: false, reason: "disabled" };
    }
    const targetPoints = CONFIG.pointExchange.pointAmount;
    const expectedFlake = CONFIG.pointExchange.requiredFlakeAmount;
    log$1(`💱 ${targetPoints} 포인트 교환 준비 중...`, "info");
    const balanceResponse = await fetchBalance(headers);
    const availableFlake = extractBillFlakeBalance(balanceResponse);
    if (availableFlake !== null) {
      log$1(`  💎 현재 보유: ${formatNumber(availableFlake)} FLAKE`, "info");
    }
    const rateResponse = await fetchRate(headers);
    if (!rateResponse || rateResponse.code !== 0 || !rateResponse.value) {
      const message = getExchangeErrorMessage(rateResponse == null ? void 0 : rateResponse.code, rateResponse == null ? void 0 : rateResponse.message);
      log$1(`✗ 전환 비율 조회 실패: ${message}`, "error");
      return { success: false, reason: "rateLookupFailed", message };
    }
    const plan = createPointExchangePlan(rateResponse.value, CONFIG.pointExchange);
    log$1(`  ✓ 필요 플레이크: ${formatNumber(plan.fromAmount)} FLAKE`, "info");
    if (availableFlake !== null && availableFlake < plan.fromAmount) {
      log$1(
        `✗ 플레이크 부족: ${formatNumber(availableFlake)} / ${formatNumber(plan.fromAmount)} FLAKE`,
        "error"
      );
      return {
        success: false,
        reason: "insufficientBalance",
        availableFlake,
        requiredFlake: expectedFlake
      };
    }
    const exchangeResult = await postExchange(headers, plan);
    if (!exchangeResult || exchangeResult.code !== 0) {
      const message = getExchangeErrorMessage(exchangeResult == null ? void 0 : exchangeResult.code, exchangeResult == null ? void 0 : exchangeResult.message);
      log$1(`✗ 포인트 교환 실패: ${message}`, "error");
      return { success: false, reason: "exchangeFailed", message, code: exchangeResult == null ? void 0 : exchangeResult.code };
    }
    const exchangedAmount = ((_a = exchangeResult.value) == null ? void 0 : _a.exchanged_amount) ?? plan.pointAmount;
    const residueFlake = ((_b = exchangeResult.value) == null ? void 0 : _b.residue_mileage) ?? ((_c = exchangeResult.value) == null ? void 0 : _c.residue_flake) ?? null;
    log$1(
      `✓ ${formatNumber(exchangedAmount)} 포인트 교환 완료 (-${formatNumber(plan.fromAmount)} FLAKE)`,
      "success"
    );
    if (residueFlake !== null) {
      log$1(`  💰 잔여 FLAKE: ${formatNumber(residueFlake)}`, "info");
    }
    return {
      success: true,
      pointAmount: plan.pointAmount,
      spentFlake: plan.fromAmount,
      exchangedAmount,
      residueFlake
    };
  }
  function getCashChargeErrorMessage(code, fallback) {
    const messages = {
      54040: "로스트아크 포인트 설정을 찾을 수 없습니다"
    };
    return messages[code] || fallback || "알 수 없는 오류";
  }
  async function runPointCashChargeAllInOne(headers, deps = {}) {
    const {
      getLostArkPointBalance: fetchPointBalance = getLostArkPointBalance,
      chargeLostArkCashWithPoints: postCashCharge = chargeLostArkCashWithPoints,
      showSuccessNotice: showSuccessNotice$1 = showSuccessNotice,
      log: log$1 = log
    } = deps;
    const exchangeResult = await exchangeConfiguredPoints(headers, { ...deps, log: log$1 });
    if (!exchangeResult.success) {
      return exchangeResult;
    }
    const targetPoints = CONFIG.lostArkCashCharge.pointAmount;
    const targetCash = CONFIG.lostArkCashCharge.cashAmount;
    log$1(`💳 ${formatNumber(targetPoints)} 포인트로 ${formatNumber(targetCash)} 캐시 충전 준비 중...`, "info");
    const pointBalanceResponse = await fetchPointBalance(headers);
    if (!pointBalanceResponse || pointBalanceResponse.code !== 0) {
      const message = getCashChargeErrorMessage(pointBalanceResponse == null ? void 0 : pointBalanceResponse.code, pointBalanceResponse == null ? void 0 : pointBalanceResponse.message);
      log$1(`✗ 포인트 잔액 조회 실패: ${message}`, "error");
      return { success: false, reason: "pointBalanceLookupFailed", message };
    }
    const availablePoints = extractStovePointBalance(pointBalanceResponse);
    if (availablePoints !== null) {
      log$1(`  💰 현재 포인트: ${formatNumber(availablePoints)} P`, "info");
    }
    if (availablePoints !== null && availablePoints < targetPoints) {
      log$1(`✗ 포인트 부족: ${formatNumber(availablePoints)} / ${formatNumber(targetPoints)} P`, "error");
      return {
        success: false,
        reason: "insufficientPoints",
        availablePoints,
        requiredPoints: targetPoints
      };
    }
    const chargeResult = await postCashCharge(headers);
    if (!chargeResult || chargeResult.code !== 0) {
      const message = getCashChargeErrorMessage(chargeResult == null ? void 0 : chargeResult.code, chargeResult == null ? void 0 : chargeResult.message);
      log$1(`✗ 로스트아크 캐시 충전 실패: ${message}`, "error");
      return { success: false, reason: "cashChargeFailed", message, code: chargeResult == null ? void 0 : chargeResult.code };
    }
    const orderNo = extractLostArkOrderNo(chargeResult);
    log$1(`✓ ${targetCash} 캐시 충전 완료${orderNo ? ` (주문번호: ${orderNo})` : ""}`, "success");
    showSuccessNotice$1(`${targetCash} 캐시 충전 성공`);
    return {
      success: true,
      pointAmount: targetPoints,
      chargedCash: targetCash,
      orderNo
    };
  }
  async function runPointExchange() {
    if (state.isRunning) {
      log("⚠️ 이미 실행 중입니다", "warning");
      return;
    }
    state.isRunning = true;
    setButtonState(true);
    try {
      const headers = extractHeaders();
      await runPointCashChargeAllInOne(headers);
    } catch (error) {
      log(`✗ 올인원 충전 오류: ${error.message}`, "error");
    } finally {
      state.isRunning = false;
      setButtonState(false);
    }
  }
  const PANEL_ID$1 = "stove-quest-automation";
  const OBSERVER_OPTIONS$1 = { childList: true, subtree: true };
  function startPanelMount({
    createPanel,
    onFirstMount = () => {
    },
    document: doc = globalThis.document
  }) {
    var _a;
    if (!doc) throw new TypeError("startPanelMount requires a document");
    if (typeof createPanel !== "function") {
      throw new TypeError("startPanelMount requires createPanel()");
    }
    const existingPanel = doc.getElementById(PANEL_ID$1);
    let panel = existingPanel;
    if (!panel) panel = createPanel();
    if (!panel) throw new TypeError("createPanel() must return a panel element");
    const timerHost = doc.defaultView || globalThis;
    let stopped = false;
    let firstMountNotified = Boolean(existingPanel);
    let reconcileTimer = null;
    let observer = null;
    function isInsidePanel(node) {
      return node === panel || typeof panel.contains === "function" && panel.contains(node);
    }
    function getMountTargets() {
      const targets2 = [];
      const myHomeBody = doc.querySelector('#__nuxt [data-slot="Body"]');
      if (myHomeBody == null ? void 0 : myHomeBody.parentNode) {
        targets2.push({
          mode: "myhome",
          parent: myHomeBody.parentNode,
          before: myHomeBody
        });
      }
      const legacyContent = doc.querySelector(".inds-content-body");
      if (legacyContent) {
        targets2.push({ mode: "legacy", parent: legacyContent, before: legacyContent.firstChild });
      }
      const main = doc.querySelector("main");
      if (main) {
        targets2.push({ mode: "legacy", parent: main, before: main.firstChild });
      }
      if (doc.body) {
        targets2.push({ mode: "fallback", parent: doc.body, before: doc.body.firstChild });
      }
      return targets2;
    }
    function isAlreadyAtTarget(parent, before) {
      if (panel.parentNode !== parent) return false;
      if (before === panel) return true;
      return panel.nextSibling === before;
    }
    function isConnectedToDocument() {
      var _a2;
      if (typeof panel.isConnected === "boolean") return panel.isConnected;
      if ((_a2 = doc.documentElement) == null ? void 0 : _a2.contains(panel)) return true;
      return typeof doc.contains === "function" && doc.contains(panel);
    }
    function notifyFirstMount() {
      if (firstMountNotified || !isConnectedToDocument()) return;
      firstMountNotified = true;
      onFirstMount();
    }
    function reconcile() {
      if (stopped) return;
      for (const target of getMountTargets()) {
        const { parent, before, mode } = target;
        if (parent === panel || isInsidePanel(parent)) continue;
        if (before === panel && panel.parentNode !== parent) continue;
        if (!isAlreadyAtTarget(parent, before)) {
          panel.dataset.stoveMount = mode;
          try {
            parent.insertBefore(panel, before);
          } catch {
            continue;
          }
        } else if (panel.dataset.stoveMount !== mode) {
          panel.dataset.stoveMount = mode;
        }
        try {
          notifyFirstMount();
        } catch (error) {
          stop();
          throw error;
        }
        return;
      }
    }
    function scheduleReconcile() {
      if (stopped || reconcileTimer !== null) return;
      reconcileTimer = timerHost.setTimeout(() => {
        reconcileTimer = null;
        reconcile();
      }, 0);
    }
    function handleMutations(records) {
      if (stopped) return;
      if (records.some((record) => !isInsidePanel(record.target))) scheduleReconcile();
    }
    function handleReady() {
      scheduleReconcile();
    }
    const MutationObserverImpl = ((_a = doc.defaultView) == null ? void 0 : _a.MutationObserver) || globalThis.MutationObserver;
    if (MutationObserverImpl) {
      observer = new MutationObserverImpl(handleMutations);
      try {
        observer.observe(doc, OBSERVER_OPTIONS$1);
      } catch {
        if (doc.documentElement) observer.observe(doc.documentElement, OBSERVER_OPTIONS$1);
        else observer = null;
      }
    }
    doc.addEventListener("DOMContentLoaded", handleReady);
    reconcile();
    function stop() {
      if (stopped) return;
      stopped = true;
      if (observer) observer.disconnect();
      doc.removeEventListener("DOMContentLoaded", handleReady);
      if (reconcileTimer !== null) {
        timerHost.clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
    }
    return stop;
  }
  const WATCHER_KEY = Symbol.for("stove.myhomeNoticeDismissal");
  const PANEL_ID = "stove-quest-automation";
  const GUIDE_SELECTOR = ".driver-popover.myhome-coachmark-popover";
  const BADGE_SELECTOR = '[role="tooltip"][id^="badge-tooltip-"]';
  const MAX_CLICKS_PER_NOTICE = 2;
  const OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "disabled", "aria-disabled", "aria-hidden", "inert"]
  };
  function startMyHomeNoticeDismissal({
    document: doc = globalThis.document,
    settleDelayMs = 600
  } = {}) {
    var _a;
    if (!doc) throw new TypeError("startMyHomeNoticeDismissal requires a document");
    const existingWatcher = doc[WATCHER_KEY];
    if (existingWatcher && !existingWatcher.stopped && typeof existingWatcher.stop === "function") {
      return existingWatcher.stop;
    }
    const delay2 = Number.isFinite(Number(settleDelayMs)) ? Math.max(0, Number(settleDelayMs)) : 600;
    const timerHost = doc.defaultView || globalThis;
    const lifecycle = { stopped: false, stop: null };
    let observer = null;
    let scanTimer = null;
    const guideAttempts = /* @__PURE__ */ new WeakMap();
    const badgeAttempts = /* @__PURE__ */ new WeakMap();
    function isInsideAutomationPanel(node) {
      const panel = doc.getElementById(PANEL_ID);
      return Boolean(panel && (node === panel || panel.contains(node)));
    }
    function isVisible(element) {
      var _a2, _b, _c, _d, _e;
      if (!element || !((_a2 = doc.documentElement) == null ? void 0 : _a2.contains(element))) return false;
      for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
        if (current.hidden || current.hasAttribute("hidden")) return false;
        if (((_b = current.getAttribute("aria-hidden")) == null ? void 0 : _b.trim().toLowerCase()) === "true") return false;
        const style = getComputedStyleFor(current);
        const display = (style == null ? void 0 : style.display) || ((_c = current.style) == null ? void 0 : _c.display);
        const visibility = (style == null ? void 0 : style.visibility) || ((_d = current.style) == null ? void 0 : _d.visibility);
        const opacity = (style == null ? void 0 : style.opacity) || ((_e = current.style) == null ? void 0 : _e.opacity);
        if ((display == null ? void 0 : display.toLowerCase()) === "none") return false;
        if ((visibility == null ? void 0 : visibility.toLowerCase()) === "hidden" || (visibility == null ? void 0 : visibility.toLowerCase()) === "collapse") return false;
        if (opacity !== void 0 && opacity !== "") {
          const numericOpacity = Number.parseFloat(opacity);
          if (Number.isFinite(numericOpacity) && numericOpacity <= 0) return false;
        }
      }
      return true;
    }
    function getComputedStyleFor(element) {
      var _a2;
      try {
        return (_a2 = timerHost.getComputedStyle) == null ? void 0 : _a2.call(timerHost, element);
      } catch {
        return null;
      }
    }
    function isEnabled(element) {
      var _a2;
      for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
        if (current.disabled === true) return false;
        if (((_a2 = current.getAttribute("aria-disabled")) == null ? void 0 : _a2.trim().toLowerCase()) === "true") return false;
        if (current.inert === true || current.hasAttribute("inert")) return false;
      }
      return true;
    }
    function canClick(element) {
      var _a2, _b;
      if (!isVisible(element) || !isEnabled(element)) return false;
      return ((_b = (_a2 = getComputedStyleFor(element)) == null ? void 0 : _a2.pointerEvents) == null ? void 0 : _b.toLowerCase()) !== "none";
    }
    function firstActionable(container, selector) {
      for (const element of container.querySelectorAll(selector)) {
        if (canClick(element) && typeof element.click === "function") return element;
      }
      return null;
    }
    function findGuideButton(popover) {
      return firstActionable(popover, ".driver-popover-close-btn") || firstActionable(popover, ".driver-popover-done-btn") || firstActionable(popover, ".driver-popover-next-btn");
    }
    function getKnownGuideStep(popover) {
      for (const step of ["myhome-coachmark-step-1", "myhome-coachmark-step-2"]) {
        if (popover.classList.contains(step)) return step;
      }
      return null;
    }
    function findBadgeCloseButton(tooltip) {
      var _a2;
      for (const button of tooltip.querySelectorAll("button[aria-label]")) {
        const label = (_a2 = button.getAttribute("aria-label")) == null ? void 0 : _a2.trim().toLowerCase();
        if ((label === "닫기" || label === "close") && canClick(button) && typeof button.click === "function") {
          return button;
        }
      }
      return null;
    }
    function clickAndWait(button) {
      button.click();
      scheduleScan(delay2);
    }
    function scan() {
      if (lifecycle.stopped) return;
      const visibleGuides = [...doc.querySelectorAll(GUIDE_SELECTOR)].filter(isVisible);
      if (visibleGuides.length > 0) {
        const guide = visibleGuides.find(getKnownGuideStep);
        if (!guide) {
          return;
        }
        const step = getKnownGuideStep(guide);
        let attemptsByStep = guideAttempts.get(guide);
        if (!attemptsByStep) {
          attemptsByStep = /* @__PURE__ */ new Map();
          guideAttempts.set(guide, attemptsByStep);
        }
        const state2 = attemptsByStep.get(step) || { clicks: 0 };
        attemptsByStep.set(step, state2);
        const button = findGuideButton(guide);
        if (button && state2.clicks < MAX_CLICKS_PER_NOTICE) {
          state2.clicks += 1;
          clickAndWait(button);
        }
        return;
      }
      const visibleBadges = [...doc.querySelectorAll(BADGE_SELECTOR)].filter(isVisible);
      for (const tooltip of visibleBadges) {
        const button = findBadgeCloseButton(tooltip);
        if (!button) continue;
        const state2 = badgeAttempts.get(tooltip) || { clicks: 0 };
        if (state2.clicks >= MAX_CLICKS_PER_NOTICE) continue;
        state2.clicks += 1;
        badgeAttempts.set(tooltip, state2);
        clickAndWait(button);
        return;
      }
    }
    function scheduleScan(waitMs = delay2, resetPending = false) {
      if (lifecycle.stopped) return;
      if (scanTimer !== null) {
        if (!resetPending) return;
        timerHost.clearTimeout(scanTimer);
      }
      scanTimer = timerHost.setTimeout(() => {
        scanTimer = null;
        scan();
      }, waitMs);
    }
    function handleMutations(records) {
      if (lifecycle.stopped) return;
      if (records.some((record) => !isInsideAutomationPanel(record.target))) scheduleScan(delay2);
    }
    function handleReady() {
      scheduleScan(delay2, true);
    }
    function stop() {
      if (lifecycle.stopped) return;
      lifecycle.stopped = true;
      if (observer) observer.disconnect();
      doc.removeEventListener("DOMContentLoaded", handleReady);
      if (scanTimer !== null) {
        timerHost.clearTimeout(scanTimer);
        scanTimer = null;
      }
      if (doc[WATCHER_KEY] === lifecycle) delete doc[WATCHER_KEY];
    }
    lifecycle.stop = stop;
    Object.defineProperty(doc, WATCHER_KEY, {
      configurable: true,
      value: lifecycle
    });
    const MutationObserverImpl = ((_a = doc.defaultView) == null ? void 0 : _a.MutationObserver) || globalThis.MutationObserver;
    if (MutationObserverImpl) {
      observer = new MutationObserverImpl(handleMutations);
      try {
        observer.observe(doc, OBSERVER_OPTIONS);
      } catch {
        if (doc.documentElement) {
          try {
            observer.observe(doc.documentElement, OBSERVER_OPTIONS);
          } catch {
            observer.disconnect();
            observer = null;
          }
        } else {
          observer.disconnect();
          observer = null;
        }
      }
    }
    doc.addEventListener("DOMContentLoaded", handleReady);
    scheduleScan(delay2, true);
    return stop;
  }
  function panelMarkup() {
    return `
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
                min-width: 0;
                box-sizing: border-box;
            }
            #stove-quest-automation[data-stove-mount="myhome"] {
                width: calc(100% - 40px);
                max-width: 1300px;
                margin: 24px auto;
                flex: 0 0 auto;
            }
            #stove-quest-automation[data-stove-mount="fallback"] {
                margin-top: 96px;
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
                min-width: 0;
                flex-wrap: wrap;
            }
            .stove-panel-title { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
            .stove-panel-version {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                font-size: 11px;
                font-weight: normal;
                color: #888888;
                line-height: 1.4;
                font-family: 'Courier New', monospace;
                min-width: 0;
                overflow-wrap: anywhere;
            }
            .stove-controls {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
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
                min-width: 0;
                overflow-wrap: anywhere;
            }
            .stove-controls > * { min-width: 0; }
            .stove-btn-main,
            .stove-btn-sub {
                display: block;
                line-height: 1.35;
            }
            .stove-btn-sub {
                margin-top: 2px;
                font-size: 12px;
                color: #a7f3d0;
                font-weight: 500;
            }
            .stove-btn-note {
                display: block;
                margin-top: 4px;
                font-size: 11px;
                color: #fbbf24;
                font-weight: 500;
                line-height: 1.3;
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
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }
            .stove-task {
                background: #1a1a1a;
                border: 1px solid #2a2a2a;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 14px;
                color: #d0d0d0;
                min-width: 0;
                overflow-wrap: anywhere;
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
                gap: 8px;
                min-width: 0;
            }
            .stove-status-label { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
            .stove-status-value { font-family: 'Courier New', monospace; min-width: 0; overflow-wrap: anywhere; text-align: right; }
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
            .stove-success-notice {
                background: #064e3b;
                border: 1px solid #10b981;
                border-radius: 8px;
                color: #d1fae5;
                font-size: 14px;
                font-weight: 700;
                margin-bottom: 16px;
                padding: 12px 14px;
                text-align: center;
                transition: opacity 0.3s ease, transform 0.3s ease;
            }
            .stove-success-notice--hide {
                opacity: 0;
                transform: translateY(-6px);
            }
            @media (max-width: 720px) {
                #stove-quest-automation[data-stove-mount="myhome"] { width: calc(100% - 24px); }
                .stove-controls,
                .stove-task-list { grid-template-columns: minmax(0, 1fr); }
                .stove-panel-header { align-items: flex-start; }
                .stove-panel-version { align-items: flex-start; }
                .stove-status-header,
                .stove-log-header { flex-wrap: wrap; gap: 8px; }
                .stove-mission-tooltip {
                    min-width: 0;
                    width: min(400px, calc(100vw - 48px));
                    max-width: calc(100vw - 48px);
                }
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
            <button id="stove-btn-point-cash-charge" class="stove-btn" disabled title="192,500 플레이크 이상일 때 충전 가능">
                <span class="stove-btn-main">💱 7700 캐시 충전</span>
                <span class="stove-btn-sub">(192,500 플레이크)</span>
                <span class="stove-btn-note" id="stove-btn-point-cash-charge-status">플레이크 확인 중</span>
            </button>
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
                    <span class="stove-status-label">🔥 부스트 미션</span>
                    <span class="stove-status-value" id="stove-status-boost">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">🎁 오늘의 1등 보상</span>
                    <span class="stove-status-value" id="stove-status-boost-reward">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">🎯 부스트 선택 글</span>
                    <span class="stove-status-value" id="stove-status-boost-target">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">💬 게임 리뷰 이벤트</span>
                    <span class="stove-status-value" id="stove-status-review-event">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">📅 리뷰 이벤트 기간</span>
                    <span class="stove-status-value" id="stove-status-review-period">-</span>
                </div>
                <div class="stove-status-item">
                    <span class="stove-status-label">🎯 이벤트 대상 리뷰</span>
                    <span class="stove-status-value" id="stove-status-review-target">-</span>
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
  }
  const ACTION_BUTTONS = [
    ["stove-btn-start", runAutomation],
    ["stove-btn-point-cash-charge", runPointExchange],
    ["stove-btn-reward-shop", openRewardShop],
    ["stove-btn-status-refresh", checkAllStatus]
  ];
  function createUI() {
    const container = document.createElement("div");
    container.id = "stove-quest-automation";
    container.innerHTML = panelMarkup();
    return container;
  }
  function initializeUI() {
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
    const attachListener = (id2, handler) => {
      const element = document.getElementById(id2);
      if (element) {
        element.addEventListener("click", handler);
      } else {
        console.warn(`[이벤트 등록] ${id2} 버튼을 찾을 수 없습니다`);
      }
    };
    {
      ACTION_BUTTONS.forEach(([id2, handler]) => attachListener(id2, handler));
      updatePointCashChargeButtonAvailability(null);
      log("자동화 패널이 준비되었습니다", "info");
    }
    attachListener("stove-btn-copy-log", copyLogToClipboard);
    setTimeout(() => {
      checkAllStatus();
    }, 500);
  }
  function init() {
    console.log("[STOVE Automation] Initializing...");
    const mountPanel = () => {
      startMyHomeNoticeDismissal();
      startPanelMount({
        createPanel: createUI,
        onFirstMount: initializeUI
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mountPanel, { once: true });
    } else {
      mountPanel();
    }
  }
  init();

})();