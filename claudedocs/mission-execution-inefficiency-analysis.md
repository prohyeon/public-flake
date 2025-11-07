# 미션 실행 단계 중복성 및 비효율성 분석

## 🔍 분석 대상
Step 3부터 Step 4.11까지의 미션 실행 함수들:
- `autoParticipateVisitMissions()` (Step 3)
- `visitRequiredPages()` (Step 4)
- `executeDailyMissions()` (Step 4.5)
- `executeContentMissions()` (Step 4.6)
- `executeWeeklyMissions()` (Step 4.7)
- `executeEventMissions()` (Step 4.8)
- `executeBannerMissions()` (Step 4.9)
- `executeAttendanceMissions()` (Step 4.10)
- `executePrizeEntry()` (Step 4.11)

---

## 🚨 심각한 중복 패턴 발견

### 1. **중복된 코드 구조 (95% 유사도)**

모든 `execute*Missions()` 함수들이 거의 동일한 구조를 가짐:

```javascript
// 공통 패턴 (executeDailyMissions, executeWeeklyMissions, executeEventMissions, executeAttendanceMissions)
async function executeXXXMissions(headers) {
    // 1. 활성화 체크
    if (!CONFIG.xxxMissions.enabled) {
        log('⏩ XXX 미션이 비활성화되어 있습니다', 'info');
        return;
    }

    // 2. 헤더 구성 (동일한 코드)
    const missionHeaders = {
        ...headers,
        'accept': 'application/json',
        'content-type': 'application/json'
    };

    // 3. API 조회 (동일한 엔드포인트, componentNo만 다름)
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.xxxMissions.componentNo}`;
    const missionData = await apiRequest(url, 'GET', missionHeaders);

    // 4. 에러 핸들링 (동일한 코드)
    if (!missionData || !missionData.value || !missionData.value.missions) {
        log('⚠️ XXX 미션 데이터를 찾을 수 없습니다', 'warning');
        state.earnings.xxxMissions = 0;
        state.completed.xxxMissions = true;
        return;
    }

    // 5. RECEIVABLE 필터링 (동일한 로직)
    const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

    // 6. 보상 수령 루프 (동일한 코드)
    for (const mission of receivableMissions) {
        const result = await receiveMissionReward(headers, mission.mission_no, CONFIG.xxxMissions.componentNo);
        if (result && result.reward_amount) {
            totalEarned += result.reward_amount;
        }
        await delay(500);
    }

    // 7. 상태 업데이트 (동일한 코드)
    state.earnings.xxxMissions = totalEarned;
    state.completed.xxxMissions = true;
}
```

**중복된 라인 수**: 각 함수당 약 **70-90줄**의 중복 코드
**총 중복 라인**: 약 **350-450줄** (5개 함수 × 70-90줄)

---

## 📊 중복 항목 상세 분석

### A. API 조회 로직 중복 (100% 동일)

```javascript
// executeDailyMissions
const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.dailyMissions.componentNo}`;

// executeWeeklyMissions
const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.weeklyMissions.componentNo}`;

// executeEventMissions
const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.eventMissions.componentNo}`;

// executeAttendanceMissions
const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.attendanceMissions.componentNo}`;
```

**차이점**: `componentNo`만 다름
**중복도**: 5개 함수에서 동일한 패턴 반복

---

### B. 헤더 구성 중복 (100% 동일)

```javascript
// 모든 함수에서 동일
const missionHeaders = {
    ...headers,
    'accept': 'application/json',
    'content-type': 'application/json'
};

// 또는
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
```

**중복도**: 모든 함수에서 동일한 헤더 구성 로직 반복

---

### C. 에러 핸들링 중복 (95% 동일)

```javascript
// 모든 함수에서 거의 동일
if (!missionData || !missionData.value || !missionData.value.missions) {
    log('⚠️ XXX 미션 데이터를 찾을 수 없습니다', 'warning');
    state.earnings.xxxMissions = 0;
    state.completed.xxxMissions = true;
    return;
}
```

**차이점**: 로그 메시지와 `state.earnings` 키만 다름
**중복도**: 5개 함수에서 반복

---

### D. RECEIVABLE 필터링 및 보상 수령 (100% 동일)

```javascript
// 모든 함수에서 동일한 패턴
const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

if (receivableMissions.length === 0) {
    log('ℹ️ 수령 가능한 XXX 미션이 없습니다', 'info');
} else {
    log(`💰 수령 가능한 미션: ${receivableMissions.length}개`, 'info');

    for (const mission of receivableMissions) {
        log(`⏳ "${mission.title}" 수령 중...`, 'info');

        const result = await receiveMissionReward(
            headers,
            mission.mission_no,
            CONFIG.xxxMissions.componentNo
        );

        if (result && result.reward_amount) {
            totalEarned += result.reward_amount;
            log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success');
        }

        await delay(500);
    }
}
```

**중복도**: 5개 함수에서 동일한 로직 반복

---

### E. 상태 업데이트 중복 (100% 동일)

```javascript
// 모든 함수에서 동일
state.earnings.xxxMissions = totalEarned;
state.completed.xxxMissions = true;

if (totalEarned > 0) {
    log(`✅ XXX 미션 완료! 총 ${totalEarned} FLAKE 획득`, 'success');
}
```

**차이점**: `state.earnings` 키와 로그 메시지만 다름
**중복도**: 5개 함수에서 반복

---

## 🔄 비효율적인 API 호출 패턴

### 1. **순차 API 호출 (병렬 가능한데 순차 실행)**

현재 구조:
```javascript
// Step 4.5: executeDailyMissions()
await executeDailyMissions(headers);     // componentNo=1 조회
await delay(CONFIG.delays.betweenActions);

// Step 4.6: executeContentMissions()
await executeContentMissions(headers);   // componentNo=4 조회
await delay(CONFIG.delays.betweenActions);

// Step 4.7: executeWeeklyMissions()
await executeWeeklyMissions(headers);    // componentNo=2 조회
await delay(CONFIG.delays.betweenActions);

// Step 4.8: executeEventMissions()
await executeEventMissions(headers);     // componentNo=9 조회
await delay(CONFIG.delays.betweenActions);

// Step 4.10: executeAttendanceMissions()
await executeAttendanceMissions(headers); // componentNo=10 조회
```

**문제점**:
- 각 함수가 개별적으로 API를 호출하고 대기
- 5개 함수 × (API 호출 시간 + delay) = 총 5-10초 소요
- **병렬 처리 시 1-2초로 단축 가능**

---

### 2. **중복된 미션 상태 조회**

#### Step 3에서 이미 조회했는데 다시 조회
```javascript
// Step 3: autoParticipateVisitMissions()
async function autoParticipateVisitMissions(headers) {
    // getAllDailyMissions()는 componentNo [1, 2, 4, 5, 9, 10, 11, 12]를 모두 조회
    const allMissions = await getAllDailyMissions(headers);

    // 이미 여기서 모든 component의 미션 데이터를 가져옴!
}

// Step 4.5: executeDailyMissions()
async function executeDailyMissions(headers) {
    // componentNo=1 다시 조회 (Step 3에서 이미 조회했는데!)
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.dailyMissions.componentNo}`;
    const missionData = await apiRequest(url, 'GET', missionHeaders);
}

// Step 4.7: executeWeeklyMissions()
async function executeWeeklyMissions(headers) {
    // componentNo=2 다시 조회 (Step 3에서 이미 조회했는데!)
    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.weeklyMissions.componentNo}`;
    const missionData = await apiRequest(url, 'GET', missionHeaders);
}
```

**문제점**:
- `getAllDailyMissions()`에서 이미 8개 component 조회
- 각 `execute*Missions()`에서 같은 데이터를 다시 조회
- **불필요한 API 호출 최소 5회 발생**

---

### 3. **특수 케이스: executeDailyMissions의 이중 조회**

```javascript
async function executeDailyMissions(headers) {
    // 1차 조회
    const missionData = await getDailyMissions(headers);

    // 방문 미션 수행
    await executeVisitMission(mission);

    // 2차 조회 (상태 갱신을 위해 같은 데이터 다시 조회)
    const updatedMissionData = await getDailyMissions(headers);

    // RECEIVABLE 필터링 및 보상 수령
    const receivableMissions = updatedMissionData.missions.filter(m => m.status === 'RECEIVABLE');
}
```

**문제점**:
- 같은 함수 내에서 같은 엔드포인트를 2번 조회
- 상태 갱신이 필요하긴 하지만, 첫 조회에서 INCOMPLETE 상태만 처리하면 1회로 축소 가능

---

## 📈 성능 영향 분석

### 현재 실행 시간 (추정)
```
Step 3:  autoParticipateVisitMissions()  - 8 API calls (병렬)    = 1-2초
Step 4.5: executeDailyMissions()         - 2 API calls          = 1-2초
Step 4.6: executeContentMissions()       - 2 API calls          = 1-2초
Step 4.7: executeWeeklyMissions()        - 1 API call           = 0.5-1초
Step 4.8: executeEventMissions()         - 1 API call           = 0.5-1초
Step 4.10: executeAttendanceMissions()   - 1 API call           = 0.5-1초
--------------------------------
총 소요 시간: 약 5-9초
```

### 최적화 후 예상 시간
```
한 번의 getAllDailyMissions() 호출로 모든 데이터 조회 = 1-2초
병렬 처리로 보상 수령                                = 1초
--------------------------------
총 소요 시간: 약 2-3초 (60-70% 단축)
```

---

## 🛠️ 리팩토링 권장사항

### 1. **공통 함수 추출 (최우선)**

#### A. 미션 조회 공통 함수
```javascript
async function fetchMissionComponent(headers, componentNo, componentName) {
    const missionHeaders = {
        ...headers,
        'accept': 'application/json',
        'content-type': 'application/json'
    };

    const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${componentNo}`;
    const missionData = await apiRequest(url, 'GET', missionHeaders);

    if (!missionData || !missionData.value || !missionData.value.missions) {
        log(`⚠️ ${componentName} 미션 데이터를 찾을 수 없습니다`, 'warning');
        return null;
    }

    return missionData.value.missions;
}
```

#### B. 보상 수령 공통 함수
```javascript
async function claimReceivableRewards(headers, missions, componentNo, componentName) {
    const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

    if (receivableMissions.length === 0) {
        log(`ℹ️ 수령 가능한 ${componentName} 미션이 없습니다`, 'info');
        return 0;
    }

    log(`💰 수령 가능한 ${componentName} 미션: ${receivableMissions.length}개`, 'info');

    let totalEarned = 0;
    for (const mission of receivableMissions) {
        const result = await receiveMissionReward(headers, mission.mission_no, componentNo);

        if (result && result.reward_amount) {
            totalEarned += result.reward_amount;
            log(`  ✓ "${mission.title}": +${result.reward_amount} FLAKE`, 'success');
        }

        await delay(500);
    }

    return totalEarned;
}
```

#### C. 통합 미션 실행 함수
```javascript
async function executeMissionComponent(headers, config, componentName) {
    if (!config.enabled) {
        log(`⏩ ${componentName} 미션이 비활성화되어 있습니다`, 'info');
        return 0;
    }

    log(`📋 ${componentName} 미션 시작...`, 'info');

    try {
        // 1. 미션 조회
        const missions = await fetchMissionComponent(headers, config.componentNo, componentName);
        if (!missions) return 0;

        log(`📝 총 ${missions.length}개 ${componentName} 미션 확인`, 'info');

        // 2. 특수 처리 (방문 미션 등)
        if (config.visitHandler) {
            await config.visitHandler(headers, missions);
            // 상태 갱신을 위해 재조회
            missions = await fetchMissionComponent(headers, config.componentNo, componentName);
        }

        // 3. 보상 수령
        const totalEarned = await claimReceivableRewards(headers, missions, config.componentNo, componentName);

        log(`✅ ${componentName} 미션 처리 완료! +${totalEarned} FLAKE`, 'success');
        return totalEarned;

    } catch (error) {
        log(`✗ ${componentName} 미션 오류: ${error.message}`, 'error');
        return 0;
    }
}
```

---

### 2. **미션 실행 함수 단순화**

#### Before (95줄)
```javascript
async function executeWeeklyMissions(headers) {
    if (!CONFIG.weeklyMissions.enabled) {
        log('⏩ 위클리 미션이 비활성화되어 있습니다', 'info');
        return;
    }

    log('📅 위클리 미션 시작...', 'info');
    let totalEarned = 0;

    try {
        const url = `${CONFIG.api.baseUrl}/flake-shop/v1/mission/component?component_no=${CONFIG.weeklyMissions.componentNo}`;

        const missionHeaders = {
            'Authorization': headers['Authorization'],
            'caller-id': 'flake-fe',
            // ... 15줄의 헤더 구성
        };

        const missionData = await apiRequest(url, 'GET', missionHeaders);

        if (!missionData || missionData.code !== 0 || !missionData.value || !missionData.value.missions) {
            log('✗ 위클리 미션 목록 조회 실패', 'error');
            state.earnings.weeklyMissions = 0;
            state.completed.weeklyMissions = true;
            return;
        }

        const missions = missionData.value.missions;
        log(`📝 총 ${missions.length}개 위클리 미션 확인`, 'info');

        const receivableMissions = missions.filter(m => m.status === 'RECEIVABLE');

        if (receivableMissions.length === 0) {
            log('ℹ️ 수령 가능한 위클리 미션이 없습니다', 'info');
        } else {
            log(`🎁 수령 가능한 위클리 미션 ${receivableMissions.length}개 발견`, 'info');

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

        state.earnings.weeklyMissions = totalEarned;
        state.completed.weeklyMissions = true;

        const completedCount = missions.filter(m => m.status === 'COMPLETE' || m.status === 'COMPLETED').length;
        const totalCount = missions.length;
        log(`📊 위클리 미션 진행 상황: ${completedCount}/${totalCount} 완료`, 'info');

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
```

#### After (5줄)
```javascript
async function executeWeeklyMissions(headers) {
    const totalEarned = await executeMissionComponent(
        headers,
        CONFIG.weeklyMissions,
        '위클리'
    );

    state.earnings.weeklyMissions = totalEarned;
    state.completed.weeklyMissions = true;
}
```

**코드 감소**: 95줄 → 5줄 (95% 감소)
**중복 제거**: 5개 함수에서 반복되는 코드 → 1개 공통 함수

---

### 3. **캐시 활용으로 중복 API 호출 제거**

```javascript
// 미션 데이터 캐시
const missionCache = {
    data: null,
    timestamp: 0,
    ttl: 5000 // 5초간 유효
};

async function getAllDailyMissionsWithCache(headers) {
    const now = Date.now();

    // 캐시가 유효하면 재사용
    if (missionCache.data && (now - missionCache.timestamp) < missionCache.ttl) {
        log('📦 캐시된 미션 데이터 사용', 'info');
        return missionCache.data;
    }

    // 캐시가 없거나 만료되면 새로 조회
    const allMissions = await getAllDailyMissions(headers);

    missionCache.data = allMissions;
    missionCache.timestamp = now;

    return allMissions;
}

// 사용 예시
async function executeDailyMissions(headers) {
    // Step 3에서 조회한 데이터 재사용
    const cachedMissions = await getAllDailyMissionsWithCache(headers);
    const dailyMissions = cachedMissions.find(c => c.componentNo === CONFIG.dailyMissions.componentNo);
    // ...
}
```

**효과**:
- Step 3 이후 5개 함수의 중복 API 호출 제거
- API 호출 횟수: 13회 → 8회 (40% 감소)

---

### 4. **병렬 처리로 성능 개선**

#### Before (순차 실행)
```javascript
await executeDailyMissions(headers);
await delay(CONFIG.delays.betweenActions);

await executeContentMissions(headers);
await delay(CONFIG.delays.betweenActions);

await executeWeeklyMissions(headers);
await delay(CONFIG.delays.betweenActions);

await executeEventMissions(headers);
await delay(CONFIG.delays.betweenActions);

await executeAttendanceMissions(headers);
```

**소요 시간**: 5-9초

#### After (병렬 실행)
```javascript
const missionConfigs = [
    { config: CONFIG.dailyMissions, name: '데일리', stateKey: 'dailyMissions' },
    { config: CONFIG.contentMissions, name: '컨텐츠', stateKey: 'contentMissions' },
    { config: CONFIG.weeklyMissions, name: '위클리', stateKey: 'weeklyMissions' },
    { config: CONFIG.eventMissions, name: '이벤트', stateKey: 'eventMissions' },
    { config: CONFIG.attendanceMissions, name: '출석', stateKey: 'attendanceMissions' }
];

// 병렬 실행
const results = await Promise.all(
    missionConfigs.map(({ config, name }) =>
        executeMissionComponent(headers, config, name)
    )
);

// 상태 업데이트
missionConfigs.forEach(({ stateKey }, index) => {
    state.earnings[stateKey] = results[index];
    state.completed[stateKey] = true;
});
```

**소요 시간**: 2-3초 (60-70% 단축)

---

## 📋 리팩토링 우선순위

### 🔴 Priority 1: 공통 함수 추출 (가장 시급)
- **작업 크기**: 중간
- **효과**: 코드 350-450줄 감소 (80% 중복 제거)
- **난이도**: 낮음
- **리스크**: 낮음
- **예상 작업 시간**: 2-3시간

### 🟡 Priority 2: 캐시 도입으로 중복 API 호출 제거
- **작업 크기**: 작음
- **효과**: API 호출 40% 감소 (13회 → 8회)
- **난이도**: 낮음
- **리스크**: 낮음 (TTL 설정 주의)
- **예상 작업 시간**: 1시간

### 🟢 Priority 3: 병렬 처리 도입
- **작업 크기**: 중간
- **효과**: 실행 시간 60-70% 단축 (5-9초 → 2-3초)
- **난이도**: 중간
- **리스크**: 중간 (API rate limit 고려 필요)
- **예상 작업 시간**: 2-3시간

---

## 💡 추가 개선 사항

### A. CONFIG 구조 통합
```javascript
// Before (분산된 설정)
CONFIG.dailyMissions.componentNo
CONFIG.weeklyMissions.componentNo
CONFIG.eventMissions.componentNo

// After (통합된 설정)
CONFIG.missions = {
    daily: { componentNo: 1, enabled: true, name: '데일리' },
    weekly: { componentNo: 2, enabled: true, name: '위클리' },
    event: { componentNo: 9, enabled: true, name: '이벤트' },
    attendance: { componentNo: 10, enabled: true, name: '출석' }
};
```

### B. 로깅 통일
```javascript
// Before (각 함수마다 다른 로그 포맷)
log('📅 위클리 미션 시작...', 'info');
log('🎉 이벤트 미션 시작...', 'info');
log('📆 출석 미션 시작...', 'info');

// After (통일된 로그 포맷)
function logMissionStart(missionName) {
    log(`📋 ${missionName} 미션 시작...`, 'info');
}
```

### C. 에러 핸들링 개선
```javascript
// Before (각 함수마다 개별 처리)
try {
    // ...
} catch (error) {
    log(`✗ 위클리 미션 오류: ${error.message}`, 'error');
}

// After (공통 에러 핸들러)
async function executeMissionWithErrorHandling(missionName, executionFn) {
    try {
        return await executionFn();
    } catch (error) {
        log(`✗ ${missionName} 미션 오류: ${error.message}`, 'error');
        console.error(`${missionName} error details:`, error);
        return 0;
    }
}
```

---

## 📊 예상 효과 요약

| 항목 | 현재 | 리팩토링 후 | 개선율 |
|------|------|------------|--------|
| 코드 라인 수 | ~500줄 | ~150줄 | 70% 감소 |
| API 호출 횟수 | 13회 | 8회 | 40% 감소 |
| 실행 시간 | 5-9초 | 2-3초 | 60-70% 단축 |
| 중복 코드 | 350-450줄 | 0줄 | 100% 제거 |
| 유지보수성 | 낮음 | 높음 | ⬆️⬆️⬆️ |

---

## ⚠️ 주의사항

### 리팩토링 시 고려할 점
1. **API Rate Limit**: 병렬 처리 시 서버 부하 고려
2. **순서 의존성**: `executeDailyMissions`의 방문 미션 처리는 순차 유지 필요
3. **상태 동기화**: 캐시 사용 시 TTL 적절히 설정
4. **테스트 필수**: 각 미션 타입별로 철저한 테스트 필요

### 리팩토링 단계별 진행
1. **1단계**: 공통 함수 추출 및 단위 테스트
2. **2단계**: 캐시 도입 및 검증
3. **3단계**: 병렬 처리 적용 및 성능 측정
4. **4단계**: 전체 통합 테스트

---

## 🎯 결론

현재 미션 실행 단계는 **심각한 코드 중복**(350-450줄)과 **비효율적인 API 호출 패턴**(13회 중 5회 중복)을 가지고 있습니다.

**리팩토링을 통해**:
- ✅ 코드 70% 감소 (500줄 → 150줄)
- ✅ API 호출 40% 감소 (13회 → 8회)
- ✅ 실행 시간 60-70% 단축 (5-9초 → 2-3초)
- ✅ 유지보수성 대폭 향상

**권장 작업 순서**: Priority 1 → Priority 2 → Priority 3
**예상 총 작업 시간**: 5-7시간
**예상 ROI**: 매우 높음 (코드 품질 + 성능 + 유지보수성)
