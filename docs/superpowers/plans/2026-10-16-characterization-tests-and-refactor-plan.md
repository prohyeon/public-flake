# 특성화 테스트 기반 리팩터링 계획 (v2.12.0 기준)

**목표:** 현재 동작을 바꾸지 않는다는 것을 테스트로 증명할 수 있는 안전망을 먼저 만들고, 그 위에서 `src/` 구조를 정리한다.

**전제:**

- 약 6천 줄짜리 `stove-quest-automation.user.js`(6,266줄)는 **`vite build` 산출물**이다. 실제 소스는 `src/` 45개 모듈(7,332줄)이므로 개선 대상은 `src/`이고, 번들은 릴리스 단계에서만 다시 생성한다.
- 2026-10-16 확인: 현재 `src/`를 빌드한 결과가 커밋된 번들과 **바이트 단위로 동일**하다. 소스와 번들이 어긋나지 않은 상태에서 출발한다.
- `@updateURL`/`@downloadURL`이 `main` 브랜치의 번들을 가리키므로 **번들을 커밋하면 곧바로 사용자에게 배포된다.** 리팩터링 기간에는 번들을 커밋하지 않는다.
- 별건(범위 외): `stove-bot-win/stove_question_automation.js`(v2.5.1, 5,121줄)는 Python 실행 경로에서 주입되지 않는 오래된 사본이다(`PUBLIC_FLAKE_2_9_2_CLICK_ANALYSIS.md`).

---

## 1. 현재 기준선 (2026-10-16 측정)

| 항목 | 값 |
|---|---|
| 테스트 | 177개 전부 통과, 약 22초 (대부분 파일별 프로세스 기동 비용) |
| 라인 / 분기 / 함수 커버리지 (`src/`) | 55.69% / 79.71% / 71.90% |
| 빌드 재현성 | 커밋된 번들과 동일 |

**커버리지 공백 (라인 % 기준):**

| 모듈 | 줄 수 | line % |
|---|---:|---:|
| `workflows/missions.js` | 835 | 21.1 |
| `workflows/automation.js` | 577 | 25.1 |
| `workflows/shop.js` | 280 | 5.4 |
| `workflows/status.js` | 278 | 15.5 |
| `workflows/roulette.js` | 241 | 7.1 |
| `ui/status.js` | 206 | 14.1 |
| `api/missions.js` | 295 | 34.9 |
| `api/roulette.js` / `api/shop.js` / `api/articles.js` / `api/profile.js` | 187 / 90 / 56 / 87 | 16.0 / 14.4 / 26.8 / 36.8 |
| `main.js` | 619 | 측정 안 됨 (빌드된 번들을 jsdom에서 실행하는 테스트로만 간접 검증) |

**구조적 관찰:** 커버리지가 높은 모듈(`boost`, `reviewEvent`, `monthlyAttendance`, `specialForce`, `snapshot`)은 모두 `deps` 객체로 API·`delay`·`log`·`now`를 주입받는다. 공백 모듈은 API 함수와 실제 `delay()`를 직접 import해서 지금 구조로는 단위 테스트를 붙이기 어렵다. 그런데 이 공백 모듈들이 바로 리팩터링 대상이다. 그래서 **코드를 건드리기 전에 외부 경계(`GM_xmlhttpRequest`)에서 동작을 고정**해야 한다.

---

## 2. "동작이 같다"의 정의

같은 시나리오(고정된 API 응답, 고정 시각, 고정 난수)에서 아래 6가지가 같으면 동작이 같다고 본다.

1. **HTTP 요청 트레이스:** `GM_xmlhttpRequest`의 순서, method, URL, body
2. **열린 탭:** `GM_openInTab`/`window.open`으로 연 URL과 닫은 여부
3. **최종 `state`:** `earnings`, `completed`, `progress`, `missionComponents` 등
4. **패널 로그:** `#stove-log-content`에 찍힌 메시지와 타입의 순서
5. **대기 정책:** 요청된 `delay`/`setTimeout`의 ms 목록
6. **스토리지:** `localStorage`/`sessionStorage`에 남긴 기록

병렬 그룹(`taskRunner`) 안에서는 `await` 개수만 달라져도 작업 사이의 요청 순서가 섞일 수 있다. 그래서 병렬 그룹은 **작업별 요청 순서 + 그룹 전체 요청 집합**으로 비교하고, 직렬 구간만 전체 순서로 비교한다.

---

## Phase 0 — 기준선 고정

- [ ] `main`에서 `refactor/characterization` 브랜치를 만든다.
- [ ] 위 커버리지 표와 테스트 시간을 `claudedocs/refactor-baseline-2026-10-16.md`에 기록한다.
- [ ] 루트 `.gitignore`에 `payment_har.json`(또는 `*.har.json`)을 추가한다. 민감정보가 담긴 HAR이 `git add .` 한 번에 커밋되는 것을 막기 위해서다.
- [ ] `package.json`에 `test:coverage` 스크립트를 추가한다: `node --test --experimental-test-coverage --test-coverage-exclude="tests/**" "tests/**/*.test.js"`
- [ ] `verify` 스크립트는 Phase 1에서 새 번들 검증과 함께 만든다.

## Phase 1 — 테스트 하네스 (src 변경 없음)

**생성: `tests/helpers/gmHarness.js`**

- 가짜 `GM_xmlhttpRequest`
  - 라우트 테이블 `{ method, match: RegExp | fn, respond: json | (req) => ({ status, body }) }`
  - 모든 호출을 트레이스에 기록한다.
  - fixture 본문은 반드시 `responseText` **문자열**로 직렬화해서 넘긴다. `apiRequest`는 JSON 파싱에 실패하면 `{ success: true }`로 resolve하기 때문에, 객체를 그대로 넘기면 모든 응답이 조용히 `{ success: true }`로 바뀐다.
  - **매칭 안 된 요청은 별도 목록(`harness.unmatched`)에 기록하고 `afterEach`에서 0건인지 단언한다.** 거절(reject)만으로는 부족하다. 대상 워크플로가 대부분 `try/catch`로 오류를 삼키고 `✗ ... 오류` 로그만 남긴 채 계속 진행하므로, 거절만 하면 테스트는 통과하고 golden에 오류 경로가 "정상 동작"으로 고정된다.
  - 500, 타임아웃, 네트워크 오류를 주입할 수 있다.
- 가짜 `GM_openInTab`/`window.open`: URL을 기록하고 `close()` 가능한 핸들을 돌려준다.
- `setTimeout` 패치: 요청된 ms를 기록하고 즉시(0ms) 실행한다. 테스트가 끝나면 원복한다. src 모듈을 직접 import하는 테스트는 jsdom `window.setTimeout`이 아니라 **`globalThis.setTimeout`**을 패치해야 한다.
- 시각 고정은 `mock.timers.enable({ apis: ['Date'], now })`, 난수 고정은 시드 기반 `Math.random`으로 한다.
- `localStorage`/`sessionStorage` 메모리 shim
- jsdom 최소 DOM(`#stove-log-content`, 진행도·상태 요소)과 로그 캡처 헬퍼
- `resetState()`/`resetConfig()`: import 시점에 `structuredClone`으로 떠 둔 스냅샷으로 싱글턴을 되돌려 테스트 사이의 오염을 막는다.

**생성: `tests/helpers/golden.js`**

- `assertGolden(name, actual)`: `tests/golden/<name>.json`과 비교한다.
- `UPDATE_GOLDEN=1 npm test`일 때만 파일을 갱신한다. 리팩터링 중 golden이 바뀌면 그건 곧 동작이 바뀌었다는 뜻이다.
- 변하는 값(타임스탬프 쿼리, 난수로 고른 댓글 문구 등)은 정규화한 뒤 비교한다.

**생성: `tests/fixtures/stove/*.json`** (API 응답 fixture)

- 출처: 기존 `tests/helpers/*Fixture.js`와 `payment_har.json`의 응답 본문
- `payment_har.json`(1.1MB, untracked)에는 토큰, 쿠키, 회원 식별자가 들어 있을 가능성이 높다. **원본 HAR은 커밋하지 않고**, 필요한 응답만 추출해서 마스킹한 뒤 커밋한다.

**새 번들 검증 (`verify`)**

- [ ] 번들 대상 테스트(`userscriptMount`, `boostUserscript`, `userscriptMetadata`)가 환경변수(예: `BUNDLE_PATH`)로 번들 경로를 받게 한다. 기본값은 커밋된 번들이다.
- [ ] `verify` 스크립트: `check` → `test` → 임시 폴더로 `vite build` → 그 새 번들로 번들 대상 테스트를 다시 실행한다.
- [ ] 이 스크립트가 있어야 Phase 3에서 `main.js`를 바꿔도 옛 번들이 아니라 새 번들로 검증된다. `main.js`는 번들을 통해서만 테스트되기 때문이다.

- [ ] 하네스 자체 테스트: 라우팅, unmatched 단언, 트레이스, 원복

## Phase 2 — 특성화 테스트 (src 변경 없음)

| 순위 | 대상 | 시나리오 |
|---|---|---|
| 1 | `workflows/missions.js` | daily/content/weekly/banner/attendance/survey/prizeEntry/visit 각각: 정상, 이미 완료, 조회 실패, 비활성화, `skipMissions` 적용, 보상 0 |
| 2 | `workflows/shop.js` | 데일리샵 출석, 마작(게임 보유 여부 분기), 누적 보상 |
| 3 | `workflows/roulette.js` | 뽑기(FLAKE 소비), 추가 보상, 참여 횟수 소진 |
| 4 | `workflows/status.js` + `ui/status.js` | `checkAllStatus` 결과와 패널 DOM 렌더 스냅샷 |
| 5 | `workflows/automation.js` | `runAutomation` 전체 3종: 하루 처음 실행 / 전부 완료 상태 / 중간 실패 후 repair pass |
| 6 | `api/{articles,missions,roulette,shop,profile}.js` | 함수별 URL·method·body 계약 |
| 7 | `main.js` | 빌드한 번들을 jsdom에서 실행해 버튼 ID↔핸들러 연결과 점검 모드 비활성화 확인 (기존 `userscriptMount` 확장) |

**golden과 별개로 직접 쓰는 안전 불변식:**

- FLAKE 소비 요청(룰렛 뽑기, 경품 응모, 포인트 교환) 횟수가 상한을 넘지 않는다.
- 같은 보상을 두 번 수령하지 않는다.
- 비활성화된 기능은 쓰기 요청을 0건 보낸다.

**완료 기준:**

- [ ] `workflows/`와 `api/`의 line 커버리지 85% 이상, export 함수마다 시나리오 1개 이상
- [ ] 전체 실행 40초 이내, 3회 연속 실행 결과 동일(flaky 0)
- [ ] 변이 점검: `skipMissions` 무시, delay 삭제, 보상 중복 호출 같은 변경을 일부러 넣었을 때 테스트가 실패하는지 확인

Phase 1~2는 `src/`를 건드리지 않아 번들이 그대로다. 그래서 `main`에 먼저 머지해도 배포에 영향이 없다.

## Phase 3 — 구조 개선 (후보, 우선순위 결정 필요)

단계마다 모듈 하나만 바꾼다. golden이 변하지 않고 `npm run verify`가 통과하면 `src/`만 커밋한다.

- **A. `missions.js` 중복 제거:** `execute*Missions`의 공통 흐름(조회 → 방문 탭 → 재조회 → 보상 수령)을 공용 러너로 묶는다. `claudedocs/mission-execution-inefficiency-analysis.md`가 이 중복을 이미 지적했지만, 모놀리식 시절 기준 문서라 현재 코드와 대조가 필요하다.
- **B. 의존성 주입 통일:** shop/roulette/status/missions/automation을 `boost`·`reviewEvent`와 같은 `deps` 패턴으로 바꾼다. 이후 단위 테스트 비용이 줄어든다.
- **C. `main.js` 분리:** `createUI`의 약 530줄 인라인 CSS/HTML을 문자열 모듈(`src/ui/panelTemplate.js`)로 옮기고 버튼 바인딩을 테이블로 만든다. CSS 파일 import 방식은 vite-plugin-monkey의 스타일 주입·메타데이터를 바꿀 수 있어 피한다.
- **D. API 레이어 정리:** 헤더/URL 생성 중복을 정리하고, `apiRequest`가 매 요청마다 남기는 콘솔 로그를 디버그 플래그 뒤로 옮긴다.
- **E. state 초기화 함수:** `createInitialState()`/`resetState()`를 도입한다(재실행·테스트 안전성). 구조 재설계는 하지 않는다.
- **F. 죽은 코드 제거:** codegraph `callers`로 호출되지 않는 export를 찾고, 수동으로 확인한 뒤 삭제한다.

**범위 외:** 기능 추가, API 엔드포인트 변경, UI 디자인 변경, 병렬화 정책 변경. 리팩터링 중 발견한 버그는 **그 자리에서 고치지 않는다.** 특성화 테스트는 현재 버그까지 고정하므로 버그는 별도 커밋으로 다룬다.

## Phase 4 — 릴리스

- [x] `npm run verify` 통과를 확인한다(Phase 1에서 만든 새 번들 검증 포함).
- [x] 버전을 올린다: `package.json`, `package-lock.json`, `vite.config.js`, `src/config.js`. `releaseMetadata.test.js`가 일치 여부를 강제한다. → 2.13.0
- [x] `npm run build`로 번들을 재생성하고 커밋한다. `main` 머지가 곧 배포다. → 로컬 `main`에만 커밋, push(배포)는 보류
- [ ] 실환경 스모크: Tampermonkey에 로컬 빌드를 설치하고 상태 새로고침(읽기 전용)으로 대시보드를 확인한 뒤, 전체 자동화를 1회 실행한다. → 2026-10-17 단계별 시간 로그 번들로 이미 돌린 계정 1개를 실행(오류 없음). 최종 2.13.0 번들과 첫 실행일 경로(룰렛, 경품 응모, 부스트, 리뷰 이벤트, 방문 미션)는 아직 실환경 미확인

---

## 리스크

- **fixture와 실제 API의 차이:** 테스트는 통과해도 실환경에서 실패할 수 있다. HAR 기반 fixture와 Phase 4 실환경 스모크로 완화한다.
- **병렬 그룹 interleaving:** 2절의 비교 규칙으로 오탐을 막는다.
- **민감정보:** HAR 원본과 fixture를 커밋하기 전에 토큰, 쿠키, member_no를 마스킹했는지 확인한다.

## 진행 상황 (2026-10-16)

| 단계 | 커밋 | 결과 |
|---|---|---|
| Phase 0 | 3199c99 | 기준선 기록, `.codegraph/`·HAR ignore |
| Phase 1 | 4cae98c | GM 경계 하네스, golden, `npm run verify` |
| Phase 2 | 693273a (main 머지) | golden 132개, 커버리지 line 55.7% → 98.7%, 변이 11개 모두 검출 |
| A | 4446eb6 | 미션 공통 조각을 helper로 추출, missions에 deps 주입 |
| B | 9819538 | shop/roulette/status/task handler에 deps 주입, shop·status 중복 정리 |
| C | 4b7189a | 패널 템플릿을 `src/ui/panelTemplate.js`로 분리, 버튼 연결 테이블화 |
| D | a00e726 | `src/api/headers.js`로 헤더 통합, 요청 추적 로그를 debug 플래그 뒤로 |
| E | c038179 | `createInitialState()`/`resetRunProgress()` |
| F | 0ea5c6c | 죽은 코드 제거 |

Phase 3 동안 기존 golden은 하나도 바뀌지 않았다(죽은 코드 테스트용 golden 3개만 삭제). 리팩터링한 코드에 대한 변이 12개도 모두 검출된다.

Phase 3 이후 2.13.0에 함께 들어간 변경: 룰렛 버그 2건 수정, 스페셜포스 제거, 단계별 소요 시간 로그, 같은 날 재실행 시 끝난 작업 건너뛰기(좋아요·댓글 로컬 기록, 완료가 증명된 미션 종류), 댓글과 초기 스냅샷 동시 시작, 상태 갱신과 최종 스냅샷 동시 실행, 인기글 부스트 하루 5회. 남은 단계는 실환경 스모크와 push(배포)다.

## 결정 사항 (2026-10-16)

1. Phase 3 범위: A~F 전부, A부터 순서대로 진행
2. Phase 1~2(테스트만)를 먼저 `main`에 머지한 뒤 Phase 3 진행
3. 릴리스 버전: 미정 (Phase 4에서 결정)
