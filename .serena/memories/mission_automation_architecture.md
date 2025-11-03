# 미션 자동화 아키텍처

## API 엔드포인트 정리

### 1. 미션 상태 조회
**GET /flake-shop/v1/mission/component?component_no={N}**
- Headers: flake-fe caller-id, reward.onstove.com origin
- Response: component_info + missions 배열
- Component 번호: 1, 2, 4, 5, 9, 10, 11, 12

### 2. 미션 참여
**POST /flake-shop/v1/mission/participate**
- Headers: flake-fe caller-id, reward.onstove.com origin
- Body: `{ mission_no, component_no }`
- Response: 미션 정보 + 변경된 status

## 미션 타입 분류

### SINGLE (단일 미션)
**특징**: 1회 참여로 완료
**상태 플로우**:
- INCOMPLETE → participateMission() → RECEIVABLE/COMPLETE

**서브타입**:
1. **방문형** (`is_visit_mission: true`)
   - 예: "스토브 메인 방문하기"
   - 결과: `status: RECEIVABLE` (별도 수령 불필요)
   
2. **게임 플레이형**
   - 예: "게임 플레이하기"
   - 결과: `status: COMPLETE`, `residue_flake` 포함 (즉시 지급)

### ACCUMULATION (누적 미션)
**특징**: 여러 번 참여 필요, milestone 기반
**예시**:
- "매일 라운지 좋아요 누르기" (5회)
- "매일 라운지 댓글 쓰기" (5회)
- "매일 라운지 글쓰기" (5회)

**필드**:
- `milestone_total_cnt`: 목표 횟수
- `milestone_per_cnt`: 회당 증가량
- `user_complete_cnt`: 현재 완료 횟수
- `total_cycle_cnt`: 총 사이클
- `user_cycle_cnt`: 현재 사이클

### ACHIEVEMENT (업적 미션)
**특징**: 특정 조건 달성 시 완료
**Component**: component_no=5

### CONTENT1 (컨텐츠 미션)
**특징**: 특정 컨텐츠 관련 미션
**Component**: component_no=4

## 함수 아키텍처

### API 레이어
```javascript
// 미션 조회
getDailyMissionStatus(headers, componentNo)
getAllDailyMissions(headers)  // 병렬 조회

// 미션 참여
participateMission(headers, missionNo, componentNo)
```

### 자동화 레이어
```javascript
// SINGLE 타입 자동 참여
autoParticipateVisitMissions(headers)
  - SINGLE + INCOMPLETE 필터링
  - participateMission() 호출
  - 상태값 기반 분기 (RECEIVABLE/COMPLETE)

// 상태 체크
checkDailyMissionStatus(headers)
  - 8개 component 병렬 조회
  - 카테고리별 분류 (daily, weekly, achievement, content, attendance)
  - 통계 계산 (total, completed, receivable, incomplete)
```

### UI 레이어
```javascript
updateStatusUI()
  - 5개 카테고리별 상태 표시
  - 마우스 hover 시 툴팁으로 세부 미션 표시
  - 상태 아이콘: ✅ COMPLETED, 🎁 RECEIVABLE, ⏳ INCOMPLETE
```

## 자동화 플로우

### 메인 플로우 (runQuestAutomation)
1. Step 0: 댓글 작성 (비동기)
2. Step 1: 새글 작성
3. Step 2: 게시글 추천
4. **Step 3: SINGLE 미션 자동 참여** ← 게임 플레이 포함
5. Step 5: 룰렛 돌리기
6. Step 7-10: 보상 수령

### skipRewards 모드
- 리워드 초기화 대기 중일 때 활성화
- SINGLE 미션, 새글, 추천, 룰렛 등 스킵
- 댓글 작성은 계속 진행

## 카테고리 분류 로직

```javascript
if (type === 'SINGLE') {
    categories.daily
} else if (type === 'ACCUMULATION') {
    if (title.includes('출석')) {
        categories.attendance
    } else {
        categories.weekly
    }
} else if (type === 'ACHIEVEMENT') {
    categories.achievement
} else if (type === 'CONTENT1') {
    categories.content
}
```

## 확장 가능성

### 새로운 미션 타입 추가 시
1. `mission_type` 확인
2. 필요시 카테고리 추가
3. 자동화 함수 확장 (타입별 필터링)

### 새로운 component_no 추가 시
- `getAllDailyMissions()`의 배열에 번호만 추가
- 자동 병렬 조회 및 분류 처리

### API 변경 대응
- 응답 구조 변경 시 getter 함수만 수정
- 상태값 추가 시 분기 로직에만 추가
