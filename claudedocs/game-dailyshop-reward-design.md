# 🎮 게임 데일리샵 출석 보상 자동 수령 시스템 설계

## 📋 설계 개요

### 목표
아스텔리아M 게임의 데일리샵 출석 보상을 자동으로 수령하는 시스템 추가 (Step 11)

### 사용자 결정사항
1. ✅ **게임 범위**: 아스텔리아M만 지원 (단순 구현)
2. ✅ **캐릭터 선택**: 첫 번째 캐릭터 자동 선택
3. ✅ **보상 범위**: 모든 타입 수령 (ITEMBOX, FLAKE, COUPON)
4. ✅ **수령 조건**: KST 기준 오늘 + `is_received: false`
5. ✅ **에러 처리**: 실패 시 스킵하고 다음으로

---

## 🔍 기존 코드 분석 결과

### ✅ 이미 구현된 기능

#### 1. FLAKE 합산 로직 (stove-quest-automation.user.js:1616)
```javascript
if (reward.item_type === 'FLAKE') {
    const rewardAmount = reward.flake_amount || 0;
    dailyAccumulatedFlake += rewardAmount;
    log(`✓ FLAKE 보상 수령 완료: ${rewardAmount.toLocaleString()} FLAKE`, 'success');
}
```

#### 2. 총 보상 합산 (stove-quest-automation.user.js:1642)
```javascript
const totalEarnings = questActivityFlake + state.earnings.roulette +
                     state.earnings.rouletteExtra + state.earnings.dailyShop +
                     state.earnings.majak + state.earnings.dailyMissions +
                     state.earnings.contentMissions + state.earnings.weeklyMissions +
                     state.earnings.eventMissions + state.earnings.bannerMissions +
                     state.earnings.attendanceMissions + state.earnings.prizeEntry +
                     dailyAccumulatedFlake;
```

#### 3. 누적 보상 조건 체크 (stove-quest-automation.user.js:1582)
```javascript
const claimableRewards = accumulatedRewards.filter(reward =>
    totalDays >= reward.rewardable_days && !reward.is_received
);
```

#### 4. 게임 소유권 체크 (stove-quest-automation.user.js:1593-1598)
```javascript
if (reward.item_type === 'INDIE_GAME_COUPON' && reward.game_id) {
    const ownershipData = await checkGameOwnership(headers, reward.game_id);
    if (ownershipData && ownershipData.value && ownershipData.value.owner_list && ownershipData.value.owner_list.length > 0) {
        log(`⚠️ 이미 소유한 게임: ${reward.item_name} - 수령 건너뜀`, 'warning');
        continue;
    }
}
```

### ✅ 재사용 가능한 함수
- `claimDailyAccumulatedReward()` - 누적 보상 수령 (FLAKE, COUPON, LIBRARY 지원)
- `checkGameOwnership()` - 게임 소유권 확인

---

## 🏗️ 새로운 시스템 구조 설계

### API 엔드포인트

#### 0. 보상 조회 API
```javascript
GET https://api.onstove.com/dailyshop/v1.0/{YYYYMM}/services/{GAME_ID}

// 예: https://api.onstove.com/dailyshop/v1.0/202511/services/ASTELLIA_IND
```

**응답 구조**:
```javascript
{
  code: 0,
  message: "OK",
  value: {
    game_info: { ... },
    daily_attendances: {
      rewards: [
        {
          item_type: "ITEMBOX" | "FLAKE",
          attendance_date: "2025-11-06",
          item_no: 1556,
          item_name: "일반 아스텔 소환 11회",
          is_received: false,
          has_game_character: true,
          game_id: "ASTELLIA_IND",
          item_id: "63901031"
        }
      ]
    },
    accumulated_attendances: {
      total_attendance_days: 1,
      rewards: [
        {
          item_type: "ITEMBOX" | "FLAKE" | "INDIE_SALE_COUPON",
          rewardable_days: 3,
          item_no: 240,
          is_received: false,
          has_game_character: true
        }
      ]
    }
  }
}
```

#### 1. 캐릭터 조회 API
```javascript
GET https://api.onstove.com/dailyshop/v1.0/game/{GAME_ID}/characters

// 예: https://api.onstove.com/dailyshop/v1.0/game/ASTELLIA_IND/characters
```

**응답 구조**:
```javascript
{
  code: 0,
  message: "OK",
  value: {
    guid: "20039967058",
    is_required_character: true,
    characters: [
      {
        character_seq: 374277168,
        name: "너시오",
        server_id: "astellia"
      }
    ]
  }
}
```

#### 2. 보상 수령 API
```javascript
POST https://api.onstove.com/dailyshop/v1.0/attendances/daily/itembox

Query Params:
  - item_no: 1556
  - reward_type: "itembox" | "flake"
  - guid: "20039967058"
  - character_seq: 374277168

Body:
{
  item_no: 1556,
  reward_type: "itembox",
  guid: "20039967058",
  character_seq: 374277168
}
```

**응답**:
```javascript
{
  code: 0,
  message: "OK",
  value: {
    total_attendance_days: 1
  }
}
```

---

## 💻 구현 계획

### Phase 1: API 함수 구현

#### 1-1. 보상 조회 함수
```javascript
async function getGameDailyShopData(headers, gameId = 'ASTELLIA_IND') {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/${yearMonth}/services/${gameId}`;

    console.log(`[게임 데일리샵 조회] URL: ${url}, Game: ${gameId}`);

    const eventHeaders = {
        'Authorization': headers['Authorization'],
        'caller-id': 'event-hub',
        'caller-detail': headers['X-UUID'] || headers['caller-detail'],
        'x-lang': 'ko',
        'x-nation': 'KR',
        'x-timezone': 'Asia/Seoul',
        'x-utc-offset': '540',
        'x-device-type': 'pc',
        'x-client-lang': 'ko',
        'accept': 'application/json, text/plain, */*',
        'Origin': 'https://event.onstove.com',
        'Referer': 'https://event.onstove.com/'
    };

    const response = await apiRequest(url, 'GET', eventHeaders);
    console.log(`[게임 데일리샵 조회] Response code:`, response?.code);
    return response;
}
```

#### 1-2. 캐릭터 조회 함수
```javascript
async function getGameCharacters(headers, gameId = 'ASTELLIA_IND') {
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/game/${gameId}/characters`;

    console.log(`[게임 캐릭터 조회] URL: ${url}, Game: ${gameId}`);

    const eventHeaders = {
        'Authorization': headers['Authorization'],
        'caller-id': 'event-hub',
        'caller-detail': headers['X-UUID'] || headers['caller-detail'],
        'x-lang': 'ko',
        'x-nation': 'KR',
        'x-timezone': 'Asia/Seoul',
        'x-utc-offset': '540',
        'x-device-type': 'pc',
        'x-client-lang': 'ko',
        'accept': 'application/json, text/plain, */*',
        'Origin': 'https://event.onstove.com',
        'Referer': 'https://event.onstove.com/'
    };

    const response = await apiRequest(url, 'GET', eventHeaders);
    console.log(`[게임 캐릭터 조회] Response:`, response);
    return response;
}
```

#### 1-3. 데일리 보상 수령 함수
```javascript
async function claimGameDailyReward(headers, itemNo, rewardType, guid, characterSeq) {
    const url = `${CONFIG.api.baseUrl}/dailyshop/v1.0/attendances/daily/${rewardType}`;

    console.log(`[게임 데일리 보상 수령] item_no: ${itemNo}, type: ${rewardType}`);

    const eventHeaders = {
        'Authorization': headers['Authorization'],
        'caller-id': 'event-hub',
        'caller-detail': headers['X-UUID'] || headers['caller-detail'],
        'content-type': 'application/json',
        'x-lang': 'ko',
        'x-nation': 'KR',
        'x-timezone': 'Asia/Seoul',
        'x-utc-offset': '540',
        'x-device-type': 'pc',
        'x-client-lang': 'ko',
        'accept': 'application/json, text/plain, */*',
        'Origin': 'https://event.onstove.com',
        'Referer': 'https://event.onstove.com/'
    };

    // Query params
    const queryParams = new URLSearchParams({
        item_no: itemNo,
        reward_type: rewardType
    });

    // 캐릭터 정보가 있으면 추가
    if (guid) queryParams.append('guid', guid);
    if (characterSeq) queryParams.append('character_seq', characterSeq);

    const fullUrl = `${url}?${queryParams.toString()}`;

    const body = {
        item_no: itemNo,
        reward_type: rewardType
    };

    // 캐릭터 정보가 있으면 body에도 추가
    if (guid) body.guid = guid;
    if (characterSeq) body.character_seq = characterSeq;

    const response = await apiRequest(fullUrl, 'POST', eventHeaders, body);
    console.log(`[게임 데일리 보상 수령] Response:`, response);
    return response;
}
```

#### 1-4. 누적 보상 수령 함수 (기존 함수 활용)
```javascript
// 기존 claimDailyAccumulatedReward() 함수 재사용
// FLAKE, INDIE_SALE_COUPON, ITEMBOX 타입 모두 지원
```

---

### Phase 2: 메인 실행 함수

```javascript
async function executeGameDailyShopRewards(headers) {
    if (!CONFIG.gameDailyShop.enabled) {
        log('⏩ 게임 데일리샵 출석 보상이 비활성화되어 있습니다', 'info');
        return;
    }

    log('🎮 게임 데일리샵 출석 보상 시작...', 'info');
    let totalFlakeEarned = 0;

    try {
        const gameId = CONFIG.gameDailyShop.gameId; // 'ASTELLIA_IND'

        // Step 1: 보상 데이터 조회
        log('📋 보상 데이터 조회 중...', 'info');
        const shopData = await getGameDailyShopData(headers, gameId);

        if (!shopData || shopData.code !== 0 || !shopData.value) {
            log('⚠️ 게임 데일리샵 데이터를 가져올 수 없습니다', 'warning');
            state.earnings.gameDailyShop = 0;
            state.completed.gameDailyShop = true;
            return;
        }

        log(`✓ 게임 정보: ${shopData.value.game_info.game_name}`, 'success');

        // Step 2: 캐릭터 필요 여부 확인
        const dailyRewards = shopData.value.daily_attendances?.rewards || [];
        const accumulatedRewards = shopData.value.accumulated_attendances?.rewards || [];

        const needsCharacter = [...dailyRewards, ...accumulatedRewards].some(
            reward => reward.has_game_character === true
        );

        let characterInfo = null;
        if (needsCharacter) {
            log('🎭 캐릭터 정보 조회 중...', 'info');
            characterInfo = await getGameCharacters(headers, gameId);

            if (!characterInfo || characterInfo.code !== 0 || !characterInfo.value) {
                log('⚠️ 캐릭터 정보를 가져올 수 없습니다', 'warning');
                state.earnings.gameDailyShop = 0;
                state.completed.gameDailyShop = true;
                return;
            }

            const characters = characterInfo.value.characters || [];
            if (characters.length === 0) {
                log('⚠️ 등록된 캐릭터가 없습니다', 'warning');
                state.earnings.gameDailyShop = 0;
                state.completed.gameDailyShop = true;
                return;
            }

            // 첫 번째 캐릭터 선택
            const selectedCharacter = characters[0];
            log(`✓ 선택된 캐릭터: ${selectedCharacter.name} (${selectedCharacter.server_id})`, 'success');
        }

        // Step 3: 데일리 출석 보상 수령 (오늘 날짜 + 미수령)
        log('', 'info');
        log('📅 데일리 출석 보상 확인 중...', 'info');

        // KST 기준 오늘 날짜
        const today = new Date();
        const kstOffset = 9 * 60; // KST = UTC+9
        const kstDate = new Date(today.getTime() + kstOffset * 60 * 1000);
        const todayStr = kstDate.toISOString().split('T')[0]; // "2025-11-07"

        log(`📆 오늘 날짜 (KST): ${todayStr}`, 'info');

        const todayRewards = dailyRewards.filter(reward =>
            reward.attendance_date === todayStr && !reward.is_received
        );

        if (todayRewards.length === 0) {
            log('ℹ️ 오늘 수령 가능한 데일리 보상이 없습니다', 'info');
        } else {
            log(`💰 수령 가능한 데일리 보상: ${todayRewards.length}개`, 'info');

            for (const reward of todayRewards) {
                try {
                    log(`⏳ "${reward.item_name}" 수령 중...`, 'info');

                    // reward_type 결정
                    let rewardType;
                    if (reward.item_type === 'ITEMBOX') {
                        rewardType = 'itembox';
                    } else if (reward.item_type === 'FLAKE') {
                        rewardType = 'flake';
                    } else {
                        log(`  ⚠️ 알 수 없는 보상 타입: ${reward.item_type}`, 'warning');
                        continue;
                    }

                    // 캐릭터 정보 추출
                    let guid = null;
                    let characterSeq = null;

                    if (reward.has_game_character && characterInfo) {
                        guid = characterInfo.value.guid;
                        characterSeq = characterInfo.value.characters[0].character_seq;
                    }

                    // 보상 수령
                    const result = await claimGameDailyReward(
                        headers,
                        reward.item_no,
                        rewardType,
                        guid,
                        characterSeq
                    );

                    if (result && result.code === 0) {
                        if (reward.item_type === 'FLAKE') {
                            const rewardAmount = reward.flake_amount || 0;
                            totalFlakeEarned += rewardAmount;
                            log(`  ✓ "${reward.item_name}": +${rewardAmount.toLocaleString()} FLAKE`, 'success');
                        } else {
                            log(`  ✓ "${reward.item_name}" 수령 완료`, 'success');
                        }
                    } else {
                        const errorCode = result?.code || 'N/A';
                        const errorMsg = result?.message || 'N/A';
                        log(`  ✗ 수령 실패: ${reward.item_name} (코드: ${errorCode}, 메시지: ${errorMsg})`, 'error');
                    }

                    await delay(500);
                } catch (e) {
                    log(`  ✗ 수령 오류 (${reward.item_name}): ${e.message}`, 'error');
                }
            }
        }

        // Step 4: 누적 출석 보상 수령
        log('', 'info');
        log('📦 누적 출석 보상 확인 중...', 'info');

        const totalDays = shopData.value.accumulated_attendances?.total_attendance_days || 0;
        log(`현재 누적 출석일: ${totalDays}일`, 'info');

        const claimableAccumulated = accumulatedRewards.filter(reward =>
            totalDays >= reward.rewardable_days && !reward.is_received
        );

        if (claimableAccumulated.length === 0) {
            log('ℹ️ 수령 가능한 누적 보상이 없습니다', 'info');
        } else {
            log(`💰 수령 가능한 누적 보상: ${claimableAccumulated.length}개`, 'info');

            for (const reward of claimableAccumulated) {
                try {
                    log(`⏳ "${reward.item_name}" 수령 중... (${reward.rewardable_days}일 달성)`, 'info');

                    // 게임 소유권 체크 (INDIE_GAME_COUPON만)
                    if (reward.item_type === 'INDIE_GAME_COUPON' && reward.game_id) {
                        const ownershipData = await checkGameOwnership(headers, reward.game_id);
                        if (ownershipData && ownershipData.value && ownershipData.value.owner_list && ownershipData.value.owner_list.length > 0) {
                            log(`  ⚠️ 이미 소유한 게임: ${reward.item_name} - 수령 건너뜀`, 'warning');
                            continue;
                        }
                    }

                    // 누적 보상 수령 (기존 함수 재사용)
                    const result = await claimDailyAccumulatedReward(headers, reward.item_no, reward.item_type);

                    if (result && result.code === 0) {
                        if (reward.item_type === 'FLAKE') {
                            const rewardAmount = reward.flake_amount || 0;
                            totalFlakeEarned += rewardAmount;
                            log(`  ✓ "${reward.item_name}": +${rewardAmount.toLocaleString()} FLAKE`, 'success');
                        } else {
                            log(`  ✓ "${reward.item_name}" 수령 완료`, 'success');
                        }
                    } else {
                        const errorCode = result?.code || 'N/A';
                        const errorMsg = result?.message || 'N/A';
                        log(`  ✗ 수령 실패: ${reward.item_name} (코드: ${errorCode}, 메시지: ${errorMsg})`, 'error');
                    }

                    await delay(500);
                } catch (e) {
                    log(`  ✗ 수령 오류 (${reward.item_name}): ${e.message}`, 'error');
                }
            }
        }

        // 상태 업데이트
        state.earnings.gameDailyShop = totalFlakeEarned;
        state.completed.gameDailyShop = true;

        if (totalFlakeEarned > 0) {
            log(`✅ 게임 데일리샵 출석 보상 완료! 총 ${totalFlakeEarned.toLocaleString()} FLAKE 획득`, 'success');
        } else {
            log('✅ 게임 데일리샵 출석 보상 처리 완료 (FLAKE 수령 없음)', 'success');
        }

    } catch (error) {
        log(`✗ 게임 데일리샵 출석 보상 오류: ${error.message}`, 'error');
        console.error('Game daily shop error details:', error);
    }

    log('✅ 게임 데일리샵 출석 보상 처리 완료!', 'success');
}
```

---

### Phase 3: CONFIG 설정 추가

```javascript
// CONFIG 객체에 추가
gameDailyShop: {
    enabled: true,
    gameId: 'ASTELLIA_IND'
},
```

### Phase 4: state 객체 확장

```javascript
// state.earnings에 추가
state.earnings.gameDailyShop = 0;

// state.completed에 추가
state.completed.gameDailyShop = false;
```

### Phase 5: 총 수익 계산 업데이트

```javascript
// totalEarnings 계산 시 추가
const totalEarnings = questActivityFlake + state.earnings.roulette +
                     state.earnings.rouletteExtra + state.earnings.dailyShop +
                     state.earnings.majak + state.earnings.dailyMissions +
                     state.earnings.contentMissions + state.earnings.weeklyMissions +
                     state.earnings.eventMissions + state.earnings.bannerMissions +
                     state.earnings.attendanceMissions + state.earnings.prizeEntry +
                     dailyAccumulatedFlake + state.earnings.gameDailyShop;  // ← 추가
```

---

## 📊 실행 플로우

```
Step 11: executeGameDailyShopRewards()
├─ 1. 보상 데이터 조회
│   └─ GET /dailyshop/v1.0/{YYYYMM}/services/ASTELLIA_IND
│
├─ 2. 캐릭터 정보 조회 (필요시)
│   ├─ has_game_character: true인 보상 존재 체크
│   └─ GET /dailyshop/v1.0/game/ASTELLIA_IND/characters
│       └─ 첫 번째 캐릭터 선택
│
├─ 3. 데일리 출석 보상 수령
│   ├─ 필터링: attendance_date === 오늘(KST) && !is_received
│   └─ 각 보상에 대해:
│       ├─ ITEMBOX → POST /attendances/daily/itembox
│       ├─ FLAKE → POST /attendances/daily/flake
│       └─ FLAKE 보상 시 totalFlakeEarned에 합산
│
├─ 4. 누적 출석 보상 수령
│   ├─ 필터링: total_attendance_days >= rewardable_days && !is_received
│   └─ 각 보상에 대해:
│       ├─ INDIE_GAME_COUPON → 게임 소유권 체크
│       ├─ claimDailyAccumulatedReward() 호출
│       └─ FLAKE 보상 시 totalFlakeEarned에 합산
│
└─ 5. 상태 업데이트
    ├─ state.earnings.gameDailyShop = totalFlakeEarned
    └─ totalEarnings 계산에 포함
```

---

## ✅ 체크리스트

### API 관련
- [x] **FLAKE 합산 로직**: 기존 코드에 존재 (dailyAccumulatedFlake)
- [x] **총 보상 합산**: totalEarnings 계산에 포함됨
- [x] **누적 보상 조건 체크**: `totalDays >= rewardable_days && !is_received`
- [x] **게임 소유권 체크**: INDIE_GAME_COUPON 타입에 대해 구현됨
- [x] **KST 날짜 처리**: UTC+9 오프셋 적용하여 오늘 날짜 계산
- [x] **has_game_character 체크**: 캐릭터 필요 여부 동적 확인

### 보상 타입별 처리
- [x] **ITEMBOX**: rewardType='itembox', 캐릭터 정보 필요
- [x] **FLAKE**: rewardType='flake', 캐릭터 정보 불필요, 금액 합산
- [x] **INDIE_SALE_COUPON**: 기존 claimDailyAccumulatedReward() 재사용

### 에러 처리
- [x] **API 실패 시**: 에러 로그 출력 후 다음 보상으로 스킵
- [x] **캐릭터 없음**: 경고 로그 출력 후 함수 종료
- [x] **보상 데이터 없음**: 경고 로그 출력 후 함수 종료

---

## 🎯 구현 순서

1. **Phase 1**: API 함수 3개 추가 (보상 조회, 캐릭터 조회, 보상 수령)
2. **Phase 2**: 메인 실행 함수 추가 (executeGameDailyShopRewards)
3. **Phase 3**: CONFIG 설정 추가
4. **Phase 4**: state 객체 확장
5. **Phase 5**: 메인 플로우에 Step 11 통합
6. **Phase 6**: 총 수익 계산 업데이트
7. **Phase 7**: 테스트 및 디버깅

---

## 📝 예상 로그 출력

```
🎮 게임 데일리샵 출석 보상 시작...
📋 보상 데이터 조회 중...
✓ 게임 정보: Astellia M

🎭 캐릭터 정보 조회 중...
✓ 선택된 캐릭터: 너시오 (astellia)

📅 데일리 출석 보상 확인 중...
📆 오늘 날짜 (KST): 2025-11-07
💰 수령 가능한 데일리 보상: 1개
⏳ "소모품 보급 상자 (계정)" 수령 중...
  ✓ "소모품 보급 상자 (계정)" 수령 완료

📦 누적 출석 보상 확인 중...
현재 누적 출석일: 1일
ℹ️ 수령 가능한 누적 보상이 없습니다

✅ 게임 데일리샵 출석 보상 처리 완료 (FLAKE 수령 없음)
✅ 게임 데일리샵 출석 보상 처리 완료!
```

---

## 🚀 다음 단계

설계가 완료되었습니다. 구현을 진행하시겠습니까?

1. ✅ **API 함수 3개 작성**
2. ✅ **메인 실행 함수 작성**
3. ✅ **CONFIG 및 state 업데이트**
4. ✅ **메인 플로우 통합**
5. ✅ **총 수익 계산 업데이트**

구현 진행할까요? 🎯
