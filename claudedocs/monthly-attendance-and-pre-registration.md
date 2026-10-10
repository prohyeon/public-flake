# v2.12.0 작업 기록 — 월간출석 판정 보완 및 사전등록

작업일: 2026-10-10. 릴리스: [v2.12.0](https://github.com/prohyeon/public-flake/releases/tag/v2.12.0) (커밋 `9b84381`, `fb0b87e`, `e5ab113`, `e9a4af2`, `87b5719`). v2.11.2는 따로 배포하지 않고 2.12.0에 포함했다.

## 1. 월간출석 `월간출석 확인 필요` 오판정

기존 판정(`src/workflows/snapshot.js` `compareMonthlyAttendanceProgress`): 실행 전 스냅샷에서 `INCOMPLETE`인 출석 미션의 `user_complete_cnt`가 실행 후 1 이상 늘지 않으면 문제로 본다. 날짜나 이번 달 기대 일수와는 비교하지 않는다. 그래서 하루를 빠뜨려 9일인 상태 자체는 원인이 아니다.

오판정이 나던 경우:

1. 같은 날 다시 실행하거나 실행 전에 이미 출석한 경우. 시작 값에 오늘 몫이 들어 있어 실행 중에는 늘지 않는다.
2. 리워드샵 탭을 연 뒤 다시 확인하지 않았다. 출석이 반영돼도 앞선 판정이 그대로 오류 신호로 나갔다.

수정 (`src/workflows/monthlyAttendance.js`, `src/workflows/automation.js`):

- **재확인:** 리워드샵을 연 경우 최종 판정 전에 3초 간격으로 최대 3회 스냅샷을 다시 읽는다(`recheckMonthlyAttendance`).
- **같은 날 기록:** `localStorage`의 `stove-monthly-attendance-v1:{user_id}`에 `{ date: KST YYYY-MM-DD, counts: { missionNo: count } }`를 저장한다. 같은 날 횟수가 기록 이상이면 `alreadyCountedMissionNos`("오늘 이미 반영")로 분류한다. 날짜가 바뀌면 기록을 쓰지 않는다. `user_id`는 `getMyProfile`로 얻고, 실패하면 기록 없이 기존 방식으로 판정한다.
- **경고 처리 (사용자 결정):** 재확인 후에도 그대로면 `unverifiedMissionNos`로 옮긴다. 실패가 아닌 경고로 처리하고 `[SG_DONE]`을 보낸다. 이 값도 기록해서 같은 날 이후 실행은 재확인을 건너뛴다. 값을 읽지 못한 `unknownMissionNos`는 계속 실패로 처리한다.
- **감수한 점:** 그날 실제로 출석이 누락돼도 경고 로그만 남고 성공으로 집계될 수 있다.

## 2. 사전등록 자동 참여

2026-10-10 HAR 캡처 기준 요청:

| 요청 | 비고 | 응답 |
| --- | --- | --- |
| `POST /dailyshop/v1.0/campaigns/{YYYYMM}/{key}/register` | 본문 없음, `caller-id: event-hub`, Origin `event.onstove.com` | `code 0` + `registration_no` / 이미 참여 `code 90605` |
| `POST /shop/v2.0/indie/wishlist/add` | 사이트가 신규 등록 직후 보냄. 본문 `{ shop_key: 'indie', shop_item_ids: [{ shop_item_id }], shop_item_ids_str }` | `response_code 0` |

구현:

- 파일: `src/api/preRegistration.js`, `src/workflows/preRegistration.js`. 전체 자동화의 스페셜포스 처리 다음에 실행한다.
- 신규 등록이면 찜하기도 보낸다. 찜하기 실패는 경고로만 처리한다.
- `90605`(이미 참여)는 정상으로 처리하고 찜하기를 반복하지 않는다.
- 등록 실패는 결과에 `사전등록 확인 필요`를 추가하고 `[SG_ERROR]`를 보낸다.
- 기간: 캠페인 월(KST)이면서 `endDate`(KST, 그날부터 중지) 전에만 동작한다. 기간 밖이면 요청도 로그도 남기지 않는다. 별도 상태 표시나 버튼은 없다.

새 캠페인 추가 (`src/config.js` `preRegistration.campaigns`):

```js
{ month: '202610', key: 'luvplace', title: 'luvplace 사전등록', shopItemId: 14203, endDate: '2026-10-15' }
```

HAR에서 register URL의 `{YYYYMM}/{key}`와 wishlist 본문의 `shop_item_id`를 옮긴다. 게임 이름은 캡처에 없어 `title`을 key로 두었다. `tests/ui/boostUserscript.test.js`의 사전등록 검증은 register가 호출된 경우에만 동작한다. 캠페인을 바꾸면 이 테스트의 모의 경로도 함께 바꾼다.

## 3. 테스트 안정화

`tests/ui/userscriptMount.test.js`는 배지 닫기 클릭 2회를 고정 80ms 대기로 확인했다. 그래서 전체 테스트를 병렬로 돌릴 때 간헐적으로 실패했다. 두 번째 클릭까지 최대 2초 기다린 뒤 80ms 여유를 두고 상한(2회)을 확인하도록 바꿨다. 수정 전 코드에서도 같은 실패가 재현됐으므로 기존 문제였다.

## 4. 작업 메모

- Bash heredoc이나 Write 도구로 `\uXXXX`가 들어간 문자열을 패치하면 이스케이프가 실제 문자로 바뀔 수 있다. `automation.js`의 유니코드 이스케이프 줄은 이스케이프가 없는 앵커로 찾아 수정한다.
- 미확인: 실제 계정에서의 사전등록 참여와 월간출석 재확인은 사용자 테스트가 필요하다.
