export const stats = [
  { label: "本週新觀察", value: "128", delta: "+18%", tone: "violet" },
  { label: "廠商開發線索", value: "42", delta: "11 高優先", tone: "blue" },
  { label: "KOL 合作線索", value: "67", delta: "19 待審", tone: "green" },
  { label: "資料來源健康度", value: "96%", delta: "8/8 正常", tone: "amber" }
];

export const observations = [
  { id: "OBS-20261103-128", type: "商品", title: "輕量氣炸鍋 4.5L", source: "公開團購頁", owner: "尚未配對", score: 91, status: "待審核", seen: "12 分鐘前" },
  { id: "OBS-20261103-127", type: "KOL", title: "好物研究室", source: "公開社群頁", owner: "生活家電", score: 88, status: "可開發", seen: "28 分鐘前" },
  { id: "OBS-20261103-126", type: "廠商", title: "晨光食品（示範）", source: "品牌官網", owner: "食品飲料", score: 84, status: "待審核", seen: "41 分鐘前" },
  { id: "OBS-20261103-125", type: "商品", title: "機能益生菌 30 包", source: "公開開團日曆", owner: "晨光食品（示範）", score: 78, status: "觀察中", seen: "1 小時前" },
  { id: "OBS-20261103-124", type: "KOL", title: "日常選物誌", source: "公開合作表單", owner: "居家生活", score: 73, status: "觀察中", seen: "2 小時前" }
];

export const vendorLeads = [
  { name: "晨光食品（示範）", category: "食品飲料", activeGroups: 8, freshness: "今日", evidence: 6, score: 84, stage: "待審核" },
  { name: "森活家電（示範）", category: "生活家電", activeGroups: 5, freshness: "今日", evidence: 4, score: 82, stage: "可開發" },
  { name: "沐光日用（示範）", category: "居家生活", activeGroups: 3, freshness: "昨日", evidence: 5, score: 76, stage: "觀察中" },
  { name: "慢慢保養（示範）", category: "美妝保養", activeGroups: 2, freshness: "2 天前", evidence: 3, score: 68, stage: "觀察中" }
];

export const kolLeads = [
  { name: "好物研究室", platform: "公開社群頁", niche: "生活家電", cadence: "近 30 日 6 團", contact: "公開合作表單", score: 88, stage: "可開發" },
  { name: "日常選物誌", platform: "公開社群頁", niche: "居家生活", cadence: "近 30 日 4 團", contact: "公開 Email", score: 73, stage: "觀察中" },
  { name: "吃貨小週末", platform: "公開內容頁", niche: "食品飲料", cadence: "近 30 日 3 團", contact: "尚未發現", score: 69, stage: "待補資料" },
  { name: "親子慢生活", platform: "公開社群頁", niche: "親子用品", cadence: "近 30 日 5 團", contact: "公開合作表單", score: 81, stage: "待審核" }
];

export const sources = [
  { name: "人工提交公開 URL", kind: "Manual", last: "3 分鐘前", success: "100%", status: "正常" },
  { name: "CSV / JSON 匯入", kind: "Import", last: "18 分鐘前", success: "99.2%", status: "正常" },
  { name: "公開團購日曆", kind: "Collector", last: "31 分鐘前", success: "97.8%", status: "正常" },
  { name: "品牌官網", kind: "Collector", last: "46 分鐘前", success: "96.1%", status: "正常" },
  { name: "公開合作表單", kind: "Collector", last: "1 小時前", success: "94.5%", status: "注意" }
];
