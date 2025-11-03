# 데일리 미션 게임 플레이 구현 세션

## 세션 개요
- **날짜**: 2025-11-03
- **주제**: 게임 플레이 미션 보상 자동화 구현
- **파일**: stove-quest-automation.user.js

## 구현 내용

### 1. API 분석 결과
**POST /flake-shop/v1/mission/participate**
- 방문형 미션과 게임 플레이 미션 모두 동일한 엔드포인트 사용
- Request Body: `{ mission_no, component_no }`
- Response 상태값으로 미션 타입 구분:
  - `RECEIVABLE`: 방문형 미션 (별도 수령 필요 없음)
  - `COMPLETE`: 게임 플레이 등 (즉시 보상 지급, residue_flake 포함)

### 2. 함수 확장: autoParticipateVisitMissions()
**위치**: stove-quest-automation.user.js:2475-2552

**변경 전**: `is_visit_mission` 필터링으로 방문형만 처리
**변경 후**: `mission_type === 'SINGLE'` 필터링으로 모든 SINGLE 타입 처리

**핵심 로직**:
```javascript
// SINGLE 타입 + INCOMPLETE 상태 필터링
if (mission.mission_type === 'SINGLE' && mission.status === 'INCOMPLETE') {
    const result = await participateMission(headers, mission.mission_no, component_no);
    
    // 상태값에 따라 다른 처리
    if (status === 'RECEIVABLE') {
        // 방문형: 참여만 완료
        participated++;
    } else if (status === 'COMPLETE' || status === 'COMPLETED') {
        // 게임플레이: 즉시 보상 지급
        completed++;
        log(`+${reward_amount} 플레이크 (잔액: ${residue_flake})`);
    }
}
```

**반환값**: `{ success, participated, completed, total }`

### 3. 자동화 플로우 통합
**위치**: stove-quest-automation.user.js:1258-1265

**Step 3**로 추가:
- Step 1: 새글 작성
- Step 2: 게시글 추천
- **Step 3: SINGLE 미션 자동 참여** (방문형 + 게임 플레이)
- Step 5: 룰렛 돌리기
- Step 7-10: 보상 수령

### 4. 처리 가능 미션 타입
- ✅ 방문형 미션 (스토브 메인 방문하기)
- ✅ 게임 플레이 미션 (게임 플레이하기)
- ✅ 기타 모든 SINGLE 타입 미션

## 기술적 발견

### 미션 상태 라이프사이클
```
INCOMPLETE → participateMission() → RECEIVABLE/COMPLETE
                                      ↓
                         방문형: RECEIVABLE (UI에 표시)
                         게임플레이: COMPLETE (즉시 지급)
```

### API 호환성
- ✅ `participateMission()` 함수 재사용 가능
- ✅ 동일 엔드포인트로 다양한 미션 처리
- ✅ 응답 상태값으로 자동 분기 처리

## 로그 출력 예시
```
[SINGLE 미션] 자동 참여 시작
[SINGLE 미션] 2개 발견
[SINGLE 미션] "스토브 메인 방문하기" 참여 중... (보상: 100 플레이크)
[SINGLE 미션] ✅ "스토브 메인 방문하기" 참여 완료 (수령 가능)
[SINGLE 미션] "게임 플레이하기" 참여 중... (보상: 200 플레이크)
[SINGLE 미션] 🎁 "게임 플레이하기" 보상 수령 완료 (+200 플레이크) (잔액: 127435)
[SINGLE 미션] 총 참여: 1개, 즉시 완료: 1개 (전체: 2)
```

## 향후 확장성
- 새로운 SINGLE 타입 미션 추가 시 자동 처리
- 상태값 기반 분기로 다양한 보상 방식 지원
- component_no 다양화 대응 가능
