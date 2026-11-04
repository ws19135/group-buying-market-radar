# Market Radar ↔ Group Buying Operations 整合契約 v0.1

## 原則

1. `group-buying-operations` 是 Vendor、Product、Host、Campaign 的唯一真實來源。
2. Market Radar 不共享 ERP 資料表，也不直接連線 ERP production database。
3. MVP 僅產生 Promotion Draft 與 dry-run，不執行寫入。
4. 所有 payload 使用穩定 UUID、`contract_version` 與 `idempotency_key`。
5. 名稱不可作為唯一識別碼。

## Promotion Draft

```json
{
  "contract_version": "0.1",
  "promotion_draft_id": "uuid",
  "idempotency_key": "uuid",
  "target_type": "VENDOR",
  "source_lead_id": "uuid",
  "proposed_fields": {
    "display_name": "示範廠商",
    "website_url": "https://example.com"
  },
  "evidence": [
    {
      "observation_id": "uuid",
      "source_url": "https://example.com/public-page",
      "observed_at": "2026-11-03T00:00:00Z"
    }
  ],
  "match_candidates": [],
  "requested_mode": "DRY_RUN"
}
```

## Dry-run Response

```json
{
  "contract_version": "0.1",
  "promotion_draft_id": "uuid",
  "result": "CONFLICT",
  "would_create": false,
  "would_update": false,
  "matched_erp_id": null,
  "conflicts": [
    {
      "field": "display_name",
      "reason": "NAME_ONLY_MATCH_NOT_ALLOWED"
    }
  ],
  "missing_required_fields": ["tax_id"],
  "executed_at": "2026-11-03T00:00:01Z"
}
```

## 狀態

`DRAFT → REVIEWED → DRY_RUN_READY → DRY_RUN_COMPLETED`

MVP 到此為止。未來若新增真實寫入，必須另增 `OWNER_APPROVED`，且使用獨立的正式端點、短效憑證、後端 RBAC、完整稽核與可回復策略。

## 禁止事項

- 公開 GitHub Pages 不可持有 ERP base URL（若非公開）、Token、Cookie 或任何秘密。
- 不得從前端直接呼叫 ERP mutation。
- 不得把缺失資料轉成 0 或空字串後 promotion。
- 不得依名稱自動更新既有 ERP 實體。
