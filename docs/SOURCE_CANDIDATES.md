# Milestone 2 首批公開來源候選

研究日期：2026-11-04  
狀態：`CANDIDATE_ONLY`，尚未加入 runtime allowlist、尚未執行自動採集

本清單只證明頁面在研究當下可由一般瀏覽器免登入查看，並具有 MVP 所需的公開市場訊號；不代表已完成網站條款、robots.txt、頻率或正式使用核准。每個網域仍須逐站完成 [SOURCE_ALLOWLIST.md](SOURCE_ALLOWLIST.md) 的審查，才可在本機或受控環境啟用。

| 優先 | 候選來源 | 可見訊號 | 適用 Adapter | 審查狀態 |
|---:|---|---|---|---|
| 1 | [育兒團購雷達－開團預告](https://babybuyradar.com/upcoming) | 商品、預計開團日、KOL 名稱／handle、原始來源連結 | Public Listing | Terms／robots Pending |
| 2 | [主夫尼克團購行事曆](https://nickjufu.tw/6358/) | 大量進行中商品、結團日、商品頁連結、單一團主 | Public Listing | Terms／robots Pending |
| 3 | [大象發福廚房團購時間表](https://egkitchen.tw/groupbuy/) | 商品、起訖日、開團狀態、團購連結、單一團主 | Public Listing | Terms／robots Pending |
| 4 | [LINKGOODS 公開團購頁](https://linkgoods.com/wnja148) | 團主、商品、起訖日、進行中／即將開團、下單連結 | Public Listing | Terms／robots Pending |
| 5 | [趣透親子飯店團購](https://thitto.com/) | 飯店商品、價格、截止日、同商品多 KOL、團購詳情 | Public Listing／Product Relation | Terms／robots Pending |

## 建議 UAT 順序

1. 先選擇一個「單一 KOL 行事曆」與一個「跨 KOL 聚合清單」，驗證兩種結構。
2. 以瀏覽器人工確認頁面不需登入、內容屬公開顯示，並記錄條款與 robots 結論。
3. 在本機 SYSTEM_ADMIN 新增 Source；初始保持 `scrape_allowed=false`。
4. 完成審查後改以 `APPROVED + REVIEWED_PUBLIC + PUBLIC_NO_LOGIN` 建立可採集來源。
5. 執行一次採集，抽樣核對商品、KOL、日期與來源連結；不合格即停用來源。
6. 兩站合計累積至少 30 筆真實事件後，計算 precision；需達 80% 才通過 Gate B。

## 明確排除

- 頁面中出現 LINE 社群連結不代表允許採集 LINE；Collector 只處理公開網頁本身。
- 不跟隨登入頁、私人社團、縮網址後的受限內容或會員限定頁。
- 不蒐集私人訊息、後台數據、GMV、轉換率或非公開聯絡資料。
