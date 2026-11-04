# Public Collector Contract

版本：v1.0  
Parsers：`public-page-1.0.0`、`public-listing-1.0.0`

## 執行流程

```text
source governance → DNS/public-IP check → robots.txt → fetch HTML
→ parse JSON-LD / Open Graph → emit Observation[] → idempotent import
→ Evidence + Run metadata + Audit
```

## 輸入 Source

Collector 只接受完成治理的 Source：

```json
{
  "type": "PUBLIC_GROUP_BUY_PAGE",
  "base_url": "https://public.example/group/item",
  "policy_status": "APPROVED",
  "terms_status": "REVIEWED_PUBLIC",
  "access_mode": "PUBLIC_NO_LOGIN",
  "login_required": false,
  "scrape_allowed": true
}
```

## 輸出

`collect(source)` 輸出：

- `records[]`：可交給 Observation 正規化層的商品／團期資料。
- `robots_status`、`robots_checked_at`：本次 robots 判定證據。
- `fetched_url`：最終同網域 URL。
- `content_hash`：頁面內容 SHA-256，用於 Run 冪等鍵。
- `parser_version`、`observed_at`：解析版本與觀察時間。

優先解析 Schema.org `Product` 與 `Event` JSON-LD。沒有結構化資料時，只有頁面同時包含公開開團訊號與標題，才會產出 `REVIEW_REQUIRED` 低信心候選，不會把一般商品頁直接視為正在開團。

## Observation 最低證據

每筆產出必須包含：

- `source_url`
- `entity_type`
- `title`／`product_name`
- `observed_at`
- `parser_version`
- `raw_payload.source_kind`
- `confidence` 與 `status`

價格、品牌、廠商、KOL、團期等缺值保持 `null/UNKNOWN`，不得推測。

## Run 冪等

預設 Run key：

```text
SHA-256(source_id + content_hash + parser_version)
```

同一個明確 `idempotency_key` 可安全重播，並直接回傳既有 Run。相同 Observation fingerprint 不會重複建立。

## 錯誤契約

| Code | 意義 |
|---|---|
| `SOURCE_POLICY_NOT_APPROVED` | 來源政策未核准 |
| `SOURCE_TERMS_NOT_REVIEWED` | 條款未完成公開資料審查 |
| `LOGIN_REQUIRED_SOURCE_BLOCKED` | 來源需要登入或不是公開模式 |
| `ROBOTS_DISALLOWED` | robots.txt 禁止目標路徑 |
| `SOURCE_DNS_PRIVATE_ADDRESS` | DNS 解析到私有／保留位址 |
| `SOURCE_REDIRECT_HOST_BLOCKED` | 重新導向離開 allowlisted hostname |
| `SOURCE_RESPONSE_TOO_LARGE` | 回應超過 1 MB |
| `SOURCE_RATE_LIMITED` | 尚未到下一次允許採集時間 |

所有失敗都必須更新 Source health、建立失敗 Run 並寫入 Audit；不得靜默跳過。
