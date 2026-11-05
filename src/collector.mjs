import { lookup } from "node:dns/promises";
import { isPublicAddress, nowIso, sha256, validatePublicUrl } from "./domain.mjs";

export const COLLECTOR_VERSION = "public-page-1.0.0";
export const LISTING_PARSER_VERSION = "public-listing-1.0.0";
export const BABYBUYRADAR_PARSER_VERSION = "babybuyradar-upcoming-1.0.0";
export const NICKJUFU_PARSER_VERSION = "nickjufu-calendar-1.0.0";
export const COLLECTOR_USER_AGENT = "SDHMarketRadar/0.6 (+public-evidence-only)";
export const MAX_RESPONSE_BYTES = 1_000_000;
export const COLLECTOR_SOURCE_TYPES = new Set([
  "PUBLIC_GROUP_BUY_PAGE",
  "PUBLIC_BRAND_CAMPAIGN",
  "PUBLIC_LISTING",
]);

function collectorError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function asBoolean(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

export function normalizeSourceGovernance(input = {}) {
  const governance = {
    access_mode: String(input.access_mode || "PUBLIC_NO_LOGIN").toUpperCase(),
    login_required: asBoolean(input.login_required),
    terms_status: String(input.terms_status || "PENDING").toUpperCase(),
    robots_status: String(input.robots_status || "UNKNOWN").toUpperCase(),
    review_notes: String(input.review_notes || "").trim() || null,
    owner_name: String(input.owner_name || "").trim() || null,
    collection_interval_minutes: Math.max(15, Math.min(10_080, Number(input.collection_interval_minutes) || 1_440)),
  };
  if (governance.access_mode !== "PUBLIC_NO_LOGIN" || governance.login_required) {
    throw collectorError("只允許不需登入的公開來源", "LOGIN_REQUIRED_SOURCE_BLOCKED");
  }
  return governance;
}

export function assertSourceCanCollect(source) {
  if (!source) throw collectorError("找不到資料來源", "SOURCE_NOT_FOUND", 404);
  if (!source.active) throw collectorError("資料來源已停用", "SOURCE_INACTIVE", 409);
  if (!COLLECTOR_SOURCE_TYPES.has(source.type)) throw collectorError("此來源類型不支援自動採集", "UNSUPPORTED_COLLECTOR_SOURCE", 409);
  if (source.policy_status !== "APPROVED") throw collectorError("來源政策尚未核准", "SOURCE_POLICY_NOT_APPROVED", 409);
  if (!source.scrape_allowed) throw collectorError("來源尚未允許自動採集", "SOURCE_COLLECTION_DISABLED", 409);
  if (source.access_mode !== "PUBLIC_NO_LOGIN" || source.login_required) throw collectorError("禁止採集登入後或封閉內容", "LOGIN_REQUIRED_SOURCE_BLOCKED", 409);
  if (source.terms_status !== "REVIEWED_PUBLIC") throw collectorError("來源條款尚未完成公開資料審查", "SOURCE_TERMS_NOT_REVIEWED", 409);
  if (!source.review_notes?.trim()) throw collectorError("啟用採集前必須留下政策與條款審查紀錄", "SOURCE_REVIEW_NOTES_REQUIRED", 409);
  return source;
}

function stripIpv4Mapped(address) {
  return address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
}

export async function resolveAndValidateHost(hostname, resolveHost = defaultResolveHost) {
  const addresses = await resolveHost(hostname);
  if (!addresses?.length) throw collectorError("來源網域無法解析", "SOURCE_DNS_EMPTY", 502);
  for (const entry of addresses) {
    const address = stripIpv4Mapped(typeof entry === "string" ? entry : entry.address);
    if (!isPublicAddress(address)) throw collectorError("來源網域解析到私有或保留網段", "SOURCE_DNS_PRIVATE_ADDRESS", 400);
  }
  return addresses;
}

async function defaultResolveHost(hostname) {
  try {
    return await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    if (!["EAI_AGAIN", "ECONNREFUSED", "ETIMEOUT"].includes(error?.code)) throw error;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const addresses = [];
      for (const [type, family] of [["A", 4], ["AAAA", 6]]) {
        const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=${type}`, {
          headers: { accept: "application/dns-json" },
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const payload = await response.json();
        for (const answer of payload.Answer || []) {
          if ((answer.type === 1 && family === 4) || (answer.type === 28 && family === 6)) addresses.push({ address: answer.data, family });
        }
      }
      if (addresses.length) return addresses;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function robotsGroups(text) {
  const groups = [];
  let agents = [];
  let rules = [];
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length) {
      rules.push({ type: key, path: value });
    }
  }
  flush();
  return groups;
}

export function isAllowedByRobots(text, pathname, userAgent = COLLECTOR_USER_AGENT) {
  const agent = userAgent.toLowerCase();
  const matching = robotsGroups(text).filter(group => group.agents.some(value => value === "*" || agent.includes(value)));
  const rules = matching.flatMap(group => group.rules).filter(rule => rule.path && pathname.startsWith(rule.path));
  if (!rules.length) return true;
  rules.sort((a, b) => b.path.length - a.path.length || (a.type === "allow" ? -1 : 1));
  return rules[0].type === "allow";
}

function header(response, name) {
  return response.headers?.get?.(name) || "";
}

async function responseTextWithLimit(response, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = Number(header(response, "content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw collectorError("來源回應超過 1 MB", "SOURCE_RESPONSE_TOO_LARGE", 413);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw collectorError("來源回應超過 1 MB", "SOURCE_RESPONSE_TOO_LARGE", 413);
  return buffer.toString("utf8");
}

async function fetchOnce(url, { fetchImpl, resolveHost, timeoutMs, accept }) {
  const validation = validatePublicUrl(url);
  if (!validation.ok) throw collectorError(validation.reason, validation.code);
  const parsed = new URL(validation.normalizedUrl);
  await resolveAndValidateHost(parsed.hostname, resolveHost);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(parsed.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept, "user-agent": COLLECTOR_USER_AGENT },
    });
  } catch (error) {
    if (error?.name === "AbortError") throw collectorError("來源請求逾時", "SOURCE_TIMEOUT", 504);
    throw collectorError("來源無法連線", "SOURCE_FETCH_FAILED", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetchText(url, options) {
  let current = new URL(url);
  const allowedHostname = current.hostname.toLowerCase();
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetchOnce(current, options);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
      await options.sleep(100 * (attempt + 1));
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = header(response, "location");
      if (!location) throw collectorError("來源重新導向缺少位置", "SOURCE_REDIRECT_INVALID", 502);
      const next = new URL(location, current);
      if (next.hostname.toLowerCase() !== allowedHostname) throw collectorError("來源重新導向到未核准網域", "SOURCE_REDIRECT_HOST_BLOCKED", 400);
      current = next;
      continue;
    }
    return { response, url: current.toString(), text: await responseTextWithLimit(response, options.maxBytes) };
  }
  throw collectorError("來源重新導向次數過多", "SOURCE_REDIRECT_LIMIT", 502);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function textContent(html) {
  return decodeHtml(String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function metaMap(html) {
  const map = new Map();
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...match[0].matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)].map(item => [item[1].toLowerCase(), decodeHtml(item[2])]));
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content && !map.has(key)) map.set(key, attrs.content.trim());
  }
  return map;
}

function jsonLdNodes(html) {
  const nodes = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(decodeHtml(match[1]).trim());
      const queue = Array.isArray(value) ? [...value] : [value];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        nodes.push(node);
        if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
      }
    } catch {
      // Invalid third-party JSON-LD is ignored; the fallback parser may still produce a review candidate.
    }
  }
  return nodes;
}

function typeIncludes(node, expected) {
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return types.some(type => String(type || "").toLowerCase() === expected.toLowerCase());
}

function named(value) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return named(value[0]);
  return named(value.name || value.legalName);
}

function firstObject(value) {
  return Array.isArray(value) ? value[0] || {} : value || {};
}

function publicEmail(html) {
  const match = String(html).match(/href\s*=\s*["']mailto:([^?"']+)/i);
  return match ? decodeURIComponent(match[1]).trim() : null;
}

function eventStatus(startsAt, endsAt, observedAt) {
  const now = new Date(observedAt).getTime();
  const start = startsAt ? new Date(startsAt).getTime() : null;
  const end = endsAt ? new Date(endsAt).getTime() : null;
  if (Number.isFinite(end) && end < now) return "ENDED";
  if (Number.isFinite(start) && start > now) return "UPCOMING";
  return "ACTIVE_OR_RECENT";
}

function inferredDate(monthValue, dayValue, observedAt, endOfDay = false) {
  const observed = new Date(observedAt);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return null;
  let year = observed.getUTCFullYear();
  const observedMonth = observed.getUTCMonth() + 1;
  if (month < observedMonth - 6) year += 1;
  if (month > observedMonth + 6) year -= 1;
  const suffix = endOfDay ? "23:59:59" : "00:00:00";
  const parsed = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${suffix}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function datesFromListingText(value, observedAt) {
  const text = String(value || "");
  const range = text.match(/(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*(?:—|–|-|~|至)\s*(\d{1,2})\s*[\/.]\s*(\d{1,2})/);
  if (range) return {
    starts_at: inferredDate(range[1], range[2], observedAt, false),
    ends_at: inferredDate(range[3], range[4], observedAt, true),
    official_end_date: true,
  };
  const end = text.match(/(\d{1,2})\s*[\/.]\s*(\d{1,2})\s*(?:結團|截止)/);
  if (end) return { starts_at: null, ends_at: inferredDate(end[1], end[2], observedAt, true), official_end_date: true };
  const start = text.match(/(?:預計開團日|開團日)?\s*(\d{1,2})\s*[\/.]\s*(\d{1,2})/);
  if (start) return { starts_at: inferredDate(start[1], start[2], observedAt, false), ends_at: null, official_end_date: false };
  return { starts_at: null, ends_at: null, official_end_date: false };
}

function listingStatus(value, dates, observedAt) {
  const text = String(value || "");
  if (/(已結束|已截止)/.test(text)) return "ENDED";
  if (/(即將開團|開團預告|預計開團)/.test(text)) return "UPCOMING";
  if (/(開團中|現正開團|目前開團)/.test(text)) return "ACTIVE_OR_RECENT";
  return dates.starts_at || dates.ends_at ? eventStatus(dates.starts_at, dates.ends_at, observedAt) : "REVIEW_REQUIRED";
}

function absoluteHttpUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function attribute(tag, name) {
  const match = String(tag || "").match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? decodeHtml(match[1]).trim() : null;
}

function classBlocks(html, tagName, className) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
  return [...String(html).matchAll(pattern)];
}

function lastClassTextBefore(html, offset, className) {
  const prefix = String(html).slice(0, offset);
  const pattern = new RegExp(`<[^>]+class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi");
  const matches = [...prefix.matchAll(pattern)];
  return textContent(matches.at(-1)?.[1] || "") || null;
}

function platformHandle(value) {
  return String(value || "").match(/@([a-z0-9._]+)/i)?.[1]?.toLowerCase() || null;
}

export function parseBabyBuyRadarUpcoming(html, { sourceUrl, observedAt = nowIso() } = {}) {
  const validation = validatePublicUrl(sourceUrl || "");
  if (!validation.ok) throw collectorError(validation.reason, validation.code);
  const listingUrl = validation.normalizedUrl;
  const records = [];
  for (const match of classBlocks(html, "article", "upcoming-card")) {
    const block = match[0];
    const title = textContent(block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    const timeTag = block.match(/<time\b[^>]*>/i)?.[0] || "";
    const startsAt = attribute(timeTag, "datetime");
    const hostName = textContent(block.match(/<[^>]+class\s*=\s*["'][^"']*\bsource-handle\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || "");
    const hostAnchor = block.match(/<a\b[^>]*class\s*=\s*["'][^"']*\bsource-badge\b[^"']*["'][^>]*>/i)?.[0] || "";
    const evidenceAnchor = block.match(/<a\b[^>]*class\s*=\s*["'][^"']*\bupcoming-source-link\b[^"']*["'][^>]*>/i)?.[0] || "";
    const hostUrl = absoluteHttpUrl(attribute(hostAnchor, "href"), listingUrl);
    const evidenceUrl = absoluteHttpUrl(attribute(evidenceAnchor, "href"), listingUrl);
    if (!title || !startsAt || !hostName) continue;
    const category = lastClassTextBefore(html, match.index, "upcoming-category-title") || lastClassTextBefore(html, match.index, "category-title");
    records.push({
      source_url: evidenceUrl || listingUrl,
      entity_type: "CAMPAIGN",
      title,
      product_name: title.replace(/(?:開放)?團購(?:囉)?[！!]?$/u, "").trim() || title,
      vendor_name: null,
      host_name: hostName,
      platform: hostUrl?.includes("instagram.com") ? "Instagram" : new URL(listingUrl).hostname,
      platform_handle: platformHandle(hostName),
      category,
      starts_at: startsAt,
      ends_at: null,
      official_end_date: false,
      price_amount: null,
      currency: "TWD",
      notes: `公開開團預告；清單來源 ${listingUrl}`,
      observed_at: observedAt,
      confidence: 0.95,
      status: eventStatus(startsAt, null, observedAt),
      parser_version: BABYBUYRADAR_PARSER_VERSION,
      raw_payload: {
        collector_version: BABYBUYRADAR_PARSER_VERSION,
        source_kind: "BABYBUYRADAR_UPCOMING_CARD",
        listing_url: listingUrl,
        evidence_url: evidenceUrl,
        host_url: hostUrl,
      },
    });
  }
  return records;
}

export function parseNickJufuCalendar(html, { sourceUrl, observedAt = nowIso() } = {}) {
  const validation = validatePublicUrl(sourceUrl || "");
  if (!validation.ok) throw collectorError(validation.reason, validation.code);
  const listingUrl = validation.normalizedUrl;
  const records = [];
  const seen = new Set();
  for (const match of classBlocks(html, "div", "nkgb-item")) {
    const block = match[0];
    const anchor = block.match(/<a\b[^>]*>[\s\S]*?<\/a>/i)?.[0] || "";
    const title = textContent(anchor);
    const evidenceUrl = absoluteHttpUrl(attribute(anchor, "href"), listingUrl);
    const dateText = textContent(block.match(/<[^>]+class\s*=\s*["'][^"']*\bnkgb-date\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || "");
    if (!title || !dateText || !evidenceUrl) continue;
    const key = `${title}\u0000${dateText}\u0000${evidenceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dates = datesFromListingText(dateText, observedAt);
    const category = dates.ends_at ? lastClassTextBefore(html, match.index, "nkgb-cat") : null;
    records.push({
      source_url: evidenceUrl,
      entity_type: "CAMPAIGN",
      title,
      product_name: title.replace(/團購$/u, "").trim() || title,
      vendor_name: null,
      host_name: "主夫尼克 & 攸三",
      platform: new URL(listingUrl).hostname,
      platform_handle: "nickjufu",
      category,
      starts_at: dates.starts_at,
      ends_at: dates.ends_at,
      official_end_date: dates.official_end_date,
      price_amount: null,
      currency: "TWD",
      notes: `公開團購行事曆；清單來源 ${listingUrl}`,
      observed_at: observedAt,
      confidence: dates.starts_at || dates.ends_at ? 0.96 : 0.72,
      status: listingStatus(dateText, dates, observedAt),
      parser_version: NICKJUFU_PARSER_VERSION,
      raw_payload: {
        collector_version: NICKJUFU_PARSER_VERSION,
        source_kind: "NICKJUFU_CALENDAR_ITEM",
        listing_url: listingUrl,
        evidence_url: evidenceUrl,
        date_text: dateText,
      },
    });
  }
  return records;
}

export function parseKnownPublicListing(html, options = {}) {
  const validation = validatePublicUrl(options.sourceUrl || "");
  if (!validation.ok) throw collectorError(validation.reason, validation.code);
  const target = new URL(validation.normalizedUrl);
  if (target.hostname === "babybuyradar.com" && target.pathname.startsWith("/upcoming")) {
    return { records: parseBabyBuyRadarUpcoming(html, options), parser_version: BABYBUYRADAR_PARSER_VERSION };
  }
  if (target.hostname === "nickjufu.tw" && target.pathname.startsWith("/6358")) {
    return { records: parseNickJufuCalendar(html, options), parser_version: NICKJUFU_PARSER_VERSION };
  }
  return { records: [], parser_version: null };
}

function cleanListingTitle(value) {
  return textContent(value)
    .replace(/^\s*(?:已結束|開團中|即將開團|本週新開團)\s*/g, "")
    .replace(/^\s*\d{1,2}\s*[\/.]\s*\d{1,2}\s*(?:—|–|-|~|至)\s*\d{1,2}\s*[\/.]\s*\d{1,2}\s*/g, "")
    .replace(/\s*\d{1,2}\s*[\/.]\s*\d{1,2}\s*(?:結團|截止)\s*$/g, "")
    .trim();
}

export function parsePublicListing(html, { sourceUrl, observedAt = nowIso() } = {}) {
  const validation = validatePublicUrl(sourceUrl || "");
  if (!validation.ok) throw collectorError(validation.reason, validation.code);
  const url = validation.normalizedUrl;
  const meta = metaMap(html);
  const h1 = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const rawHost = meta.get("author") || meta.get("og:site_name") || textContent(h1?.[1] || "");
  const hostName = rawHost && !/^(團購|開團預告|團購時間表)$/i.test(rawHost)
    ? rawHost.replace(/團購\s*\d{4}[\s\S]*$/, "").replace(/團購(?:好物|行事曆|時間表)?\s*$/, "").trim() || rawHost
    : null;
  const genericHeadings = /^(現正開團中|目前開團中總覽|本週新開團|即將開團|開團預告|本月團購|團購時間表|團購)$/;
  const headings = [...String(html).matchAll(/<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const records = [];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const nextOffset = headings[index + 1]?.index ?? Math.min(String(html).length, match.index + match[0].length + 900);
    const contextHtml = String(html).slice(match.index, Math.min(nextOffset, match.index + match[0].length + 900));
    const title = cleanListingTitle(match[2]);
    if (!title || title.length < 2 || genericHeadings.test(title)) continue;
    const contextText = textContent(contextHtml);
    if (!/(團|開團|結團|截止|\d{1,2}\s*[\/.]\s*\d{1,2})/.test(contextText)) continue;
    const dates = datesFromListingText(contextText, observedAt);
    const anchor = contextHtml.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i);
    const outboundUrl = absoluteHttpUrl(anchor?.[1], url);
    const price = contextText.match(/(?:NT\$|NTD|售價|團購價)\s*([\d,]+)/i)?.[1]?.replace(/,/g, "") || null;
    records.push({
      source_url: url,
      entity_type: "CAMPAIGN",
      title,
      product_name: title.replace(/(?:團購|開團|團)\s*$/g, "").trim() || title,
      vendor_name: null,
      host_name: hostName,
      platform: new URL(url).hostname,
      starts_at: dates.starts_at,
      ends_at: dates.ends_at,
      official_end_date: dates.official_end_date,
      price_amount: price,
      currency: "TWD",
      notes: outboundUrl ? `公開清單項目；活動連結 ${outboundUrl}` : "公開清單項目；需人工確認廠商與活動連結",
      observed_at: observedAt,
      confidence: dates.starts_at || dates.ends_at ? 0.78 : 0.6,
      status: listingStatus(contextText, dates, observedAt),
      parser_version: LISTING_PARSER_VERSION,
      raw_payload: { collector_version: LISTING_PARSER_VERSION, source_kind: "PUBLIC_LISTING_HEADING", heading: title, context: contextText.slice(0, 500), outbound_url: outboundUrl },
    });
  }
  return records;
}

function recordFromProduct(node, context) {
  const offer = firstObject(node.offers);
  const vendor = named(node.brand) || named(node.manufacturer) || named(offer.seller);
  const host = named(node.author) || named(node.organizer);
  const startsAt = offer.validFrom || node.startDate || null;
  const endsAt = offer.priceValidUntil || node.endDate || null;
  return {
    source_url: context.url,
    entity_type: "PRODUCT",
    title: named(node) || context.meta.get("og:title") || context.title,
    product_name: named(node) || context.title,
    brand: named(node.brand),
    vendor_name: vendor,
    host_name: host,
    platform: context.hostname,
    category: named(node.category) || node.category || null,
    public_email: context.email,
    starts_at: startsAt,
    ends_at: endsAt,
    official_end_date: Boolean(endsAt),
    price_amount: offer.price ?? offer.lowPrice ?? null,
    currency: offer.priceCurrency || "TWD",
    notes: `公開頁結構化資料；狀態 ${eventStatus(startsAt, endsAt, context.observedAt)}`,
    observed_at: context.observedAt,
    confidence: 0.9,
    status: eventStatus(startsAt, endsAt, context.observedAt),
    parser_version: COLLECTOR_VERSION,
    raw_payload: { collector_version: COLLECTOR_VERSION, source_kind: "JSON_LD_PRODUCT", node },
  };
}

function recordFromEvent(node, context) {
  const offer = firstObject(node.offers);
  const item = firstObject(node.itemOffered || offer.itemOffered);
  const productName = named(item) || named(node);
  const startsAt = node.startDate || offer.validFrom || null;
  const endsAt = node.endDate || offer.priceValidUntil || null;
  return {
    source_url: context.url,
    entity_type: "CAMPAIGN",
    title: named(node) || productName || context.title,
    product_name: productName,
    brand: named(item.brand),
    vendor_name: named(item.brand) || named(item.manufacturer) || named(offer.seller),
    host_name: named(node.organizer) || named(node.performer),
    platform: context.hostname,
    category: named(item.category) || item.category || null,
    public_email: context.email,
    starts_at: startsAt,
    ends_at: endsAt,
    official_end_date: Boolean(endsAt),
    price_amount: offer.price ?? offer.lowPrice ?? null,
    currency: offer.priceCurrency || "TWD",
    notes: `公開活動結構化資料；狀態 ${eventStatus(startsAt, endsAt, context.observedAt)}`,
    observed_at: context.observedAt,
    confidence: 0.9,
    status: eventStatus(startsAt, endsAt, context.observedAt),
    parser_version: COLLECTOR_VERSION,
    raw_payload: { collector_version: COLLECTOR_VERSION, source_kind: "JSON_LD_EVENT", node },
  };
}

export function parsePublicPage(html, { sourceUrl, observedAt = nowIso() } = {}) {
  const validation = validatePublicUrl(sourceUrl || "");
  if (!validation.ok) throw collectorError(validation.reason, validation.code);
  const url = validation.normalizedUrl;
  const meta = metaMap(html);
  const titleMatch = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const context = {
    url,
    hostname: new URL(url).hostname,
    observedAt,
    meta,
    title: decodeHtml(titleMatch?.[1] || "").trim() || null,
    email: publicEmail(html),
  };
  const records = [];
  for (const node of jsonLdNodes(html)) {
    if (typeIncludes(node, "Product")) records.push(recordFromProduct(node, context));
    else if (typeIncludes(node, "Event")) records.push(recordFromEvent(node, context));
  }
  if (!records.length) {
    const pageText = textContent(html);
    const groupBuySignal = /(團購|開團|跟團|團購價|結團|預購)/i.test(pageText);
    const title = meta.get("og:title") || context.title;
    const price = meta.get("product:price:amount") || meta.get("og:price:amount");
    if (groupBuySignal && title) {
      records.push({
        source_url: url,
        entity_type: "PRODUCT",
        title,
        product_name: title,
        vendor_name: meta.get("og:site_name") || null,
        host_name: meta.get("author") || null,
        platform: context.hostname,
        public_email: context.email,
        price_amount: price || null,
        currency: meta.get("product:price:currency") || meta.get("og:price:currency") || "TWD",
        notes: "公開頁文字含開團訊號；需人工確認商品、廠商與團期",
        observed_at: observedAt,
        confidence: 0.55,
        status: "REVIEW_REQUIRED",
        parser_version: COLLECTOR_VERSION,
        raw_payload: { collector_version: COLLECTOR_VERSION, source_kind: "OPEN_GRAPH_FALLBACK", title, price },
      });
    }
  }
  return records;
}

export class PublicPageCollector {
  constructor({ fetchImpl = globalThis.fetch, resolveHost = defaultResolveHost, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 10_000, maxBytes = MAX_RESPONSE_BYTES, clock = () => new Date() } = {}) {
    this.fetchImpl = fetchImpl;
    this.resolveHost = resolveHost;
    this.sleep = sleep;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.clock = clock;
  }

  async collect(source) {
    assertSourceCanCollect(source);
    const target = new URL(source.base_url);
    const options = { fetchImpl: this.fetchImpl, resolveHost: this.resolveHost, sleep: this.sleep, timeoutMs: this.timeoutMs, maxBytes: this.maxBytes };
    const robotsUrl = new URL("/robots.txt", target.origin).toString();
    const robots = await safeFetchText(robotsUrl, { ...options, accept: "text/plain,*/*;q=0.1" });
    let robotsStatus = "NOT_PRESENT";
    if (robots.response.status === 200) {
      robotsStatus = isAllowedByRobots(robots.text, target.pathname) ? "ALLOWED" : "BLOCKED";
      if (robotsStatus === "BLOCKED") throw collectorError("robots.txt 不允許採集此路徑", "ROBOTS_DISALLOWED", 409);
    } else if (robots.response.status !== 404) {
      throw collectorError("無法確認 robots.txt 政策", "ROBOTS_UNAVAILABLE", 502);
    }
    const page = await safeFetchText(target.toString(), { ...options, accept: "text/html,application/xhtml+xml,application/json;q=0.8" });
    if (!page.response.ok) throw collectorError(`來源回應 HTTP ${page.response.status}`, "SOURCE_HTTP_ERROR", 502);
    const contentType = header(page.response, "content-type").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw collectorError("來源內容不是支援的公開 HTML 頁面", "SOURCE_CONTENT_TYPE_UNSUPPORTED", 415);
    }
    const observedAt = nowIso(this.clock);
    const knownListing = source.type === "PUBLIC_LISTING" ? parseKnownPublicListing(page.text, { sourceUrl: page.url, observedAt }) : { records: [], parser_version: null };
    const listingRecords = source.type === "PUBLIC_LISTING" && !knownListing.records.length ? parsePublicListing(page.text, { sourceUrl: page.url, observedAt }) : [];
    const records = knownListing.records.length ? knownListing.records : listingRecords.length ? listingRecords : parsePublicPage(page.text, { sourceUrl: page.url, observedAt });
    const parserVersion = knownListing.records.length ? knownListing.parser_version : listingRecords.length ? LISTING_PARSER_VERSION : COLLECTOR_VERSION;
    return {
      records,
      robots_status: robotsStatus,
      robots_checked_at: observedAt,
      fetched_url: page.url,
      content_hash: sha256(page.text),
      parser_version: parserVersion,
      observed_at: observedAt,
    };
  }
}
