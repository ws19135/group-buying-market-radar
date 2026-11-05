# MVP Sandbox 驗證紀錄

日期：2026-11-05

> 本文件證明 Foundation、M1 與 M2 真實市場發現通過，不代表完整 MVP 通過。商品跨來源去重、Vendor enrichment、商品－KOL 關聯與預計開發名單尚未完成。

## 自動驗證

- `npm run check`：syntax check 通過。
- Node test runner：25 tests、25 pass、0 fail（最終數量以 CI 為準）。
- 覆蓋：RBAC、公開唯讀、來源治理、robots、DNS／SSRF、公開頁 JSON-LD 解析、URL／私有網段防護、正規化、fingerprint、CSV、同名不合併、UNKNOWN 評分、Collector Run 冪等、稽核、Dry-run、禁止 hard delete。

## 瀏覽器驗證

- Managed preview 成功連線至本機 SQLite Sandbox。
- 首頁顯示 3 Observations、3 Vendor Leads、3 KOL Leads、來源健康度 100%。
- 六種角色逐一切換驗證，分別顯示：系統治理中心、營運決策台、情報採集工作台、財務觀測台、品牌合作視角、團主合作視角。
- 各角色側邊選單依工作範圍縮減；SYSTEM_ADMIN 可見完整八頁，VENDOR／HOST 僅見各自合作頁與權限說明。
- 建立 Observation dialog 可正常開啟並含必填公開 URL。
- SYSTEM_ADMIN 資料來源頁顯示「MVP 採集底座版」、公開來源治理表、政策／條款／robots 狀態與採集欄位。
- 「新增公開來源」表單包含來源類型、公開頁 URL、政策、條款審查、自動採集、最短間隔、負責人與審查紀錄。
- 頁面固定顯示不採集 LINE 群、私人社團、登入後頁面或封閉資料。
- FINANCE 角色的「建立觀察」按鈕為 disabled；OPS_EDITOR 可開啟表單。
- 首屏已做桌面視覺檢查；狀態文字、角色、Production／ERP 安全邊界均清楚可見。
- 應用頁無 JavaScript error；檢查工具只回報瀏覽器 extension 自身 metadata error，非本站程式。

## M2 真實來源驗證

- 2026-11-05 09:23（台灣時間）端到端執行 `npm run m2:collect`。
- 育兒團購雷達：36 筆、0 errors、robots `ALLOWED`。
- 主夫尼克公開團購行事曆：115 筆、0 errors、robots `ALLOWED`。
- 合計 151 筆；70 進行中、73 即將開團、21 筆 7 日內結束、8 筆因日期不完整進入人工確認。
- 30 筆人工抽樣全部正確，precision 100%；自動結構完整率 94.7%。
- 詳細證據見 [M2_UAT_EVIDENCE.md](M2_UAT_EVIDENCE.md)。

## 邊界聲明

M2 只讀取免登入公開網頁並寫入隔離的本機 SQLite；ERP 仍只使用 fixture。沒有連線或寫入正式 ERP，也沒有修改 `group-buying-operations`。正式資料量 10,000 筆／2 秒目標尚未做 benchmark，保留至正式化階段。

