# MVP Sandbox API v1

Base path：`/api/v1`。所有回應為 JSON；mutation 僅供本機 Sandbox。角色以 `x-role` 模擬，request correlation 可傳 `x-request-id`。

## Endpoints

| Method | Path | 能力 | 說明 |
|---|---|---|---|
| GET | `/health` | — | 模式、MVP 狀態、真實 Collector 數量、SQLite、Sandbox／ERP 寫入邊界 |

`/health` 目前回傳 `mvp_status: "DISCOVERY_FOUNDATION"` 與 `collector_runtime_available: true`。`live_collectors` 依完成治理且已啟用的來源動態計算；`real_market_discovery_enabled` 只有在至少一個來源啟用時才為 `true`。這不等於完整 MVP 已通過，完整狀態仍須完成 30 筆真實事件 UAT。
| GET | `/dashboard` | view | 儀表板統計 |
| GET／POST | `/sources` | view／source_admin | 來源列表／建立公開來源 |
| POST | `/sources/:id/collect` | source_admin | 執行核准公開來源 Collector；保存 Run／Evidence／Audit |
| GET／POST | `/observations` | view／review | 查詢／建立 Observation |
| GET | `/observations/:id` | view | Evidence 與 match candidates |
| POST | `/imports` | review | CSV／JSON 匯入 |
| GET | `/runs` | view | Collection run 與 row errors |
| POST | `/leads/rebuild` | review | 從 Observation 重建評分線索 |
| GET | `/leads?lead_type=VENDOR|KOL` | view | 線索列表 |
| POST | `/leads/:id/review` | review／approve | SUBMIT 或管理者決策 |
| GET | `/reviews` | view | 決策歷程 |
| POST | `/leads/:id/promotion-drafts` | integration_dry_run | 核准線索建立草稿 |
| GET | `/promotion-drafts` | view | 草稿列表 |
| POST | `/promotion-drafts/:id/dry-run` | integration_dry_run | 對 ERP fixture 模擬 |
| GET | `/audit?limit=100` | approve | 稽核紀錄 |

## 公開來源範例

```json
{
  "name": "公開開團頁",
  "type": "PUBLIC_GROUP_BUY_PAGE",
  "base_url": "https://public.example/group/item",
  "policy_status": "APPROVED",
  "terms_status": "REVIEWED_PUBLIC",
  "access_mode": "PUBLIC_NO_LOGIN",
  "login_required": false,
  "scrape_allowed": true,
  "collection_interval_minutes": 1440,
  "review_notes": "公開頁且不需登入；2026-11-04 完成審查"
}
```

只有上述治理條件全部成立，`POST /sources/:id/collect` 才會執行。相同 `idempotency_key` 會回傳既有 Run。

## Observation 範例

```json
{
  "source_url": "https://example.com/public/group-buy/tea",
  "entity_type": "PRODUCT",
  "title": "春季茶品團購",
  "vendor_name": "示範茶行",
  "host_name": "示範團主",
  "platform": "Instagram",
  "platform_handle": "@demo_host",
  "category": "飲品",
  "observed_at": "2026-11-04T08:00:00.000Z"
}
```

## Import 範例

```json
{
  "format": "json",
  "idempotency_key": "uat-batch-001",
  "records": [{ "source_url": "https://example.com/a", "entity_type": "VENDOR", "vendor_name": "示範品牌" }]
}
```

## 錯誤

```json
{
  "error": { "code": "FORBIDDEN", "message": "此角色沒有執行這項作業的權限" },
  "request_id": "req_..."
}
```

常見狀態：400 格式／URL／DNS 邊界錯誤、403 權限或 Sandbox 停寫、404 資源不存在、409 政策／robots 狀態衝突、413 body 或來源回應過大、415 不支援內容型別、429 來源頻率限制、500 已消毒的內部錯誤。

