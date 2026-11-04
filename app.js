import { ROLES, can, getRole, actionState as publicActionState } from "./permissions.js";
import { stats as demoStats, observations as demoObservations, vendorLeads as demoVendorLeads, kolLeads as demoKolLeads, sources as demoSources } from "./data.js";
import { RadarApi, newClientRequestId } from "./api-client.js";
import { PAGE_CATALOG, canAccessRolePage, getRoleExperience } from "./role-experience.js";

const titles = Object.fromEntries(Object.entries(PAGE_CATALOG).map(([id, item]) => [id, item.label]));
const labels = { OBSERVED: "已觀察", DISCOVERED: "待審核", SUBMITTED: "已送審", APPROVED: "已核准", REJECTED: "已拒絕", NEEDS_MORE_DATA: "待補資料", IGNORED: "不處理", DRY_RUN_READY: "待 Dry-run", DRY_RUN_COMPLETED: "Dry-run 完成", HEALTHY: "正常", UNKNOWN: "未知", PENDING: "待確認", COMPLETED: "完成", PARTIAL: "部分完成", FAILED: "失敗" };

let role = getRole(location.search);
let page = location.hash.slice(1) || "overview";
const api = new RadarApi({ role });
const state = { dashboard: null, observations: [], vendorLeads: [], kolLeads: [], sources: [], promotions: [], runs: [], loading: true };

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
    mode.textContent = "MVP Sandbox 已連線";
    detail.textContent = "本機 SQLite · Production 未觸碰";
    document.querySelector(".preview-banner").classList.add("sandbox");
    document.querySelector(".preview-banner strong").textContent = "可操作 MVP Sandbox";
    document.querySelector(".preview-badge").textContent = "LOCAL WRITE";
  } else {
    mode.textContent = "公開展示模式";
    detail.textContent = "合成資料 · 完全唯讀";
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
  banner.querySelector("strong").textContent = api.connected ? `${experience.homeTitle} · MVP Sandbox` : `${experience.homeTitle} · 公開預覽`;
  banner.querySelector(".preview-badge").textContent = api.connected ? experience.badge : "NO WRITE";
  roleSummary.textContent = api.connected && can(role, "review")
    ? `以「${ROLES[role].label}」操作專屬工作台；每次異動均留下 Audit，正式 ERP 寫入持續封鎖。`
    : `以「${ROLES[role].label}」檢視專屬工作台；此角色沒有資料異動權限。`;
}

async function refresh() {
  state.loading = true;
  if (!api.connected) {
    state.observations = demoObservations.map(item => ({ observation_id: item.id, entity_type: item.type, title: item.title, source_url: "https://example.com/public-demo", vendor_name: item.owner, score: item.score, status: item.status, observed_at: item.seen }));
    state.vendorLeads = demoVendorLeads.map((item, i) => ({ lead_id: `demo-v-${i}`, lead_type: "VENDOR", canonical_name: item.name, score: item.score, stage: item.stage, metadata: { category: item.category, observation_count: item.activeGroups, evidence_count: item.evidence, last_observed_at: item.freshness } }));
    state.kolLeads = demoKolLeads.map((item, i) => ({ lead_id: `demo-k-${i}`, lead_type: "KOL", canonical_name: item.name, score: item.score, stage: item.stage, metadata: { platform: item.platform, category: item.niche, observation_count: item.cadence, public_email: item.contact } }));
    state.sources = demoSources.map((item, i) => ({ source_id: `demo-s-${i}`, name: item.name, type: item.kind, last_success_at: item.last, health_status: item.status, policy_status: "DEMO", success: item.success }));
    state.promotions = []; state.runs = [];
    state.dashboard = { observations: demoStats[0].value, vendor_leads: demoStats[1].value, kol_leads: demoStats[2].value, pending_review: 19, promotion_drafts: 12, sources: 8, source_health_percent: 96 };
    state.loading = false; return;
  }
  try {
    const [dashboard, observations, vendors, kols, sources, promotions, runs] = await Promise.all([api.dashboard(), api.observations(), api.leads("VENDOR"), api.leads("KOL"), api.sources(), api.promotions(), api.runs()]);
    Object.assign(state, { dashboard, observations: observations.items, vendorLeads: vendors.items, kolLeads: kols.items, sources: sources.items, promotions: promotions.items, runs: runs.items });
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
  observations: () => `${heading("市場觀察", "保留來源、時間、Parser、Raw hash 與 Evidence。", `<div class="button-row">${button("open-import", "review", "匯入 CSV／JSON", { primary: false })}${button("open-observation", "review", "建立觀察")}</div>`)}${toolbar("搜尋 Observation、商品、廠商或 KOL…")}${table(["Observation", "類型／名稱", "廠商／KOL", "來源", "狀態", "時間"], state.observations.map(item => `<tr><td class="id">${esc(item.observation_id)}</td><td><span class="strong">${esc(item.title)}</span><span class="subtle">${esc(item.entity_type)}</span></td><td>${esc(item.vendor_name || item.host_name || "資料不足")}</td><td><a href="${esc(item.source_url)}" target="_blank" rel="noreferrer">公開來源</a></td><td>${badge(item.status)}</td><td>${date(item.observed_at)}</td></tr>`))}`,
  vendors: () => renderLeads("VENDOR", state.vendorLeads, "廠商開發線索", "評分權重 25／20／20／20／10／5；缺值保留 UNKNOWN。"),
  kols: () => renderLeads("KOL", state.kolLeads, "KOL 合作線索", "評分權重 30／20／15／15／10／10；不推估銷售或 GMV。"),
  review: () => { const leads = [...state.vendorLeads, ...state.kolLeads].filter(item => ["DISCOVERED", "SUBMITTED", "NEEDS_MORE_DATA", "待審核", "待補資料"].includes(item.stage)); return `${heading("人工審核佇列", "所有決策保存 Actor、Reason 與 Before／After。", button("rebuild-leads", "review", "重建線索"))}<div class="notice">同名只產生 Match Candidate，不會自動合併。OPS_EDITOR 可送審；主管與管理員才可核准。</div>${table(["線索", "類型", "分數／充分度", "狀態", "最後觀察", "審核"], leads.map(item => `<tr><td><span class="strong">${esc(item.canonical_name)}</span><span class="subtle">${esc(item.lead_id)}</span></td><td>${esc(item.lead_type)}</td><td>${score(item.score, item.data_sufficiency)}</td><td>${badge(item.stage)}</td><td>${date(item.last_observed_at)}</td><td>${button("open-review", role === "OPS_EDITOR" ? "review" : "approve", "審核", { primary: false, id: item.lead_id })}</td></tr>`), "目前沒有待審線索")}`; },
  sources: () => `${heading("資料來源健康度", "MVP 支援人工 URL 與 CSV／JSON；自動 Collector 預設停用。", button("open-source", "source_admin", "新增來源"))}${table(["來源", "型態", "政策", "最近成功", "狀態"], state.sources.map(item => `<tr><td><span class="strong">${esc(item.name)}</span><span class="subtle">${esc(item.base_url || "公開展示來源")}</span></td><td>${esc(item.type)}</td><td>${badge(item.policy_status)}</td><td>${date(item.last_success_at)}</td><td>${badge(item.health_status)}</td></tr>`))}${state.runs.length ? `<h3 class="subsection-title">最近匯入 Run</h3>${table(["Run", "狀態", "新增", "重複", "錯誤"], state.runs.slice(0, 10).map(item => `<tr><td class="id">${esc(item.run_id)}</td><td>${badge(item.status)}</td><td>${item.created_count}</td><td>${item.duplicate_count}</td><td>${item.error_count}</td></tr>`))}` : ""}`,
  integration: () => `${heading("ERP 整合 Dry-run", "使用穩定 ID、冪等鍵、證據鏈與合約版本；正式寫入不存在。")}<div class="notice">group-buying-operations 仍是 SoT。本模組只比較 Demo ERP Snapshot，不持有 ERP Token。</div><div class="integration-flow">${[["1. Approved Lead", "只有已核准線索可建立草稿。"], ["2. Promotion Draft", "固定 contract 與 idempotency key。"], ["3. Dry-run", "輸出 would_create、conflicts 與缺值。"], ["4. Stop", "MVP 到此停止，不提供正式寫入。"]].map(([a, b]) => `<div class="flow-card"><strong>${a}</strong><span>${b}</span></div>`).join("")}</div><h3 class="subsection-title">已核准線索</h3>${table(["線索", "類型", "分數", "動作"], [...state.vendorLeads, ...state.kolLeads].filter(item => item.stage === "APPROVED").map(item => `<tr><td>${esc(item.canonical_name)}</td><td>${item.lead_type}</td><td>${score(item.score, item.data_sufficiency)}</td><td>${button("create-promotion", "integration_dry_run", "建立 Draft", { primary: false, id: item.lead_id })}</td></tr>`), "尚無已核准線索")}<h3 class="subsection-title">Promotion Drafts</h3>${table(["Draft", "目標", "狀態", "結果", "動作"], state.promotions.map(item => `<tr><td class="id">${esc(item.promotion_draft_id)}</td><td>${esc(item.target_type)}</td><td>${badge(item.status)}</td><td>${badge(item.dry_run_result?.result || "尚未執行")}</td><td>${item.status === "DRY_RUN_COMPLETED" ? "已完成" : button("dry-run", "integration_dry_run", "執行 Dry-run", { primary: false, id: item.promotion_draft_id })}</td></tr>`), "尚無 Promotion Draft")}`,
  permissions: () => `${heading("角色權限與執行模式", api.connected ? "Sandbox 依角色開啟功能；外部角色仍只有檢視權。" : "公開站可預覽全部角色，但 Mutation 一律關閉。")}<div class="grid permission-grid">${Object.entries(ROLES).map(([key, value]) => `<article class="panel permission-card ${key === role ? "active" : ""}"><h3>${value.label}</h3><p>${key} · ${value.short}</p><div class="chips">${["view", "review", "approve", "source_admin", "integration_dry_run"].map(capability => `<span class="badge ${can(key, capability) ? "green" : ""}">${can(key, capability) ? "✓" : "—"} ${capability}</span>`).join("")}</div></article>`).join("")}</div><div class="notice" style="margin-top:16px">角色選單只供 Sandbox 驗證，不是正式登入。Production 仍須獨立身份驗證與短效憑證。</div>`,
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
    ${heading("角色專屬摘要", api.connected ? "資料來自本機 SQLite Sandbox。" : "公開 Pages 使用合成資料，所有操作保持唯讀。", `<div class="button-row">${experience.actions.map(roleAction).join("")}</div>`)}
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
function openSource() { openModal({ kind: "source", title: "新增公開資料來源", description: "自動採集預設關閉；仍須完成條款與政策確認。", submit: "新增來源", fields: [{ name: "name", label: "來源名稱", required: true }, { name: "type", label: "類型", type: "select", options: [["MANUAL_URL", "人工 URL"], ["CSV_JSON", "CSV／JSON"], ["PUBLIC_CALENDAR", "公開團購日曆"], ["BRAND_SITE", "品牌官網"]] }, { name: "base_url", label: "Base URL", type: "url", required: true, full: true }, { name: "policy_status", label: "政策", type: "select", options: [["PENDING", "待確認"], ["APPROVED", "已確認公開可用"], ["BLOCKED", "禁止採集"]] }] }); }
function openReview(id) { const lead = [...state.vendorLeads, ...state.kolLeads].find(item => item.lead_id === id); const options = role === "OPS_EDITOR" ? [["SUBMIT", "送交主管"]] : [["APPROVE", "核准"], ["NEEDS_MORE_DATA", "要求補資料"], ["REJECT", "拒絕"], ["IGNORE", "不處理"]]; openModal({ kind: "review", title: `審核：${lead?.canonical_name || id}`, description: "決策會寫入 ReviewDecision 與 Audit Log。", submit: "送出決策", payload: { leadId: id }, fields: [{ name: "action", label: "決策", type: "select", options }, { name: "reason", label: "原因", type: "textarea", required: true, rows: 5 }] }); }

async function submitModal(event) {
  event.preventDefault(); const body = Object.fromEntries([...new FormData(modalForm).entries()].filter(([, value]) => value !== "")); const kind = modalForm.dataset.kind; const payload = JSON.parse(modalForm.dataset.payload || "{}"); modalSubmit.disabled = true;
  try { if (kind === "observation") await api.createObservation(body); else if (kind === "import") await api.importRecords({ ...body, idempotency_key: newClientRequestId("import") }); else if (kind === "source") await api.createSource(body); else if (kind === "review") await api.reviewLead(payload.leadId, body); modal.close(); await refresh(); render(); showToast("作業完成並寫入 Audit Log"); } catch (error) { showToast(error.message, "error"); } finally { modalSubmit.disabled = false; }
}
function exportPage() { const data = page === "observations" ? state.observations : page === "vendors" ? state.vendorLeads : page === "kols" ? state.kolLeads : page === "sources" ? state.sources : page === "integration" ? state.promotions : state.dashboard; const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `market-radar-${page}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); showToast("已匯出目前頁面 JSON"); }
function filterTable(term) { const query = term.trim().toLowerCase(); app.querySelectorAll("tbody tr").forEach(row => { row.hidden = Boolean(query && !row.textContent.toLowerCase().includes(query)); }); }
function showToast(message, tone = "success") { toast.textContent = message; toast.dataset.tone = tone; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200); }

init();
