import { normalizeKey, sha256 } from "./domain.mjs";

export const MARKET_GRAPH_VERSION = "1.0.0";
export const PROSPECT_STAGES = Object.freeze(["PLANNED", "ASSIGNED", "CONTACTED", "RESPONDED", "NEGOTIATING", "WON", "LOST", "DO_NOT_CONTACT"]);
export const PROSPECT_PRIORITIES = Object.freeze(["LOW", "MEDIUM", "HIGH", "URGENT"]);

const TERMINAL_STAGES = new Set(["WON", "LOST", "DO_NOT_CONTACT"]);
const STAGE_TRANSITIONS = Object.freeze({
  PLANNED: new Set(["ASSIGNED", "CONTACTED", "DO_NOT_CONTACT"]),
  ASSIGNED: new Set(["PLANNED", "CONTACTED", "DO_NOT_CONTACT"]),
  CONTACTED: new Set(["RESPONDED", "NEGOTIATING", "LOST", "DO_NOT_CONTACT"]),
  RESPONDED: new Set(["CONTACTED", "NEGOTIATING", "LOST", "DO_NOT_CONTACT"]),
  NEGOTIATING: new Set(["RESPONDED", "WON", "LOST", "DO_NOT_CONTACT"]),
  WON: new Set(),
  LOST: new Set(["CONTACTED"]),
  DO_NOT_CONTACT: new Set(),
});

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function productIdentity(observation) {
  const raw = observation.raw_payload || {};
  const stableValue = firstValue(raw, ["gtin", "barcode", "sku", "model", "official_product_url", "officialUrl"])
    || firstValue(raw?.item || raw?.product, ["gtin", "barcode", "sku", "model", "url"]);
  if (stableValue) return { basis: "STABLE_PUBLIC_ID", value: normalizeKey(stableValue), confidence: 0.99, auto_merge: true };
  const productKey = normalizeKey(observation.product_name || observation.title);
  const brandKey = normalizeKey(observation.brand);
  if (productKey && brandKey) return { basis: "BRAND_AND_EXACT_PRODUCT", value: `${brandKey}|${productKey}`, confidence: 0.96, auto_merge: true };
  return { basis: "OBSERVATION_SCOPED", value: observation.observation_id, confidence: 1, auto_merge: false };
}

export function productIdForObservation(observation) {
  const identity = productIdentity(observation);
  return { ...identity, product_id: `product_${sha256(`${identity.basis}:${identity.value}`).slice(0, 20)}` };
}

export function vendorIdentity(observation, productId) {
  const email = normalizeKey(observation.public_email);
  const raw = observation.raw_payload || {};
  const officialUrl = firstValue(raw, ["vendor_official_url", "brand_official_url", "manufacturer_url"]);
  if (email) return { basis: "PUBLIC_BUSINESS_EMAIL", value: email, confidence: 0.99 };
  if (officialUrl) return { basis: "PUBLIC_OFFICIAL_URL", value: normalizeKey(officialUrl), confidence: 0.98 };
  if (observation.vendor_name) return { basis: "OBSERVATION_SCOPED_NAME", value: observation.observation_id, confidence: 0.7 };
  return { basis: "UNKNOWN_FOR_PRODUCT", value: productId, confidence: 0 };
}

export function kolIdentity(observation) {
  const platform = normalizeKey(observation.platform);
  const handle = normalizeKey(observation.platform_handle);
  if (platform && handle) return { basis: "PLATFORM_HANDLE", value: `${platform}|${handle}`, confidence: 0.99, match_status: "STABLE" };
  return { basis: "OBSERVATION_SCOPED_NAME", value: observation.observation_id, confidence: 0.65, match_status: "REVIEW_REQUIRED" };
}

export function deterministicGraphId(prefix, value) {
  return `${prefix}_${sha256(String(value)).slice(0, 20)}`;
}

export function normalizeProspectPriority(value = "MEDIUM") {
  const priority = String(value || "MEDIUM").toUpperCase();
  if (!PROSPECT_PRIORITIES.includes(priority)) throw Object.assign(new Error("不支援的開發優先序"), { status: 400, code: "INVALID_PROSPECT_PRIORITY" });
  return priority;
}

export function normalizeProspectStage(value = "PLANNED") {
  const stage = String(value || "PLANNED").toUpperCase();
  if (!PROSPECT_STAGES.includes(stage)) throw Object.assign(new Error("不支援的開發階段"), { status: 400, code: "INVALID_PROSPECT_STAGE" });
  return stage;
}

export function assertProspectTransition(before, after) {
  const from = normalizeProspectStage(before);
  const to = normalizeProspectStage(after);
  if (from === to) return to;
  if (!STAGE_TRANSITIONS[from]?.has(to)) {
    throw Object.assign(new Error(`不可由 ${from} 直接變更為 ${to}`), { status: 409, code: "INVALID_PROSPECT_TRANSITION" });
  }
  return to;
}

export function isActiveProspectStage(stage) {
  return !TERMINAL_STAGES.has(String(stage || "").toUpperCase());
}
