# 資料字典 v0.2

| Table | 主鍵 | 用途 | 保留重點 |
|---|---|---|---|
| `sources` | `source_id` | 公開來源、政策與健康度 | base URL 唯一；不代表已獲准自動擷取 |
| `collection_runs` | `run_id` | 批次匯入結果 | idempotency key 唯一；保留逐列錯誤 |
| `observations` | `observation_id` | 不可覆寫的市場觀察 | fingerprint 唯一；保存 raw hash 與版本 |
| `evidence` | `evidence_id` | UI 欄位的原始證據 | 連回 Observation 與 source URL |
| `match_candidates` | `candidate_id` | 人工去重候選 | confidence、reasons、conflicts、version |
| `leads` | `lead_id` | Vendor／KOL 聚合線索 | score version、breakdown、資料充分度、stage |
| `review_decisions` | `decision_id` | 審核事件 | actor、reason、before／after，不可 hard delete |
| `promotion_drafts` | `promotion_draft_id` | ERP promotion 草稿 | contract、idempotency、evidence、dry-run result |
| `audit_log` | `audit_id` | Mutation 稽核 | actor、action、entity、before／after、request ID |
| `schema_migrations` | `version` | SQLite schema 版本 | MVP migration `001_initial_mvp` |

## Null 與時間規則

- 缺值使用 SQL `NULL`／JSON `null`，語意為未知或資料不足，不等於數字 0。
- API 時間採 UTC ISO 8601；SQLite 儲存文字時間。
- JSON 結構欄位以 `_json` 儲存，API mapper 轉回 object／array。
- `raw_payload_hash`、`fingerprint`、`idempotency_key` 使用 SHA-256；ID 使用帶 entity prefix 的 UUID。

## 敏感資料政策

只接受公開頁面明示的合作 Email；MVP 不蒐集私人訊息、登入後內容、推估銷量、GMV、私人互動指標或非公開聯絡名單。fixture 與 seed 均為合成資料。

