# 특성화 테스트 중 발견한 버그 후보 (2026-10-16, v2.12.0)

특성화 테스트는 아래 동작을 **현재 그대로** 고정한다. 리팩터링(A~F) 중에는 고치지 않는다. 고칠 때는 버그 하나씩 별도 커밋으로 처리하고, 해당 golden을 `UPDATE_GOLDEN=1`로 갱신한 뒤 diff를 검토한다.

## 1. FLAKE 손실 가능 (우선 검토)

| 위치 | 현상 |
|---|---|
| ~~`src/workflows/roulette.js:63-95`~~ | **수정됨.** 룰렛 POST가 `{code:0}`인데 `value`가 없으면(또는 `null` 본문이면) 같은 뽑기를 무제한 재전송했다. 이제는 재전송하지 않고 라운드를 끝낸 뒤 서버 참여 횟수를 다시 읽는다. |
| ~~`src/workflows/roulette.js:28, 72-82, 113-117`~~ | **수정됨.** 7019가 아닌 오류 코드가 계속 오면 바깥 `while(true)`가 끝없이 반복됐다. 이제는 직전 라운드 뒤 참여 횟수가 늘지 않으면 멈춘다(최대 maxDraws 라운드). |
| `src/workflows/roulette.js` 순수익 계산 | 결과를 확인하지 못한 뽑기를 서버가 횟수에 반영했어도 비용은 성공한 뽑기 수로만 계산한다. 요약의 순수익이 실제보다 많게 나올 수 있다(서버 횟수 증가분으로 비용을 계산하면 해결). |
| `src/workflows/roulette.js:39-41` | 매 라운드 서버 참여 횟수로 남은 횟수를 다시 계산한다. 서버 반영이 늦으면 30회를 넘겨 뽑는다. |
| `src/workflows/pointExchange.js:73` | 잔액을 알 수 없을 때(오류 코드, HTML 응답)에도 교환 POST를 보낸다. |
| `src/workflows/pointExchange.js:148` | 교환에 성공한 뒤 포인트 잔액 조회가 실패하면 FLAKE는 이미 소비됐는데 이를 복구할 수단이 없다. |
| `src/workflows/automation.js:59-64` | 글쓰기 상태 확인이 실패해도 새 글을 작성하므로 중복 글이 생길 수 있다. |
| `src/workflows/comments.js` | 댓글이 멱등하지 않다. 같은 날 다시 실행해도 매번 댓글 5개를 새로 단다. |

## 2. 결과·표시 오류

| 위치 | 현상 |
|---|---|
| `src/workflows/roulette.js:137-144` | 뽑기 뒤 참여 횟수 재확인이 실패하면 순수익이 0으로 기록된다. |
| `src/workflows/missions.js:720-835` | SINGLE 방문 미션 보상이 `state.earnings`에 합산되지 않아 요약에 0으로 표시된다. |
| `src/workflows/automation.js:126` + `missions.js:797` | SINGLE 방문 미션이 연 탭은 수집되지 않아 실행 후에도 닫히지 않는다. |
| `src/workflows/automation.js:517` | 룰렛 요약 줄이 총합의 부호를 써서, 손실이면 `+-100 FLAKE`로 출력된다. |
| `src/workflows/automation.js:237-240` | weekly/attendance/content/banner/survey 보상 수령이 실패해도(`null`) 전체 결과는 성공으로 판정된다. |
| `src/workflows/automation.js:266` | 실패 작업 로그에 그룹 id가 두 번 붙는다(`community/community:articleWrite`). |
| `automationPlan.js:139-163`, `snapshot.js:540-558` | 복구 계획과 diff가 데일리 누적 보상을 보지 않아, 15일 누적 보상이 미수령으로 남는다. |
| `src/workflows/automationPlan.js:62` | `CONFIG.roulette.enabled=false`여도 뽑기 작업을 계획에 넣는다(실행 시 경고만 남김). |
| `missions.js:269` 등 보상 합산 루프 | 보상 금액을 `+=`로 더해서, 문자열이 오면 이어 붙여진다(`'0N/A'`). |
| `src/workflows/missions.js:193-197` | 컨텐츠 미션은 재조회에 실패하면 완료 표시를 하지 않는다. 데일리 미션은 같은 상황에서 완료로 표시해 서로 다르다. |
| `src/workflows/shop.js:70-77, 194-201` | 목록 조회가 실패해도 `completed.dailyShop`/`majak`을 `true`로 둔다. `claimDailyAccumulatedRewards`는 완료 플래그를 아예 설정하지 않는다. |
| `src/workflows/roulette.js:155-180` | EXTRA 경로에서 일찍 반환하면 `state.earnings.rouletteExtra`에 이전 값이 남는다. `received_yn === false`만 수령 대상으로 본다. |
| `src/api/roulette.js:89` | `sub_event_no`가 없으면 이벤트 번호에 문자열 `"undefined"`가 저장된다. |
| `src/ui/pointCashCharge.js:8-10` | `Number(null) === 0`이라, 잔액을 아직 모를 때 "확인 중" 대신 "192,500 플레이크 부족"을 표시한다. |
| `src/api/profile.js` 마일리지 조회 | 실패하면 0을 반환해서, 패널이 실패 표시 대신 초록색 "0 F"를 보여준다. |
| `src/ui/status.js:37-40` | 카테고리가 사라져도 이전 툴팁이 남는다. |
| `src/ui/status.js:46-48` | "N일중"에 `milestone_per_cnt`를 쓴다. 문서와 `missions.js:290`은 `milestone_total_cnt`를 목표로 본다(확인 필요). |
| `src/ui/status.js:89` | 서버가 준 미션 제목을 이스케이프 없이 `innerHTML`로 넣는다. |
| `src/ui/logger.js:11` | 알 수 없는 로그 타입이면 "undefined 메시지"로 출력된다. |
| `src/main.js:584` | 점검 모드 로그에 "⚠️ ⚠️"가 두 번 찍힌다. |

## 3. 시간대·환경 의존

| 위치 | 현상 |
|---|---|
| `src/utils/time.js:35` (`getTodayString`) | 로컬 날짜를 쓴다. shop/status는 이 값을 KST 날짜와 비교하므로 KST 밖에서는 하루가 어긋난다. |
| `src/utils/maintenance.js:8-11` | `getTimezoneOffset`을 더한 뒤 `toISOString`을 쓴다. 이 방식은 UTC 머신에서만 KST가 나와서, KST 머신에서는 점검 모드가 09:00에 시작된다. |
| `src/workflows/status.js:177-179` | 글쓰기 여부의 하루 경계를 로컬 자정으로 잡는다. |
| `src/utils/auth.js:4` | 같은 이름의 SUAT 쿠키가 두 개(host-only + domain)면 `null`이 되어 "SUAT not found"로 실패한다. |

## 4. 중복 요청·불일치 (D 리팩터링에서 결정 필요)

| 위치 | 현상 |
|---|---|
| `src/workflows/status.js:84-85` | 설문 상태를 lounge 헤더(`caller-id: storee-lounge`)로 조회한다. 같은 컴포넌트를 새로고침마다 서로 다른 헤더로 두 번 읽는다. |
| `src/workflows/status.js:228-229` | `getAllDailyMissions`가 실패하면 미션 페이지를 두 번 요청한다. |
| `src/api/shop.js:53-59` vs `:77-82` | `COUPON` 보상이 데일리 누적에서는 `LIBRARY` 엔드포인트로, 마작에서는 `coupon` 엔드포인트로 간다. |
| `src/workflows/shop.js:161` vs `:229-234` | 마작 쿠폰은 게임 보유 확인을 건너뛴다. |
| `src/main.js:598` | 점검 모드에서도 500ms 뒤 상태 조회 API를 호출한다. |

## 5. 죽은 코드 (F에서 제거 완료)

- 제거: `stove-btn-test-tab`(패널에 없는 id), `extractComments`, `getLostArkPaymentInfo`/`buildLostArkPaymentInfoUrl`, `closeTabAfterDelay`, `getCurrentMonthDateRange`, `runRoulette`(독립 룰렛 버튼이 사라진 뒤 남은 진입점)
- 유지: `parseAutomationSignalTitle`. 스크립트는 쓰지 않지만 stove-bot-win이 읽는 탭 제목 신호 형식의 명세 역할을 해서 남겼다.
