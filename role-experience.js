export const PAGE_CATALOG = {
  overview: { icon: "總", label: "角色首頁" },
  observations: { icon: "觀", label: "市場觀察" },
  products: { icon: "品", label: "商品中心" },
  vendor_candidates: { icon: "資", label: "廠商資料" },
  relations: { icon: "聯", label: "商品 × KOL" },
  prospects: { icon: "開", label: "預計開發" },
  vendors: { icon: "廠", label: "廠商線索" },
  kols: { icon: "K", label: "KOL 線索" },
  review: { icon: "審", label: "審核佇列" },
  sources: { icon: "源", label: "資料來源" },
  integration: { icon: "接", label: "ERP Dry-run" },
  permissions: { icon: "權", label: "權限說明" },
};

const sharedBoundary = [
  ["Production touched：NO", "Sandbox 與正式 ERP 完全分離"],
  ["ERP write：DISABLED", "MVP 僅允許 Promotion Dry-run"],
  ["公開資料原則", "不採集私人訊息、GMV 或非公開聯絡資料"],
];

export const ROLE_EXPERIENCES = {
  SYSTEM_ADMIN: {
    homeTitle: "系統治理中心",
    eyebrow: "SYSTEM GOVERNANCE",
    badge: "ADMIN CONTROL",
    accent: "violet",
    description: "管理資料來源、系統邊界與完整 Sandbox 流程。",
    nav: [
      { group: "治理總覽", pages: ["overview", "permissions"] },
      { group: "市場情報", pages: ["observations", "products", "vendor_candidates", "relations"] },
      { group: "作業與治理", pages: ["prospects", "vendors", "kols", "sources", "review", "integration"] },
    ],
    metrics: [
      ["商品中心", "product_candidates", "M3 聚合商品", "violet"],
      ["KOL 關聯", "kol_product_relations", "M5 可追溯關聯", "blue"],
      ["開發名單", "development_prospects", "M6 Pipeline", "green"],
      ["待確認合併", "product_matches_pending", "需人工決策", "amber"],
    ],
    focusTitle: "管理員檢查清單",
    focusItems: [
      ["來源政策", "確認公開來源政策狀態與健康度"],
      ["資料治理", "監看 Evidence、去重候選與版本"],
      ["權限稽核", "所有異動均保留 Actor 與 Before／After"],
    ],
    boundaryTitle: "不可跨越的系統邊界",
    boundaryItems: sharedBoundary,
    actions: [["open-source", "source_admin", "新增來源"], ["open-observation", "review", "建立觀察"]],
  },
  OPS_MANAGER: {
    homeTitle: "營運決策台",
    eyebrow: "OPERATIONS DECISION DESK",
    badge: "APPROVAL DESK",
    accent: "blue",
    description: "聚焦待審核線索、開發優先序與 Promotion 決策。",
    nav: [
      { group: "主管總覽", pages: ["overview", "review"] },
      { group: "候選情報", pages: ["products", "vendor_candidates", "relations", "observations"] },
      { group: "開發管理", pages: ["prospects", "vendors", "kols", "integration", "sources", "permissions"] },
    ],
    metrics: [
      ["開發名單", "development_prospects", "主管 Pipeline", "violet"],
      ["進行中", "active_prospects", "待推進項目", "blue"],
      ["已補充廠商", "enriched_vendors", "公開資料可開發", "green"],
      ["待確認商品", "product_matches_pending", "合併決策", "amber"],
    ],
    focusTitle: "主管今日焦點",
    focusItems: [
      ["先處理高分待審", "核准、退回補件或標示不處理"],
      ["檢查同名衝突", "名稱相同不代表同一實體"],
      ["確認 Promotion", "僅核准線索能建立 Dry-run 草稿"],
    ],
    boundaryTitle: "決策護欄",
    boundaryItems: sharedBoundary,
    actions: [["go-page", "view", "前往審核", "review"], ["go-page", "view", "查看 Dry-run", "integration"]],
  },
  OPS_EDITOR: {
    homeTitle: "情報採集工作台",
    eyebrow: "DISCOVERY WORKBENCH",
    badge: "EDITOR DESK",
    accent: "green",
    description: "建立市場觀察、補齊證據並將候選送交主管審核。",
    nav: [
      { group: "採集工作", pages: ["overview", "observations", "products", "sources"] },
      { group: "候選整理", pages: ["vendor_candidates", "relations", "prospects", "vendors", "kols", "review"] },
      { group: "我的權限", pages: ["permissions"] },
    ],
    metrics: [
      ["商品候選", "product_candidates", "已建立商品中心", "violet"],
      ["廠商候選", "vendor_candidates", "待補公開資料", "blue"],
      ["KOL 關聯", "kol_product_relations", "商品開團關聯", "green"],
      ["開發名單", "development_prospects", "可新增活動紀錄", "amber"],
    ],
    focusTitle: "編輯下一步",
    focusItems: [
      ["建立 Observation", "先保存公開 URL 與可追溯證據"],
      ["補齊公開欄位", "未知值保持 UNKNOWN，不填入假 0"],
      ["送交主管", "編輯可 SUBMIT，但不可自行 APPROVE"],
    ],
    boundaryTitle: "採集規範",
    boundaryItems: [
      ["只用公開來源", "不登入、不繞過限制、不擷取私人內容"],
      ["不自動合併", "同名只建立 Match Candidate"],
      ["不推估營收", "不推算銷售量、GMV 或私人互動"],
    ],
    actions: [["open-observation", "review", "建立觀察"], ["open-import", "review", "匯入 CSV／JSON"]],
  },
  FINANCE: {
    homeTitle: "財務觀測台",
    eyebrow: "FINANCE READ-ONLY VIEW",
    badge: "READ ONLY",
    accent: "amber",
    description: "查看候選規模與 Promotion 狀態；不包含推估 GMV 或寫入權限。",
    nav: [
      { group: "財務觀測", pages: ["overview", "vendors", "kols", "integration"] },
      { group: "權限邊界", pages: ["permissions"] },
    ],
    metrics: [
      ["廠商候選", "vendor_leads", "僅供規模觀測", "blue"],
      ["KOL 候選", "kol_leads", "僅供規模觀測", "green"],
      ["Promotion", "promotion_drafts", "Dry-run 數量", "violet"],
      ["待審核", "pending_review", "尚未成為正式主檔", "amber"],
    ],
    focusTitle: "財務可見資訊",
    focusItems: [
      ["候選規模", "查看線索數量、分數與資料充分度"],
      ["整合狀態", "查看 Promotion 是否完成 Dry-run"],
      ["資料品質", "UNKNOWN 不會被誤認為數字 0"],
    ],
    boundaryTitle: "財務限制",
    boundaryItems: [
      ["沒有 GMV 推估", "市場訊號不等於可認列營收"],
      ["沒有審核權", "不可提交、核准或建立 Promotion"],
      ["沒有 ERP 寫入", "只顯示合成快照的 Dry-run 結果"],
    ],
    actions: [["export", "view", "匯出目前摘要"]],
  },
  VENDOR: {
    homeTitle: "品牌合作視角",
    eyebrow: "VENDOR PARTNER PREVIEW",
    badge: "PARTNER VIEW",
    accent: "rose",
    description: "展示品牌合作機會與公開資訊邊界；本角色沒有內部作業權。",
    nav: [
      { group: "品牌合作", pages: ["overview", "vendors"] },
      { group: "資料與權限", pages: ["permissions"] },
    ],
    metrics: [
      ["市場觀察", "observations", "公開訊號樣本", "violet"],
      ["廠商候選", "vendor_leads", "合成展示資料", "blue"],
      ["來源健康度", "source_health_percent", "公開來源品質", "green", "%"],
      ["Promotion", "promotion_drafts", "僅顯示狀態", "amber"],
    ],
    focusTitle: "品牌端會看到什麼",
    focusItems: [
      ["公開合作輪廓", "品類、公開網站與資料充分度"],
      ["候選狀態", "了解資料仍在觀察或審核階段"],
      ["透明邊界", "不顯示其他品牌的私人或內部資料"],
    ],
    boundaryTitle: "品牌端限制",
    boundaryItems: [
      ["唯讀角色", "不可建立、修改、審核或匯入資料"],
      ["非正式主檔", "候選資料不代表 ERP 已建檔"],
      ["MVP 合成展示", "正式 Partner Portal 需身份與租戶隔離"],
    ],
    actions: [["go-page", "view", "查看品牌候選", "vendors"]],
  },
  HOST: {
    homeTitle: "團主合作視角",
    eyebrow: "HOST & CREATOR PREVIEW",
    badge: "CREATOR VIEW",
    accent: "cyan",
    description: "展示團主／KOL 合作輪廓與公開資料狀態；不開放內部作業。",
    nav: [
      { group: "團主合作", pages: ["overview", "kols"] },
      { group: "資料與權限", pages: ["permissions"] },
    ],
    metrics: [
      ["市場觀察", "observations", "公開開團訊號", "violet"],
      ["KOL 候選", "kol_leads", "合成展示資料", "green"],
      ["來源健康度", "source_health_percent", "公開來源品質", "blue", "%"],
      ["Promotion", "promotion_drafts", "僅顯示狀態", "amber"],
    ],
    focusTitle: "團主端會看到什麼",
    focusItems: [
      ["公開合作輪廓", "平台、領域與公開合作方式"],
      ["資料充分度", "清楚區分已知資訊與 UNKNOWN"],
      ["合作狀態", "候選不代表已簽約或已進入 ERP"],
    ],
    boundaryTitle: "團主端限制",
    boundaryItems: [
      ["唯讀角色", "不可建立、修改、審核或匯入資料"],
      ["不比較私人績效", "不取得私訊、後台或非公開轉換資料"],
      ["MVP 合成展示", "正式 Creator Portal 需身份與本人資料隔離"],
    ],
    actions: [["go-page", "view", "查看 KOL 候選", "kols"]],
  },
};

export function getRoleExperience(role) {
  return ROLE_EXPERIENCES[role] || ROLE_EXPERIENCES.OPS_MANAGER;
}

export function pagesForRole(role) {
  return getRoleExperience(role).nav.flatMap(group => group.pages);
}

export function canAccessRolePage(role, page) {
  return pagesForRole(role).includes(page);
}

