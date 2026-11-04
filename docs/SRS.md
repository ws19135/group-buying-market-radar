# 團購市場情報與開發雷達 SRS v0.1

狀態：Approved for MVP（D-MR-01～10 採建議版）  
日期：2026-11-03

## 1. 目的與邊界

本系統協助團購部門發現市場上正在開團的商品、可開發廠商與可合作 KOL／團主。Market Radar 是「觀察與情報層」，不是既有 ERP 的替代品。

- Market Radar 保存外部公開訊號、證據、正規化結果、候選與審核狀態。
- `group-buying-operations` 保存 Vendor、Product、Host、Campaign 等正式主檔，且為唯一真實來源（SoT）。
- 觀察資料不得自動建立或更新 ERP 主檔。
- 無資料代表「未知／資料不足」，不得呈現為 0。
- 不推估銷售量、GMV 或私人互動成效。

## 2. 使用者與角色

| 角色 | 正式環境權限 | 公開展示站 |
|---|---|---|
| SYSTEM_ADMIN | 檢視、審核、核准、來源管理、整合 dry-run | 可切換預覽，無寫入 |
| OPS_MANAGER | 檢視、審核、核准、整合 dry-run | 可切換預覽，無寫入 |
| OPS_EDITOR | 檢視、提交審核 | 可切換預覽，無寫入 |
| FINANCE | 預設無市場雷達作業權 | 可檢視角色頁面，無寫入 |
| VENDOR | 無市場雷達作業權 | 可檢視角色頁面，無寫入 |
| HOST | 無市場雷達作業權 | 可檢視角色頁面，無寫入 |

公開展示站移除入口驗證，讓各角色頁面可直接審閱；它只放合成資料，不包含 Token、Session、資料庫或寫入 API。正式環境仍必須保留身份驗證與後端 RBAC。

## 3. D-MR-01～10 決策

| ID | 決策 |
|---|---|
| D-MR-01 | Market Radar 與 ERP 分離部署；ERP 為正式主檔 SoT。 |
| D-MR-02 | 所有外部資料先建立 Observation，不直接建立 Vendor／Product／Host／Campaign。 |
| D-MR-03 | 僅採集公開可見來源；不存取私人 LINE、封閉 FB、登入後 IG／Threads 或其他受限內容。 |
| D-MR-04 | 每筆觀察保留 source URL、observed_at、parser_version、raw value 與 evidence。 |
| D-MR-05 | raw、normalized、inferred 欄位分離；推論值必須附 confidence 與規則版本。 |
| D-MR-06 | 禁止只依名稱自動合併；去重只產生候選，須人工確認穩定 ID 與證據。 |
| D-MR-07 | 缺值表示未知／資料不足，不得補 0；不推估銷售量與 GMV。 |
| D-MR-08 | 廠商分數權重採 25/20/20/20/10/5；KOL 分數採 30/20/15/15/10/10。 |
| D-MR-09 | ERP promotion 預設僅 dry-run；需 Owner approval 才可進入未來寫入流程。 |
| D-MR-10 | `kol-claw` 僅作架構參考或外部 adapter，不直接合併至 ERP 核心。 |

## 4. 功能需求

### FR-01 公開來源登錄

- 接受人工公開 URL、CSV／JSON 匯入、公開團購日曆、品牌官網及公開合作表單。
- 每個 Source 記錄類型、政策、擷取頻率、最近成功時間與健康度。
- 正式 collector 啟用前必須完成 robots、平台條款與合法性檢查。

### FR-02 市場觀察

- 建立不可覆寫證據鏈的 Observation。
- 可將一次來源解析為商品、廠商、KOL／團主與開團訊號。
- 重跑 parser 不覆蓋原始值，應建立新版本或可追溯的 normalized 結果。

### FR-03 正規化與去重

- 正規化網址、平台 handle、電話／Email（僅公開聯絡資料）、品牌名稱與商品規格。
- 去重輸出 match candidate、理由、confidence 與衝突欄位。
- 同名不是自動合併依據。

### FR-04 線索評分

廠商評分（100 分）：開團活躍度 25、品類契合 20、證據品質 20、合作可行性 20、資料新鮮度 10、資料完整度 5。

KOL 評分（100 分）：近期開團活躍度 30、品類契合 20、公開合作方式 15、證據品質 15、資料新鮮度 10、資料完整度 10。

### FR-05 人工審核

- OPS_EDITOR 可提交候選。
- OPS_MANAGER／SYSTEM_ADMIN 可核准、退回或標示不處理。
- 每次決策記錄 actor、timestamp、reason 與前後狀態。

### FR-06 ERP Promotion Draft

- 核准候選可建立 promotion draft。
- dry-run 顯示欄位映射、預計建立／更新、衝突與缺值。
- MVP 不實作正式 ERP 寫入。

### FR-07 公開角色預覽

- 不顯示登入入口，透過角色選單或 `?role=` 切換角色。
- 所有角色都能開啟所有頁面以便審閱 UI 差異。
- 所有可能改變狀態的操作都必須 disabled 或回覆 dry-run 提示。
- 僅可使用合成或已匿名化展示資料。

## 5. 核心資料模型

| Entity | 必要欄位 |
|---|---|
| Source | source_id, type, base_url, policy_status, health_status |
| Observation | observation_id, source_id, source_url, observed_at, parser_version, raw_payload_hash |
| Evidence | evidence_id, observation_id, field, raw_value, captured_at |
| NormalizedEntity | entity_id, entity_type, normalized_fields, normalization_version |
| MatchCandidate | candidate_id, entity_a, entity_b, confidence, reasons, status |
| Lead | lead_id, lead_type, score, score_version, stage, last_observed_at |
| ReviewDecision | decision_id, lead_id, actor_role, action, reason, decided_at |
| PromotionDraft | draft_id, lead_id, target_type, field_mapping, conflicts, status |

## 6. 非功能需求

- 可追溯性：每個 UI 欄位可追到 Observation 與 Evidence。
- 可重現性：相同 parser／score 版本與輸入應產生相同結果。
- 安全性：公開站不可包含秘密、個資名單、內部營業資料或寫入端點。
- 可用性：核心頁面支援桌面、平板與手機；關鍵狀態不可只用顏色表示。
- 效能：10,000 筆觀察下，列表首屏目標在 2 秒內完成（正式 API 環境）。
- 稽核：正式審核與 promotion 事件不可被一般使用者刪除。

## 7. MVP 驗收條件

1. 公開 URL 可免登入開啟。
2. 六種角色均可切換，所有頁面都可顯示。
3. 所有動作在公開站都不造成寫入。
4. Observation、Vendor Lead、KOL Lead、Review、Source、ERP Dry-run 頁面齊全。
5. README 顯示資料流程圖。
6. 權限測試通過，且 GitHub Pages workflow 先測試再部署。

## 8. 後續階段

- Phase 1：Observation API、資料庫 schema、人工 URL 與 CSV 匯入。
- Phase 2：合法公開來源 collectors、排程與來源健康度。
- Phase 3：去重候選、評分版本、審核工作流。
- Phase 4：與 ERP 的唯讀查詢及 promotion dry-run contract test。
- Phase 5：Owner 核准後的受控寫入（另案審核）。
