# STOVE Quest Automation - 종합 코드 분석

> **작성일**: 2025-10-28
> **버전**: v1.7.6
> **파일**: stove-quest-automation.user.js (2,945 라인)
> **목적**: 대용량 파일 작업 시 빠른 참조를 위한 구조적 분석

---

## 📋 목차

1. [파일 구조](#파일-구조)
2. [설정 및 상태 관리](#설정-및-상태-관리)
3. [주요 함수 분류](#주요-함수-분류)
4. [API 엔드포인트 맵](#api-엔드포인트-맵)
5. [이벤트 흐름](#이벤트-흐름)
6. [UI 컴포넌트](#ui-컴포넌트)
7. [코드 메트릭](#코드-메트릭)

---

## 파일 구조

### 섹션 구분 (라인 번호)

```
[0-14]     UserScript 메타데이터
[16-19]    IIFE 시작 + 'use strict'
[20-53]    CONFIG 설정
[55-78]    State 관리
[80-176]   Utility Functions (12개)
[178-793]  API Functions (30개)
[795-926]  UI/Progress Functions (4개)
[928-2175] Main Automation Functions (8개 주요 워크플로우)
[2177-2377] Status Check Functions (5개)
[2379-2468] Status UI Update Functions (1개)
[2470-2902] UI Injection (createUI)
[2904-2945] Initialization (init, tryCreateUI)
```

### 주요 섹션 경계

| 라인 범위 | 섹션명 | 주요 내용 |
|---------|--------|----------|
| 20-53 | Configuration | CONFIG 객체 정의 |
| 55-78 | State Management | state 객체 정의 |
| 80-176 | Utility Functions | 쿠키, 헤더, 딜레이, 타임스탬프 등 |
| 178-793 | API Functions | STOVE API 호출 함수들 |
| 795-926 | UI/Progress Functions | 로그, 진행상황 UI 업데이트 |
| 928-2175 | Main Workflows | 자동화 메인 로직 |
| 2177-2377 | Status Checks | 상태 확인 함수들 |
| 2470-2902 | UI Injection | DOM 생성 및 이벤트 바인딩 |
| 2904-2945 | Initialization | 초기화 로직 |

---

## 설정 및 상태 관리

### CONFIG 객체 (라인 23-53)

```javascript
const CONFIG = {
    version: '1.7.6',
    lastUpdated: '2025-10-28',

    api: {
        baseUrl: 'https://api.onstove.com'
    },

    targets: {
        articleLikes: 10,    // 게시글 추천 목표
        comments: 5,         // 댓글 작성 목표
        newArticle: 1        // 새글 작성 목표
    },

    delays: {
        betweenActions: 200,    // 작업 간 딜레이 (ms)
        afterComment: 11000     // 댓글 작성 후 대기 (ms)
    },

    comment: "Nice!",       // 기본 댓글 내용

    tags: [                 // 대상 태그들
        'STOVEINDIE',
        'epicseven',
        'crossfire',
        'btscookingon',
        'chaoszeronightmare'
    ],

    roulette: {
        enabled: true,
        subEventNo: '1000000228',        // 룰렛 이벤트 ID
        extraSubEventNo: '1000000230',   // 룰렛 EXTRA ID
        drawCost: 100,                   // 룰렛 비용 (FLAKE)
        maxDraws: 30                     // 최대 룰렛 횟수
    }
};
```

### State 객체 (라인 58-78)

```javascript
const state = {
    isRunning: false,           // 실행 중 여부

    progress: {                 // 진행 상황
        articleLikes: 0,
        comments: 0,
        newArticle: 0
    },

    completed: {                // 완료 여부
        roulette: false,
        dailyShop: false,
        majak: false
    },

    createdCommentIds: [],      // 생성한 댓글 ID 저장

    earnings: {                 // 획득 FLAKE 추적
        roulette: 0,            // 룰렛 순수익
        rouletteExtra: 0,       // 룰렛 EXTRA 마일스톤
        dailyShop: 0,           // 데일리 샵
        majak: 0                // 마작 리워드
    }
};
```

---

## 주요 함수 분류

### 1. Utility Functions (라인 80-176)

| 함수명 | 라인 | 설명 |
|-------|------|------|
| `getCookie(name)` | 83-87 | 쿠키 값 추출 |
| `extractHeaders()` | 90-113 | API 요청 헤더 생성 (SUAT, UUID) |
| `delay(ms)` | 115-117 | Promise 기반 딜레이 |
| `getTimestamp()` | 119-121 | 현재 타임스탬프 (ms) |
| `getTodayString()` | 123-129 | YYYY-MM-DD 형식 날짜 |
| `isRewardSkipPeriod()` | 132-141 | KST 00:00-01:00 체크 |
| `checkDailyRewardsClaimed()` | 145-147 | 항상 false 반환 (레거시) |
| `playCompletionSound()` | 149-176 | 완료 사운드 재생 (Web Audio API) |

### 2. API Functions (라인 178-793)

#### 핵심 API 래퍼
| 함수명 | 라인 | HTTP | 엔드포인트 |
|-------|------|------|-----------|
| `apiRequest()` | 181-212 | - | GM_xmlhttpRequest 래퍼 |

#### 게시글/댓글 관련
| 함수명 | 라인 | HTTP | 엔드포인트 |
|-------|------|------|-----------|
| `getArticleList()` | 214-218 | GET | `/postie/v2.0/interest/article/list` |
| `getCommentList()` | 220-233 | GET | `/postie/v1.0/article/{id}/comment/list` |
| `likeArticle()` | 235-238 | PUT | `/postie/v1.0/article/{id}/interaction/LIKE` |
| `likeComment()` | 240-249 | PUT | `/postie/v1.0/comment/{id}/interaction/LIKE` |
| `checkArticleLikeStatus()` | 251-258 | GET | `/postie/v1.0/article/{ids}/interaction/LIKE` |
| `checkCommentLikeStatus()` | 260-266 | GET | `/postie/v1.0/comment/{ids}/interaction/LIKE` |
| `postComment()` | 268-280 | POST | `/postie/v1.0/article/{id}/comment` |
| `postHalloweenComment()` | 282-295 | POST | `/postie/v1.0/article/{할로윈ID}/comment` |
| `createHalloweenArticle()` | 297-342 | POST | `/postie/v1.0/article` (할로윈 특수) |
| `createArticle()` | 344-366 | POST | `/postie/v1.0/article` |

#### 태그 관리
| 함수명 | 라인 | HTTP | 엔드포인트 |
|-------|------|------|-----------|
| `unfollowTag()` | 368-372 | DELETE | `/postie/v1.0/favorite/TAG/{tag}` |
| `followTag()` | 374-382 | PUT | `/postie/v1.0/favorite/TAG/{tag}` |

#### 룰렛 관련
| 함수명 | 라인 | HTTP | 엔드포인트 |
|-------|------|------|-----------|
| `getRouletteParticipationCount()` | 383-445 | GET | `/emsbackapi/v3.0/participationCnt?sub_event_no={id}` |
| `executeRouletteDraw()` | 447-518 | POST | `/emsbackapi/v3.0/draw/{subEventNo}` |
| `getRouletteExtra()` | 520-540 | GET | `/emsbackapi/v3.0/extra?sub_event_no={id}` |
| `claimRouletteExtra()` | 542-568 | PUT | `/emsbackapi/v3.0/extra/{subEventNo}` |

#### 데일리 샵 & 마작
| 함수명 | 라인 | HTTP | 엔드포인트 |
|-------|------|------|-----------|
| `getDailyShopRewards()` | 570-595 | GET | `/dailyshop/v1.0/{yearMonth}/services/STOVEINDIE` |
| `getMyProfile()` | 597-617 | GET | `/postie/v1.0/user/me` |
| `getMyArticles()` | 619-637 | GET | `/postie/v1.0/interest/user/{userId}/article/list` |
| `claimDailyReward()` | 639-669 | POST | `/dailyshop/v1.0/attendances/daily/{type}` |
| `getMajakDailyShopRewards()` | 671-697 | GET | `/dailyshop/v1.0/{yearMonth}/services/RIICHICITY_IND` |
| `checkGameOwnership()` | 699-724 | GET | `/ownership/v1/check_ownership_by_bgameid?game_id={id}` |
| `claimDailyAccumulatedReward()` | 726-765 | POST | `/dailyshop/v1.0/attendances/accumulate/{type}` |
| `claimMajakAccumulatedReward()` | 767-793 | POST | `/dailyshop/v1.0/attendances/accumulate/coupon` |

### 3. UI/Progress Functions (라인 795-926)

| 함수명 | 라인 | 설명 |
|-------|------|------|
| `log(message, type)` | 798-828 | 로그 출력 (info/success/warning/error) |
| `updateProgress(task, current, total)` | 830-865 | 진행 상황 UI 업데이트 |
| `setButtonState(running)` | 867-909 | 버튼 활성화/비활성화 |
| `extractComments(articles, count)` | 911-926 | 게시글에서 댓글 추출 |

### 4. Main Automation Workflows (라인 928-2175)

| 함수명 | 라인 | 설명 | 버튼 연결 |
|-------|------|------|----------|
| `runAutomation()` | 931-1331 | **전체 자동화 메인 워크플로우** | 🚀 전체 자동화 |
| `claimRewards()` | 1333-1477 | 리워드 클레임 (레거시) | - |
| `runRewardClaim()` | 1479-1499 | 리워드 클레임 래퍼 | - |
| `runRouletteDraws()` | 1501-1627 | 룰렛 실행 로직 | - |
| `runRoulette()` | 1629-1650 | 룰렛 실행 래퍼 | 🎰 룰렛만 |
| `claimDailyShopRewards()` | 1652-1728 | 데일리 샵 보상 수령 | - |
| `runDailyReward()` | 1730-1750 | 데일리 보상 래퍼 | 💝 데일리 보상 |
| `claimMajakDailyShopRewards()` | 1752-1892 | 마작 데일리 보상 수령 | - |
| `runMajakReward()` | 1894-1914 | 마작 리워드 래퍼 | 🀄 마작 리워드 |
| `runDailyAccumulatedReward()` | 1916-2032 | 데일리 누적 보상 | 🎁 데일리 누적 보상 |
| `claimRouletteExtraRewards()` | 2034-2125 | 룰렛 EXTRA 마일스톤 클레임 | - |
| `runRouletteExtra()` | 2127-2147 | 룰렛 EXTRA 래퍼 | 🎁 룰렛 EXTRA |
| `runArticleCreation()` | 2149-2175 | 출석 글쓰기 | ✍️ 출석글쓰기 |

### 5. Status Check Functions (라인 2177-2377)

| 함수명 | 라인 | 설명 |
|-------|------|------|
| `checkRouletteStatus()` | 2180-2193 | 룰렛 횟수 확인 |
| `checkDailyShopStatus()` | 2195-2234 | 데일리 샵 상태 확인 |
| `checkMajakShopStatus()` | 2236-2277 | 마작 샵 상태 확인 |
| `checkArticleWriteStatus()` | 2279-2329 | 오늘 글쓰기 여부 확인 |
| `checkAllStatus()` | 2331-2377 | 전체 상태 일괄 확인 |
| `updateStatusUI()` | 2379-2468 | 상태 UI 업데이트 |

### 6. UI Injection (라인 2470-2902)

| 함수명 | 라인 | 설명 |
|-------|------|------|
| `createUI()` | 2473-2902 | UI 생성 및 이벤트 바인딩 |

### 7. Initialization (라인 2904-2945)

| 함수명 | 라인 | 설명 |
|-------|------|------|
| `init()` | 2907-2923 | 초기화 진입점 |
| `tryCreateUI()` | 2925-2942 | UI 생성 재시도 로직 (최대 5회) |

---

## API 엔드포인트 맵

### Base URL
```
https://api.onstove.com
```

### 엔드포인트 목록

#### Postie API (커뮤니티)

| 메서드 | 경로 | 설명 | 함수 |
|-------|------|------|------|
| GET | `/postie/v2.0/interest/article/list` | 관심 게시글 목록 | `getArticleList` |
| GET | `/postie/v1.0/article/{id}/comment/list` | 게시글 댓글 목록 | `getCommentList` |
| PUT | `/postie/v1.0/article/{id}/interaction/LIKE` | 게시글 좋아요 | `likeArticle` |
| PUT | `/postie/v1.0/comment/{id}/interaction/LIKE` | 댓글 좋아요 | `likeComment` |
| GET | `/postie/v1.0/article/{ids}/interaction/LIKE` | 게시글 좋아요 상태 확인 | `checkArticleLikeStatus` |
| GET | `/postie/v1.0/comment/{ids}/interaction/LIKE` | 댓글 좋아요 상태 확인 | `checkCommentLikeStatus` |
| POST | `/postie/v1.0/article/{id}/comment` | 댓글 작성 | `postComment` |
| POST | `/postie/v1.0/article` | 게시글 작성 | `createArticle` |
| DELETE | `/postie/v1.0/favorite/TAG/{tag}` | 태그 언팔로우 | `unfollowTag` |
| PUT | `/postie/v1.0/favorite/TAG/{tag}` | 태그 팔로우 | `followTag` |
| GET | `/postie/v1.0/user/me` | 내 프로필 조회 | `getMyProfile` |
| GET | `/postie/v1.0/interest/user/{userId}/article/list` | 사용자 게시글 목록 | `getMyArticles` |

#### EMS API (이벤트/룰렛)

| 메서드 | 경로 | 설명 | 함수 |
|-------|------|------|------|
| GET | `/emsbackapi/v3.0/participationCnt` | 룰렛 참여 횟수 조회 | `getRouletteParticipationCount` |
| POST | `/emsbackapi/v3.0/draw/{subEventNo}` | 룰렛 실행 | `executeRouletteDraw` |
| GET | `/emsbackapi/v3.0/extra` | 룰렛 EXTRA 마일스톤 조회 | `getRouletteExtra` |
| PUT | `/emsbackapi/v3.0/extra/{subEventNo}` | 룰렛 EXTRA 보상 수령 | `claimRouletteExtra` |

#### Daily Shop API (데일리 보상)

| 메서드 | 경로 | 설명 | 함수 |
|-------|------|------|------|
| GET | `/dailyshop/v1.0/{yearMonth}/services/STOVEINDIE` | 데일리 샵 보상 목록 | `getDailyShopRewards` |
| GET | `/dailyshop/v1.0/{yearMonth}/services/RIICHICITY_IND` | 마작 데일리 샵 보상 목록 | `getMajakDailyShopRewards` |
| POST | `/dailyshop/v1.0/attendances/daily/{type}` | 데일리 보상 수령 | `claimDailyReward` |
| POST | `/dailyshop/v1.0/attendances/accumulate/{type}` | 누적 보상 수령 | `claimDailyAccumulatedReward` |
| POST | `/dailyshop/v1.0/attendances/accumulate/coupon` | 마작 누적 보상 수령 | `claimMajakAccumulatedReward` |

#### Ownership API (게임 소유권)

| 메서드 | 경로 | 설명 | 함수 |
|-------|------|------|------|
| GET | `/ownership/v1/check_ownership_by_bgameid` | 게임 소유 여부 확인 | `checkGameOwnership` |

---

## 이벤트 흐름

### 1. 전체 자동화 워크플로우 (`runAutomation`)

```
시작
  ↓
1. 헤더 추출 (SUAT, UUID)
  ↓
2. 게시글 추천 (10회)
   - getArticleList() → 관심 게시글 목록
   - likeArticle() × 10회
  ↓
3. 댓글 작성 (5회) + 좋아요
   - getArticleList() → 새로운 게시글 목록
   - postComment() × 5회
   - likeComment() × 5회 (자신의 댓글)
  ↓
4. 새글 작성 (1회)
   - createArticle() × 1회
   - unfollowTag() → 태그 언팔로우
  ↓
5. 룰렛 실행
   - getRouletteParticipationCount() → 현재 횟수 확인
   - executeRouletteDraw() × (30 - 현재횟수)회
  ↓
6. 데일리 보상 수령
   - getDailyShopRewards() → 보상 목록
   - claimDailyReward() × N회
  ↓
7. 마작 보상 수령
   - getMajakDailyShopRewards() → 보상 목록
   - claimDailyReward() × N회
  ↓
완료 (사운드 재생)
```

### 2. 룰렛 워크플로우 (`runRoulette`)

```
시작
  ↓
1. 헤더 추출
  ↓
2. 현재 룰렛 횟수 조회
   - getRouletteParticipationCount()
  ↓
3. 남은 횟수 계산
   remaining = 30 - current
  ↓
4. 룰렛 실행 (반복)
   - executeRouletteDraw() × remaining
   - 각 결과에서 FLAKE 수집
   - earnings.roulette 누적
  ↓
완료
```

### 3. 데일리 보상 워크플로우 (`runDailyReward`)

```
시작
  ↓
1. 헤더 추출
  ↓
2. 보상 목록 조회
   - getDailyShopRewards()
  ↓
3. 필터링
   - todayOrFuture = 오늘/미래 날짜 보상
   - unclaimed = 미수령 보상
  ↓
4. 보상 수령 (반복)
   - claimDailyReward() × N회
   - earnings.dailyShop 누적
  ↓
완료
```

### 4. 상태 확인 워크플로우 (`checkAllStatus`)

```
시작
  ↓
1. 헤더 추출
  ↓
2. 병렬 상태 확인
   ├─ checkArticleWriteStatus()     → 오늘 글쓰기 여부
   ├─ checkRouletteStatus()         → 룰렛 횟수
   ├─ checkDailyShopStatus()        → 데일리 보상 상태
   └─ checkMajakShopStatus()        → 마작 보상 상태
  ↓
3. UI 업데이트
   - updateStatusUI(statusData)
  ↓
완료
```

---

## UI 컴포넌트

### DOM 구조

```html
<div id="stove-quest-automation">

  <!-- 헤더 -->
  <div class="stove-panel-header">
    <span class="stove-panel-title">🤖 STOVE 퀘스트 자동화</span>
    <span class="stove-panel-version">
      <div>v1.7.6</div>
      <div>Updated: 2025-10-28</div>
    </span>
  </div>

  <!-- 컨트롤 버튼들 (Grid 3열) -->
  <div class="stove-controls">
    <button id="stove-btn-start">🚀 전체 자동화</button>
    <button id="stove-btn-roulette">🎰 룰렛만</button>
    <button id="stove-btn-roulette-extra">🎁 룰렛 EXTRA</button>
    <button id="stove-btn-daily">💝 데일리 보상</button>
    <button id="stove-btn-daily-accumulated">🎁 데일리 누적 보상</button>
    <button id="stove-btn-majak">🀄 마작 리워드</button>
    <button id="stove-btn-article">✍️ 출석글쓰기</button>
  </div>

  <!-- 현재 상태 섹션 -->
  <div class="stove-status-section">
    <div class="stove-status-header">
      📊 현재 상태
      <button id="stove-btn-status-refresh">🔄 새로고침</button>
    </div>
    <div class="stove-status-list">
      <div class="stove-status-item">
        <span>✍️ 오늘 글쓰기</span>
        <span id="stove-status-article">-</span>
      </div>
      <div class="stove-status-item">
        <span>🎰 룰렛 횟수</span>
        <span id="stove-status-roulette">-</span>
      </div>
      <div class="stove-status-item">
        <span>💝 데일리 보상</span>
        <span id="stove-status-daily">-</span>
      </div>
      <div class="stove-status-item">
        <span>🀄 마작 리워드</span>
        <span id="stove-status-majak">-</span>
      </div>
    </div>
  </div>

  <!-- 진행 상황 섹션 -->
  <div class="stove-progress-section">
    <div class="stove-progress-header">📊 커뮤니티 활동 진행 상황</div>
    <div class="stove-progress-bar">
      <div class="stove-progress-fill">
        <span id="stove-progress-text"></span>
      </div>
    </div>
    <div class="stove-task-list">
      <div class="stove-task">게시글 추천: <span id="stove-article-likes">0/10</span></div>
      <div class="stove-task">댓글 작성: <span id="stove-comments">0/5</span></div>
      <div class="stove-task">새글 작성: <span id="stove-new-article">0/1</span></div>
    </div>
  </div>

  <!-- 로그 섹션 -->
  <div class="stove-log-section">
    <div class="stove-log-header">
      <span>📝 로그</span>
      <button id="stove-btn-copy-log">📋</button>
    </div>
    <div id="stove-log-content"></div>
  </div>

</div>
```

### 이벤트 바인딩 (라인 2876-2894)

```javascript
attachListener('stove-btn-start', runAutomation);
attachListener('stove-btn-roulette', runRoulette);
attachListener('stove-btn-roulette-extra', runRouletteExtra);
attachListener('stove-btn-daily', runDailyReward);
attachListener('stove-btn-daily-accumulated', runDailyAccumulatedReward);
attachListener('stove-btn-majak', runMajakReward);
attachListener('stove-btn-article', runArticleCreation);
attachListener('stove-btn-copy-log', copyLogToClipboard);
attachListener('stove-btn-status-refresh', checkAllStatus);
```

### 스타일 특징

- **다크 테마**: `#1a1a1a` 배경, `#e0e0e0` 텍스트
- **반응형 Grid**: 버튼 3열, 태스크 2열 레이아웃
- **애니메이션**: 호버 시 `translateY(-1px)`, 클릭 시 `scale(0.95)`
- **진행 바**: 녹색(`#10b981`) 애니메이션 (0.5s ease)
- **커스텀 스크롤바**: 다크 스타일 스크롤바

---

## 코드 메트릭

### 파일 통계

| 메트릭 | 값 |
|--------|-----|
| **총 라인 수** | 2,945 |
| **주요 함수 수** | 52개 |
| **API 엔드포인트** | 19개 (unique) |
| **이벤트 리스너** | 9개 |
| **CSS 라인** | ~250 라인 |

### 함수 복잡도 (Cyclomatic Complexity 추정)

| 함수 | 복잡도 | 라인 수 | 비고 |
|------|--------|---------|------|
| `runAutomation` | **높음 (15+)** | 400 | 메인 워크플로우, 리팩토링 우선순위 높음 |
| `claimDailyShopRewards` | 중간 (8-12) | 76 | 여러 조건 분기 |
| `claimMajakDailyShopRewards` | 중간 (8-12) | 140 | 여러 조건 분기 |
| `runDailyAccumulatedReward` | 중간 (8-12) | 116 | 게임 소유권 확인 포함 |
| `getRouletteParticipationCount` | 낮음 (3-5) | 62 | 단순 조회 |
| `executeRouletteDraw` | 낮음 (3-5) | 71 | 단순 실행 |
| `createUI` | **높음 (10+)** | 430 | UI 생성, HTML 문자열 포함 |

### 주요 패턴

#### 1. Promise 기반 비동기 처리
```javascript
async function runAutomation() {
    try {
        const headers = extractHeaders();
        await likeArticle(headers, articleId);
        // ...
    } catch (error) {
        log(`오류: ${error.message}`, 'error');
    } finally {
        setButtonState(false);
    }
}
```

#### 2. GM_xmlhttpRequest 래핑
```javascript
function apiRequest(url, method, headers, body = null) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method, url, headers,
            data: body ? JSON.stringify(body) : null,
            onload: (response) => {
                if (response.status >= 200 && response.status < 300) {
                    resolve(JSON.parse(response.responseText));
                } else {
                    reject(new Error(`API Error: ${response.status}`));
                }
            },
            onerror: reject
        });
    });
}
```

#### 3. State 기반 진행 추적
```javascript
state.progress.articleLikes++;
updateProgress('articleLikes', state.progress.articleLikes, CONFIG.targets.articleLikes);
```

#### 4. Earnings 추적 패턴
```javascript
state.earnings.roulette += reward;
log(`💰 룰렛 보상: ${reward} FLAKE (누적: ${state.earnings.roulette})`, 'success');
```

### 리팩토링 추천사항

1. **`runAutomation` 분할**: 400 라인 → 각 단계별 함수로 분리
2. **중복 코드 제거**: `claimDailyShopRewards`와 `claimMajakDailyShopRewards` 공통화
3. **에러 처리 일관성**: 모든 API 함수에 동일한 에러 핸들링 패턴 적용
4. **타입 안정성**: JSDoc 타입 주석 추가 (선택사항)
5. **설정 외부화**: 하드코딩된 이벤트 ID를 CONFIG로 이동 (일부 완료됨)

---

## 주요 워크플로우 상세

### 🚀 전체 자동화 (`runAutomation`)

**라인**: 931-1331
**복잡도**: 매우 높음
**호출 API**: 10+ 엔드포인트

**단계별 흐름**:

1. **초기화** (931-938)
   - 버튼 비활성화
   - 상태 초기화
   - 헤더 추출

2. **게시글 추천 단계** (940-1000)
   ```
   목표: 10회 게시글 추천
   - getArticleList(30) → 30개 게시글
   - checkArticleLikeStatus() → 이미 좋아요한 게시글 필터링
   - likeArticle() × 10회
   - 200ms 딜레이
   ```

3. **댓글 작성 단계** (1002-1100)
   ```
   목표: 5회 댓글 작성 + 자신의 댓글에 좋아요
   - getArticleList(30) → 새로운 게시글
   - postComment("Nice!") × 5회
   - createdCommentIds에 댓글 ID 저장
   - 11초 대기 (API 제한)
   - likeComment() × 5회 (자신의 댓글)
   ```

4. **새글 작성 단계** (1102-1160)
   ```
   목표: 1회 게시글 작성
   - createArticle() → 출석 게시글
   - unfollowTag() → 태그 언팔로우 (스팸 방지)
   ```

5. **룰렛 실행 단계** (1162-1220)
   ```
   조건: CONFIG.roulette.enabled === true
   - runRouletteDraws() 호출
   ```

6. **데일리 보상 단계** (1222-1260)
   ```
   조건: KST 00:00-01:00 제외
   - claimDailyShopRewards() 호출
   ```

7. **마작 보상 단계** (1262-1300)
   ```
   조건: KST 00:00-01:00 제외
   - claimMajakDailyShopRewards() 호출
   ```

8. **완료 처리** (1302-1331)
   - 총 획득 FLAKE 계산
   - 사운드 재생
   - 버튼 재활성화

### 🎰 룰렛 실행 (`runRouletteDraws`)

**라인**: 1501-1627
**복잡도**: 중간

**단계별 흐름**:

1. **현재 횟수 조회** (1510-1525)
   ```javascript
   const data = await getRouletteParticipationCount(headers, subEventNo);
   const current = data.value?.currentCnt || 0;
   const limit = data.value?.limitCnt || 30;
   ```

2. **남은 횟수 계산** (1527-1540)
   ```javascript
   const remaining = limit - current;
   if (remaining <= 0) {
       log('오늘 룰렛을 이미 모두 완료했습니다', 'info');
       return;
   }
   ```

3. **룰렛 실행 반복** (1542-1610)
   ```javascript
   for (let i = 0; i < remaining; i++) {
       const result = await executeRouletteDraw(headers, subEventNo);
       const reward = result.value?.user_reward?.qty || 0;
       const cost = CONFIG.roulette.drawCost;
       const netProfit = reward - cost;
       state.earnings.roulette += netProfit;

       await delay(CONFIG.delays.betweenActions);
   }
   ```

### 💝 데일리 보상 수령 (`claimDailyShopRewards`)

**라인**: 1652-1728
**복잡도**: 중간

**단계별 흐름**:

1. **보상 목록 조회** (1660-1670)
   ```javascript
   const data = await getDailyShopRewards(headers);
   const rewards = data.value?.rewards || [];
   ```

2. **필터링: 오늘/미래 날짜** (1672-1680)
   ```javascript
   const today = getTodayString();
   const todayOrFutureRewards = rewards.filter(r => r.date >= today);
   ```

3. **필터링: 미수령 보상** (1682-1690)
   ```javascript
   const unclaimedRewards = todayOrFutureRewards.filter(r => {
       return r.attendance === false && r.accumulated === false;
   });
   ```

4. **보상 수령 반복** (1692-1720)
   ```javascript
   for (const reward of unclaimedRewards) {
       await claimDailyReward(headers, reward.item_no, reward.reward_type);
       state.earnings.dailyShop += reward.flake || 0;
       await delay(CONFIG.delays.betweenActions);
   }
   ```

---

## 디버깅 가이드

### 주요 로그 포인트

| 로그 메시지 | 함수 | 의미 |
|-----------|------|------|
| `[API Request] Starting request` | `apiRequest` | API 요청 시작 |
| `[API Request] Error response` | `apiRequest` | API 오류 응답 |
| `[댓글 목록 조회] Found X comments` | `getCommentList` | 댓글 조회 성공 |
| `[룰렛 실행] X/Y회 완료` | `runRouletteDraws` | 룰렛 진행 상황 |
| `[STOVE Automation] UI element in DOM` | `createUI` | UI 생성 확인 |

### 일반적인 문제 해결

#### 1. "Authorization token (SUAT) not found"
- **원인**: 쿠키에 SUAT 토큰 없음
- **해결**: STOVE 로그인 상태 확인

#### 2. "UUID (sgs_da_uuid) not found"
- **원인**: localStorage 또는 쿠키에 UUID 없음
- **해결**: STOVE 프로필 페이지 재방문

#### 3. UI가 표시되지 않음
- **원인**: DOM 삽입 대상 요소가 없음
- **해결**: `tryCreateUI` 재시도 로직 확인 (최대 5회)

#### 4. API 429 Too Many Requests
- **원인**: API 속도 제한 초과
- **해결**: `CONFIG.delays` 값 증가

#### 5. 룰렛 실행 안 됨
- **원인**: `CONFIG.roulette.enabled === false`
- **해결**: CONFIG 설정 확인

---

## 변경 이력

### v1.7.6 (2025-10-28)
- GitHub 저장소 URL 변경
  - `prohyeon/flake` → `prohyeon/public-flake`
  - 파일 경로 간소화 (루트 디렉토리)

### v1.7.5 (이전)
- 보안 검토 완료
- 주요 보안 이슈 없음 확인

---

## 빠른 참조

### 주요 상수

```javascript
CONFIG.api.baseUrl = 'https://api.onstove.com'
CONFIG.targets = { articleLikes: 10, comments: 5, newArticle: 1 }
CONFIG.delays = { betweenActions: 200, afterComment: 11000 }
CONFIG.roulette.maxDraws = 30
CONFIG.roulette.drawCost = 100
```

### 주요 DOM ID

```javascript
'stove-quest-automation'      // 메인 컨테이너
'stove-btn-start'             // 전체 자동화 버튼
'stove-btn-roulette'          // 룰렛 버튼
'stove-btn-status-refresh'    // 상태 새로고침 버튼
'stove-log-content'           // 로그 출력 영역
'stove-progress-text'         // 진행률 텍스트
'stove-status-article'        // 글쓰기 상태
'stove-status-roulette'       // 룰렛 상태
```

### 주요 State 경로

```javascript
state.isRunning              // 실행 중 여부
state.progress.articleLikes  // 게시글 추천 진행
state.progress.comments      // 댓글 작성 진행
state.progress.newArticle    // 새글 작성 진행
state.completed.roulette     // 룰렛 완료 여부
state.earnings.roulette      // 룰렛 순수익
state.earnings.dailyShop     // 데일리 샵 수익
state.createdCommentIds      // 생성한 댓글 ID 배열
```

---

## 참고 사항

### 작업 시 주의사항

1. **대용량 파일**: 2,945 라인이므로 섹션별로 작업
2. **라인 번호 참조**: 이 문서의 라인 번호로 빠른 네비게이션
3. **API 의존성**: 모든 함수가 `extractHeaders()` 의존
4. **비동기 처리**: 대부분 `async/await` 패턴
5. **상태 관리**: `state` 객체 중앙 집중식

### 추천 작업 순서

1. **설정 변경**: CONFIG 객체 수정 (라인 23-53)
2. **UI 수정**: createUI 함수 (라인 2473-2902)
3. **API 추가**: apiRequest 패턴 따라 새 함수 작성
4. **워크플로우 수정**: 메인 함수들 (라인 928-2175)
5. **상태 관리 확장**: state 객체 확장 (라인 58-78)

---

**생성일**: 2025-10-28
**분석 도구**: Claude Code with Serena MCP
**목적**: 효율적인 코드 작업을 위한 구조적 참조 문서
