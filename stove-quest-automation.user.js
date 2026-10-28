// ==UserScript==
// @name         STOVE Quest Automation
// @namespace    https://profile.onstove.com/
// @version      3.0.1
// @author       prohyeon
// @description  STOVE 자동화 (미션, 설문 투표, 룰렛, 데일리 보상)
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
    version: "3.0.1",
    lastUpdated: "2026-10-28",
    debug: false,
    maintenanceMode: {
      enabled: false,
      startDate: "2025-11-01",
      message: "11월 플레이크 구조 확인중입니다, 업데이트 이후 사용할 수 있습니다"
    },
    api: {
      baseUrl: "https://api.onstove.com"
    },
    delays: {
      betweenActions: 200
    },
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
  const COLORS = { success: "#34d399", error: "#f87171", info: "#60a5fa", warning: "#fbbf24" };
  const DECORATIVE = new RegExp("(?:\\p{Extended_Pictographic}️?|‍|✓|✗)+ ?", "gu");
  const TIMING_OPEN = "";
  const TIMING_CLOSE = "";
  const timingText = (text) => `${TIMING_OPEN}${text}${TIMING_CLOSE}`;
  function decodeHtmlEntities(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
      if (name[0] === "#") {
        const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code <= 1114111 ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    });
  }
  function displayText(text) {
    return decodeHtmlEntities(text).replace(DECORATIVE, "");
  }
  function appendMessage(entry, message) {
    const pattern = new RegExp(`(${TIMING_OPEN}[^${TIMING_CLOSE}]*${TIMING_CLOSE})`);
    for (const part of String(message).split(pattern)) {
      if (!part) continue;
      if (part.startsWith(TIMING_OPEN) && part.endsWith(TIMING_CLOSE)) {
        const span = document.createElement("span");
        span.className = "log-timing";
        span.textContent = displayText(part.slice(1, -1));
        entry.appendChild(span);
      } else {
        entry.appendChild(document.createTextNode(displayText(part)));
      }
    }
  }
  function log(message, type = "info", options = {}) {
    const logContent = document.getElementById("stove-log-content");
    if (!logContent) return;
    const entry = document.createElement("div");
    entry.style.color = COLORS[type];
    entry.style.borderLeftColor = COLORS[type];
    entry.dataset.type = type;
    if (options.timing) entry.dataset.timing = "true";
    appendMessage(entry, message);
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
    const day = String(kstTime.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
        dailyAccumulated: 0
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
  function setButtonState(running) {
    const btnIds = ["stove-btn-start", "stove-btn-reward-shop", "stove-btn-status-refresh"];
    for (const id of btnIds) {
      const btn = document.getElementById(id);
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
  const SNAPSHOT_CATEGORIES = ["daily", "content", "weekly", "banner", "attendance", "survey", "other"];
  const COMPLETE_STATUSES$1 = /* @__PURE__ */ new Set(["COMPLETE", "COMPLETED"]);
  const DONE_STATUSES = /* @__PURE__ */ new Set(["COMPLETE", "COMPLETED"]);
  const defaultServices = {
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
      missionComponents,
      rawRouletteResult,
      rawRouletteExtraResult,
      rawShopResult,
      rawMajakResult,
      flakeTotal,
      flakeMonthly
    ] = await Promise.all([
      settle("missions", () => services2.getAllDailyMissions(headers)),
      settle("roulette", () => services2.getRouletteParticipationCount(headers, services2.getRouletteSubEventNo())),
      settle("rouletteExtra", () => services2.getRouletteExtra(headers, services2.getRouletteExtraSubEventNo())),
      settle("shop", () => services2.getDailyShopRewards(headers)),
      settle("majak", () => services2.getMajakDailyShopRewards(headers)),
      settle("flakeTotal", () => services2.getTotalFlakeBalance(headers)),
      settle("flakeMonthly", () => services2.getMonthlyFlakeTotal(headers))
    ]);
    const rouletteResult = validateRouletteResult(rawRouletteResult);
    const rouletteExtraResult = validateRouletteExtraResult(rawRouletteExtraResult);
    const shopResult = validateAttendanceShopResult("shop", rawShopResult);
    const majakResult = validateAttendanceShopResult("majak", rawMajakResult);
    let missionsError = null;
    if (missionComponents.ok && !Array.isArray(missionComponents.value)) {
      missionsError = makeSnapshotError("missions", "Missions payload was not an array");
    } else if (missionComponents.ok && Object.hasOwn(errors, "missionComponents") && Array.isArray(missionComponents.value) && missionComponents.value.length === 0) {
      missionsError = makeSnapshotError("missions", "Missions payload was empty after component refresh failed");
    }
    const sectionResults = {
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
    const missions = missionComponents.ok && !missionsError ? normalizeMissionSnapshot(missionComponents.value, { missionComponents: missionComponentIds }) : failedSection(missionComponents.error || missionsError, {
      categories: emptyCategories(),
      byMissionNo: {}
    });
    return {
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      degraded: Object.keys(errors).length > 0,
      errors,
      missions,
      roulette: normalizeRoulette(rouletteResult),
      rouletteExtra: normalizeRouletteExtra(rouletteExtraResult),
      shop: normalizeShop(shopResult),
      majak: normalizeShop(majakResult),
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const plannedMissionNos = plan.plannedMissionNos || [];
    const afterMissions = ((_a = after == null ? void 0 : after.missions) == null ? void 0 : _a.byMissionNo) || {};
    const incompleteMissionNos = plannedMissionNos.filter((missionNo) => {
      const mission = afterMissions[missionNo];
      return !mission || !DONE_STATUSES.has(mission.status);
    });
    return {
      rouletteStillRemaining: (((_b = after == null ? void 0 : after.roulette) == null ? void 0 : _b.remaining) || 0) > 0,
      incompleteMissionNos,
      unclaimedDailyShop: ((_d = (_c = after == null ? void 0 : after.shop) == null ? void 0 : _c.unclaimedDaily) == null ? void 0 : _d.length) || 0,
      unclaimedMajakShop: ((_f = (_e = after == null ? void 0 : after.majak) == null ? void 0 : _e.unclaimedDaily) == null ? void 0 : _f.length) || 0,
      claimableExtra: ((_h = (_g = after == null ? void 0 : after.rouletteExtra) == null ? void 0 : _g.claimable) == null ? void 0 : _h.length) || 0,
      monthlyAttendanceProgress: compareMonthlyAttendanceProgress(before, after)
    };
  }
  function getSnapshotSummary(snapshot) {
    var _a, _b;
    const missions = Object.values(((_a = snapshot == null ? void 0 : snapshot.missions) == null ? void 0 : _a.byMissionNo) || {});
    return {
      rouletteRemaining: ((_b = snapshot == null ? void 0 : snapshot.roulette) == null ? void 0 : _b.remaining) || 0,
      missions: {
        complete: missions.filter((mission) => COMPLETE_STATUSES$1.has(mission.status)).length,
        receivable: missions.filter((mission) => mission.status === "RECEIVABLE").length,
        incomplete: missions.filter((mission) => mission.status === "INCOMPLETE").length
      }
    };
  }
  function task(id, kind, meta = {}) {
    return { id, kind, ...meta };
  }
  function group(id, concurrency, tasks) {
    const filteredTasks = tasks.filter(Boolean);
    if (filteredTasks.length === 0) return null;
    return { id, concurrency, tasks: filteredTasks };
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
  function shouldSchedulePrizeEntry(snapshot) {
    var _a;
    if (!isSectionKnown(snapshot == null ? void 0 : snapshot.missions)) return false;
    return ((_a = getPrizeEntryMission$1(snapshot)) == null ? void 0 : _a.status) === "INCOMPLETE";
  }
  function buildAutomationPlan(snapshot = {}) {
    var _a, _b;
    const plannedMissionNos = getVisitMissionNos(snapshot);
    const skippedDone = Object.keys(MISSION_TASK_CATEGORIES).filter((kind) => isCategoryDone(snapshot, MISSION_TASK_CATEGORIES[kind]));
    const missionTask = (id, kind, meta) => skippedDone.includes(kind) ? null : task(id, kind, meta);
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
      group("visits", plannedMissionNos.length > 0 ? 1 : 4, [
        plannedMissionNos.length > 0 ? task("visits:singleVisits", "singleVisits", { missionNos: plannedMissionNos }) : null,
        missionTask("visits:dailyMissions", "dailyMissions"),
        missionTask("visits:contentMissions", "contentMissions"),
        missionTask("visits:bannerMissions", "bannerMissions")
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
      ])
    ]);
    return { plannedMissionNos, groups, skippedDone };
  }
  function buildRepairPlan(diff = {}) {
    const plannedMissionNos = diff.incompleteMissionNos || [];
    const tasks = [
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
  function shortTaskId(id) {
    return String(id).split(":").pop();
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
      startGroup(id) {
        groupStartedAt.set(id, now());
      },
      /** Elapsed ms since startGroup(id); recorded under `section` unless it is null. */
      endGroup(section, id) {
        const begin = groupStartedAt.get(id) ?? now();
        return record(section, id, now() - begin);
      },
      record,
      /** Launches a task ahead of its group (e.g. comments) and times it from that launch. */
      track(id, launch) {
        const begin = now();
        const promise = launch();
        const settle = () => {
          taskMs.set(id, now() - begin);
        };
        tracked.add(id);
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
      taskMs(id) {
        return taskMs.get(id);
      },
      /** " · 1.2초", plus per-task times when more than one foreground task ran. */
      groupSuffix(ms, results = []) {
        const timed = results.filter((result) => result.status !== "background" && taskMs.has(result.id)).map((result) => `${shortTaskId(result.id)} ${formatSeconds(taskMs.get(result.id))}`);
        return ` · ${formatSeconds(ms)}${timed.length > 1 ? ` (${timed.join(" · ")})` : ""}`;
      },
      summaryLines() {
        const lines = [`소요 시간 · 총 ${formatSeconds(now() - startedAt)}`];
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
  function services$3(deps = {}) {
    return {
      getRouletteParticipationCount,
      executeRouletteDraw,
      getRouletteExtra,
      claimRouletteExtra,
      delay,
      log,
      ...deps
    };
  }
  async function runRouletteDraws(headers, deps = {}) {
    var _a, _b;
    const io = services$3(deps);
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
        return netProfit;
      }
    } catch (e) {
      io.log(`✗ 룰렛 실행 실패: ${e.message}`, "error");
    }
    state.completed.roulette = true;
    io.log("✅ 룰렛 실행 완료!", "success");
    return 0;
  }
  async function claimRouletteExtraRewards(headers, deps = {}) {
    var _a;
    const io = services$3(deps);
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
  function services$2(deps = {}) {
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
    const io = services$2(deps);
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
    io.log("✅ 데일리 보상 처리 완료!", "success");
    return dailyFlakeEarned;
  }
  async function claimMajakDailyShopRewards(headers, deps = {}) {
    var _a;
    const io = services$2(deps);
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
    io.log("✅ 마작 리워드 처리 완료!", "success");
    return majakFlakeEarned;
  }
  async function claimDailyAccumulatedRewards(headers, deps = {}) {
    var _a, _b, _c;
    const io = services$2(deps);
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
  const COMPLETE_STATUSES = /* @__PURE__ */ new Set(["COMPLETE", "COMPLETED"]);
  function services$1(deps = {}) {
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
    const io = services$1(deps);
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
    const io = services$1(deps);
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
    const io = services$1(deps);
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
    const io = services$1(deps);
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
    const io = services$1(deps);
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
    const io = services$1(deps);
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
    const io = services$1(deps);
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
    const io = services$1(deps);
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
    const io = services$1(options.deps);
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
  function updateStatusUI(statusData) {
    var _a, _b, _c, _d;
    if (statusData.dailyMission) {
      if (statusData.dailyMission.loading) {
        ["daily", "weekly", "content", "attendance"].forEach((cat) => {
          const el = document.getElementById(`stove-status-mission-${cat}`);
          if (el) el.innerHTML = '<span style="color: #3b82f6">확인 중</span>';
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
                statusHTML = `<span style="color: #f59e0b">보상 ${receivable}개</span>`;
              } else {
                statusHTML = '<span style="color: #6b7280">-</span>';
              }
            } else {
              if (completed === total) {
                statusHTML = '<span style="color: #10b981">완료</span>';
              } else if (receivable > 0) {
                statusHTML = `<span style="color: #f59e0b">보상 ${receivable}개</span>`;
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
              const catLabel = catKey === "daily" ? "데일리 미션" : catKey === "weekly" ? "위클리 미션" : catKey === "content" ? "컨텐츠" : "월간 출석";
              let tooltipHTML = `<div class="stove-mission-tooltip-title">${catLabel}</div>`;
              missions.forEach((mission) => {
                const statusIcon = mission.status === "COMPLETE" || mission.status === "COMPLETED" ? "완료" : mission.status === "RECEIVABLE" ? "보상" : "진행";
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
          if (el) el.innerHTML = '<span style="color: #ef4444">실패</span>';
        });
      }
    }
    const rouletteEl = document.getElementById("stove-status-roulette");
    if (rouletteEl && statusData.roulette) {
      if (statusData.roulette.loading) {
        rouletteEl.innerHTML = '<span style="color: #3b82f6">확인 중...</span>';
      } else if (statusData.roulette.success) {
        const { current, limit, remaining } = statusData.roulette;
        const color = remaining > 0 ? "#10b981" : "#6b7280";
        rouletteEl.innerHTML = `<span style="color: ${color}">${current}/${limit} (${remaining}회 남음)</span>`;
      } else {
        rouletteEl.innerHTML = '<span style="color: #ef4444">확인 실패</span>';
      }
    }
    const dailyShopEl = document.getElementById("stove-status-daily");
    if (dailyShopEl && statusData.dailyShop) {
      if (statusData.dailyShop.loading) {
        dailyShopEl.innerHTML = '<span style="color: #3b82f6">확인 중...</span>';
      } else if (statusData.dailyShop.success) {
        const { received, notReceived, noRewardToday } = statusData.dailyShop;
        if (received) {
          dailyShopEl.innerHTML = '<span style="color: #10b981">전부 완료</span>';
        } else if (notReceived) {
          dailyShopEl.innerHTML = '<span style="color: #f59e0b">보상 미수령</span>';
        } else if (noRewardToday) {
          dailyShopEl.innerHTML = '<span style="color: #9ca3af">오늘 보상 없음</span>';
        } else {
          dailyShopEl.innerHTML = '<span style="color: #6b7280">-</span>';
        }
      } else {
        dailyShopEl.innerHTML = '<span style="color: #ef4444">확인 실패</span>';
      }
    }
    const majakShopEl = document.getElementById("stove-status-majak");
    if (majakShopEl && statusData.majakShop) {
      if (statusData.majakShop.loading) {
        majakShopEl.innerHTML = '<span style="color: #3b82f6">확인 중...</span>';
      } else if (statusData.majakShop.success) {
        const { received, notReceived, noRewardToday } = statusData.majakShop;
        if (received) {
          majakShopEl.innerHTML = '<span style="color: #10b981">전부 완료</span>';
        } else if (notReceived) {
          majakShopEl.innerHTML = '<span style="color: #f59e0b">보상 미수령</span>';
        } else if (noRewardToday) {
          majakShopEl.innerHTML = '<span style="color: #9ca3af">오늘 보상 없음</span>';
        } else {
          majakShopEl.innerHTML = '<span style="color: #6b7280">-</span>';
        }
      } else {
        majakShopEl.innerHTML = '<span style="color: #ef4444">확인 실패</span>';
      }
    }
    const surveyEl = document.getElementById("stove-status-survey");
    if (surveyEl && statusData.survey) {
      if (statusData.survey.loading) {
        surveyEl.innerHTML = '<span style="color: #3b82f6">확인 중...</span>';
      } else if (statusData.survey.success) {
        const { notAvailable, noMissions, completed, receivable, total, allCompleted } = statusData.survey;
        if (notAvailable) {
          surveyEl.innerHTML = '<span style="color: #6b7280">비활성화</span>';
        } else if (noMissions) {
          surveyEl.innerHTML = '<span style="color: #6b7280">미션 없음</span>';
        } else if (allCompleted) {
          surveyEl.innerHTML = '<span style="color: #10b981">전부 완료</span>';
        } else if (receivable > 0) {
          surveyEl.innerHTML = `<span style="color: #f59e0b">투표 가능 ${receivable}개</span>`;
        } else if (completed > 0) {
          surveyEl.innerHTML = `<span style="color: #6b7280">${completed}/${total}</span>`;
        } else {
          surveyEl.innerHTML = '<span style="color: #6b7280">-</span>';
        }
      } else {
        surveyEl.innerHTML = '<span style="color: #ef4444">확인 실패</span>';
      }
    }
    const totalFlakeEl = document.getElementById("stove-status-total-flake");
    if (totalFlakeEl && statusData.totalFlake !== void 0) {
      if ((_a = statusData.totalFlake) == null ? void 0 : _a.loading) {
        totalFlakeEl.innerHTML = '<span style="color: #3b82f6">확인 중...</span>';
      } else if ((_b = statusData.totalFlake) == null ? void 0 : _b.error) {
        totalFlakeEl.innerHTML = '<span style="color: #ef4444">확인 실패</span>';
      } else {
        totalFlakeEl.innerHTML = `<span style="color: #10b981">${statusData.totalFlake.toLocaleString()} F</span>`;
      }
    }
    const monthlyFlakeEl = document.getElementById("stove-status-monthly-flake");
    if (monthlyFlakeEl && statusData.monthlyFlake !== void 0) {
      if ((_c = statusData.monthlyFlake) == null ? void 0 : _c.loading) {
        monthlyFlakeEl.innerHTML = '<span style="color: #3b82f6">확인 중...</span>';
      } else if ((_d = statusData.monthlyFlake) == null ? void 0 : _d.error) {
        monthlyFlakeEl.innerHTML = '<span style="color: #ef4444">확인 실패</span>';
      } else {
        monthlyFlakeEl.innerHTML = `<span style="color: #10b981">+${statusData.monthlyFlake.toLocaleString()} F</span>`;
      }
    }
  }
  const STATUS_KEYS = ["dailyMission", "roulette", "dailyShop", "majakShop", "survey"];
  const BALANCE_KEYS = ["totalFlake", "monthlyFlake"];
  function services(deps = {}) {
    return {
      getRouletteParticipationCount,
      getDailyShopRewards,
      getMajakDailyShopRewards,
      apiRequest,
      getAllDailyMissions,
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
    const io = services(deps);
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
    const io = services(deps);
    return checkTodayAttendanceStatus(io, () => io.getDailyShopRewards(headers));
  }
  async function checkMajakShopStatus(headers, deps = {}) {
    const io = services(deps);
    return checkTodayAttendanceStatus(io, () => io.getMajakDailyShopRewards(headers));
  }
  async function checkSurveyStatus(headers, deps = {}) {
    var _a;
    const io = services(deps);
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
    const io = services(deps);
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
      const [dailyMissionStatus, rouletteStatus, dailyShopStatus, majakShopStatus, surveyStatus, totalFlake, monthlyFlake] = await Promise.all([
        checkDailyMissionStatus(headers),
        checkRouletteStatus(headers),
        checkDailyShopStatus(headers),
        checkMajakShopStatus(headers),
        checkSurveyStatus(headers),
        getTotalFlakeBalance(headers),
        getMonthlyFlakeTotal(headers)
      ]);
      updateStatusUI({
        dailyMission: dailyMissionStatus,
        roulette: rouletteStatus,
        dailyShop: dailyShopStatus,
        majakShop: majakShopStatus,
        survey: surveyStatus,
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
      ...deps
    };
  }
  function createAutomationTaskHandlers({ headers, allTabs = [], deps = {} }) {
    const io = taskServices(deps);
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
      (diff.incompleteMissionNos || []).length > 0 || diff.unclaimedDailyShop > 0 || diff.unclaimedMajakShop > 0 || diff.claimableExtra > 0
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
    preRegistrationResult,
    rouletteEnabled = CONFIG.roulette.enabled
  }) {
    var _a;
    const issues = [];
    const failedTasks = flattenTaskResults(groupResults).filter(isFailedTask);
    if (failedTasks.length > 0) issues.push(`작업 실패 ${failedTasks.length}개`);
    if (snapshot == null ? void 0 : snapshot.degraded) issues.push("최종 상태 확인 불가");
    if (hasSafeRepairableItems(diff)) issues.push("미션·보상 미완료");
    if (hasMonthlyAttendanceVerificationIssue(diff)) issues.push("월간출석 확인 필요");
    const roulettePlanned = (_a = plan == null ? void 0 : plan.groups) == null ? void 0 : _a.some((group2) => {
      var _a2;
      return (_a2 = group2.tasks) == null ? void 0 : _a2.some((task2) => task2.kind === "rouletteDraws");
    });
    if (rouletteEnabled && roulettePlanned && (diff == null ? void 0 : diff.rouletteStillRemaining)) {
      issues.push("룰렛 미완료");
    }
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
      `${label}: 룰렛 ${summary.rouletteRemaining}회, 미션 완료 ${summary.missions.complete}/수령가능 ${summary.missions.receivable}/미완료 ${summary.missions.incomplete}`,
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
      `${label}: 미션 ${diff.incompleteMissionNos.length}개, 데일리 ${diff.unclaimedDailyShop}개, 마작 ${diff.unclaimedMajakShop}개, EXTRA ${diff.claimableExtra}개, ${formatMonthlyAttendanceProgress(diff.monthlyAttendanceProgress)}`,
      hasSnapshotDiffWarning(diff) ? "warning" : "success"
    );
  }
  const SNAPSHOT_SECTION_ORDER = [
    "missions",
    "roulette",
    "rouletteExtra",
    "shop",
    "majak",
    "flakeTotal",
    "flakeMonthly"
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
    var _a, _b, _c;
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
    const logSection = document.querySelector(".stove-log-section");
    if (logSection) {
      const rect = logSection.getBoundingClientRect();
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
      log("월간 출석 기록 불러오는 중...", "info");
      const endMonthlyContext = timing.start("준비", "월간 출석 기록");
      let monthlyAttendanceContext;
      try {
        monthlyAttendanceContext = await loadMonthlyAttendanceContext(headers).then((context) => {
          endMonthlyContext();
          return context;
        });
      } catch (error) {
        await beforeSnapshotTask;
        throw error;
      }
      const beforeSnapshot = await beforeSnapshotTask;
      logSnapshotSummary("초기 스냅샷", beforeSnapshot);
      addSnapshotDetail(timing, "초기 스냅샷 세부", beforeSections.sections);
      const compareWithAttendanceRecord = (snapshot) => applyMonthlyAttendanceRecord(
        compareSnapshots(beforeSnapshot, snapshot, plan),
        snapshot,
        monthlyAttendanceContext
      );
      const plan = buildAutomationPlan(beforeSnapshot);
      if (plan.skippedDone.length > 0) {
        for (const kind of plan.skippedDone) state.completed[kind] = true;
        log(`오늘 이미 완료되어 건너뜀: ${plan.skippedDone.join(", ")}`, "info");
      }
      const handlers = createAutomationTaskHandlers({ headers, allTabs });
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
          const elapsed = timingText(timing.groupSuffix(timing.endGroup("그룹", group2.id), results));
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
                const elapsed = timingText(timing.groupSuffix(timing.endGroup(null, `repair:${group2.id}`), results));
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
        preRegistrationResult
      });
      const dailyAccumulatedFlake = state.earnings.dailyAccumulated || 0;
      let totalEarnings = (state.earnings.roulette || 0) + (state.earnings.rouletteExtra || 0) + (state.earnings.dailyShop || 0) + (state.earnings.majak || 0) + (state.earnings.dailyMissions || 0) + (state.earnings.visitMissions || 0) + (state.earnings.contentMissions || 0) + (state.earnings.weeklyMissions || 0) + (state.earnings.bannerMissions || 0) + (state.earnings.attendanceMissions || 0) + (state.earnings.surveyMissions || 0) + (state.earnings.prizeEntry || 0) + (dailyAccumulatedFlake || 0);
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
      log(`  📋 데일리 미션: ${state.earnings.dailyMissions} FLAKE`, state.earnings.dailyMissions > 0 ? "success" : "info");
      const visitMissionFlake = state.earnings.visitMissions || 0;
      log(`  🚶 방문 미션: ${visitMissionFlake} FLAKE`, visitMissionFlake > 0 ? "success" : "info");
      log(`  📰 컨텐츠 미션: ${state.earnings.contentMissions} FLAKE`, state.earnings.contentMissions > 0 ? "success" : "info");
      log(`  📅 위클리 미션: ${state.earnings.weeklyMissions} FLAKE`, state.earnings.weeklyMissions > 0 ? "success" : "info");
      log(`  🎨 배너 미션: ${state.earnings.bannerMissions} FLAKE`, state.earnings.bannerMissions > 0 ? "success" : "info");
      log(`  📆 출석 미션: ${state.earnings.attendanceMissions} FLAKE`, state.earnings.attendanceMissions > 0 ? "success" : "info");
      log(`  📊 설문조사: ${state.earnings.surveyMissions} FLAKE`, state.earnings.surveyMissions > 0 ? "success" : "info");
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
      state.completed.roulette = ((_a = afterSnapshot.roulette) == null ? void 0 : _a.success) === true && (!CONFIG.roulette.enabled || !diff.rouletteStillRemaining);
      state.completed.dailyShop = ((_b = afterSnapshot.shop) == null ? void 0 : _b.success) === true && diff.unclaimedDailyShop === 0;
      state.completed.majak = ((_c = afterSnapshot.majak) == null ? void 0 : _c.success) === true && diff.unclaimedMajakShop === 0;
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
      log("", "info", { timing: true });
      for (const line of timing.summaryLines()) log(line, "info", { timing: true });
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
    const balance = numberOrNull$1((_a = response == null ? void 0 : response.value) == null ? void 0 : _a.mileage_amount);
    return balance === null ? null : balance;
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
    const balance = numberOrNull((_a = response == null ? void 0 : response.value) == null ? void 0 : _a.mileage_amount);
    return balance === null ? null : balance;
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
      const targets = [];
      const myHomeBody = doc.querySelector('#__nuxt [data-slot="Body"]');
      if (myHomeBody == null ? void 0 : myHomeBody.parentNode) {
        targets.push({
          mode: "myhome",
          parent: myHomeBody.parentNode,
          before: myHomeBody
        });
      }
      const legacyContent = doc.querySelector(".inds-content-body");
      if (legacyContent) {
        targets.push({ mode: "legacy", parent: legacyContent, before: legacyContent.firstChild });
      }
      const main = doc.querySelector("main");
      if (main) {
        targets.push({ mode: "legacy", parent: main, before: main.firstChild });
      }
      if (doc.body) {
        targets.push({ mode: "fallback", parent: doc.body, before: doc.body.firstChild });
      }
      return targets;
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
                --bg: #151515;
                --surface: #1e1e1e;
                --surface-2: #262626;
                --border: #2e2e2e;
                --text: #e6e6e6;
                --muted: #8a8a8a;
                --accent: #3b82f6;
                --ok: #34d399;
                --warn: #fbbf24;
                --error: #f87171;
                background: var(--bg);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 20px;
                margin: 24px 0;
                color: var(--text);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
                font-size: 14px;
                line-height: 1.5;
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
            #stove-quest-automation * { box-sizing: border-box; }
            .stove-panel-header {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 8px 16px;
                padding-bottom: 14px;
                margin-bottom: 16px;
                border-bottom: 1px solid var(--border);
            }
            .stove-panel-title { font-size: 18px; font-weight: 700; color: #ffffff; min-width: 0; overflow-wrap: anywhere; }
            .stove-panel-version { font-size: 12px; color: var(--muted); font-family: 'Courier New', monospace; }
            .stove-maintenance-notice {
                background: #3b1212;
                border: 1px solid #7f1d1d;
                border-radius: 8px;
                padding: 14px 16px;
                margin-bottom: 16px;
            }
            .stove-maintenance-title { font-weight: 700; color: #ffffff; margin-bottom: 4px; }
            .stove-maintenance-message { color: #fecaca; }
            .stove-actions {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
                gap: 16px;
                margin-bottom: 16px;
                align-items: stretch;
            }
            .stove-actions-secondary {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: 10px;
                min-width: 0;
            }
            .stove-btn {
                background: var(--surface-2);
                border: 1px solid var(--border);
                color: var(--text);
                padding: 10px 14px;
                border-radius: 8px;
                cursor: pointer;
                font: inherit;
                font-weight: 600;
                text-align: left;
                transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
                min-width: 0;
                overflow-wrap: anywhere;
            }
            .stove-btn:hover:not(:disabled) { background: #303030; border-color: #3d3d3d; }
            .stove-btn-primary { background: var(--accent); border-color: var(--accent); color: #ffffff; }
            .stove-btn-primary:hover:not(:disabled) { background: #2563eb; border-color: #2563eb; }
            .stove-btn:disabled { cursor: not-allowed; opacity: 0.45; }
            .stove-btn-main { display: block; }
            .stove-btn-sub { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); font-weight: 400; }
            .stove-btn-note { display: block; margin-top: 2px; font-size: 12px; color: var(--warn); font-weight: 500; }
            .stove-layout {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
                gap: 16px;
                align-items: start;
            }
            .stove-card {
                background: var(--surface);
                border: 1px solid var(--border);
                border-radius: 10px;
                padding: 16px;
                min-width: 0;
            }
            .stove-card-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 12px;
                min-height: 28px;
            }
            .stove-card-title { font-size: 14px; font-weight: 700; color: #ffffff; letter-spacing: 0.02em; }
            .stove-ghost-btn {
                background: transparent;
                border: 1px solid var(--border);
                color: var(--muted);
                padding: 4px 10px;
                border-radius: 6px;
                cursor: pointer;
                font: inherit;
                font-size: 12px;
                white-space: nowrap;
            }
            .stove-ghost-btn:hover { color: var(--text); border-color: #3d3d3d; }
            .stove-status-group + .stove-status-group { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
            .stove-status-group-title { font-size: 11px; font-weight: 600; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
            .stove-status-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                padding: 7px 0;
                min-width: 0;
            }
            .stove-status-label { color: #c8c8c8; min-width: 0; overflow-wrap: anywhere; }
            .stove-status-value { font-variant-numeric: tabular-nums; text-align: right; min-width: 0; overflow-wrap: anywhere; color: var(--text); }
            .stove-status-item.stove-total { border-top: 1px solid var(--border); margin-top: 8px; padding-top: 12px; }
            .stove-mission-item { position: relative; cursor: help; }
            .stove-mission-tooltip {
                position: absolute;
                left: 0;
                top: 100%;
                margin-top: 6px;
                background: #2a2a2a;
                border: 1px solid #3a3a3a;
                border-radius: 8px;
                padding: 12px;
                min-width: 280px;
                max-width: 400px;
                z-index: 10000;
                font-size: 13px;
                line-height: 1.5;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                display: none;
            }
            .stove-mission-item:hover .stove-mission-tooltip { display: block; }
            .stove-mission-tooltip-title {
                font-weight: 600;
                color: var(--ok);
                margin-bottom: 6px;
                padding-bottom: 6px;
                border-bottom: 1px solid #3a3a3a;
            }
            .stove-mission-tooltip-item { padding: 4px 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
            .stove-mission-tooltip-name { flex: 1; color: #d0d0d0; }
            .stove-mission-tooltip-status { font-size: 12px; white-space: nowrap; }
            .stove-log-toolbar { display: flex; align-items: center; gap: 12px; }
            .stove-switch {
                position: relative;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: var(--muted);
                cursor: pointer;
                user-select: none;
            }
            .stove-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
            .stove-switch-box {
                width: 16px;
                height: 16px;
                border: 1px solid #4a4a4a;
                border-radius: 4px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                background: var(--bg);
                flex: 0 0 auto;
            }
            .stove-switch-box::after {
                content: "";
                width: 8px;
                height: 4px;
                border-left: 2px solid #ffffff;
                border-bottom: 2px solid #ffffff;
                transform: rotate(-45deg) translate(1px, -1px);
                opacity: 0;
            }
            .stove-switch input:checked + .stove-switch-box { background: var(--accent); border-color: var(--accent); }
            .stove-switch input:checked + .stove-switch-box::after { opacity: 1; }
            .stove-switch input:focus-visible + .stove-switch-box { outline: 2px solid var(--accent); outline-offset: 2px; }
            .stove-log-section {
                background: #0f0f0f;
                border: 1px solid var(--border);
                border-radius: 8px;
                padding: 10px 12px;
                max-height: 420px;
                overflow-y: auto;
                scroll-behavior: smooth;
            }
            .stove-log-section::-webkit-scrollbar { width: 8px; }
            .stove-log-section::-webkit-scrollbar-track { background: transparent; }
            .stove-log-section::-webkit-scrollbar-thumb { background: #333333; border-radius: 4px; }
            #stove-log-content {
                font-size: 13px;
                line-height: 1.55;
                font-family: 'Courier New', monospace;
            }
            #stove-log-content > div {
                padding: 2px 0 2px 10px;
                border-left: 2px solid transparent;
                overflow-wrap: anywhere;
            }
            #stove-log-content:not([data-show-timing="true"]) [data-timing="true"],
            #stove-log-content:not([data-show-timing="true"]) .log-timing { display: none; }
            .stove-success-notice {
                background: #064e3b;
                border: 1px solid #10b981;
                border-radius: 8px;
                color: #d1fae5;
                font-weight: 600;
                margin-bottom: 16px;
                padding: 12px 14px;
                text-align: center;
                transition: opacity 0.3s ease, transform 0.3s ease;
            }
            .stove-success-notice--hide { opacity: 0; transform: translateY(-6px); }
            @media (max-width: 900px) {
                .stove-layout { grid-template-columns: minmax(0, 1fr); }
            }
            @media (max-width: 720px) {
                #stove-quest-automation { padding: 16px; }
                #stove-quest-automation[data-stove-mount="myhome"] { width: calc(100% - 24px); }
                .stove-actions { grid-template-columns: minmax(0, 1fr); }
                .stove-actions-secondary { grid-template-columns: minmax(0, 1fr); }
                .stove-mission-tooltip { min-width: 0; width: min(400px, calc(100vw - 48px)); max-width: calc(100vw - 48px); }
            }
        </style>
        <div class="stove-panel-header">
            <span class="stove-panel-title">STOVE 퀘스트 자동화</span>
            <span class="stove-panel-version">v${CONFIG.version} · ${CONFIG.lastUpdated}</span>
        </div>
        <div id="stove-maintenance-notice" class="stove-maintenance-notice" style="display: none;">
            <div class="stove-maintenance-title">점검 중</div>
            <div class="stove-maintenance-message">${CONFIG.maintenanceMode.message}</div>
        </div>
        <div class="stove-actions">
            <button id="stove-btn-start" class="stove-btn stove-btn-primary">전체 자동화</button>
            <div class="stove-actions-secondary">
            <button id="stove-btn-point-cash-charge" class="stove-btn" disabled title="192,500 플레이크 이상일 때 충전 가능">
                <span class="stove-btn-main">7,700 캐시 충전</span>
                <span class="stove-btn-sub">192,500 플레이크 필요</span>
                <span class="stove-btn-note" id="stove-btn-point-cash-charge-status">플레이크 확인 중</span>
            </button>
            <button id="stove-btn-reward-shop" class="stove-btn">
                <span class="stove-btn-main">리워드샵 방문</span>
            </button>
            </div>
        </div>
        <div class="stove-layout">
            <div class="stove-card stove-status-section">
                <div class="stove-card-header">
                    <span class="stove-card-title">현재 상태</span>
                    <button id="stove-btn-status-refresh" class="stove-ghost-btn stove-status-refresh">새로고침</button>
                </div>
                <div class="stove-status-group">
                    <div class="stove-status-group-title">미션</div>
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
                        <span class="stove-status-label">월간 출석</span>
                        <span class="stove-status-value" id="stove-status-mission-attendance">-</span>
                    </div>
                    <div class="stove-status-item">
                        <span class="stove-status-label">설문조사</span>
                        <span class="stove-status-value" id="stove-status-survey">-</span>
                    </div>
                </div>
                <div class="stove-status-group">
                    <div class="stove-status-group-title">보상</div>
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
                </div>
                <div class="stove-status-group">
                    <div class="stove-status-group-title">플레이크</div>
                    <div class="stove-status-item stove-total">
                        <span class="stove-status-label">현재 보유</span>
                        <span class="stove-status-value" id="stove-status-total-flake">-</span>
                    </div>
                    <div class="stove-status-item">
                        <span class="stove-status-label">이번 달 획득</span>
                        <span class="stove-status-value" id="stove-status-monthly-flake">-</span>
                    </div>
                </div>
            </div>
            <div class="stove-card">
                <div class="stove-card-header">
                    <span class="stove-card-title">로그</span>
                    <div class="stove-log-toolbar">
                        <label class="stove-switch">
                            <input type="checkbox" id="stove-toggle-timing">
                            <span class="stove-switch-box"></span>
                            소요 시간 표시
                        </label>
                        <button id="stove-btn-copy-log" class="stove-ghost-btn" title="로그 전체 복사">복사</button>
                    </div>
                </div>
                <div class="stove-log-section">
                    <div id="stove-log-content"></div>
                </div>
            </div>
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
      const logContent2 = document.getElementById("stove-log-content");
      if (!logContent2) return;
      const logText = logContent2.innerText || logContent2.textContent;
      navigator.clipboard.writeText(logText).then(() => {
        const btn = document.getElementById("stove-btn-copy-log");
        if (btn) {
          const original = btn.textContent;
          btn.textContent = "복사됨";
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
      ACTION_BUTTONS.forEach(([id, handler]) => attachListener(id, handler));
      updatePointCashChargeButtonAvailability(null);
      log("자동화 패널이 준비되었습니다", "info");
    }
    attachListener("stove-btn-copy-log", copyLogToClipboard);
    const timingToggle = document.getElementById("stove-toggle-timing");
    const logContent = document.getElementById("stove-log-content");
    if (timingToggle && logContent) {
      timingToggle.addEventListener("change", () => {
        logContent.dataset.showTiming = timingToggle.checked ? "true" : "false";
      });
    }
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