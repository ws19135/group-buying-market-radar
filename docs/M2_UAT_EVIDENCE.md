# Milestone 2 真實市場發現 UAT 證據

執行日期：2026-11-05 09:23（Asia/Taipei）
執行指令：`npm run m2:collect -- --database=/tmp/group-buying-market-radar-m2-uat-v2.sqlite`

## 結果摘要

| 指標 | 結果 | Gate |
|---|---:|---|
| 核准且成功來源 | 2 | ≥ 2，Pass |
| 真實公開開團事件 | 151 | ≥ 30，Pass |
| Row errors | 0 | Pass |
| 自動結構完整率 | 94.7% | ≥ 80%，Pass |
| 人工抽樣 precision | 30／30（100%） | ≥ 80%，Pass |
| 公開證據回鏈 | 151／151 | Pass |

Gate B：**PASS**。

## 來源執行結果

| 來源 | Adapter | Emitted | Created | Errors | Robots |
|---|---|---:|---:|---:|---|
| [育兒團購雷達－開團預告](https://babybuyradar.com/upcoming) | `babybuyradar-upcoming-1.0.0` | 36 | 36 | 0 | ALLOWED |
| [主夫尼克公開團購行事曆](https://nickjufu.tw/6358/) | `nickjufu-calendar-1.0.0` | 115 | 115 | 0 | ALLOWED |

## Feed 統計

| 分類 | 數量 |
|---|---:|
| 進行中／近期 | 70 |
| 即將開團 | 73 |
| 7 日內結束 | 21 |
| 日期不足、需人工確認 | 8 |
| 來源異常 | 0 |

## Precision 核對方法

人工從兩站各抽 15 筆，逐筆比對商品名稱、KOL／團主、開團或結團日期及原始回鏈；30 筆全部相符。自動結構完整率則檢查每筆是否同時具備高信心、商品、團主、公開 URL，以及開始或結束日期。日期僅寫「11 月」「敬請期待」等 8 筆不猜測日期，固定標成 `REVIEW_REQUIRED`。

## 安全與資料邊界

- 只讀免登入公開頁；不進入頁面中的 LINE 群、私人社團、會員頁或登入後內容。
- 每次採集重新檢查 robots.txt、DNS 公網位址、同網域 redirect、timeout、回應大小與來源頻率。
- 只保存市場發現所需的事實欄位與回鏈，不複製文章全文。
- 真實資料只進本機 SQLite；GitHub Pages 仍為合成、唯讀展示。
- Production ERP untouched；ERP write disabled。
