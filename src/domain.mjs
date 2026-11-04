import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";

export const CONTRACT_VERSION = "0.1";
export const NORMALIZATION_VERSION = "1.0.0";
export const SCORE_VERSION = "1.0.0";
export const PARSER_VERSION = "manual-1.0.0";

export const ENTITY_TYPES = new Set(["PRODUCT", "VENDOR", "KOL", "CAMPAIGN"]);
export const LEAD_TYPES = new Set(["VENDOR", "KOL"]);
export const REVIEW_ACTIONS = new Set(["SUBMIT", "APPROVE", "REJECT", "NEEDS_MORE_DATA", "IGNORE"]);

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^192\.0\.0\./,
  /^192\.0\.2\./,
  /^198\.(1[89])\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^(22[4-9]|23\d|24\d|25[0-5])\./,
];

export function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

export function normalizeKey(value) {
  return normalizeText(value)?.toLocaleLowerCase("zh-Hant").replace(/[\s\-–—_·・,，.。()（）]/g, "") || null;
}

export function normalizeHandle(value) {
  const text = normalizeText(value);
  return text ? text.replace(/^@/, "").toLowerCase() : null;
}

export function normalizeEmail(value) {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

export function normalizeUrl(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const url = new URL(text);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  [...url.searchParams.keys()].forEach(key => {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  });
  url.searchParams.sort();
  return url.toString();
}

export function validatePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "INVALID_URL", reason: "URL 格式不正確" };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, code: "UNSUPPORTED_PROTOCOL", reason: "只允許 HTTP／HTTPS" };
  }
  if (url.username || url.password) {
    return { ok: false, code: "URL_CREDENTIALS_BLOCKED", reason: "URL 不得包含帳密" };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "localhost.localdomain"].includes(hostname) || hostname.endsWith(".local")) {
    return { ok: false, code: "PRIVATE_HOST_BLOCKED", reason: "不得使用本機或內網網址" };
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && PRIVATE_IPV4.some(pattern => pattern.test(hostname))) {
    return { ok: false, code: "PRIVATE_IP_BLOCKED", reason: "不得使用私有或保留 IPv4" };
  }
  if (ipVersion === 6 && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:"))) {
    return { ok: false, code: "PRIVATE_IP_BLOCKED", reason: "不得使用私有或保留 IPv6" };
  }
  if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") {
    return { ok: false, code: "METADATA_IP_BLOCKED", reason: "不得存取雲端 metadata" };
  }
  return { ok: true, normalizedUrl: normalizeUrl(url.toString()) };
}

export function normalizeObservation(input) {
  const sourceUrl = validatePublicUrl(input.source_url || input.sourceUrl || "");
  if (!sourceUrl.ok) throw Object.assign(new Error(sourceUrl.reason), { code: sourceUrl.code, status: 400 });
  const entityType = normalizeText(input.entity_type || input.entityType || "PRODUCT")?.toUpperCase();
  if (!ENTITY_TYPES.has(entityType)) throw Object.assign(new Error("不支援的 observation entity_type"), { code: "INVALID_ENTITY_TYPE", status: 400 });
  const normalized = {
    entity_type: entityType,
    source_url: sourceUrl.normalizedUrl,
    title: normalizeText(input.title),
    brand: normalizeText(input.brand),
    product_name: normalizeText(input.product_name || input.productName),
    vendor_name: normalizeText(input.vendor_name || input.vendorName),
    host_name: normalizeText(input.host_name || input.hostName),
    platform: normalizeText(input.platform),
    platform_handle: normalizeHandle(input.platform_handle || input.platformHandle),
    category: normalizeText(input.category),
    public_email: normalizeEmail(input.public_email || input.publicEmail),
    starts_at: normalizeDate(input.starts_at || input.startsAt),
    ends_at: normalizeDate(input.ends_at || input.endsAt),
    official_end_date: Boolean(input.official_end_date ?? input.officialEndDate),
    price_amount: normalizeNumber(input.price_amount ?? input.priceAmount),
    currency: normalizeText(input.currency || "TWD")?.toUpperCase(),
    notes: normalizeText(input.notes),
  };
  if (!normalized.title) {
    normalized.title = normalized.product_name || normalized.vendor_name || normalized.host_name || new URL(normalized.source_url).hostname;
  }
  return normalized;
}

function normalizeDate(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/[,，$NTD\s]/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function observationFingerprint(normalized) {
  const stableIdentity = {
    source_url: normalized.source_url,
    entity_type: normalized.entity_type,
    platform_handle: normalized.platform_handle,
    product_name: normalizeKey(normalized.product_name),
    vendor_name: normalizeKey(normalized.vendor_name),
    host_name: normalizeKey(normalized.host_name),
    starts_at: normalized.starts_at,
  };
  return sha256(stableIdentity);
}

export function buildEvidence(observationId, normalized, capturedAt = nowIso()) {
  const fields = ["title", "brand", "product_name", "vendor_name", "host_name", "platform", "platform_handle", "category", "public_email", "starts_at", "ends_at", "price_amount"];
  return fields
    .filter(field => normalized[field] !== null && normalized[field] !== undefined)
    .map(field => ({
      evidence_id: newId("evd"),
      observation_id: observationId,
      field,
      raw_value: String(normalized[field]),
      source_url: normalized.source_url,
      captured_at: capturedAt,
    }));
}

export function findMatchCandidates(observation, existing = []) {
  const candidates = [];
  for (const other of existing) {
    if (other.observation_id === observation.observation_id) continue;
    const reasons = [];
    const conflicts = [];
    let confidence = 0;
    if (observation.source_url === other.source_url) {
      confidence = Math.max(confidence, 0.99);
      reasons.push("SAME_CANONICAL_URL");
    }
    if (observation.public_email && observation.public_email === other.public_email) {
      confidence = Math.max(confidence, 0.96);
      reasons.push("SAME_PUBLIC_EMAIL");
    }
    if (observation.platform_handle && observation.platform === other.platform && observation.platform_handle === other.platform_handle) {
      confidence = Math.max(confidence, 0.94);
      reasons.push("SAME_PLATFORM_HANDLE");
    }
    const names = ["vendor_name", "host_name", "product_name"];
    const sameName = names.some(field => observation[field] && normalizeKey(observation[field]) === normalizeKey(other[field]));
    if (sameName && confidence === 0) {
      confidence = 0.45;
      reasons.push("SAME_DISPLAY_NAME");
      conflicts.push("NAME_ONLY_MATCH_NOT_ALLOWED");
    }
    if (!reasons.length) continue;
    candidates.push({
      candidate_id: newId("match"),
      observation_id: observation.observation_id,
      target_type: "OBSERVATION",
      target_id: other.observation_id,
      confidence,
      reasons,
      conflicts,
      status: confidence >= 0.9 && !conflicts.length ? "REVIEW_REQUIRED" : "POSSIBLE",
      version: NORMALIZATION_VERSION,
    });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function freshnessScore(lastObservedAt, now = new Date()) {
  if (!lastObservedAt) return null;
  const ageDays = Math.max(0, (now.getTime() - new Date(lastObservedAt).getTime()) / 86_400_000);
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.8;
  if (ageDays <= 90) return 0.5;
  if (ageDays <= 180) return 0.25;
  return 0.1;
}

function ratio(value, max) {
  if (value === null || value === undefined) return null;
  return Math.max(0, Math.min(1, Number(value) / max));
}

function weightedScore(metrics, weights) {
  let total = 0;
  const breakdown = {};
  for (const [key, weight] of Object.entries(weights)) {
    const raw = metrics[key];
    const value = raw === null || raw === undefined ? null : Math.max(0, Math.min(1, raw));
    const points = value === null ? null : Math.round(value * weight * 100) / 100;
    breakdown[key] = { value, weight, points, status: value === null ? "UNKNOWN" : "KNOWN" };
    if (points !== null) total += points;
  }
  return { score: Math.round(total), breakdown, data_sufficiency: Math.round(Object.values(breakdown).filter(item => item.status === "KNOWN").length / Object.keys(weights).length * 100) };
}

export function scoreVendor(group) {
  const metrics = {
    activity: ratio(group.observation_count, 8),
    category_fit: group.category ? 1 : null,
    evidence_quality: ratio(group.evidence_count, 8),
    collaboration_feasibility: group.public_email ? 1 : group.source_url ? 0.5 : null,
    freshness: freshnessScore(group.last_observed_at),
    completeness: ratio([group.canonical_name, group.category, group.source_url, group.public_email].filter(Boolean).length, 4),
  };
  return weightedScore(metrics, { activity: 25, category_fit: 20, evidence_quality: 20, collaboration_feasibility: 20, freshness: 10, completeness: 5 });
}

export function scoreKol(group) {
  const metrics = {
    activity: ratio(group.observation_count, 6),
    category_fit: group.category ? 1 : null,
    public_collaboration_method: group.public_email ? 1 : group.source_url ? 0.5 : null,
    evidence_quality: ratio(group.evidence_count, 6),
    freshness: freshnessScore(group.last_observed_at),
    completeness: ratio([group.canonical_name, group.platform, group.platform_handle, group.category, group.public_email].filter(Boolean).length, 5),
  };
  return weightedScore(metrics, { activity: 30, category_fit: 20, public_collaboration_method: 15, evidence_quality: 15, freshness: 10, completeness: 10 });
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header = [], ...data] = rows.filter(item => item.some(cell => cell.trim() !== ""));
  const keys = header.map(key => normalizeText(key));
  return data.map(values => Object.fromEntries(keys.map((key, index) => [key, normalizeText(values[index])])));
}

export function parseImportPayload(format, payload) {
  if (format === "csv") return parseCsv(String(payload || ""));
  if (format === "json") {
    const value = typeof payload === "string" ? JSON.parse(payload) : payload;
    return Array.isArray(value) ? value : value?.records || [value];
  }
  throw Object.assign(new Error("只支援 csv 或 json"), { code: "UNSUPPORTED_IMPORT_FORMAT", status: 400 });
}

export function buildPromotionDraft(lead, observations, matchCandidates = []) {
  const proposedFields = {
    display_name: lead.canonical_name,
    website_url: lead.metadata?.source_url || null,
    public_email: lead.metadata?.public_email || null,
    category: lead.metadata?.category || null,
  };
  const evidence = observations.map(item => ({
    observation_id: item.observation_id,
    source_url: item.source_url,
    observed_at: item.observed_at,
  }));
  const idempotencyKey = sha256({ lead_id: lead.lead_id, target_type: lead.lead_type, proposed_fields: proposedFields, observation_ids: evidence.map(item => item.observation_id).sort() });
  return {
    contract_version: CONTRACT_VERSION,
    promotion_draft_id: newId("promo"),
    idempotency_key: idempotencyKey,
    target_type: lead.lead_type,
    source_lead_id: lead.lead_id,
    proposed_fields: proposedFields,
    evidence,
    match_candidates: matchCandidates,
    requested_mode: "DRY_RUN",
    status: "DRY_RUN_READY",
  };
}

export function executeDryRun(draft, erpSnapshot = { vendors: [], hosts: [] }, executedAt = nowIso()) {
  const collection = draft.target_type === "VENDOR" ? erpSnapshot.vendors || [] : erpSnapshot.hosts || [];
  const proposed = draft.proposed_fields;
  const exactStable = collection.find(item =>
    (proposed.public_email && item.public_email && normalizeEmail(item.public_email) === normalizeEmail(proposed.public_email)) ||
    (proposed.website_url && item.website_url && normalizeUrl(item.website_url) === normalizeUrl(proposed.website_url))
  );
  const nameOnly = collection.find(item => normalizeKey(item.display_name) === normalizeKey(proposed.display_name));
  const missing = [];
  if (!proposed.display_name) missing.push("display_name");
  if (draft.target_type === "VENDOR" && !proposed.website_url && !proposed.public_email) missing.push("website_url_or_public_email");
  const conflicts = [];
  if (!exactStable && nameOnly) conflicts.push({ field: "display_name", reason: "NAME_ONLY_MATCH_NOT_ALLOWED", candidate_erp_id: nameOnly.id });
  let result = "WOULD_CREATE";
  if (missing.length) result = "INCOMPLETE";
  else if (conflicts.length) result = "CONFLICT";
  else if (exactStable) result = "WOULD_LINK_EXISTING";
  return {
    contract_version: CONTRACT_VERSION,
    promotion_draft_id: draft.promotion_draft_id,
    result,
    would_create: result === "WOULD_CREATE",
    would_update: false,
    matched_erp_id: exactStable?.id || null,
    conflicts,
    missing_required_fields: missing,
    executed_at: executedAt,
  };
}
