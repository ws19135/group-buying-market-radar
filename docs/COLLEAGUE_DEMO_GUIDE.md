# Market Radar MVP 同事展示指南

> 目前是 M6 可操作交付版，不是 `MVP_COMPLETE`。公開 Pages 的商品、廠商、KOL 與 Pipeline 仍是合成資料且完全唯讀；本機 Sandbox 才會載入真實公開事件。

## 建議展示順序（約 8 分鐘）

1. 開啟公開 Pages，說明這是免登入、合成資料、完全唯讀的展示入口。
2. 從右上角依序切換六種角色，觀察首頁名稱、側邊選單、指標、色彩與工作焦點同步變化。
3. 切換 `OPS_EDITOR`：展示「情報採集工作台」、Observation、CSV／JSON 匯入與送審範圍。
4. 切換 `OPS_MANAGER`：展示「營運決策台」、審核佇列、核准邏輯與 Promotion Dry-run。
5. 切換 `SYSTEM_ADMIN`：展示「系統治理中心」、來源政策、Evidence、Audit 與全部系統頁面。
6. 切換 `FINANCE`：說明只看候選規模與 Dry-run 狀態，不推估 GMV、不可審核。
7. 切換 `VENDOR`／`HOST`：展示專屬外部視角與未來 Portal 的租戶隔離邊界。
8. 回到本機 Sandbox，示範市場發現 → 商品中心 → 商品詳情的 KOL → 廠商公開資料 → 加入預計開發 → 指派／推進／Activity。
9. 最後說明 M7～M8 還需要正式登入、受控部署、備份／監控與完整 UAT，ERP 仍只到 Dry-run。

## 六種角色畫面

| 角色 | 首頁 | 主要選單 | 寫入能力 |
|---|---|---|---|
| SYSTEM_ADMIN | 系統治理中心 | 完整治理、資料、審核、整合 | Sandbox 全能力 |
| OPS_MANAGER | 營運決策台 | 審核、候選、Promotion、來源監看 | 審核與 Dry-run |
| OPS_EDITOR | 情報採集工作台 | Observation、來源、候選、送審 | 建立、匯入、送審 |
| FINANCE | 財務觀測台 | 候選規模、Promotion 狀態 | 無，唯讀 |
| VENDOR | 品牌合作視角 | 品牌候選、權限說明 | 無，唯讀 |
| HOST | 團主合作視角 | KOL 候選、權限說明 | 無，唯讀 |

## 展示時必須說清楚

- 公開 Pages 沒有 API、SQLite、Token 或寫入能力。
- 本機 Sandbox 的角色選單是 UAT 模擬，不是正式登入。
- 外部角色目前使用合成展示資料；正式 Portal 上線前仍需 SSO 與 Vendor／Host 本人資料隔離。
- ERP 正式資料沒有被寫入；MVP 在 Promotion Dry-run 停止。

