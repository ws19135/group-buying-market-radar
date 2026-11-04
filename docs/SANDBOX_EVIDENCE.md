# MVP Sandbox 驗證紀錄

日期：2026-11-04

## 自動驗證

- `npm run check`：syntax check 通過。
- Node test runner：14 tests、14 pass、0 fail。
- 覆蓋：RBAC、公開唯讀、URL／私有網段防護、正規化、fingerprint、CSV、同名不合併、UNKNOWN 評分、API 全流程、冪等、稽核、Dry-run、禁止 hard delete。

## 瀏覽器驗證

- Managed preview 成功連線至本機 SQLite Sandbox。
- 首頁顯示 3 Observations、3 Vendor Leads、3 KOL Leads、來源健康度 100%。
- 八個頁面均可導覽；建立 Observation dialog 可正常開啟並含必填公開 URL。
- FINANCE 角色的「建立觀察」按鈕為 disabled；OPS_EDITOR 可開啟表單。
- 首屏已做桌面視覺檢查；狀態文字、角色、Production／ERP 安全邊界均清楚可見。
- 應用頁無 JavaScript error；檢查工具只回報瀏覽器 extension 自身 metadata error，非本站程式。

## 邊界聲明

驗證使用合成資料與 ERP fixture。沒有連線或寫入正式 ERP，也沒有修改 `group-buying-operations`。正式資料量 10,000 筆／2 秒目標尚未做 benchmark，保留至正式化階段。

