# STOVE Quest Automation - AI Reference Guide

> **AI-Optimized Documentation**
> **Version**: v1.7.6 | **Lines**: 2,945 | **Functions**: 52
> **Purpose**: Fast AI parsing and context retrieval

---

## 🔍 QUICK LOOKUP INDEX

### Search Keywords → Line Ranges

```yaml
# Configuration & State
CONFIG: 23-53
STATE: 58-78
HEADERS: 90-113

# Core Functions by Category
UTILITY: 80-176
API_WRAPPER: 178-793
UI_PROGRESS: 795-926
MAIN_WORKFLOWS: 928-2175
STATUS_CHECKS: 2177-2377
UI_CREATION: 2470-2902
INITIALIZATION: 2904-2945

# Specific Features
ARTICLE_LIKE: 235-238, 251-258
COMMENT: 220-249, 268-280
ROULETTE: 383-518, 1501-1627
DAILY_REWARD: 570-669, 1652-1728
MAJAK: 671-793, 1752-1892
UI_BUTTONS: 2750-2757, 2876-2894
```

---

## 📊 FUNCTION REGISTRY

### Pattern: `functionName | line_start-line_end | complexity | category | dependencies`

```
# Utility Layer
getCookie | 83-87 | LOW | util | []
extractHeaders | 90-113 | LOW | util | [getCookie, localStorage]
delay | 115-117 | LOW | util | [Promise]
getTimestamp | 119-121 | LOW | util | [Date]
getTodayString | 123-129 | LOW | util | [Date]
isRewardSkipPeriod | 132-141 | LOW | util | [Date]
playCompletionSound | 149-176 | LOW | util | [AudioContext]

# API Layer (Base)
apiRequest | 181-212 | MEDIUM | api_core | [GM_xmlhttpRequest, Promise]

# API Layer (Article/Comment)
getArticleList | 214-218 | LOW | api_article | [apiRequest]
getCommentList | 220-233 | LOW | api_comment | [apiRequest]
likeArticle | 235-238 | LOW | api_article | [apiRequest]
likeComment | 240-249 | LOW | api_comment | [apiRequest]
checkArticleLikeStatus | 251-258 | LOW | api_article | [apiRequest]
checkCommentLikeStatus | 260-266 | LOW | api_comment | [apiRequest]
postComment | 268-280 | LOW | api_comment | [apiRequest]
postHalloweenComment | 282-295 | LOW | api_comment | [apiRequest]
createHalloweenArticle | 297-342 | MEDIUM | api_article | [apiRequest]
createArticle | 344-366 | LOW | api_article | [apiRequest]

# API Layer (Tag)
unfollowTag | 368-372 | LOW | api_tag | [apiRequest]
followTag | 374-382 | LOW | api_tag | [apiRequest]

# API Layer (Roulette)
getRouletteParticipationCount | 383-445 | MEDIUM | api_roulette | [apiRequest]
executeRouletteDraw | 447-518 | MEDIUM | api_roulette | [apiRequest]
getRouletteExtra | 520-540 | LOW | api_roulette | [apiRequest]
claimRouletteExtra | 542-568 | LOW | api_roulette | [apiRequest]

# API Layer (Daily Shop)
getDailyShopRewards | 570-595 | LOW | api_shop | [apiRequest]
getMyProfile | 597-617 | LOW | api_user | [apiRequest]
getMyArticles | 619-637 | LOW | api_article | [apiRequest]
claimDailyReward | 639-669 | LOW | api_shop | [apiRequest]
getMajakDailyShopRewards | 671-697 | LOW | api_shop | [apiRequest]
checkGameOwnership | 699-724 | LOW | api_ownership | [apiRequest]
claimDailyAccumulatedReward | 726-765 | MEDIUM | api_shop | [apiRequest]
claimMajakAccumulatedReward | 767-793 | LOW | api_shop | [apiRequest]

# UI Layer
log | 798-828 | LOW | ui | [document.getElementById]
updateProgress | 830-865 | LOW | ui | [state, document.getElementById]
setButtonState | 867-909 | LOW | ui | [document.querySelectorAll]
extractComments | 911-926 | LOW | util | []

# Workflow Layer (Main)
runAutomation | 931-1331 | VERY_HIGH | workflow_main | [extractHeaders, getArticleList, likeArticle, postComment, createArticle, runRouletteDraws, claimDailyShopRewards, claimMajakDailyShopRewards]
claimRewards | 1333-1477 | HIGH | workflow_legacy | [getDailyShopRewards, claimDailyReward]
runRewardClaim | 1479-1499 | LOW | workflow_wrapper | [claimRewards]
runRouletteDraws | 1501-1627 | MEDIUM | workflow_roulette | [getRouletteParticipationCount, executeRouletteDraw]
runRoulette | 1629-1650 | LOW | workflow_wrapper | [runRouletteDraws]
claimDailyShopRewards | 1652-1728 | MEDIUM | workflow_shop | [getDailyShopRewards, claimDailyReward]
runDailyReward | 1730-1750 | LOW | workflow_wrapper | [claimDailyShopRewards]
claimMajakDailyShopRewards | 1752-1892 | HIGH | workflow_majak | [getMajakDailyShopRewards, checkGameOwnership, claimDailyReward]
runMajakReward | 1894-1914 | LOW | workflow_wrapper | [claimMajakDailyShopRewards]
runDailyAccumulatedReward | 1916-2032 | HIGH | workflow_accumulated | [checkGameOwnership, claimDailyAccumulatedReward]
claimRouletteExtraRewards | 2034-2125 | MEDIUM | workflow_roulette_extra | [getRouletteExtra, claimRouletteExtra]
runRouletteExtra | 2127-2147 | LOW | workflow_wrapper | [claimRouletteExtraRewards]
runArticleCreation | 2149-2175 | LOW | workflow_article | [createArticle, unfollowTag]

# Status Layer
checkRouletteStatus | 2180-2193 | LOW | status | [getRouletteParticipationCount]
checkDailyShopStatus | 2195-2234 | MEDIUM | status | [getDailyShopRewards]
checkMajakShopStatus | 2236-2277 | MEDIUM | status | [getMajakDailyShopRewards]
checkArticleWriteStatus | 2279-2329 | MEDIUM | status | [getMyProfile, getMyArticles]
checkAllStatus | 2331-2377 | MEDIUM | status | [checkArticleWriteStatus, checkRouletteStatus, checkDailyShopStatus, checkMajakShopStatus]
updateStatusUI | 2379-2468 | LOW | ui | [document.getElementById]

# UI Creation
createUI | 2473-2902 | HIGH | ui_creation | [document.createElement, attachListener]

# Initialization
init | 2907-2923 | LOW | init | [tryCreateUI]
tryCreateUI | 2925-2942 | LOW | init | [createUI]
```

---

## 🗺️ API ENDPOINT MAP

### Pattern: `METHOD /path | function | params | response_field`

```yaml
# Postie API - Base: https://api.onstove.com
GET /postie/v2.0/interest/article/list:
  func: getArticleList
  params: [size, timestemp]
  response: value.list
  line: 214-218

GET /postie/v1.0/article/{id}/comment/list:
  func: getCommentList
  params: [articleId, size, timestemp]
  response: value.comments
  line: 220-233

PUT /postie/v1.0/article/{id}/interaction/LIKE:
  func: likeArticle
  params: [articleId]
  response: null
  line: 235-238

PUT /postie/v1.0/comment/{id}/interaction/LIKE:
  func: likeComment
  params: [commentId]
  response: null
  line: 240-249

GET /postie/v1.0/article/{ids}/interaction/LIKE:
  func: checkArticleLikeStatus
  params: [articleIds]
  response: value
  line: 251-258

GET /postie/v1.0/comment/{ids}/interaction/LIKE:
  func: checkCommentLikeStatus
  params: [commentIds]
  response: value
  line: 260-266

POST /postie/v1.0/article/{id}/comment:
  func: postComment
  params: [articleId, content]
  body: {content: string}
  response: value
  line: 268-280

POST /postie/v1.0/article:
  func: createArticle
  params: []
  body: {title, content, tags, categoryCode}
  response: value
  line: 344-366

DELETE /postie/v1.0/favorite/TAG/{tag}:
  func: unfollowTag
  params: [tagName]
  response: null
  line: 368-372

PUT /postie/v1.0/favorite/TAG/{tag}:
  func: followTag
  params: [tagName]
  response: null
  line: 374-382

GET /postie/v1.0/user/me:
  func: getMyProfile
  params: [timestemp]
  response: value
  line: 597-617

GET /postie/v1.0/interest/user/{userId}/article/list:
  func: getMyArticles
  params: [userId, sort, size, type, timestemp]
  response: value.list
  line: 619-637

# EMS API
GET /emsbackapi/v3.0/participationCnt:
  func: getRouletteParticipationCount
  params: [sub_event_no]
  response: value.currentCnt, value.limitCnt
  line: 383-445

POST /emsbackapi/v3.0/draw/{subEventNo}:
  func: executeRouletteDraw
  params: [subEventNo]
  response: value.user_reward.qty
  line: 447-518

GET /emsbackapi/v3.0/extra:
  func: getRouletteExtra
  params: [sub_event_no]
  response: value.extra_milestones
  line: 520-540

PUT /emsbackapi/v3.0/extra/{subEventNo}:
  func: claimRouletteExtra
  params: [subEventNo]
  body: {gift_no, extra_cycle_no}
  response: value
  line: 542-568

# Daily Shop API
GET /dailyshop/v1.0/{yearMonth}/services/STOVEINDIE:
  func: getDailyShopRewards
  params: [yearMonth]
  response: value.rewards
  line: 570-595

GET /dailyshop/v1.0/{yearMonth}/services/RIICHICITY_IND:
  func: getMajakDailyShopRewards
  params: [yearMonth]
  response: value.rewards
  line: 671-697

POST /dailyshop/v1.0/attendances/daily/{type}:
  func: claimDailyReward
  params: [item_no, reward_type]
  response: value
  line: 639-669

POST /dailyshop/v1.0/attendances/accumulate/{type}:
  func: claimDailyAccumulatedReward
  params: [item_no]
  response: value
  line: 726-765

POST /dailyshop/v1.0/attendances/accumulate/coupon:
  func: claimMajakAccumulatedReward
  params: [item_no]
  response: value
  line: 767-793

# Ownership API
GET /ownership/v1/check_ownership_by_bgameid:
  func: checkGameOwnership
  params: [game_id]
  response: value.is_owned
  line: 699-724
```

---

## 🔗 DATA FLOW GRAPH

### Pattern: `workflow → steps → state_changes`

```yaml
runAutomation:
  entry: line_931
  exit: line_1331
  complexity: VERY_HIGH
  steps:
    - init: [setButtonState(true), state.reset]
    - phase_1_article_likes:
        range: 940-1000
        calls: [getArticleList, checkArticleLikeStatus, likeArticle]
        loop: 10
        state_update: state.progress.articleLikes++
    - phase_2_comments:
        range: 1002-1100
        calls: [getArticleList, postComment, likeComment]
        loop: 5
        state_update: [state.progress.comments++, state.createdCommentIds.push]
        delay: 11000
    - phase_3_article_create:
        range: 1102-1160
        calls: [createArticle, unfollowTag]
        loop: 1
        state_update: state.progress.newArticle++
    - phase_4_roulette:
        range: 1162-1220
        condition: CONFIG.roulette.enabled
        calls: [runRouletteDraws]
        state_update: state.completed.roulette
    - phase_5_daily_shop:
        range: 1222-1260
        condition: !isRewardSkipPeriod()
        calls: [claimDailyShopRewards]
        state_update: state.completed.dailyShop
    - phase_6_majak:
        range: 1262-1300
        condition: !isRewardSkipPeriod()
        calls: [claimMajakDailyShopRewards]
        state_update: state.completed.majak
    - finalize:
        range: 1302-1331
        calls: [playCompletionSound]
        state_update: state.isRunning = false

runRouletteDraws:
  entry: line_1501
  exit: line_1627
  complexity: MEDIUM
  steps:
    - check_count:
        range: 1510-1525
        calls: [getRouletteParticipationCount]
        vars: [current, limit]
    - calculate_remaining:
        range: 1527-1540
        expr: remaining = limit - current
    - execute_draws:
        range: 1542-1610
        calls: [executeRouletteDraw]
        loop: remaining
        state_update: state.earnings.roulette += (reward - cost)
        delay: 200

claimDailyShopRewards:
  entry: line_1652
  exit: line_1728
  complexity: MEDIUM
  steps:
    - fetch_rewards:
        range: 1660-1670
        calls: [getDailyShopRewards]
        vars: rewards
    - filter_today_or_future:
        range: 1672-1680
        filter: date >= today
        vars: todayOrFutureRewards
    - filter_unclaimed:
        range: 1682-1690
        filter: attendance==false && accumulated==false
        vars: unclaimedRewards
    - claim_loop:
        range: 1692-1720
        calls: [claimDailyReward]
        loop: unclaimedRewards.length
        state_update: state.earnings.dailyShop += reward.flake
        delay: 200

claimMajakDailyShopRewards:
  entry: line_1752
  exit: line_1892
  complexity: HIGH
  steps:
    - fetch_rewards:
        calls: [getMajakDailyShopRewards]
    - check_ownership:
        calls: [checkGameOwnership]
        game_id: btscookingon
    - filter_and_claim:
        calls: [claimDailyReward]
        state_update: state.earnings.majak += reward.flake
```

---

## 🎯 STATE SCHEMA

### Pattern: `path | type | initial | mutators`

```yaml
state:
  isRunning:
    type: boolean
    initial: false
    mutators: [runAutomation, runRoulette, runDailyReward, runMajakReward, runArticleCreation]

  progress:
    articleLikes:
      type: number
      initial: 0
      mutators: [runAutomation.phase_1]
      max: CONFIG.targets.articleLikes
    comments:
      type: number
      initial: 0
      mutators: [runAutomation.phase_2]
      max: CONFIG.targets.comments
    newArticle:
      type: number
      initial: 0
      mutators: [runAutomation.phase_3]
      max: CONFIG.targets.newArticle

  completed:
    roulette:
      type: boolean
      initial: false
      mutators: [runAutomation.phase_4]
    dailyShop:
      type: boolean
      initial: false
      mutators: [runAutomation.phase_5]
    majak:
      type: boolean
      initial: false
      mutators: [runAutomation.phase_6]

  createdCommentIds:
    type: array<number>
    initial: []
    mutators: [runAutomation.phase_2]
    usage: [likeComment]

  earnings:
    roulette:
      type: number
      initial: 0
      mutators: [runRouletteDraws]
      calc: sum(reward - cost)
    rouletteExtra:
      type: number
      initial: 0
      mutators: [claimRouletteExtraRewards]
    dailyShop:
      type: number
      initial: 0
      mutators: [claimDailyShopRewards]
    majak:
      type: number
      initial: 0
      mutators: [claimMajakDailyShopRewards]
```

---

## 🎨 UI COMPONENT TREE

### Pattern: `id | type | event_handler | related_function`

```yaml
stove-quest-automation:
  type: container
  line: 2475-2902

  stove-btn-start:
    type: button
    text: "🚀 전체 자동화"
    handler: runAutomation
    line: 2750, 2886

  stove-btn-roulette:
    type: button
    text: "🎰 룰렛만"
    handler: runRoulette
    line: 2751, 2887

  stove-btn-roulette-extra:
    type: button
    text: "🎁 룰렛 EXTRA"
    handler: runRouletteExtra
    line: 2752, 2888

  stove-btn-daily:
    type: button
    text: "💝 데일리 보상"
    handler: runDailyReward
    line: 2753, 2889

  stove-btn-daily-accumulated:
    type: button
    text: "🎁 데일리 누적 보상"
    handler: runDailyAccumulatedReward
    line: 2754, 2890

  stove-btn-majak:
    type: button
    text: "🀄 마작 리워드"
    handler: runMajakReward
    line: 2755, 2891

  stove-btn-article:
    type: button
    text: "✍️ 출석글쓰기"
    handler: runArticleCreation
    line: 2756, 2892

  stove-btn-status-refresh:
    type: button
    text: "🔄 새로고침"
    handler: checkAllStatus
    line: 2762, 2894

  stove-btn-copy-log:
    type: button
    text: "📋"
    handler: copyLogToClipboard
    line: 2801, 2893

  stove-status-article:
    type: span
    updater: updateStatusUI
    data_source: checkArticleWriteStatus
    line: 2767

  stove-status-roulette:
    type: span
    updater: updateStatusUI
    data_source: checkRouletteStatus
    line: 2771

  stove-status-daily:
    type: span
    updater: updateStatusUI
    data_source: checkDailyShopStatus
    line: 2775

  stove-status-majak:
    type: span
    updater: updateStatusUI
    data_source: checkMajakShopStatus
    line: 2779

  stove-progress-text:
    type: span
    updater: updateProgress
    line: 2788

  stove-article-likes:
    type: span
    updater: updateProgress
    path: state.progress.articleLikes
    line: 2792

  stove-comments:
    type: span
    updater: updateProgress
    path: state.progress.comments
    line: 2793

  stove-new-article:
    type: span
    updater: updateProgress
    path: state.progress.newArticle
    line: 2794

  stove-log-content:
    type: div
    updater: log
    line: 2803
```

---

## 🔧 CONFIG SCHEMA

### Pattern: `key | type | value | usage`

```yaml
CONFIG:
  version:
    type: string
    value: "1.7.6"
    usage: [UI display]
    line: 24

  lastUpdated:
    type: string
    value: "2025-10-28"
    usage: [UI display]
    line: 25

  api.baseUrl:
    type: string
    value: "https://api.onstove.com"
    usage: [All API functions]
    line: 27

  targets.articleLikes:
    type: number
    value: 10
    usage: [runAutomation, updateProgress]
    line: 30

  targets.comments:
    type: number
    value: 5
    usage: [runAutomation, updateProgress]
    line: 31

  targets.newArticle:
    type: number
    value: 1
    usage: [runAutomation, updateProgress]
    line: 32

  delays.betweenActions:
    type: number
    value: 200
    usage: [All workflow functions]
    line: 35

  delays.afterComment:
    type: number
    value: 11000
    usage: [runAutomation.phase_2]
    line: 36

  comment:
    type: string
    value: "Nice!"
    usage: [postComment]
    line: 38

  tags:
    type: array<string>
    value: [STOVEINDIE, epicseven, crossfire, btscookingon, chaoszeronightmare]
    usage: [createArticle, followTag, unfollowTag]
    line: 39-45

  roulette.enabled:
    type: boolean
    value: true
    usage: [runAutomation.phase_4]
    line: 47

  roulette.subEventNo:
    type: string
    value: "1000000228"
    usage: [getRouletteParticipationCount, executeRouletteDraw]
    line: 48

  roulette.extraSubEventNo:
    type: string
    value: "1000000230"
    usage: [getRouletteExtra, claimRouletteExtra]
    line: 49

  roulette.drawCost:
    type: number
    value: 100
    usage: [runRouletteDraws profit calculation]
    line: 50

  roulette.maxDraws:
    type: number
    value: 30
    usage: [getRouletteParticipationCount]
    line: 51
```

---

## 🐛 ERROR PATTERNS

### Pattern: `error_message | location | cause | resolution`

```yaml
"Authorization token (SUAT) not found":
  location: extractHeaders:94
  cause: Cookie missing or user not logged in
  resolution: Check STOVE login status

"UUID (sgs_da_uuid) not found":
  location: extractHeaders:97
  cause: localStorage/Cookie missing UUID
  resolution: Visit STOVE profile page to initialize UUID

"API Error: {status}":
  location: apiRequest:200
  cause: API response status >= 300
  resolution: Check API endpoint and parameters

"Network error":
  location: apiRequest:205
  cause: GM_xmlhttpRequest onerror triggered
  resolution: Check network connectivity

"Failed to parse JSON response":
  location: apiRequest:195
  cause: Response body is not valid JSON
  resolution: Log response.responseText for debugging
```

---

## 🚀 MODIFICATION HOTSPOTS

### Pattern: `feature | files_to_modify | priority`

```yaml
change_target_counts:
  config: CONFIG.targets (line 29-32)
  priority: LOW
  impact: UI display, workflow loops

change_delays:
  config: CONFIG.delays (line 34-36)
  priority: LOW
  impact: API rate limiting, automation speed

change_comment_text:
  config: CONFIG.comment (line 38)
  priority: LOW
  impact: Comment content only

add_new_tag:
  config: CONFIG.tags (line 39-45)
  priority: LOW
  impact: Article creation, tag operations

change_roulette_config:
  config: CONFIG.roulette (line 46-52)
  priority: MEDIUM
  impact: Roulette behavior, event IDs

add_new_workflow:
  ui: createUI button HTML (line 2750-2757)
  ui: createUI event binding (line 2876-2894)
  workflow: New async function in workflow section
  priority: HIGH
  impact: New feature addition

modify_api_endpoint:
  api: Specific API function (line 178-793)
  priority: HIGH
  impact: API communication, data structure

modify_ui_layout:
  ui: createUI HTML template (line 2481-2805)
  ui: createUI CSS styles (line 2482-2738)
  priority: MEDIUM
  impact: Visual appearance only
```

---

## 📈 COMPLEXITY METRICS

### Pattern: `function | cyclomatic_complexity | halstead_difficulty | maintainability_index`

```yaml
runAutomation:
  cc: 18
  difficulty: HIGH
  maintainability: 45
  refactor_priority: CRITICAL
  line: 931-1331

createUI:
  cc: 12
  difficulty: MEDIUM
  maintainability: 55
  refactor_priority: HIGH
  line: 2473-2902

claimMajakDailyShopRewards:
  cc: 10
  difficulty: MEDIUM
  maintainability: 60
  refactor_priority: MEDIUM
  line: 1752-1892

runDailyAccumulatedReward:
  cc: 9
  difficulty: MEDIUM
  maintainability: 62
  refactor_priority: MEDIUM
  line: 1916-2032

claimDailyShopRewards:
  cc: 8
  difficulty: MEDIUM
  maintainability: 65
  refactor_priority: LOW
  line: 1652-1728
```

---

## 🔐 SECURITY ANNOTATIONS

### Pattern: `location | security_concern | mitigation | severity`

```yaml
extractHeaders:
  location: line_90-113
  concern: Token extraction from cookie/localStorage
  mitigation: No hardcoded credentials, runtime extraction only
  severity: LOW

apiRequest:
  location: line_181-212
  concern: GM_xmlhttpRequest usage
  mitigation: Whitelist domains via @connect, HTTPS only
  severity: LOW

createUI:
  location: line_2481-2805
  concern: innerHTML usage
  mitigation: Static strings only, no user input
  severity: LOW

log:
  location: line_798-828
  concern: innerHTML for log display
  mitigation: No user input, internal state only
  severity: LOW
```

---

## 🎯 QUICK EDIT RECIPES

### Common Modification Patterns

```yaml
# Recipe 1: Change article like target
location: line_30
change: CONFIG.targets.articleLikes = 10
to: CONFIG.targets.articleLikes = 15
impact: Workflow loop count, UI display

# Recipe 2: Disable roulette
location: line_47
change: CONFIG.roulette.enabled = true
to: CONFIG.roulette.enabled = false
impact: runAutomation skips phase_4

# Recipe 3: Add new button
step_1:
  location: line_2757 (after last button)
  action: Insert HTML
  code: '<button id="stove-btn-new" class="stove-btn">🆕 New Feature</button>'
step_2:
  location: line_2894 (after last attachListener)
  action: Insert listener
  code: "attachListener('stove-btn-new', runNewFeature);"
step_3:
  location: line_2175 (after runArticleCreation)
  action: Insert function
  code: "async function runNewFeature() { /* implementation */ }"

# Recipe 4: Change API base URL
location: line_27
change: baseUrl: 'https://api.onstove.com'
to: baseUrl: 'https://new-api.onstove.com'
impact: All API calls

# Recipe 5: Modify comment content
location: line_38
change: comment: "Nice!"
to: comment: "Great post!"
impact: postComment function only
```

---

**Generated**: 2025-10-28
**Format**: AI-Optimized Reference
**Parsing Strategy**: Keyword → Line → Context
**Update Strategy**: Sync with STOVE_AUTOMATION_ANALYSIS.md
