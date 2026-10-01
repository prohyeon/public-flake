export const capturedSpecialForceShop = {
  "service_id": "GM-2A26-6A4CAF50_IND",
  "attendance_type": "ACCUMULATED_PLAY_SYSTEM",
  "date_info": {
    "attend_start_dt": "2026-10-01T00:00:00",
    "attend_end_dt": "2026-10-14T23:59:59"
  },
  "event_not_started": false,
  "event_ended": false,
  "exchange_condition": true,
  "accumulated_plays": {
    "total_play_days": 1,
    "rewards": [
      {
        "item_type": "FLAKE",
        "flake_amount": 1000,
        "rewardable_days": 1,
        "item_no": 25,
        "item_name": "1,000 플레이크 &amp; SP부스트(60분)",
        "is_received": false,
        "sold_out": false,
        "eligible": true
      },
      {
        "item_type": "FLAKE",
        "flake_amount": 1000,
        "rewardable_days": 2,
        "item_no": 26,
        "item_name": "1,000 플레이크 &amp; 계급 경험치 부스트(60분)",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "flake_amount": 1000,
        "rewardable_days": 3,
        "item_no": 27,
        "item_name": "1,000 플레이크 &amp; 무기 경험치 부스트(60분)",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "flake_amount": 1000,
        "rewardable_days": 4,
        "item_no": 28,
        "item_name": "1,000 플레이크 &amp; 무기 훈련 교본[하급] x 10개",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "flake_amount": 1000,
        "rewardable_days": 5,
        "item_no": 29,
        "item_name": "1,000 플레이크 &amp; SP 2000",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "flake_amount": 1000,
        "rewardable_days": 6,
        "item_no": 30,
        "item_name": "1,000 플레이크 &amp; SC 2000",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      },
      {
        "item_type": "FLAKE",
        "flake_amount": 10000,
        "rewardable_days": 7,
        "item_no": 31,
        "item_name": "10,000 플레이크 &amp; 프라임 포스, 스페셜 키 x 10개",
        "is_received": false,
        "sold_out": false,
        "eligible": false
      }
    ]
  },
  "month": "202610"
};
export const specialForceShop = () => structuredClone(capturedSpecialForceShop);
