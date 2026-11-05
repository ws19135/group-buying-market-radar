# 團購市場情報與開發雷達 SRS v0.4

狀態：MVP Rebaselined／Discovery Foundation Implemented／完整 MVP 尚未完成
日期：2026-11-04

## 1. 目的與邊界

本系統協助團購部門發現市場上正在開團的商品、可開發廠商與可合作 KOL／團主。Market Radar 是「觀察與情報層」，不是既有 ERP 的替代品。

- Market Radar 保存外部公開訊號、證據、正規化結果、候選與審核狀態。
- `group-buying-operations` 保存 Vendor、Product、Host、Campaign 等正式主檔，且為唯一真實來源（SoT）。
- 觀察資料不得自動建立或更新 ERP 主檔。
- 無資料代表「未知／資料不足」，不得呈現為 0。
- 不推估銷售量、GMV 或私人互動成效。

### 1.1 Owner 重新定義

完整 MVP 的第一步必須實際找到市場上正在開團的商品；接著以商品為中心收集廠商公開資料、列出正在開團的 KOL／團主，並讓公司開團人員把廠商加入與指派到預計開發名單。人工輸入、合成資料或只有後段審核流程，不構成完整 MVP。

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

## 3. D-MR-01～20 決策

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
| D-MR-11 | 真實公開市場發現是 MVP 第一個驗收閘門；人工輸入或合成資料不算完成。 |
| D-MR-12 | Product 是聚合中心；一個商品可對應多筆 GroupBuyEvent。 |
| D-MR-13 | GroupBuyEvent 必須連結公開來源、觀察時間、狀態，以及可辨識時的 Vendor 與 KOL。 |
| D-MR-14 | 同一商品需彙整所有已觀察的開團 KOL／團主。 |
| D-MR-15 | Vendor enrichment 只使用公開商務資料，欄位皆保留 Evidence。 |
| D-MR-16 | 開團人員可將 VendorCandidate 加入 DevelopmentProspect 並接受指派。 |
| D-MR-17 | 系統不自動對外聯絡；所有聯絡由人員明確執行。 |
| D-MR-18 | 登入後、私人社團、私人 LINE 或規避限制的資料不得採集。 |
| D-MR-19 | Collector／Parser／Normalization／Match 必須版本化、冪等且可重跑。 |
| D-MR-20 | Pages 只展示合成資料；真實資料與開發名單位於受控後端。 |

## 4. 功能需求

### FR-00 真實市場商品發現（MVP Entry Gate）

- 系統須由經核准的公開來源，自動或一鍵執行發現目前／近期正在開團的商品。
- 每筆結果至少包含 source URL、observed_at、商品顯示名稱、開團狀態與 Evidence。
- 支援排程、手動重跑、重試、來源停用、冪等鍵與 run health。
- 至少兩種公開來源類型完成 contract test 與真實資料 UAT。

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
- 每個角色必須有不同的首頁名稱、導覽選單、工作焦點、指標與角色說明。
- SYSTEM_ADMIN 可見完整治理、資料、審核與整合頁面；OPS_MANAGER 聚焦審核與 Promotion；OPS_EDITOR 聚焦採集、整理與送審。
- FINANCE、VENDOR、HOST 僅顯示與自身視角相關的頁面，且所有 mutation 保持 disabled。
- 所有可能改變狀態的操作都必須 disabled 或回覆 dry-run 提示。
- 僅可使用合成或已匿名化展示資料。

### FR-08 商品、廠商與 KOL 關聯

- ProductCandidate 聚合不同來源與不同 KOL 的 GroupBuyEvent。
- 商品詳情須列出所有已發現正在／曾經開團的 KOL、平台、團期與證據。
- 可從 ProductCandidate 追到 VendorCandidate；無法確認時保持 UNKNOWN。

### FR-09 廠商公開資料補充

- 收集廠商名稱、官網、公開合作頁、公開商務 Email、品類、地區與公開社群網址。
- 每個欄位保存來源、captured_at、confidence 與 parser version。
- 不推測統編、營收或非公開聯絡資料；只依同名不得連結 ERP Vendor。

### FR-10 預計開發名單

- OPS_EDITOR 可將 VendorCandidate 加入 DevelopmentProspect。
- OPS_MANAGER 可指派開團人員、設定優先序、下一步日期與開發階段。
- 同一 Vendor 只能有一筆有效 Prospect，重複加入須冪等回傳既有項目。
- 系統保存 Activity 與 Audit，但不得自動發信、私訊或聯絡外部人員。

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
| ProductCandidate | product_id, canonical_name, brand, category, normalized_specs, status |
| GroupBuyEvent | event_id, product_id, vendor_id, kol_id, source_url, observed_at, starts_at, ends_at, event_status |
| VendorCandidate | vendor_id, display_name, website_url, public_business_contact, evidence, match_status |
| KolCandidate | kol_id, display_name, platform, handle, public_collaboration_method, evidence |
| KolProductRelation | relation_id, kol_id, product_id, event_id, first_seen_at, last_seen_at |
| DevelopmentProspect | prospect_id, vendor_id, owner_id, priority, stage, next_action_at |
| DevelopmentActivity | activity_id, prospect_id, actor_id, action_type, note, created_at |

## 6. 非功能需求

- 可追溯性：每個 UI 欄位可追到 Observation 與 Evidence。
- 可重現性：相同 parser／score 版本與輸入應產生相同結果。
- 安全性：公開站不可包含秘密、個資名單、內部營業資料或寫入端點。
- 可用性：核心頁面支援桌面、平板與手機；關鍵狀態不可只用顏色表示。
- 效能：10,000 筆觀察下，列表首屏目標在 2 秒內完成（正式 API 環境）。
- 稽核：正式審核與 promotion 事件不可被一般使用者刪除。

## 7. MVP 驗收條件與狀態

| 驗收條件 | 狀態 | 證據 |
|---|---|---|
| 公開 URL 可免登入開啟 | Done | GitHub Pages |
| 六種角色均可切換，且呈現六套不同工作台 | Done | role-experience tests 與瀏覽器逐角色驗證 |
| 所有動作在公開站都不造成寫入 | Done | Pages 無 API；UI 自動進入 READ-ONLY |
| Observation、Lead、Review、Source、ERP Dry-run 頁面齊全 | Done | 八頁 UI |
| README 顯示資料流程圖 | Done | `docs/assets/market-radar-flow.png` |
| 權限測試通過，workflow 先測試再部署 | Done | `npm run check` gate |
| 本機可完成匯入至 Dry-run 全流程 | Done | SQLite REST API 與 API integration test |
| 正式 ERP 與既有 repo 未被寫入 | Done | 無 ERP write endpoint；fixture only |
| 公開來源治理與安全 Collector runtime | Done | policy／terms／robots／DNS／SSRF／Run contract tests |
| 真實發現至少 30 筆公開開團事件 | Done | 2 個來源、151 筆事件；30／30 人工抽樣正確 |
| 同商品彙整多位開團 KOL | Not Started | Product／GroupBuyEvent／Relation UAT |
| 商品可追到有 Evidence 的廠商資料 | Not Started | Vendor enrichment UAT |
| 可加入、指派與追蹤預計開發名單 | Not Started | Development pipeline UAT |

## 8. 實作狀態與下一步

- Milestone 2 已完成：兩個公開來源、兩種專用 Adapter、151 筆真實事件、Discovery Feed、Run metadata 與 Gate B UAT。
- 完整 MVP 尚未完成：Product／GroupBuyEvent 去重彙整、Vendor enrichment、KOL relations 與 Development Pipeline。
- 下一步依 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) 的 Milestone 3～8 執行。
- 正式化：SSO、後端身份映射、受管資料庫、備份、監控、正式 ERP 唯讀 adapter 與 contract test。
- 不在本 MVP：Owner 核准後的受控 ERP 寫入；必須另案風險審核與核准。
