# Group Buying Market Radar

公開、唯讀的「團購市場情報與開發雷達」第一版。它用來整理市場上正在開團的商品、可能合作的廠商與 KOL，並在人工審核後產生 ERP 整合 dry-run。

> 這個 Repository 與 `ws19135/group-buying-operations` 分離，避免干擾現有 ERP。ERP 仍是 Vendor、Product、Host、Campaign 的唯一真實來源（SoT）。

## 資料流程

![團購市場雷達從公開開團來源、觀察、正規化去重、候選審核到既有 ERP 的流程](docs/assets/market-radar-flow.png)

系統先把公開訊號保存為市場觀察，經正規化與去重後分成「商品／廠商候選」及「KOL／團主候選」。只有人工審核與實體配對完成的資料，才會產生轉入既有團購 ERP 的草稿；公開展示站本身不會寫入 ERP。

## 已完成

- 免登入公開預覽入口
- 六種角色切換：SYSTEM_ADMIN、OPS_MANAGER、OPS_EDITOR、FINANCE、VENDOR、HOST
- 所有角色頁面皆可顯示；功能依角色標示
- 所有新增、核准、匯入、匯出與 ERP 整合按鈕皆為唯讀展示，不會寫入
- 市場觀察、廠商線索、KOL 線索、審核佇列、來源健康度與 ERP dry-run 畫面
- 合成示範資料，不含真實個資、聯絡資料或推估 GMV
- GitHub Pages 部署工作流程
- 權限邏輯自動測試

## 本機執行

```bash
npm test
npm start
```

開啟 <http://localhost:4173>。也可用 query string 直接指定角色，例如：

```text
http://localhost:4173/?role=OPS_EDITOR#observations
```

## 安全邊界

公開預覽站不包含登入、Cookie Session、ERP Token、資料庫連線或寫入 API。正式內部版仍須保留身份驗證、後端 RBAC、稽核紀錄與 Owner approval。

## 文件

- [SRS：需求規格](docs/SRS.md)
- [ERP 整合契約](docs/INTEGRATION_CONTRACT.md)

## 授權

MIT
