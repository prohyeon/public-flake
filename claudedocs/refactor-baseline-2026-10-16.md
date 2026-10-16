# 리팩터링 기준선 (2026-10-16, v2.12.0, commit 16d357c)

- `npm test`: 177개 통과, 약 22초
- `npm run test:coverage` (`src/`): line 55.69% / branch 79.71% / funcs 71.90%
- `vite build` 결과가 커밋된 `stove-quest-automation.user.js`와 바이트 단위로 동일

| 파일 | line % | branch % | funcs % |
|---|---:|---:|---:|
| api/articles.js | 26.79 | 100.00 | 0.00 |
| api/boost.js | 100.00 | 92.00 | 100.00 |
| api/lostArkCashCharge.js | 83.74 | 79.17 | 61.54 |
| api/missions.js | 34.92 | 91.30 | 50.00 |
| api/pointExchange.js | 64.35 | 78.95 | 50.00 |
| api/preRegistration.js | 94.74 | 78.57 | 100.00 |
| api/profile.js | 36.78 | 40.00 | 25.00 |
| api/request.js | 86.67 | 91.67 | 83.33 |
| api/reviewEvent.js | 95.00 | 86.36 | 100.00 |
| api/roulette.js | 16.04 | 100.00 | 16.67 |
| api/shop.js | 14.44 | 100.00 | 0.00 |
| api/specialForce.js | 90.91 | 70.59 | 100.00 |
| config.js | 100.00 | 100.00 | 100.00 |
| state.js | 100.00 | 100.00 | 100.00 |
| ui/boostStatus.js | 96.92 | 83.87 | 100.00 |
| ui/dismissMyHomeNotices.js | 93.97 | 78.22 | 100.00 |
| ui/logger.js | 21.05 | 66.67 | 100.00 |
| ui/mount.js | 91.36 | 69.81 | 92.86 |
| ui/notifications.js | 4.76 | 100.00 | 0.00 |
| ui/pointCashCharge.js | 100.00 | 72.22 | 100.00 |
| ui/progress.js | 13.85 | 100.00 | 0.00 |
| ui/reviewEventStatus.js | 100.00 | 85.19 | 100.00 |
| ui/specialForce.js | 100.00 | 54.17 | 100.00 |
| ui/status.js | 14.08 | 11.76 | 25.00 |
| utils/audio.js | 4.35 | 100.00 | 0.00 |
| utils/auth.js | 11.11 | 100.00 | 0.00 |
| utils/automationSignal.js | 90.48 | 43.75 | 80.00 |
| utils/tabs.js | 27.27 | 50.00 | 33.33 |
| utils/time.js | 33.33 | 100.00 | 16.67 |
| workflows/automation.js | 25.13 | 79.03 | 52.94 |
| workflows/automationPlan.js | 100.00 | 97.26 | 100.00 |
| workflows/boost.js | 96.31 | 90.59 | 87.88 |
| workflows/comments.js | 100.00 | 78.57 | 100.00 |
| workflows/missions.js | 21.08 | 65.85 | 43.48 |
| workflows/monthlyAttendance.js | 94.92 | 69.64 | 100.00 |
| workflows/pointExchange.js | 66.50 | 52.17 | 50.00 |
| workflows/preRegistration.js | 100.00 | 70.83 | 100.00 |
| workflows/reviewEvent.js | 96.52 | 87.50 | 83.33 |
| workflows/roulette.js | 7.05 | 100.00 | 0.00 |
| workflows/shop.js | 5.36 | 100.00 | 0.00 |
| workflows/snapshot.js | 94.76 | 79.45 | 100.00 |
| workflows/specialForce.js | 83.48 | 79.10 | 88.89 |
| workflows/status.js | 15.47 | 66.67 | 12.50 |
| workflows/taskRunner.js | 100.00 | 91.18 | 100.00 |

`main.js`는 import 시 `init()`이 실행되므로 커버리지에 잡히지 않는다. 빌드된 번들을 jsdom에서 실행하는 테스트(`tests/ui/userscriptMount.test.js` 등)로만 검증된다.
