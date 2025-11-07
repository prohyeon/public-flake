# 스토브 플레이크 전체 자동화 기능 흐름 분석

## 📋 목차
1. [시스템 아키텍처 개요](#시스템-아키텍처-개요)
2. [메인 자동화 플로우](#메인-자동화-플로우)
3. [미션 타입별 처리 로직](#미션-타입별-처리-로직)
4. [API 계층 구조](#api-계층-구조)
5. [상태 관리 및 UI](#상태-관리-및-ui)

---

## 시스템 아키텍처 개요

### 3계층 아키텍처
```
┌─────────────────────────────────────────┐
│         UI Layer (상태 표시)              │
│  - 진행률 표시 (Progress bars)           │
│  - 미션 상태 툴팁 (Tooltips)             │
│  - 로그 출력 (Console logs)              │
└─────────────────────────────────────────┘
                    ↑
┌─────────────────────────────────────────┐
│      Automation Layer (자동화 로직)      │
│  - runQuestAutomation() - 메인 플로우   │
│  - autoParticipateVisitMissions()        │
│  - executeDailyMissions()                │
│  - executeWeeklyMissions()               │
│  - executeContentMissions()              │
│  - executeEventMissions()                │
│  - executeBannerMissions()               │
│  - executeAttendanceMissions()           │
└─────────────────────────────────────────┘
                    ↑
┌─────────────────────────────────────────┐
│         API Layer (API 호출)             │
│  - getDailyMissionStatus()               │
│  - getAllDailyMissions()                 │
│  - participateMission()                  │
│  - createArticle()                       │
│  - likeArticle()                         │
│  - postComment()                         │
└─────────────────────────────────────────┘
```

---

## 메인 자동화 플로우

### 전체 실행 순서
```
runQuestAutomation()
├─ Step 0: 📝 댓글 작성 (비동기 백그라운드)
│   └─ commentPromise = postMultipleComments(10개)
│
├─ Step 1: ✍️ 새글 작성 (1회)
│   ├─ checkArticleWriteStatus() - 오늘 작성 확인
│   └─ createArticle() - 미작성 시 게시글 생성
│
├─ Step 2: 👍 게시글 추천 (5개)
│   ├─ 게시글 목록 조회 (목표의 3배)
│   ├─ checkArticleLikeStatus() - 좋아요 상태 체크
│   ├─ 좋아요 안 누른 게시글 필터링
│   └─ likeArticle() × 5회
│
├─ Step 3: 🎯 SINGLE 미션 자동 참여
│   └─ autoParticipateVisitMissions()
│       ├─ 방문형 미션 (스토브 메인 방문) → RECEIVABLE
│       └─ 게임 플레이 미션 → COMPLETE (즉시 보상)
│
├─ Step 4: 📄 필수 페이지 방문
│   └─ visitRequiredPages()
│
├─ Step 4.5: 🎯 데일리 미션 실행
│   └─ executeDailyMissions()
│
├─ Step 4.6: 📦 컨텐츠 미션 실행
│   └─ executeContentMissions()
│
├─ Step 4.7: 📅 위클리 미션 실행
│   └─ executeWeeklyMissions()
│
├─ Step 4.8: 🎊 이벤트 미션 실행
│   └─ executeEventMissions()
│
├─ Step 4.9: 🎪 배너 미션 실행
│   └─ executeBannerMissions()
│
├─ Step 4.10: 📆 출석 미션 실행
│   └─ executeAttendanceMissions()
│
├─ Step 4.11: 🎁 경품 응모
│   └─ executePrizeEntry()
│
├─ Step 5: 🎰 룰렛 돌리기
│   └─ runRouletteDraws()
│
├─ Step 6: ⏳ 댓글 작성 완료 대기
│   └─ await commentPromise
│
├─ Step 7: 💝 데일리 보상 수령
│   └─ claimDailyShopRewards()
│
├─ Step 8: 🀄 마작 보상 수령
│   └─ claimMajakDailyShopRewards()
│
├─ Step 9: 🎲 룰렛 추가 보상
│   └─ claimRouletteExtraRewards()
│
└─ Step 10: 🎁 데일리 누적 보상
    └─ claimDailyAccumulatedRewards()
```

### skipRewards 모드 (리워드 초기화 대기)
```
when skipRewards = true:
  ✅ 실행: Step 0 (댓글 작성)
  ⏩ 스킵: Step 1 (새글 작성)
  ⏩ 스킵: Step 2 (게시글 추천)
  ⏩ 스킵: Step 3 (SINGLE 미션)
  ✅ 실행: Step 4 ~ Step 10 (나머지)
```

---

## 미션 타입별 처리 로직

### 1. SINGLE 타입 (단일 미션)
**Component**: 1, 2, 9, 10, 11, 12

#### 상태 플로우
```
INCOMPLETE
    ↓
participateMission(mission_no, component_no)
    ↓
┌─────────────┬─────────────┐
│ RECEIVABLE  │  COMPLETE   │
├─────────────┼─────────────┤
│ 방문형 미션  │ 게임플레이   │
│ (별도 수령X) │ (즉시 지급)  │
└─────────────┴─────────────┘
```

#### 서브타입 분류
```javascript
// 1. 방문형 미션
{
  is_visit_mission: true,
  title: "스토브 메인 방문하기",
  status: RECEIVABLE  // 참여만 완료, UI에 표시
}

// 2. 게임 플레이 미션
{
  is_visit_mission: false,
  title: "게임 플레이하기",
  status: COMPLETE,    // 즉시 보상 지급
  residue_flake: 127435  // 잔액 정보
}
```

#### 자동화 함수: `autoParticipateVisitMissions()`
```javascript
async function autoParticipateVisitMissions(headers) {
  // 1. 전체 미션 조회
  const allMissions = await getAllDailyMissions(headers);

  // 2. SINGLE + INCOMPLETE 필터링
  const singleMissions = missions.filter(m =>
    m.mission_type === 'SINGLE' &&
    m.status === 'INCOMPLETE'
  );

  // 3. 각 미션 참여
  for (const mission of singleMissions) {
    const result = await participateMission(
      headers,
      mission.mission_no,
      mission.component_no
    );

    // 4. 상태별 분기 처리
    if (result.value.status === 'RECEIVABLE') {
      // 방문형: 참여만 완료
      log(`✅ ${mission.title} 참여 완료 (수령 가능)`);
      participated++;
    } else if (result.value.status === 'COMPLETE') {
      // 게임플레이: 즉시 보상 지급
      log(`🎁 ${mission.title} 보상 수령 (+${reward_amount})`);
      completed++;
    }
  }

  return { participated, completed, total };
}
```

### 2. ACCUMULATION 타입 (누적 미션)
**Component**: 다양

#### 상태 플로우
```
INCOMPLETE (user_complete_cnt < milestone_total_cnt)
    ↓
participateMission() × N회
    ↓
RECEIVABLE (user_complete_cnt >= milestone_total_cnt)
    ↓
claimReward()
    ↓
COMPLETE
```

#### 필드 구조
```javascript
{
  mission_type: "ACCUMULATION",
  title: "매일 라운지 좋아요 누르기",
  milestone_total_cnt: 5,      // 목표 횟수
  milestone_per_cnt: 1,         // 회당 증가량
  user_complete_cnt: 3,         // 현재 완료 횟수
  total_cycle_cnt: 1,           // 총 사이클
  user_cycle_cnt: 0,            // 현재 사이클
  status: "INCOMPLETE"          // 진행 상태
}
```

#### 예시 미션
- 매일 라운지 좋아요 누르기 (5회)
- 매일 라운지 댓글 쓰기 (5회)
- 매일 라운지 글쓰기 (5회)

### 3. CONTENT1 타입 (컨텐츠 미션)
**Component**: 4

특정 컨텐츠 관련 미션 (게임별, 이벤트별)

### 4. ACHIEVEMENT 타입 (업적 미션)
**Component**: 5

특정 조건 달성 시 완료되는 미션

---

## API 계층 구조

### 미션 조회 API

#### 1. 단일 Component 조회
```javascript
GET /flake-shop/v1/mission/component?component_no={N}

Headers:
  - caller-id: flake-fe
  - origin: reward.onstove.com

Response:
{
  component_info: {
    component_no: 1,
    component_type: "SINGLE",
    title: "데일리 미션"
  },
  missions: [
    {
      mission_no: 123,
      mission_type: "SINGLE",
      status: "INCOMPLETE",
      title: "스토브 메인 방문하기",
      reward_amount: 100,
      is_visit_mission: true
    }
  ]
}
```

#### 2. 전체 미션 병렬 조회
```javascript
async function getAllDailyMissions(headers) {
  const componentNos = [1, 2, 4, 5, 9, 10, 11, 12];

  // 병렬 조회
  const promises = componentNos.map(no =>
    getDailyMissionStatus(headers, no)
  );

  const results = await Promise.all(promises);
  return results.filter(r => r.success);
}
```

### 미션 참여 API

```javascript
POST /flake-shop/v1/mission/participate

Headers:
  - caller-id: flake-fe
  - origin: reward.onstove.com

Body:
{
  mission_no: 123,
  component_no: 1
}

Response:
{
  value: {
    mission_no: 123,
    status: "RECEIVABLE" | "COMPLETE" | "COMPLETED",
    residue_flake: 127435,  // COMPLETE 시 포함
    reward_amount: 100
  }
}
```

---

## 상태 관리 및 UI

### 미션 상태 체크 함수

```javascript
async function checkDailyMissionStatus(headers) {
  // 1. 전체 미션 조회
  const allMissions = await getAllDailyMissions(headers);

  // 2. 카테고리별 분류
  const categories = {
    daily: [],       // SINGLE
    weekly: [],      // ACCUMULATION (위클리)
    content: [],     // CONTENT1
    attendance: []   // ACCUMULATION (출석)
  };

  // 3. 미션 분류 로직
  allMissions.forEach(comp => {
    const type = comp.component_info.component_type;
    const title = comp.component_info.title;

    if (type === 'SINGLE') {
      categories.daily.push(comp.missions);
    } else if (type === 'ACCUMULATION') {
      if (title.includes('출석')) {
        categories.attendance.push(comp.missions);
      } else {
        categories.weekly.push(comp.missions);
      }
    } else if (type === 'CONTENT1') {
      categories.content.push(comp.missions);
    }
  });

  // 4. 카테고리별 통계 계산
  return {
    daily: {
      total: missions.length,
      completed: missions.filter(m => m.status === 'COMPLETE').length,
      receivable: missions.filter(m => m.status === 'RECEIVABLE').length,
      incomplete: missions.filter(m => m.status === 'INCOMPLETE').length
    },
    // ... weekly, content, attendance
  };
}
```

### UI 업데이트 시스템

```javascript
function updateStatusUI() {
  // 5개 카테고리 상태 표시
  const categories = ['daily', 'weekly', 'content', 'attendance', 'achievement'];

  categories.forEach(cat => {
    const status = missionStatus.categories[cat];
    if (status) {
      // 진행률 계산
      const progress = `${status.completed}/${status.total}`;

      // 상태 아이콘
      const icon = getStatusIcon(status);

      // 툴팁 생성 (마우스 hover)
      const tooltip = generateTooltip(status.missions);

      updateCategoryUI(cat, progress, icon, tooltip);
    }
  });
}

function getStatusIcon(status) {
  if (status.incomplete > 0) return '⏳';  // 진행 중
  if (status.receivable > 0) return '🎁';  // 수령 가능
  if (status.completed === status.total) return '✅';  // 완료
}
```

---

## 주요 특징 및 최적화

### 1. 병렬 처리 (Parallel Processing)
```javascript
// ✅ Good: 병렬 조회
const allMissions = await Promise.all([
  getDailyMissionStatus(headers, 1),
  getDailyMissionStatus(headers, 2),
  getDailyMissionStatus(headers, 4)
]);

// ❌ Bad: 순차 조회
for (const no of [1, 2, 4]) {
  await getDailyMissionStatus(headers, no);
}
```

### 2. 비동기 백그라운드 작업
```javascript
// Step 0: 댓글 작성을 백그라운드에서 진행
const commentPromise = postMultipleComments(headers, 10);

// ... 다른 작업 진행 ...

// Step 6: 댓글 작성 완료 대기
await commentPromise;
```

### 3. 중복 작업 방지
```javascript
// 오늘 이미 작성한 글 체크
const writeStatus = await checkArticleWriteStatus(headers);
if (writeStatus.hasWrittenToday) {
  log('⏩ 오늘 이미 작성 완료, 스킵');
  return;
}

// 이미 좋아요 누른 게시글 필터링
const unlikedArticles = articles.filter(article =>
  articleLikeStatuses[article.article_id]?.LIKE !== true
);
```

### 4. 상태 기반 분기 처리
```javascript
// API 응답 상태값으로 자동 분기
const result = await participateMission(headers, mission_no, component_no);

if (result.value.status === 'RECEIVABLE') {
  // 방문형: 참여만 완료
} else if (result.value.status === 'COMPLETE') {
  // 게임플레이: 즉시 보상 지급
}
```

---

## 확장 가능성

### 새로운 미션 타입 추가
```javascript
// 1. mission_type 확인
// 2. 카테고리 매핑 추가
// 3. 자동화 함수 확장

if (type === 'NEW_TYPE') {
  categories.newCategory.push(comp.missions);
}
```

### 새로운 Component 추가
```javascript
// getAllDailyMissions()의 배열에만 추가
const componentNos = [1, 2, 4, 5, 9, 10, 11, 12, 13]; // 13 추가
// → 자동으로 병렬 조회 및 분류 처리
```

### API 변경 대응
```javascript
// 응답 구조 변경 시 getter 함수만 수정
function getMissionStatus(response) {
  return response?.value?.status || 'UNKNOWN';
}

// 상태값 추가 시 분기 로직에만 추가
if (status === 'NEW_STATUS') {
  // 새로운 상태 처리
}
```

---

## 요약

### 핵심 자동화 플로우
1. **병렬 처리**: 8개 component 동시 조회로 성능 최적화
2. **비동기 처리**: 댓글 작성을 백그라운드에서 진행
3. **상태 기반 분기**: API 응답 상태값으로 자동 처리 결정
4. **중복 방지**: 이미 완료된 작업 체크 후 스킵
5. **확장 가능**: 새로운 미션/컴포넌트 추가 시 최소 수정

### 미션 처리 전략
- **SINGLE**: 즉시 참여 → 상태별 자동 분기 (RECEIVABLE/COMPLETE)
- **ACCUMULATION**: 목표 횟수 달성 시까지 반복 참여
- **CONTENT1/ACHIEVEMENT**: 조건 달성 시 자동 완료

### UI/UX 최적화
- 카테고리별 진행률 표시
- 툴팁으로 세부 미션 정보 제공
- 상태 아이콘으로 직관적 시각화 (✅ 🎁 ⏳)
