# 需求追溯矩陣（RTM）v0.2

| 需求 | 實作 | 自動驗證 | 狀態 |
|---|---|---|---|
| FR-01 來源登錄／匯入 | API sources、imports；UI forms | API flow、CSV tests | Done |
| FR-02 Observation／Evidence | SQLite observations、evidence | API create、duplicate、detail | Done |
| FR-03 正規化／去重 | `domain.mjs` | deterministic、URL、name-only tests | Done |
| FR-04 版本化評分 | Vendor／KOL scorer | UNKNOWN scoring test | Done |
| FR-05 人工審核 | review endpoint、RBAC、audit | forbidden／approve／audit tests | Done |
| FR-06 Promotion Dry-run | draft + fixture executor | name-only conflict、end-to-end | Done |
| FR-07 公開角色預覽 | dual-mode UI、six roles | permissions tests | Done |
| NFR 可追溯／可重現 | evidence、version、hash、request ID | domain／API tests | Done |
| NFR 安全邊界 | Pages no API、CSP、body limit、URL guard | health boundary、URL tests | Done for MVP |
| NFR 效能 10k／2s | 分頁與 indexes | 尚無 10k benchmark | Deferred |
| 正式 ERP 寫入 | 無 endpoint；固定 Dry-run | health／dry-run assertions | Intentionally excluded |

