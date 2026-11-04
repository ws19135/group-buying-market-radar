# 公開來源 Allowlist 與治理規則

版本：v1.0  
日期：2026-11-04

## Owner 已核准的來源範圍

| 來源類型 | 範圍 | 自動採集 | 狀態 |
|---|---|---:|---|
| `PUBLIC_GROUP_BUY_PAGE` | 不需登入即可查看的單一公開開團頁 | 可，經逐站審查後啟用 | Approved scope |
| `PUBLIC_BRAND_CAMPAIGN` | 品牌官網或公開活動頁 | 可，經逐站審查後啟用 | Approved scope |
| `PUBLIC_LISTING` | 公開團購清單、日曆或索引頁 | 可，經逐站審查後啟用 | Approved scope |
| `WEB_SEARCH_RESULT` | 開放网頁搜尋結果或合法資料 API 的結果 | 只允許匯入；API Adapter 尚未建置 | Approved scope |
| LINE 群、私人社團、登入後頁面 | 任何需要帳號、邀請、會員或繞過存取限制的內容 | 不可 | Blocked |

核准的是「來源類型」，不是任意網域。每一個實際 URL 仍須分別登記並完成政策審查，系統才會執行採集。

## 啟用條件

實際來源必須同時满足：

1. `policy_status=APPROVED`
2. `terms_status=REVIEWED_PUBLIC`
3. `access_mode=PUBLIC_NO_LOGIN`
4. `login_required=false`
5. `scrape_allowed=true`
6. 來源類型屬於可執行 Collector 的三種公開頁面類型
7. robots.txt 在執行當下允許目標路徑，或目標站未提供 robots.txt

任一條件不成立，系統都會停止採集並寫入失敗 Run 與 Audit Log。

## 每站審查紀錄

| 欄位 | 必填內容 |
|---|---|
| URL／網域 | 最終公開 URL，不可依賴跨網域跳轉 |
| 來源負責人 | 內部 Owner |
| 公開性 | 確認無帳號、邀請或會員條件 |
| 條款結論 | `REVIEWED_PUBLIC` 或 `BLOCKED` |
| 審查說明 | 審查日期、頁面位置與限制摘要 |
| 頻率 | 最短 15 分鐘；預設 1,440 分鐘 |
| robots | 每次執行重新檢查，保存狀態與時間 |

## 固定安全護欄

- 只允許 HTTP／HTTPS，阻擋 localhost、私有／保留 IP 與 cloud metadata。
- DNS 解析後再次檢查位址，降低 DNS rebinding／SSRF 風險。
- 重新導向不得離開已核准 hostname。
- timeout 10 秒、最多一次重試、最多三次同網域重新導向。
- 單次回應上限 1 MB；僅解析公開 HTML。
- 使用可識別 User-Agent：`SDHMarketRadar/0.5 (+public-evidence-only)`。
- 不嘗試登入、解驗證碼、繞過 paywall、讀取 Cookie 或模擬私人帳號。

## 目前實際網域

目前 Repository 不預載任何真實網域，也不把測試 fixture 當成真實市場資料。首批真實 URL 將在 Milestone 2 逐站審查後加入受控環境；GitHub Pages 繼續只顯示合成資料。
