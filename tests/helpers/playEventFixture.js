// 2026-11-01 luvplace shop capture, reduced to the fields src reads. The captured account had 0 play
// days, so total_play_days and day 1's eligible are set here to exercise a claim.
export const capturedPlayEventShop = {
  "service_id": "GM-29D4-6A460686_IND",
  "attendance_type": "ACCUMULATED_PLAY_SYSTEM",
  "date_info": {
    "attend_start_dt": "2026-11-01T00:00:00",
    "attend_end_dt": "2026-11-15T23:59:59"
  },
  "event_not_started": false,
  "event_ended": false,
  "exchange_condition": true,
  "accumulated_plays": {
    "total_play_days": 1,
    "rewards": [
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 1,
        "item_no": 42,
        "item_name": "1,000 플레이크 &amp; 100 루비",
        "is_received": false,
        "sold_out": false,
        "eligible": true
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 2,
        "item_no": 43,
        "item_name": "1,000 플레이크 &amp; 꾸러기 상점 장식/문양 교환권",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 3,
        "item_no": 44,
        "item_name": "1,000 플레이크 &amp; 1백만 EXP",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 4,
        "item_no": 45,
        "item_name": "1,000 플레이크 &amp; 100 루비",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 5,
        "item_no": 46,
        "item_name": "1,000 플레이크 &amp; 꾸러기 상점 제목/테두리 교환권",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 6,
        "item_no": 47,
        "item_name": "1,000 플레이크 &amp; 1백만 EXP",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 7,
        "item_no": 48,
        "item_name": "1,000 플레이크 &amp; 150 루비",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 8,
        "item_no": 49,
        "item_name": "1,000 플레이크 &amp; 꾸러기 상점 배경/스킨 교환권",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 1000,
        "rewardable_days": 9,
        "item_no": 50,
        "item_name": "1,000 플레이크 &amp; 1백만 EXP",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "has_game_character": false,
        "flake_amount": 10000,
        "rewardable_days": 10,
        "item_no": 51,
        "item_name": "10,000 플레이크 &amp; 400 루비",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      }
    ]
  },
  "month": "202611"
};
export const playEventShop = () => structuredClone(capturedPlayEventShop);
