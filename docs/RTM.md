# 需求追溯矩陣（RTM）v0.4

| 需求 | 實作 | 自動驗證 | 狀態 |
|---|---|---|---|
| FR-00 真實市場商品發現 | 2 個專用 Adapter、Discovery Feed、M2 UAT runner | 151 筆真實事件；30／30 人工抽樣正確 | M2 Done |
| FR-01 來源登錄／匯入 | API sources、imports、source governance；UI forms | API flow、policy、CSV tests | Done |
| FR-02 Observation／Evidence | SQLite observations、evidence | API create、duplicate、detail | Done |
| FR-03 正規化／去重 | `domain.mjs` | deterministic、URL、name-only tests | Done |
| FR-04 版本化評分 | Vendor／KOL scorer | UNKNOWN scoring test | Done |
| FR-05 人工審核 | review endpoint、RBAC、audit | forbidden／approve／audit tests | Done |
| FR-06 Promotion Dry-run | draft + fixture executor | name-only conflict、end-to-end | Done |
| FR-07 角色專屬工作台 | dual-mode UI、six distinct homes/navigation | permissions + role-experience tests | Done |
| FR-08 商品／廠商／KOL 關聯 | ProductCandidate、GroupBuyEvent、relations | graph + dedup UAT | Not Started / MVP Blocker |
| FR-09 廠商公開資料補充 | Vendor enrichment + field evidence | enrichment contract tests | Not Started / MVP Blocker |
| FR-10 預計開發名單 | DevelopmentProspect、Assignment、Activity | RBAC + idempotency + audit tests | Not Started / MVP Blocker |
| NFR 可追溯／可重現 | evidence、version、hash、request ID | domain／API tests | Done |
| NFR 安全邊界 | Pages no API、CSP、policy、robots、DNS／SSRF、redirect、timeout、rate limit、1 MB | health、URL、Collector contract tests | M1 Done；正式身份／部署 pending |
| NFR 效能 10k／2s | 分頁與 indexes | 尚無 10k benchmark | Deferred |
| 正式 ERP 寫入 | 無 endpoint；固定 Dry-run | health／dry-run assertions | Intentionally excluded |

