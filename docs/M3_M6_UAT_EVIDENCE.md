# Milestone 3～6 UAT 證據

日期：2026-11-05  
版本：v0.9.0  
狀態：`M6_PIPELINE_READY`

## 真實資料重建結果

執行 `npm run m2:collect && npm run m6:rebuild` 後：

| 指標 | 結果 |
|---|---:|
| 非合成 Observation | 151 |
| ProductCandidate | 151 |
| GroupBuyEvent | 151 |
| VendorCandidate | 151 |
| KolCandidate | 10 |
| KolProductRelation | 151 |
| 待人工商品比對 | 3 |
| 已補充公開廠商資料 | 0 |
| DevelopmentProspect | 0 |

廠商與 Prospect 為 0 的欄位不是遺漏：兩個現行來源主要提供商品、團主與日期，沒有足夠的公開廠商官網／合作資料。系統建立 `NEEDS_ENRICHMENT` 候選並保留 UNKNOWN，不推測或以合成資料冒充。

## Gate C — 商品中心

- 品牌 + 精確商品名稱等穩定證據可自動彙整跨事件商品。
- 只有同名但缺少穩定證據時，只建立 `PENDING` match candidate。
- OPS_MANAGER／SYSTEM_ADMIN 可人工確認 merge 或 split；兩種決策都保存 Audit。
- 商品詳情彙整事件、價格範圍、廠商、KOL 與別名。

結果：Passed。

## Gate D — 廠商公開資料

- 每個商品可追到 VendorCandidate；未知廠商保持待補充。
- 可補正式／顯示名稱、官網、公開合作頁、公開商務 Email、品類與地區。
- 每個被補充欄位保存 source URL、captured_at、confidence 與 parser version。
- 系統不推測統編、營收、私人 Email 或私人聯絡方式。

結果：Passed（能力與 Evidence UAT）。真實資料仍等待人員逐筆補充。

## Gate E — 商品 × KOL／團主

- 真實資料建立 10 個 KOL 候選與 151 筆 relation。
- Relation 保存平台、handle、事件、公開來源與觀察時間。
- 商品詳情可列出多位 KOL；KOL 清單可彙整商品與事件數。

結果：Passed。

## Gate F — 預計開發 Pipeline

- OPS_EDITOR 可由 VendorCandidate 冪等加入 Prospect，重複操作回傳既有項目。
- OPS_MANAGER／SYSTEM_ADMIN 可設定負責人、優先序、下一步與合法階段轉換。
- OPS_EDITOR 不可自行指派 owner 或推進受管階段。
- 備註與研究／聯絡／追蹤活動採 append-only，所有 mutation 寫入 Audit。
- 系統不自動發 Email、私訊或對外聯絡。

結果：Passed（自動化端到端 API UAT）。

## 自動驗證

`npm run check`：29 tests、29 pass、0 fail。涵蓋 stable identity、name-only candidate、merge、split、Vendor Evidence、KOL relations、Prospect idempotency、角色權限、合法階段、Activity、Audit、禁止 hard delete 與 ERP Dry-run。

## 尚未完成

- M7：SSO／Session、後端 role mapping、受管資料庫、排程、備份、監控與 Secrets。
- M8：在受控環境以團隊真實操作完成完整端到端 UAT 與交付簽核。
- 因此健康狀態是 `M6_PIPELINE_READY`，不是 `MVP_COMPLETE`。
