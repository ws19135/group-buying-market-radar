import { ROLES, can, getRole, actionState as publicActionState } from "./permissions.js";
import { stats as demoStats, observations as demoObservations, vendorLeads as demoVendorLeads, kolLeads as demoKolLeads, sources as demoSources } from "./data.js";
import { RadarApi, newClientRequestId } from "./api-client.js";
import { PAGE_CATALOG, canAccessRolePage, getRoleExperience } from "./role-experience.js";

const titles = Object.fromEntries(Object.entries(PAGE_CATALOG).map(([id, item]) => [id, item.label]));
const labels = { OBSERVED: "已觀察", ACTIVE_OR_RECENT: "進行中／近期", UPCOMING: "即將開始", ENDED: "已結束", REVIEW_REQUIRED: "需人工確認", DISCOVERED: "待審核", SUBMITTED: "已送審", APPROVED: "已核准", REJECTED: "已拒絕", NEEDS_MORE_DATA: "待補資料", NEEDS_ENRICHMENT: "待補廠商資料", ENRICHED: "公開資料已補充", IGNORED: "不處理", DRY_RUN_READY: "待 Dry-run", DRY_RUN_COMPLETED: "Dry-run 完成", HEALTHY: "正常", ERROR: "異常", UNKNOWN: "未知", PENDING: "待確認", REVIEWED_PUBLIC: "公開來源已審查", ALLOWED: "允許", NOT_PRESENT: "未提供", BLOCKED: "禁止", COMPLETED: "完成", PARTIAL: "部分完成", FAILED: "失敗", ACTIVE: "使用中", MERGED: "已合併", PLANNED: "待規劃", ASSIGNED: "已指派", CONTACTED: "已聯絡", RESPONDED: "已回覆", NEGOTIATING: "洽談中", WON: "開發成功", LOST: "未成交", DO_NOT_CONTACT: "不聯絡", LOW: "低", MEDIUM: "中", HIGH: "高", URGENT: "急" };

let role = getRole(location.search);
let page = location.hash.slice(1) || "overview";
const api = new RadarApi({ role });
const state = { dashboard: null, observations: [], discoveryFeed: { summary: {}, items: [] }, products: [], productDetail: null, vendorCandidates: [], kolCandidates: [], prospects: { summary: { stages: {} }, items: [] }, vendorLeads: [], kolLeads: [], sources: [], promotions: [], runs: [], loading: true };

const app = document.querySelector("#app");
const roleSelect = document.querySelector("#role-select");
const pageTitle = document.querySelector("#page-title");
const roleSummary = document.querySelector("#role-summary");
const toast = document.querySelector("#toast");
const modal = document.querySelector("#modal");
const modalForm = document.querySelector("#modal-form");
const modalFields = document.querySelector("#modal-fields");
const modalSubmit = document.querySelector("#modal-submit");

function esc(value) { return String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function textLabel(value) { return labels[value] || value || "資料不足"; }
function date(value) { if (!value) return "資料不足"; const d = new Date(value); return Number.isNaN(d.getTime()) ? esc(value) : new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(d); }
function badge(value) { const text = textLabel(value); const tone = /正常|核准|完成|HEALTHY/.test(text) ? "green" : /待|注意|部分|資料不足|未知/.test(text) ? "amber" : /拒絕|失敗/.test(text) ? "red" : "violet"; return `<span class="badge ${tone}">${esc(text)}</span>`; }
function score(value, sufficiency) { return value === null || value === undefined ? badge("資料不足") : `<span class="score"><i style="--score:${Number(value)}%"></i>${Number(value)}${sufficiency === null || sufficiency === undefined ? "" : `<small>${esc(sufficiency)}% 資料</small>`}</span>`; }
function table(headers, rows, empty = "目前沒有資料") { return `<div class="panel table-wrap"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="empty-state">${esc(empty)}</td></tr>`}</tbody></table></div>`; }
function heading(title, description, actions = "") { return `<div class="section-heading"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${actions}</div>`; }
function capabilityState(capability) { if (!api.connected) return publicActionState(role, capability); if (!can(role, capability)) return { enabled: false, reason: "此角色沒有這項權限" }; if (!api.health?.write_enabled) return { enabled: false, reason: "Sandbox 寫入已停用" }; return { enabled: true, reason: "只寫入本機 SQLite；不觸碰 Production" }; }
function button(command, capability, text, { primary = true, id = "" } = {}) { const permission = capabilityState(capability); return `<button class="btn ${primary ? "btn-primary" : "btn-secondary"}" data-command="${command}" ${id ? `data-id="${esc(id)}"` : ""} ${permission.enabled ? "" : "disabled"} title="${esc(permission.reason)}">${esc(text)}</button>`; }
function actions(capability, text, command) { return `<div class="button-row"><button class="btn btn-secondary" data-command="export">匯出 JSON</button>${button(command, capability, text)}</div>`; }
function toolbar(placeholder) { return `<div class="toolbar"><input class="search" data-search placeholder="${esc(placeholder)}"></div>`; }

async function init() {
  renderNavigation();
  roleSelect.innerHTML = Object.entries(ROLES).map(([key, value]) => `<option value="${key}">${value.label} · ${key}</option>`).join("");
  roleSelect.value = role;
  bindEvents();
  await api.probe();
  updateMode();
  await refresh();
  render();
}

function bindEvents() {
  roleSelect.addEventListener("change", async () => { role = roleSelect.value; api.setRole(role); const url = new URL(location.href); url.searchParams.set("role", role); url.hash = "overview"; history.replaceState({}, "", url); page = "overview"; if (api.connected) await refresh(); render(); });
  document.querySelector("#navigation").addEventListener("click", event => { const target = event.target.closest("[data-page]"); if (target) location.hash = target.dataset.page; });
  addEventListener("hashchange", () => { page = location.hash.slice(1) || "overview"; render(); });
  app.addEventListener("click", handleCommand);
  app.addEventListener("input", event => { if (event.target.matches("[data-search]")) filterTable(event.target.value); });
  modalForm.addEventListener("submit", submitModal);
  document.querySelector("#modal-cancel").addEventListener("click", () => modal.close());
  document.querySelector("#modal-close").addEventListener("click", () => modal.close());
}

function updateMode() {
  const mode = document.querySelector("#sidebar-mode");
  const detail = document.querySelector("#sidebar-mode-detail");
  if (api.connected) {
    mode.textContent = "M6 開發雷達版";
    detail.textContent = `${api.health?.market_graph?.products ?? 0} 商品 · ${api.health?.market_graph?.active_prospects ?? 0} 開發中`;
    document.querySelector(".preview-banner").classList.add("sandbox");
    document.querySelector(".preview-banner strong").textContent = "公開採集 Sandbox";
    document.querySelector(".preview-badge").textContent = "LOCAL WRITE";
  } else {
    mode.textContent = "MVP 規格展示";
    detail.textContent = "合成資料 · 公開採集器需在本機執行";
  }
}

function renderNavigation() {
  const experience = getRoleExperience(role);
  document.querySelector("#navigation").innerHTML = experience.nav.map(group => `<div class="nav-label">${esc(group.group)}</div>${group.pages.map(id => { const item = PAGE_CATALOG[id]; return `<button class="nav-item" data-page="${id}"><span class="nav-icon">${esc(item.icon)}</span><span>${esc(id === "overview" ? experience.homeTitle : item.label)}</span></button>`; }).join("")}`).join("");
}

function updateRolePresentation(experience) {
  document.body.dataset.role = role;
  document.body.dataset.accent = experience.accent;
  document.querySelector(".topbar .eyebrow").textContent = experience.eyebrow;
  const banner = document.querySelector(".preview-banner");
  banner.querySelector("strong").textContent = api.connected ? `${experience.homeTitle} · M6 開發雷達版` : `${experience.homeTitle} · M6 規格預覽`;
  banner.querySelector(".preview-badge").textContent = api.connected ? experience.badge : "NO WRITE";
  roleSummary.textContent = api.connected && can(role, "review")
    ? `以「${ROLES[role].label}」操作 M6 Sandbox；可由商品追到 KOL、廠商公開資料與預計開發名單。`
    : `以「${ROLES[role].label}」檢視角色規格；Pages 僅顯示合成資料，不執行網路採集。`;
}

async function refresh() {
  state.loading = true;
  if (!api.connected) {
    state.observations = demoObservations.map(item => ({ observation_id: item.id, entity_type: item.type, title: item.title, source_url: "https://example.com/public-demo", vendor_name: item.owner, score: item.score, status: item.status, observed_at: item.seen }));
    state.vendorLeads = demoVendorLeads.map((item, i) => ({ lead_id: `demo-v-${i}`, lead_type: "VENDOR", canonical_name: item.name, score: item.score, stage: item.stage, metadata: { category: item.category, observation_count: item.activeGroups, evidence_count: item.evidence, last_observed_at: item.freshness } }));
    state.kolLeads = demoKolLeads.map((item, i) => ({ lead_id: `demo-k-${i}`, lead_type: "KOL", canonical_name: item.name, score: item.score, stage: item.stage, metadata: { platform: item.platform, category: item.niche, observation_count: item.cadence, public_email: item.contact } }));
    state.sources = demoSources.map((item, i) => ({ source_id: `demo-s-${i}`, name: item.name, type: item.kind, last_success_at: item.last, health_status: item.status, policy_status: "DEMO", success: item.success }));
    state.discoveryFeed = { summary: { total: state.observations.length, active: 1, upcoming: 2, ending_soon: 1, needs_review: 0, source_errors: 0 }, items: state.observations };
    state.products = demoObservations.map((item, i) => ({ product_id: `demo-product-${i}`, canonical_name: item.title, category: item.type, vendor_names: item.owner, event_count: i + 2, kol_count: i + 1, pending_match_count: i === 0 ? 1 : 0, status: "ACTIVE" }));
    state.vendorCandidates = demoVendorLeads.map((item, i) => ({ vendor_id: `demo-vendor-${i}`, display_name: item.name, category: item.category, product_count: item.activeGroups, evidence_count: item.evidence, status: i === 0 ? "ENRICHED" : "PARTIAL", website_url: "https://example.com/public-demo", prospect_id: i === 0 ? "demo-prospect-0" : null }));
    state.kolCandidates = demoKolLeads.map((item, i) => ({ kol_id: `demo-kol-${i}`, display_name: item.name, platform: item.platform, handle: `demo_${i + 1}`, product_count: item.cadence, event_count: item.cadence + 1, last_seen_at: new Date().toISOString(), match_status: "STABLE" }));
    state.prospects = { summary: { total: 2, stages: { ASSIGNED: 1, CONTACTED: 1 }, owners: [{ owner_id: "開團人員 A", count: 1 }, { owner_id: "開團人員 B", count: 1 }] }, items: [{ prospect_id: "demo-prospect-0", vendor_id: "demo-vendor-0", vendor_name: demoVendorLeads[0]?.name || "示範廠商", owner_id: "開團人員 A", priority: "HIGH", stage: "ASSIGNED", next_action_at: new Date(Date.now() + 86400000).toISOString(), activity_count: 2 }, { prospect_id: "demo-prospect-1", vendor_id: "demo-vendor-1", vendor_name: demoVendorLeads[1]?.name || "示範廠商 B", owner_id: "開團人員 B", priority: "MEDIUM", stage: "CONTACTED", next_action_at: new Date(Date.now() + 172800000).toISOString(), activity_count: 3 }] };
    state.promotions = []; state.runs = [];
    state.dashboard = { observations: demoStats[0].value, vendor_leads: demoStats[1].value, kol_leads: demoStats[2].value, pending_review: 19, promotion_drafts: 12, sources: 8, source_health_percent: 96, product_candidates: state.products.length, vendor_candidates: state.vendorCandidates.length, enriched_vendors: 1, kol_candidates: state.kolCandidates.length, kol_product_relations: state.kolCandidates.reduce((sum, item) => sum + item.event_count, 0), development_prospects: 2, active_prospects: 2, product_matches_pending: 1 };
    state.loading = false; return;
  }
  try {
    const [dashboard, observations, discoveryFeed, products, vendorCandidates, kolCandidates, prospects, vendors, kols, sources, promotions, runs] = await Promise.all([api.dashboard(), api.observations(), api.discoveryFeed(), api.products(), api.vendorCandidates(), api.kolCandidates(), can(role, "pipeline_view") ? api.prospects() : Promise.resolve({ summary: { stages: {} }, items: [] }), api.leads("VENDOR"), api.leads("KOL"), api.sources(), api.promotions(), api.runs()]);
    Object.assign(state, { dashboard, observations: observations.items, discoveryFeed, products: products.items, vendorCandidates: vendorCandidates.items, kolCandidates: kolCandidates.items, prospects, vendorLeads: vendors.items, kolLeads: kols.items, sources: sources.items, promotions: promotions.items, runs: runs.items });
  } catch (error) { showToast(error.message, "error"); }
  finally { state.loading = false; }
}

function render() {
  const experience = getRoleExperience(role);
  if (!titles[page] || !canAccessRolePage(role, page)) {
    page = "overview";
    const url = new URL(location.href);
    url.hash = "overview";
    history.replaceState({}, "", url);
  }
  renderNavigation();
  updateRolePresentation(experience);
  pageTitle.textContent = page === "overview" ? experience.homeTitle : titles[page];
  document.querySelectorAll("[data-page]").forEach(item => item.classList.toggle("active", item.dataset.page === page));
  app.innerHTML = state.loading ? '<div class="panel loading-state">正在載入資料…</div>' : (views[page] || views.overview)();
}

const views = {
  overview: () => { const d = state.dashboard || {}; const cards = [["市場觀察", d.observations ?? "—", "可追溯證據", "violet"], ["廠商線索", d.vendor_leads ?? "—", `${d.pending_review ?? "—"} 待處理`, "blue"], ["KOL 線索", d.kol_leads ?? "—", `${d.promotion_drafts ?? "—"} Promotion`, "green"], ["來源健康度", d.source_health_percent === null ? "資料不足" : `${d.source_health_percent ?? "—"}%`, `${d.sources ?? "—"} 個來源`, "amber"]]; return `${heading("今日市場脈動", api.connected ? "資料來自本機 SQLite MVP Sandbox。" : "公開頁使用合成資料；執行 npm start 後可操作。", actions("review", "建立公開 URL 觀察", "open-observation"))}<div class="grid stats">${cards.map(([name, value, delta, tone]) => `<article class="stat" style="--accent:var(--${tone});--accent-soft:var(--${tone}-soft,#f1efff)"><span class="stat-label">${name}</span><div class="stat-value">${value}</div><span class="stat-delta">${delta}</span></article>`).join("")}</div><div class="grid two-col"><article class="panel"><div class="panel-head"><h3>MVP 流程</h3><span>${api.connected ? "可操作" : "唯讀"}</span></div><div class="panel-body pipeline">${[["Observation", d.observations], ["Vendor Lead", d.vendor_leads], ["KOL Lead", d.kol_leads], ["待審核", d.pending_review], ["Promotion", d.promotion_drafts]].map(([name, value], i) => `<div class="pipeline-row"><span>${name}</span><div class="bar"><i style="width:${Math.max(value ? 8 : 0, 100 - i * 18)}%"></i></div><strong>${value ?? 0}</strong></div>`).join("")}</div></article><article class="panel"><div class="panel-head"><h3>安全邊界</h3><span>固定</span></div><div class="panel-body activity">${[["Production touched：NO", "本機資料與正式 ERP 完全分離"], ["ERP write：DISABLED", "只允許 Promotion Dry-run"], ["公開 URL：安全驗證", "阻擋 localhost、內網與 metadata IP"]].map(([a, b]) => `<div class="activity-item"><i></i><div><strong>${a}</strong><span>${b}</span></div></div>`).join("")}</div></article></div>`; },
  observations: () => { const feed = state.discoveryFeed || { summary: {}, items: [] }; const s = feed.summary || {}; const cards = [["真實事件", s.total ?? 0, "兩個公開來源", "violet"], ["進行中", s.active ?? 0, "可優先開發", "green"], ["即將開團", s.upcoming ?? 0, "近期市場訊號", "blue"], ["7 日內結束", s.ending_soon ?? 0, `${s.needs_review ?? 0} 筆待確認`, "amber"]]; return `${heading("市場發現 Feed", "實際公開商品、KOL／團主、團期與來源回鏈；不含 LINE 群、私人社團或登入後資料。", `<div class="button-row">${button("open-import", "review", "匯入 CSV／JSON", { primary: false })}${button("open-observation", "review", "建立觀察")}</div>`)}<div class="grid stats compact-stats">${cards.map(([name, value, detail, tone]) => `<article class="stat" style="--accent:var(--${tone});--accent-soft:var(--${tone}-soft,#f1efff)"><span class="stat-label">${name}</span><div class="stat-value">${value}</div><span class="stat-delta">${detail}</span></article>`).join("")}</div>${toolbar("搜尋商品、廠商或 KOL…")}${table(["商品／活動", "KOL／團主", "團期", "來源", "狀態", "觀察時間"], feed.items.map(item => `<tr><td><span class="strong">${esc(item.product_name || item.title)}</span><span class="subtle">${esc(item.category || item.parser_version || item.entity_type)}</span></td><td>${esc(item.host_name || "資料不足")}</td><td><span class="subtle">${item.starts_at ? `開團 ${date(item.starts_at)}` : ""}${item.starts_at && item.ends_at ? "<br>" : ""}${item.ends_at ? `結團 ${date(item.ends_at)}` : ""}</span></td><td><a href="${esc(item.source_url)}" target="_blank" rel="noreferrer">公開證據 ↗</a></td><td>${badge(item.status)}</td><td>${date(item.observed_at)}</td></tr>`), "尚未執行真實來源採集")}`; },
  products: () => {
    const detail = state.productDetail;
    const detailHtml = !detail ? "" : `<section class="detail-panel panel"><div class="panel-head"><h3>${esc(detail.canonical_name)}</h3><button class="table-action" data-command="close-product">關閉詳情</button></div><div class="panel-body"><div class="detail-meta"><span>${badge(detail.status)}</span><span>${esc(detail.brand || "品牌 UNKNOWN")}</span><span>${esc(detail.category || "品類 UNKNOWN")}</span><span>${detail.events?.length || 0} 筆開團事件</span></div><h3 class="subsection-title">正在／曾經開團的 KOL</h3>${table(["KOL／團主", "平台", "Handle", "事件", "最後觀察"], (detail.kols || []).map(item => `<tr><td>${esc(item.display_name)}</td><td>${esc(item.platform || "UNKNOWN")}</td><td>${esc(item.handle || "UNKNOWN")}</td><td>${item.event_count}</td><td>${date(item.last_seen_at)}</td></tr>`), "尚未辨識 KOL")}<h3 class="subsection-title">商品別名與拆分</h3>${table(["商品別名", "比對依據", "信心", "狀態", "操作"], (detail.aliases || []).map(item => `<tr><td>${esc(item.alias_name)}</td><td>${esc(item.match_basis || "UNKNOWN")}</td><td>${Math.round(Number(item.confidence || 0) * 100)}%</td><td>${badge(item.status)}</td><td>${item.status === "ACTIVE" && (detail.aliases || []).length > 1 ? button("product-split", "product_review", "拆成獨立商品", { primary: false, id: item.alias_id }) : "—"}</td></tr>`), "尚無商品別名")}<h3 class="subsection-title">商品合併候選</h3>${table(["候選商品", "理由", "信心", "狀態", "決策"], (detail.match_candidates || []).map(item => `<tr><td>${esc(item.product_a_name)} ↔ ${esc(item.product_b_name)}</td><td>${esc((item.reasons || []).join("、"))}</td><td>${Math.round(item.confidence * 100)}%</td><td>${badge(item.status)}</td><td>${item.status === "PENDING" ? `${button("product-merge", "product_review", "確認合併", { primary: false, id: item.product_match_id })}${button("product-reject", "product_review", "保持分開", { primary: false, id: item.product_match_id })}` : "已決策"}</td></tr>`), "沒有待確認合併")}</div></section>`;
    return `${heading("商品中心", "M3 以穩定公開證據自動彙整；只有名稱相同時一律保留人工確認。", button("rebuild-graph", "review", "重建商品關聯"))}${toolbar("搜尋商品、品牌或品類…")}${table(["商品", "廠商", "團購事件", "KOL", "公開價格", "待確認", "詳情"], state.products.map(item => `<tr><td><span class="strong">${esc(item.canonical_name)}</span><span class="subtle">${esc(item.brand || item.category || item.identity_basis)}</span></td><td>${esc(item.vendor_names || "UNKNOWN")}</td><td>${item.event_count}</td><td>${item.kol_count}</td><td>${item.min_price == null ? "UNKNOWN" : `${esc(item.currency || "TWD")} ${item.min_price}${item.max_price !== item.min_price ? `–${item.max_price}` : ""}`}</td><td>${item.pending_match_count ? badge("PENDING") : "—"}</td><td><button class="table-action" data-command="open-product" data-id="${esc(item.product_id)}">查看</button></td></tr>`), "尚未建立商品中心")}${detailHtml}`;
  },
  vendor_candidates: () => `${heading("廠商公開資料", "M4 每個欄位保留公開來源、擷取時間、信心與 Parser；未知值不猜測。")}${toolbar("搜尋廠商、品類或公開 Email…")}${table(["廠商候選", "公開資料", "商品", "證據", "狀態", "開發名單", "操作"], state.vendorCandidates.map(item => `<tr><td><span class="strong">${esc(item.display_name || "UNKNOWN／待補充")}</span><span class="subtle">${esc(item.vendor_id)}</span></td><td><span class="subtle">${item.website_url ? `<a href="${esc(item.website_url)}" target="_blank" rel="noreferrer">官網 ↗</a>` : "官網 UNKNOWN"}<br>${esc(item.public_business_email || item.category || "資料不足")}</span></td><td>${item.product_count}</td><td>${item.evidence_count}</td><td>${badge(item.status)}</td><td>${item.prospect_id ? badge("ASSIGNED") : "尚未加入"}</td><td><div class="button-row">${button("open-vendor-enrichment", "vendor_enrich", "補公開資料", { primary: false, id: item.vendor_id })}${item.prospect_id ? "" : item.display_name ? button("open-prospect-create", "prospect_create", "加入開發", { primary: false, id: item.vendor_id }) : '<button class="table-action" disabled title="需先確認廠商名稱">加入開發</button>'}</div></td></tr>`), "尚無廠商候選")}`,
  relations: () => `${heading("商品 × KOL／團主", "M5 以公開平台 Handle 建立穩定關聯；每筆都保留開團事件與來源回鏈。")}${toolbar("搜尋 KOL、平台或 Handle…")}${table(["KOL／團主", "平台／Handle", "商品數", "事件數", "比對狀態", "最後觀察"], state.kolCandidates.map(item => `<tr><td><span class="strong">${esc(item.display_name)}</span><span class="subtle">${esc(item.kol_id)}</span></td><td>${esc(item.platform || "UNKNOWN")}<span class="subtle">${esc(item.handle || "UNKNOWN")}</span></td><td>${item.product_count}</td><td>${item.event_count}</td><td>${badge(item.match_status)}</td><td>${date(item.last_seen_at)}</td></tr>`), "尚無商品－KOL 關聯")}`,
  prospects: () => { const p = state.prospects || { summary: { stages: {} }, items: [] }; const stages = p.summary?.stages || {}; const cards = [["全部開發名單", p.summary?.total || 0, "同廠商唯一有效項目", "violet"], ["已指派", stages.ASSIGNED || 0, "已分派開團人員", "blue"], ["已聯絡", stages.CONTACTED || 0, "等待回覆", "amber"], ["洽談中", stages.NEGOTIATING || 0, "可追蹤下一步", "green"]]; return `${heading("預計開發 Pipeline", "M6 只管理內部指派、優先序、下一步與活動紀錄；系統不自動發信或私訊。") }<div class="grid stats compact-stats">${cards.map(([name, value, detail, tone]) => `<article class="stat" style="--accent:var(--${tone});--accent-soft:var(--${tone}-soft,#f1efff)"><span class="stat-label">${name}</span><div class="stat-value">${value}</div><span class="stat-delta">${detail}</span></article>`).join("")}</div>${toolbar("搜尋廠商或負責人…")}${table(["廠商", "負責人", "優先序", "階段", "下一步", "活動", "操作"], p.items.map(item => `<tr><td><span class="strong">${esc(item.vendor_name)}</span><span class="subtle">${esc(item.category || item.prospect_id)}</span></td><td>${esc(item.owner_id || "尚未指派")}</td><td>${badge(item.priority)}</td><td>${badge(item.stage)}</td><td>${date(item.next_action_at)}</td><td>${item.activity_count}</td><td><div class="button-row">${button("open-prospect-note", "prospect_create", "加紀錄", { primary: false, id: item.prospect_id })}${button("open-prospect-manage", "prospect_manage", "指派／推進", { primary: false, id: item.prospect_id })}</div></td></tr>`), "尚未加入預計開發名單")}`; },
  vendors: () => renderLeads("VENDOR", state.vendorLeads, "廠商開發線索", "評分權重 25／20／20／20／10／5；缺值保留 UNKNOWN。"),
  kols: () => renderLeads("KOL", state.kolLeads, "KOL 合作線索", "評分權重 30／20／15／15／10／10；不推估銷售或 GMV。"),
  review: () => { const leads = [...state.vendorLeads, ...state.kolLeads].filter(item => ["DISCOVERED", "SUBMITTED", "NEEDS_MORE_DATA", "待審核", "待補資料"].includes(item.stage)); return `${heading("人工審核佇列", "所有決策保存 Actor、Reason 與 Before／After。", button("rebuild-leads", "review", "重建線索"))}<div class="notice">同名只產生 Match Candidate，不會自動合併。OPS_EDITOR 可送審；主管與管理員才可核准。</div>${table(["線索", "類型", "分數／充分度", "狀態", "最後觀察", "審核"], leads.map(item => `<tr><td><span class="strong">${esc(item.canonical_name)}</span><span class="subtle">${esc(item.lead_id)}</span></td><td>${esc(item.lead_type)}</td><td>${score(item.score, item.data_sufficiency)}</td><td>${badge(item.stage)}</td><td>${date(item.last_observed_at)}</td><td>${button("open-review", role === "OPS_EDITOR" ? "review" : "approve", "審核", { primary: false, id: item.lead_id })}</td></tr>`), "目前沒有待審線索")}`; },
  sources: () => `${heading("公開資料來源治理", "只有政策與條款完成審查、明確不需登入且允許採集的來源才能執行 Collector。", button("open-source", "source_admin", "新增公開來源"))}<div class="notice">不採集 LINE 群、私人社團、登入後頁面或封閉資料。每次執行都檢查 robots.txt、DNS／SSRF 邊界、1 MB 上限與來源頻率。</div>${table(["來源", "型態", "政策／條款", "Robots", "最近成功", "狀態", "採集"], state.sources.map(item => `<tr><td><span class="strong">${esc(item.name)}</span><span class="subtle">${esc(item.base_url || "公開展示來源")}</span></td><td>${esc(item.type)}</td><td>${badge(item.policy_status)} <span class="subtle">${esc(textLabel(item.terms_status))}</span></td><td>${badge(item.robots_status)}</td><td>${date(item.last_success_at)}</td><td>${badge(item.health_status)}</td><td>${item.scrape_allowed && ["PUBLIC_GROUP_BUY_PAGE","PUBLIC_BRAND_CAMPAIGN","PUBLIC_LISTING"].includes(item.type) ? button("collect-source", "source_admin", "執行採集", { primary: false, id: item.source_id }) : "未啟用"}</td></tr>`))}${state.runs.length ? `<h3 class="subsection-title">最近採集／匯入 Run</h3>${table(["Run", "目標", "Parser", "狀態", "新增", "重複", "錯誤"], state.runs.slice(0, 10).map(item => `<tr><td class="id">${esc(item.run_id)}</td><td><span class="subtle">${esc(item.target_url || "人工匯入")}</span></td><td>${esc(item.run_parser_version || "manual")}</td><td>${badge(item.status)}</td><td>${item.created_count}</td><td>${item.duplicate_count}</td><td>${item.error_count}</td></tr>`))}` : ""}`,
  integration: () => `${heading("ERP 整合 Dry-run", "使用穩定 ID、冪等鍵、證據鏈與合約版本；正式寫入不存在。")}<div class="notice">group-buying-operations 仍是 SoT。本模組只比較 Demo ERP Snapshot，不持有 ERP Token。</div><div class="integration-flow">${[["1. Approved Lead", "只有已核准線索可建立草稿。"], ["2. Promotion Draft", "固定 contract 與 idempotency key。"], ["3. Dry-run", "輸出 would_create、conflicts 與缺值。"], ["4. Stop", "MVP 到此停止，不提供正式寫入。"]].map(([a, b]) => `<div class="flow-card"><strong>${a}</strong><span>${b}</span></div>`).join("")}</div><h3 class="subsection-title">已核准線索</h3>${table(["線索", "類型", "分數", "動作"], [...state.vendorLeads, ...state.kolLeads].filter(item => item.stage === "APPROVED").map(item => `<tr><td>${esc(item.canonical_name)}</td><td>${item.lead_type}</td><td>${score(item.score, item.data_sufficiency)}</td><td>${button("create-promotion", "integration_dry_run", "建立 Draft", { primary: false, id: item.lead_id })}</td></tr>`), "尚無已核准線索")}<h3 class="subsection-title">Promotion Drafts</h3>${table(["Draft", "目標", "狀態", "結果", "動作"], state.promotions.map(item => `<tr><td class="id">${esc(item.promotion_draft_id)}</td><td>${esc(item.target_type)}</td><td>${badge(item.status)}</td><td>${badge(item.dry_run_result?.result || "尚未執行")}</td><td>${item.status === "DRY_RUN_COMPLETED" ? "已完成" : button("dry-run", "integration_dry_run", "執行 Dry-run", { primary: false, id: item.promotion_draft_id })}</td></tr>`), "尚無 Promotion Draft")}`,
  permissions: () => `${heading("角色權限與執行模式", api.connected ? "Sandbox 依角色開啟功能；外部角色仍只有檢視權。" : "公開站可預覽全部角色，但 Mutation 一律關閉。")}<div class="grid permission-grid">${Object.entries(ROLES).map(([key, value]) => `<article class="panel permission-card ${key === role ? "active" : ""}"><h3>${value.label}</h3><p>${key} · ${value.short}</p><div class="chips">${["view", "review", "product_review", "vendor_enrich", "prospect_create", "prospect_manage"].map(capability => `<span class="badge ${can(key, capability) ? "green" : ""}">${can(key, capability) ? "✓" : "—"} ${capability}</span>`).join("")}</div></article>`).join("")}</div><div class="notice" style="margin-top:16px">角色選單只供 Sandbox 驗證，不是正式登入。Production 仍須獨立身份驗證與短效憑證。</div>`,
};

function roleAction([command, capability, label, destination]) {
  if (command === "go-page") return `<button class="btn btn-secondary" data-command="go-page" data-id="${esc(destination)}">${esc(label)}</button>`;
  if (command === "export") return `<button class="btn btn-secondary" data-command="export">${esc(label)}</button>`;
  return button(command, capability, label, { primary: command !== "open-import" });
}

function metricValue(dashboard, key, suffix = "") {
  const value = dashboard[key];
  if (value === null || value === undefined) return "資料不足";
  return `${value}${suffix}`;
}

function renderRoleOverview() {
  const experience = getRoleExperience(role);
  const dashboard = state.dashboard || {};
  const cards = experience.metrics.map(([name, key, detail, tone, suffix = ""]) => [name, metricValue(dashboard, key, suffix), detail, tone]);
  const permissionText = can(role, "approve") ? "可核准" : can(role, "review") ? "可建立／送審" : "唯讀檢視";
  return `
    <section class="role-hero role-${experience.accent}">
      <div>
        <span class="role-kicker">${esc(experience.eyebrow)}</span>
        <h2>${esc(experience.homeTitle)}</h2>
        <p>${esc(experience.description)}</p>
      </div>
      <div class="role-identity">
        <span>${esc(ROLES[role].label)}</span>
        <strong>${esc(permissionText)}</strong>
        <small>${esc(role)}</small>
      </div>
    </section>
    <div class="foundation-status"><strong>M3～M6 已完成：商品中心到預計開發 Pipeline</strong><span>本機可由真實開團事件建立商品、廠商與 KOL 關聯，再加入、指派及追蹤預計開發名單；M7 的正式登入與受控部署仍未啟用。</span></div>
    ${heading("角色專屬摘要", api.connected ? "以下為本機流程基礎版與合成種子資料。" : "公開 Pages 使用合成資料，所有操作保持唯讀。", `<div class="button-row">${experience.actions.map(roleAction).join("")}</div>`)}
    <div class="grid stats">${cards.map(([name, value, detail, tone]) => `<article class="stat" style="--accent:var(--${tone});--accent-soft:var(--${tone}-soft,#f1efff)"><span class="stat-label">${esc(name)}</span><div class="stat-value">${esc(value)}</div><span class="stat-delta">${esc(detail)}</span></article>`).join("")}</div>
    <div class="grid two-col role-panels">
      <article class="panel">
        <div class="panel-head"><h3>${esc(experience.focusTitle)}</h3><span>${esc(permissionText)}</span></div>
        <div class="panel-body role-focus">${experience.focusItems.map(([title, detail], index) => `<div class="focus-item"><b>${index + 1}</b><div><strong>${esc(title)}</strong><span>${esc(detail)}</span></div></div>`).join("")}</div>
      </article>
      <article class="panel">
        <div class="panel-head"><h3>${esc(experience.boundaryTitle)}</h3><span>固定護欄</span></div>
        <div class="panel-body activity">${experience.boundaryItems.map(([title, detail]) => `<div class="activity-item"><i></i><div><strong>${esc(title)}</strong><span>${esc(detail)}</span></div></div>`).join("")}</div>
      </article>
    </div>`;
}

views.overview = renderRoleOverview;

function renderLeads(type, leads, title, description) { return `${heading(title, description, button("rebuild-leads", "review", "重新計算線索"))}${toolbar(`搜尋${type === "VENDOR" ? "廠商或品類" : "KOL、平台或領域"}…`)}${table([type === "VENDOR" ? "廠商" : "KOL", "公開資料", "Observation", "分數／充分度", "階段", "最後觀察"], leads.map(item => `<tr><td><span class="strong">${esc(item.canonical_name)}</span><span class="subtle">${esc(item.lead_id)}</span></td><td>${esc(item.metadata?.category || item.metadata?.platform || "資料不足")}</td><td>${esc(item.metadata?.observation_count ?? "資料不足")}</td><td>${score(item.score, item.data_sufficiency)}</td><td>${badge(item.stage)}</td><td>${date(item.last_observed_at || item.metadata?.last_observed_at)}</td></tr>`))}`; }

async function handleCommand(event) {
  const target = event.target.closest("[data-command]");
  if (!target || target.disabled) return;
  try {
    if (target.dataset.command === "go-page") { location.hash = target.dataset.id || "overview"; return; }
    if (target.dataset.command === "export") return exportPage();
    if (target.dataset.command === "open-observation") return openObservation();
    if (target.dataset.command === "open-import") return openImport();
    if (target.dataset.command === "open-source") return openSource();
    if (target.dataset.command === "collect-source") { const result = await api.collectSource(target.dataset.id); await refresh(); render(); return showToast(`採集完成：新增 ${result.run.created_count}、重複 ${result.run.duplicate_count}`); }
    if (target.dataset.command === "rebuild-graph") { await api.rebuildMarketGraph(); await refresh(); render(); return showToast("商品、廠商與 KOL 關聯已重建"); }
    if (target.dataset.command === "open-product") { const product = state.products.find(item => item.product_id === target.dataset.id); state.productDetail = api.connected ? await api.product(target.dataset.id) : { ...product, aliases: [], events: [], match_candidates: [], kols: state.kolCandidates.slice(0, Math.max(1, product?.kol_count || 1)) }; render(); return; }
    if (target.dataset.command === "close-product") { state.productDetail = null; render(); return; }
    if (target.dataset.command === "product-merge" || target.dataset.command === "product-reject") { await api.reviewProductMatch(target.dataset.id, target.dataset.command === "product-merge" ? "MERGE" : "REJECT"); await refresh(); state.productDetail = null; render(); return showToast("商品比對決策已保存"); }
    if (target.dataset.command === "product-split") { await api.splitProductAlias(target.dataset.id); await refresh(); state.productDetail = null; render(); return showToast("商品別名已拆成獨立商品"); }
    if (target.dataset.command === "open-vendor-enrichment") return openVendorEnrichment(target.dataset.id);
    if (target.dataset.command === "open-prospect-create") return openProspectCreate(target.dataset.id);
    if (target.dataset.command === "open-prospect-manage") return openProspectManage(target.dataset.id);
    if (target.dataset.command === "open-prospect-note") return openProspectNote(target.dataset.id);
    if (target.dataset.command === "open-review") return openReview(target.dataset.id);
    if (target.dataset.command === "rebuild-leads") { await api.rebuildLeads(); await refresh(); render(); return showToast("線索與評分已重新計算"); }
    if (target.dataset.command === "create-promotion") { await api.createPromotion(target.dataset.id); await refresh(); render(); return showToast("Promotion Draft 已建立"); }
    if (target.dataset.command === "dry-run") { const result = await api.dryRun(target.dataset.id); await refresh(); render(); return showToast(`Dry-run：${textLabel(result.dry_run_result?.result)}`); }
  } catch (error) { showToast(error.message, "error"); }
}

function openModal({ kind, title, description, submit, fields, payload = {} }) {
  modalForm.dataset.kind = kind; modalForm.dataset.payload = JSON.stringify(payload);
  document.querySelector("#modal-title").textContent = title; document.querySelector("#modal-description").textContent = description; modalSubmit.textContent = submit;
  modalFields.innerHTML = fields.map(field => { const id = `field-${field.name}`; const labelHtml = `<label for="${id}">${esc(field.label)}${field.required ? " *" : ""}</label>`; if (field.type === "textarea") return `<div class="form-field full">${labelHtml}<textarea id="${id}" name="${field.name}" rows="${field.rows || 6}" ${field.required ? "required" : ""} placeholder="${esc(field.placeholder || "")}"></textarea></div>`; if (field.type === "select") return `<div class="form-field">${labelHtml}<select id="${id}" name="${field.name}">${field.options.map(([value, text]) => `<option value="${value}">${esc(text)}</option>`).join("")}</select></div>`; return `<div class="form-field ${field.full ? "full" : ""}">${labelHtml}<input id="${id}" name="${field.name}" type="${field.type || "text"}" ${field.required ? "required" : ""} placeholder="${esc(field.placeholder || "")}"></div>`; }).join("");
  modal.showModal(); modalFields.querySelector("input,textarea,select")?.focus();
}
function openObservation() { openModal({ kind: "observation", title: "建立公開市場觀察", description: "只登錄公開 URL 與人工確認欄位，不會存取受限內容。", submit: "建立 Observation", fields: [{ name: "source_url", label: "公開來源 URL", type: "url", required: true, full: true }, { name: "entity_type", label: "類型", type: "select", options: [["PRODUCT", "商品"], ["VENDOR", "廠商"], ["KOL", "KOL／團主"], ["CAMPAIGN", "團期"]] }, { name: "title", label: "顯示名稱", required: true }, { name: "category", label: "品類" }, { name: "product_name", label: "商品名稱" }, { name: "vendor_name", label: "廠商名稱" }, { name: "host_name", label: "KOL／團主" }, { name: "platform", label: "平台" }, { name: "platform_handle", label: "公開 Handle" }, { name: "public_email", label: "公開商務 Email", type: "email" }, { name: "starts_at", label: "開始時間", type: "datetime-local" }, { name: "ends_at", label: "結束時間", type: "datetime-local" }, { name: "price_amount", label: "公開價格", type: "number" }, { name: "notes", label: "備註", type: "textarea", rows: 3 }] }); }
function openImport() { openModal({ kind: "import", title: "匯入 CSV／JSON", description: "支援 source_url、entity_type、title、vendor_name、host_name、product_name、category 等欄位。", submit: "開始匯入", fields: [{ name: "format", label: "格式", type: "select", options: [["csv", "CSV"], ["json", "JSON"]] }, { name: "payload", label: "資料內容", type: "textarea", required: true, rows: 12, placeholder: "source_url,entity_type,title\nhttps://example.com,PRODUCT,示範商品" }] }); }
function openSource() { openModal({ kind: "source", title: "新增公開資料來源", description: "僅限不需登入的公開頁。要啟用採集，政策需核准、條款狀態需為已審查公開，並留下審查說明。", submit: "新增來源", fields: [{ name: "name", label: "來源名稱", required: true }, { name: "type", label: "類型", type: "select", options: [["PUBLIC_GROUP_BUY_PAGE", "公開團購頁"], ["PUBLIC_BRAND_CAMPAIGN", "公開品牌活動頁"], ["PUBLIC_LISTING", "公開團購清單／日曆"], ["WEB_SEARCH_RESULT", "公開搜尋結果（匯入）"], ["MANUAL_URL", "人工 URL"]] }, { name: "base_url", label: "公開頁 URL", type: "url", required: true, full: true }, { name: "policy_status", label: "來源政策", type: "select", options: [["PENDING", "待確認"], ["APPROVED", "已核准"], ["BLOCKED", "禁止採集"]] }, { name: "terms_status", label: "條款審查", type: "select", options: [["PENDING", "待確認"], ["REVIEWED_PUBLIC", "已確認為公開可用"], ["BLOCKED", "禁止使用"]] }, { name: "scrape_allowed", label: "自動採集", type: "select", options: [["false", "先不啟用"], ["true", "啟用公開頁採集"]] }, { name: "collection_interval_minutes", label: "最短採集間隔（分鐘）", type: "number", placeholder: "1440" }, { name: "owner_name", label: "來源負責人" }, { name: "review_notes", label: "政策／條款審查紀錄", type: "textarea", rows: 4, full: true }] }); }
function openReview(id) { const lead = [...state.vendorLeads, ...state.kolLeads].find(item => item.lead_id === id); const options = role === "OPS_EDITOR" ? [["SUBMIT", "送交主管"]] : [["APPROVE", "核准"], ["NEEDS_MORE_DATA", "要求補資料"], ["REJECT", "拒絕"], ["IGNORE", "不處理"]]; openModal({ kind: "review", title: `審核：${lead?.canonical_name || id}`, description: "決策會寫入 ReviewDecision 與 Audit Log。", submit: "送出決策", payload: { leadId: id }, fields: [{ name: "action", label: "決策", type: "select", options }, { name: "reason", label: "原因", type: "textarea", required: true, rows: 5 }] }); }
function openVendorEnrichment(id) { const vendor = state.vendorCandidates.find(item => item.vendor_id === id); openModal({ kind: "vendor-enrichment", title: `補充廠商公開資料：${vendor?.display_name || "UNKNOWN"}`, description: "只填寫可公開驗證的商務資料，每次補充都必須附公開證據 URL。", submit: "保存公開資料", payload: { vendorId: id }, fields: [{ name: "display_name", label: "廠商正式／顯示名稱", placeholder: vendor?.display_name || "" }, { name: "category", label: "品類", placeholder: vendor?.category || "" }, { name: "website_url", label: "公開官網", type: "url", full: true }, { name: "collaboration_url", label: "公開合作頁", type: "url", full: true }, { name: "public_business_email", label: "公開商務 Email", type: "email" }, { name: "region", label: "地區" }, { name: "evidence_source_url", label: "公開證據 URL", type: "url", required: true, full: true }, { name: "confidence", label: "信心（0～1）", type: "number", placeholder: "0.9" }] }); }
function openProspectCreate(id) { const vendor = state.vendorCandidates.find(item => item.vendor_id === id); const fields = [{ name: "priority", label: "優先序", type: "select", options: [["MEDIUM", "中"], ["HIGH", "高"], ["URGENT", "急"], ["LOW", "低"]] }, { name: "next_action_at", label: "下一步日期", type: "datetime-local" }, { name: "note", label: "加入原因／下一步", type: "textarea", rows: 4 }]; if (can(role, "prospect_manage")) fields.splice(1, 0, { name: "owner_id", label: "負責開團人員" }); openModal({ kind: "prospect-create", title: `加入預計開發：${vendor?.display_name || id}`, description: "同一廠商只會建立一筆有效 Prospect；系統不會自動聯絡對方。", submit: "加入開發名單", payload: { vendorId: id }, fields }); }
function openProspectManage(id) { const prospect = state.prospects.items.find(item => item.prospect_id === id); openModal({ kind: "prospect-manage", title: `指派／推進：${prospect?.vendor_name || id}`, description: "主管可設定負責人、優先序、階段與下一步；所有變更寫入 Activity 與 Audit。", submit: "更新 Pipeline", payload: { prospectId: id }, fields: [{ name: "owner_id", label: "負責開團人員", placeholder: prospect?.owner_id || "" }, { name: "priority", label: "優先序", type: "select", options: [[prospect?.priority || "MEDIUM", `目前：${textLabel(prospect?.priority || "MEDIUM")}`], ["LOW", "低"], ["MEDIUM", "中"], ["HIGH", "高"], ["URGENT", "急"]] }, { name: "stage", label: "開發階段", type: "select", options: [[prospect?.stage || "PLANNED", `目前：${textLabel(prospect?.stage || "PLANNED")}`], ["PLANNED", "待規劃"], ["ASSIGNED", "已指派"], ["CONTACTED", "已聯絡"], ["RESPONDED", "已回覆"], ["NEGOTIATING", "洽談中"], ["WON", "開發成功"], ["LOST", "未成交"], ["DO_NOT_CONTACT", "不聯絡"]] }, { name: "next_action_at", label: "下一步日期", type: "datetime-local" }, { name: "note", label: "變更說明", type: "textarea", rows: 4 }] }); }
function openProspectNote(id) { const prospect = state.prospects.items.find(item => item.prospect_id === id); openModal({ kind: "prospect-note", title: `新增活動紀錄：${prospect?.vendor_name || id}`, description: "只保存內部工作紀錄，不會發送 Email 或訊息。", submit: "新增紀錄", payload: { prospectId: id }, fields: [{ name: "action_type", label: "活動類型", type: "select", options: [["NOTE", "一般備註"], ["RESEARCH", "資料研究"], ["CALL_LOG", "聯絡紀錄"], ["FOLLOW_UP", "後續追蹤"]] }, { name: "note", label: "活動內容", type: "textarea", required: true, rows: 5 }] }); }

async function submitModal(event) {
  event.preventDefault(); const body = Object.fromEntries([...new FormData(modalForm).entries()].filter(([, value]) => value !== "")); const kind = modalForm.dataset.kind; const payload = JSON.parse(modalForm.dataset.payload || "{}"); modalSubmit.disabled = true;
  try { if (kind === "observation") await api.createObservation(body); else if (kind === "import") await api.importRecords({ ...body, idempotency_key: newClientRequestId("import") }); else if (kind === "source") await api.createSource(body); else if (kind === "review") await api.reviewLead(payload.leadId, body); else if (kind === "vendor-enrichment") await api.enrichVendor(payload.vendorId, body); else if (kind === "prospect-create") await api.createProspect(payload.vendorId, body); else if (kind === "prospect-manage") await api.updateProspect(payload.prospectId, body); else if (kind === "prospect-note") await api.addProspectActivity(payload.prospectId, body); modal.close(); await refresh(); render(); showToast("作業完成並寫入 Audit Log"); } catch (error) { showToast(error.message, "error"); } finally { modalSubmit.disabled = false; }
}
function exportPage() { const pageData = { observations: state.observations, products: state.products, vendor_candidates: state.vendorCandidates, relations: state.kolCandidates, prospects: state.prospects, vendors: state.vendorLeads, kols: state.kolLeads, sources: state.sources, integration: state.promotions }; const data = pageData[page] || state.dashboard; const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `market-radar-${page}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); showToast("已匯出目前頁面 JSON"); }
function filterTable(term) { const query = term.trim().toLowerCase(); app.querySelectorAll("tbody tr").forEach(row => { row.hidden = Boolean(query && !row.textContent.toLowerCase().includes(query)); }); }
function showToast(message, tone = "success") { toast.textContent = message; toast.dataset.tone = tone; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200); }

init();
