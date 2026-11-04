import { ROLES, can, getRole, actionState } from "./permissions.js";
import { stats, observations, vendorLeads, kolLeads, sources } from "./data.js";

const navItems = [
  { group: "情報中心", items: [
    ["overview", "總", "市場總覽"], ["observations", "觀", "市場觀察"], ["vendors", "廠", "廠商線索"], ["kols", "K", "KOL 線索"]
  ]},
  { group: "營運作業", items: [
    ["review", "審", "審核佇列"], ["sources", "源", "資料來源"], ["integration", "接", "ERP Dry-run"]
  ]},
  { group: "系統", items: [["permissions", "權", "權限預覽"]] }
];

const titles = Object.fromEntries(navItems.flatMap(group => group.items.map(([id,,label]) => [id,label])));
let role = getRole(location.search);
let page = location.hash.slice(1) || "overview";

const app = document.querySelector("#app");
const roleSelect = document.querySelector("#role-select");
const pageTitle = document.querySelector("#page-title");
const roleSummary = document.querySelector("#role-summary");
const toast = document.querySelector("#toast");

function init() {
  document.querySelector("#navigation").innerHTML = navItems.map(group => `
    <div class="nav-label">${group.group}</div>
    ${group.items.map(([id,icon,label]) => `<button class="nav-item" data-page="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`).join("")}
  `).join("");
  roleSelect.innerHTML = Object.entries(ROLES).map(([key,value]) => `<option value="${key}">${value.label} · ${key}</option>`).join("");
  roleSelect.value = role;
  roleSelect.addEventListener("change", () => {
    role = roleSelect.value;
    const url = new URL(location.href);
    url.searchParams.set("role", role);
    history.replaceState({}, "", url);
    render();
  });
  document.querySelector("#navigation").addEventListener("click", event => {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    location.hash = button.dataset.page;
  });
  addEventListener("hashchange", () => { page = location.hash.slice(1) || "overview"; render(); });
  app.addEventListener("click", event => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const result = actionState(role, action.dataset.capability || "review");
    showToast(result.reason);
  });
  app.addEventListener("input", event => {
    if (event.target.matches("[data-search]")) filterTable(event.target.value);
  });
  render();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function render() {
  if (!titles[page]) page = "overview";
  pageTitle.textContent = titles[page];
  roleSummary.textContent = `目前以「${ROLES[role].label}」檢視；所有頁面可顯示，功能依角色標示且不會寫入資料。`;
  document.querySelectorAll("[data-page]").forEach(item => item.classList.toggle("active", item.dataset.page === page));
  const renderer = views[page] || views.overview;
  app.innerHTML = renderer();
}

function score(value) { return `<span class="score"><i style="--score:${value}%"></i>${value}</span>`; }
function badge(value) {
  const tone = /可開發|正常|已核准/.test(value) ? "green" : /待審核|注意|待補/.test(value) ? "amber" : "violet";
  return `<span class="badge ${tone}">${value}</span>`;
}
function actionButtons(capability = "review", primary = "送出審核") {
  const state = actionState(role, capability);
  return `<div class="button-row"><button class="btn btn-secondary" data-action data-capability="${capability}">匯出預覽</button><button class="btn btn-primary" data-action data-capability="${capability}" title="${state.reason}">${primary}</button></div>`;
}
function heading(title, description, actions = "") {
  return `<div class="section-heading"><div><h2>${title}</h2><p>${description}</p></div>${actions}</div>`;
}
function table(headers, rows) {
  return `<div class="panel table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function filterTable(term) {
  const query = term.trim().toLowerCase();
  app.querySelectorAll("tbody tr").forEach(row => row.hidden = query && !row.textContent.toLowerCase().includes(query));
}

const views = {
  overview: () => `
    ${heading("今日市場脈動", "以證據為核心彙整公開開團訊號；數字為合成展示資料。", actionButtons("review", "新增公開 URL"))}
    <div class="grid stats">${stats.map(item => `<article class="stat" style="--accent:var(--${item.tone});--accent-soft:var(--${item.tone}-soft,#f1efff)"><span class="stat-label">${item.label}</span><div class="stat-value">${item.value}</div><span class="stat-delta">${item.delta}</span></article>`).join("")}</div>
    <div class="grid two-col">
      <article class="panel"><div class="panel-head"><h3>線索開發漏斗</h3><span>本週</span></div><div class="panel-body pipeline">
        ${[["新觀察",128,100],["已正規化",96,75],["待審核",43,34],["可開發",30,23],["ERP Dry-run",12,9]].map(([label,count,width]) => `<div class="pipeline-row"><span>${label}</span><div class="bar"><i style="width:${width}%"></i></div><strong>${count}</strong></div>`).join("")}
      </div></article>
      <article class="panel"><div class="panel-head"><h3>最新活動</h3><span>自動更新</span></div><div class="panel-body activity">
        <div class="activity-item"><i></i><div><strong>公開團購頁新增 7 筆觀察</strong><span>12 分鐘前 · parser v0.1</span></div></div>
        <div class="activity-item"><i></i><div><strong>KOL 線索完成去重候選</strong><span>28 分鐘前 · 需人工確認</span></div></div>
        <div class="activity-item"><i></i><div><strong>來源健康檢查完成</strong><span>46 分鐘前 · 8/8 正常</span></div></div>
      </div></article>
    </div>`,

  observations: () => `
    ${heading("市場觀察", "每筆訊號保留來源、觀察時間、解析版本與原始證據。", actionButtons("review", "建立觀察"))}
    <div class="toolbar"><input class="search" data-search placeholder="搜尋觀察 ID、商品、廠商或 KOL…"><button class="btn btn-secondary" data-action>篩選器</button></div>
    ${table(["觀察 ID","類型 / 名稱","來源","關聯對象","分數","狀態","最後觀察"], observations.map(o => `<tr><td class="id">${o.id}</td><td><span class="strong">${o.title}</span><span class="subtle">${o.type}</span></td><td>${o.source}</td><td>${o.owner}</td><td>${score(o.score)}</td><td>${badge(o.status)}</td><td>${o.seen}</td></tr>`))}`,

  vendors: () => `
    ${heading("廠商開發線索", "廠商分數由開團活躍度、品類契合、證據品質與聯絡可行性組成。", actionButtons("approve", "核准為開發名單"))}
    <div class="toolbar"><input class="search" data-search placeholder="搜尋廠商或品類…"><button class="btn btn-secondary" data-action>分數規則</button></div>
    ${table(["廠商","品類","公開開團數","新鮮度","證據數","分數","階段"], vendorLeads.map(v => `<tr><td><span class="strong">${v.name}</span><span class="subtle">尚未建立 ERP 廠商</span></td><td>${v.category}</td><td>${v.activeGroups}</td><td>${v.freshness}</td><td>${v.evidence}</td><td>${score(v.score)}</td><td>${badge(v.stage)}</td></tr>`))}`,

  kols: () => `
    ${heading("KOL 合作線索", "僅收錄公開可見資訊，不收集私人社群、登入後內容或推估銷售額。", actionButtons("approve", "核准為開發名單"))}
    <div class="toolbar"><input class="search" data-search placeholder="搜尋 KOL、平台或垂直品類…"><button class="btn btn-secondary" data-action>平台篩選</button></div>
    ${table(["KOL","公開平台","垂直領域","開團頻率","公開聯絡方式","分數","階段"], kolLeads.map(k => `<tr><td><span class="strong">${k.name}</span><span class="subtle">合成示範資料</span></td><td>${k.platform}</td><td>${k.niche}</td><td>${k.cadence}</td><td>${k.contact}</td><td>${score(k.score)}</td><td>${badge(k.stage)}</td></tr>`))}`,

  review: () => {
    const pending = observations.filter(o => /待審核|待補/.test(o.status));
    return `${heading("人工審核佇列", "系統只提出候選；人工確認後才可進入開發名單或 ERP dry-run。", actionButtons("approve", "批次核准"))}
      <div class="notice">名稱相似不等於同一對象。系統禁止只依名稱自動合併，必須檢查來源證據與穩定識別碼。</div>
      ${table(["優先序","觀察","來源","信心分數","建議動作","狀態"], pending.map((o,i) => `<tr><td><span class="badge violet">P${i+1}</span></td><td><span class="strong">${o.title}</span><span class="subtle">${o.id}</span></td><td>${o.source}</td><td>${score(o.score)}</td><td>比對證據並確認實體</td><td>${badge(o.status)}</td></tr>`))}`;
  },

  sources: () => `
    ${heading("資料來源健康度", "公開來源優先；每次擷取皆保留 observed_at、parser_version 與 evidence URL。", actionButtons("source_admin", "新增來源"))}
    ${table(["來源","型態","最近完成","成功率","狀態"], sources.map(s => `<tr><td><span class="strong">${s.name}</span><span class="subtle">公開資料</span></td><td>${s.kind}</td><td>${s.last}</td><td>${s.success}</td><td>${badge(s.status)}</td></tr>`))}`,

  integration: () => `
    ${heading("ERP 整合 Dry-run", "Market Radar 是觀察層；group-buying-operations 仍是廠商、商品、團主與活動的唯一真實來源。", actionButtons("integration_dry_run", "執行 Dry-run"))}
    <div class="notice">公開站不持有 ERP Token、不呼叫寫入 API，也不會自動建立 Vendor / Product / Host / Campaign。</div>
    <div class="integration-flow">
      <div class="flow-card"><strong>1. Observation</strong><span>保留公開來源、時間、原始值與證據。</span></div>
      <div class="flow-card"><strong>2. Review</strong><span>人工去重、驗證與判定開發價值。</span></div>
      <div class="flow-card"><strong>3. Promotion Draft</strong><span>產生 ERP 欄位映射與差異預覽。</span></div>
      <div class="flow-card"><strong>4. Owner Approval</strong><span>未來由 ERP Owner 核准後才可能寫入。</span></div>
    </div>
    <article class="panel" style="margin-top:16px"><div class="panel-head"><h3>本次模擬結果</h3><span>尚未執行</span></div><div class="panel-body"><span class="badge">0 建立</span> <span class="badge">0 更新</span> <span class="badge">0 衝突</span></div></article>`,

  permissions: () => `
    ${heading("角色權限預覽", "入口驗證已從公開展示站移除；每個角色都能看到頁面，但所有寫入一律關閉。")}
    <div class="grid permission-grid">${Object.entries(ROLES).map(([key,value]) => `<article class="panel permission-card ${key === role ? "active" : ""}"><h3>${value.label}</h3><p>${key} · ${value.short}</p><div class="chips">${["view","review","approve","source_admin","integration_dry_run"].map(cap => `<span class="badge ${can(key,cap) ? "green" : ""}">${can(key,cap) ? "✓" : "—"} ${cap}</span>`).join("")}</div></article>`).join("")}</div>
    <div class="notice" style="margin-top:16px">正式內部環境仍應保留身份驗證與後端 RBAC。這個公開站只用來審閱畫面與權限差異，資料為合成內容。</div>`
};

init();
