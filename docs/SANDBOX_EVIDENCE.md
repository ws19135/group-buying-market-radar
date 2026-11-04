# MVP Sandbox 驗證紀錄

日期：2026-11-04

> 本文件只證明 Foundation 流程驗證通過，不代表重新定義後的完整 MVP 通過。真實市場發現、商品－KOL 關聯、Vendor enrichment 與預計開發名單尚無完成證據。

## 自動驗證

- `npm run check`：syntax check 通過。
- Node test runner：17 tests、17 pass、0 fail。
- 覆蓋：RBAC、公開唯讀、URL／私有網段防護、正規化、fingerprint、CSV、同名不合併、UNKNOWN 評分、API 全流程、冪等、稽核、Dry-run、禁止 hard delete。

## 瀏覽器驗證

- Managed preview 成功連線至本機 SQLite Sandbox。
- 首頁顯示 3 Observations、3 Vendor Leads、3 KOL Leads、來源健康度 100%。
- 六種角色逐一切換驗證，分別顯示：系統治理中心、營運決策台、情報採集工作台、財務觀測台、品牌合作視角、團主合作視角。
- 各角色側邊選單依工作範圍縮減；SYSTEM_ADMIN 可見完整八頁，VENDOR／HOST 僅見各自合作頁與權限說明。
- 建立 Observation dialog 可正常開啟並含必填公開 URL。
- FINANCE 角色的「建立觀察」按鈕為 disabled；OPS_EDITOR 可開啟表單。
- 首屏已做桌面視覺檢查；狀態文字、角色、Production／ERP 安全邊界均清楚可見。
- 應用頁無 JavaScript error；檢查工具只回報瀏覽器 extension 自身 metadata error，非本站程式。

## 邊界聲明

驗證使用合成資料與 ERP fixture。沒有連線或寫入正式 ERP，也沒有修改 `group-buying-operations`。正式資料量 10,000 筆／2 秒目標尚未做 benchmark，保留至正式化階段。

