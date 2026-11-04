# Group Buying Market Radar — MVP

SDH 團購 ERP 的「團購市場情報與開發雷達」。MVP 將公開市場訊號保存為可追溯的 Observation，經過正規化、去重候選、評分與人工審核後，產生 ERP Promotion Dry-run；它不會直接寫入正式 ERP。

> 本 Repository 與 `ws19135/group-buying-operations` 分離。ERP 仍是 Vendor、Product、Host、Campaign 的唯一真實來源（SoT）。

## 兩種執行模式

| 模式 | 用途 | 寫入範圍 |
|---|---|---|
| GitHub Pages 公開預覽 | 免登入展示六套角色工作台與合成資料 | 完全唯讀，沒有 API、資料庫或秘密 |
| 本機 MVP Sandbox | 完整操作流程與 UAT | 只寫入本機 SQLite；ERP 僅讀取 fixture 並執行 Dry-run |

公開預覽：<https://ws19135.github.io/group-buying-market-radar/>

## MVP 功能

- 人工公開 URL 建立 Observation，以及 CSV／JSON 批次匯入
- URL、handle、Email、日期與金額正規化；匯入與 Observation 冪等控制
- Evidence 證據鏈與 Match Candidate；只靠同名永遠不會自動合併
- Vendor／KOL 版本化評分；缺值標示 `UNKNOWN`，不偽造為 0
- OPS_EDITOR 提交；OPS_MANAGER／SYSTEM_ADMIN 核准、退回或忽略
- 核准後建立 Promotion Draft，並對 ERP 合成快照執行 Dry-run
- Request ID、前後狀態與 actor role 稽核紀錄；沒有 hard delete API
- 同一前端自動辨識「公開唯讀」或「本機 Sandbox」模式
- 六種角色各有專屬首頁、側邊選單、工作焦點、指標與色彩識別
- SYSTEM_ADMIN／OPS_MANAGER／OPS_EDITOR 呈現不同內部作業流程；FINANCE／VENDOR／HOST 為專屬唯讀視角

## 資料流程

![團購市場雷達從公開開團來源、觀察、正規化去重、候選審核到既有 ERP 的流程](docs/assets/market-radar-flow.png)

## 本機啟動

需求：Node.js 22 以上（使用內建 `node:sqlite`，不需安裝第三方套件）。

```bash
npm run check
npm start
```

開啟 <http://localhost:4173>。首次啟動會建立 `.data/market-radar.sqlite` 並載入合成示範資料。可用 query string 指定角色：

```text
http://localhost:4173/?role=OPS_EDITOR#observations
```

可用環境變數：

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | `4173` | HTTP port |
| `HOST` | `127.0.0.1` | bind host |
| `MR_DATABASE_FILE` | `.data/market-radar.sqlite` | SQLite 路徑；測試可用 `:memory:` |
| `MR_SEED_DEMO` | `true` | 是否載入合成資料 |
| `MR_SANDBOX_WRITE_ENABLED` | `true` | 設為 `false` 可停用所有 API mutation |

## 安全邊界

- 公開 Pages 不包含登入、Cookie Session、ERP Token、SQLite 或寫入 API。
- Sandbox 的 `x-role` 僅供本機 UAT 模擬，不是正式身份驗證。
- URL 僅保存證據，不由伺服器擷取；本機、私有網段與 metadata URL 會被拒絕。
- ERP 整合固定為 `DRY_RUN`，回傳 `production_touched: false` 與 `erp_write_enabled: false`。
- 正式上線前仍需 SSO／Session、後端身份映射、秘密管理、正式 ERP 唯讀 adapter、備份與監控。

## 文件

- [SRS 與驗收狀態](docs/SRS.md)
- [系統架構](docs/SAD.md)
- [詳細設計](docs/SDD.md)
- [API 契約](docs/API.md)
- [資料字典](docs/DATA_DICTIONARY.md)
- [需求追溯矩陣](docs/RTM.md)
- [UAT 計畫](docs/UAT_PLAN.md)
- [同事展示指南](docs/COLLEAGUE_DEMO_GUIDE.md)
- [ERP 整合契約](docs/INTEGRATION_CONTRACT.md)

## 測試

```bash
npm test
```

測試涵蓋六套角色體驗與導覽隔離、權限矩陣、正規化／SSRF 邊界、CSV、去重、UNKNOWN 評分、API 全流程、冪等、稽核、Promotion Dry-run 與禁止 hard delete。

## 授權

MIT
