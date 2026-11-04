# MVP UAT 計畫 v0.2

## 前置條件

1. Node.js 22+；執行 `npm run check`。
2. 執行 `npm start` 並開啟 <http://localhost:4173>。
3. 確認頁首顯示 `LOCAL WRITE`／Sandbox，且 ERP production 為未觸碰。

## 驗收案例

| ID | 角色 | 操作 | 預期結果 |
|---|---|---|---|
| UAT-01 | ADMIN | 新增公開 Source | 成功；私有 IP／localhost 被拒絕 |
| UAT-02 | EDITOR | 建立 Observation | Evidence 可查看；重送不重複新增 |
| UAT-03 | EDITOR | CSV／JSON 匯入後以相同 key 重送 | 第二次回傳 replay；run 計數不重複 |
| UAT-04 | EDITOR | 重建 Leads | Vendor／KOL 分數與資料充分度顯示 |
| UAT-05 | EDITOR | SUBMIT | stage 進入 `IN_REVIEW`；無 APPROVE 權限 |
| UAT-06 | MANAGER | APPROVE 並填 reason | stage 變 `APPROVED`；Review 與 audit 有 before／after |
| UAT-07 | MANAGER | 建 Promotion Draft 並 Dry-run | 顯示 create／link／conflict／incomplete；ERP 無更新 |
| UAT-08 | FINANCE | 嘗試 mutation | UI disabled；API 直接呼叫回 403 |
| UAT-09 | 任意 | 切換八頁與六角色、手機寬度 | 頁面可讀，關鍵狀態有文字而非只靠顏色 |
| UAT-10 | 公開 Pages | 開啟相同網址 | 顯示 `READ-ONLY`；所有 mutation 不可用，無 API／DB／Token |

## 出場準則

- `npm run check` 全部通過。
- UAT-01～10 無阻斷缺陷。
- 公開 Pages 與本機 Sandbox 的模式標示正確。
- 沒有正式 ERP write endpoint，且既有 `group-buying-operations` 無變更。

