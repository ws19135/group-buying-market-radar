import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RadarDatabase } from "./src/database.mjs";
import { PublicPageCollector } from "./src/collector.mjs";
import { LEAD_TYPES, REVIEW_ACTIONS, newId, parseImportPayload, sha256, validatePublicUrl } from "./src/domain.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_DB = join(ROOT, ".data", "market-radar.sqlite");
const DEFAULT_ERP_SNAPSHOT = JSON.parse(readFileSync(join(ROOT, "fixtures", "erp-master-snapshot.json"), "utf8"));
const BODY_LIMIT = 1_000_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
};

const CAPABILITIES = {
  SYSTEM_ADMIN: new Set(["view", "review", "approve", "source_admin", "integration_dry_run"]),
  OPS_MANAGER: new Set(["view", "review", "approve", "integration_dry_run"]),
  OPS_EDITOR: new Set(["view", "review"]),
  FINANCE: new Set(["view"]),
  VENDOR: new Set(["view"]),
  HOST: new Set(["view"]),
};

function sendJson(response, status, payload, requestId) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, error, requestId) {
  const status = Number(error.status) || 500;
  const code = error.code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
  sendJson(response, status, { error: { code, message: status >= 500 ? "伺服器處理失敗" : error.message }, request_id: requestId }, requestId);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("請求內容超過 1 MB"), { status: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("JSON 格式不正確"), { status: 400, code: "INVALID_JSON" }); }
}

function actorContext(request) {
  const role = String(request.headers["x-role"] || "OPS_MANAGER").toUpperCase();
  if (!CAPABILITIES[role]) throw Object.assign(new Error("未知角色"), { status: 403, code: "UNKNOWN_ROLE" });
  return { actorRole: role, requestId: String(request.headers["x-request-id"] || newId("req")) };
}

function requireCapability(context, capability) {
  if (!CAPABILITIES[context.actorRole]?.has(capability)) {
    throw Object.assign(new Error("此角色沒有執行這項作業的權限"), { status: 403, code: "FORBIDDEN" });
  }
}

function queryOptions(url) {
  return Object.fromEntries(url.searchParams.entries());
}

export function createRadarServer({
  databaseFile = process.env.MR_DATABASE_FILE || DEFAULT_DB,
  seedDemo = process.env.MR_SEED_DEMO !== "false",
  writeEnabled = process.env.MR_SANDBOX_WRITE_ENABLED !== "false",
  erpSnapshot = DEFAULT_ERP_SNAPSHOT,
  collector = new PublicPageCollector(),
} = {}) {
  const database = new RadarDatabase(databaseFile);
  if (seedDemo) database.seedDemo();

  const server = createServer(async (request, response) => {
    const requestId = String(request.headers["x-request-id"] || newId("req"));
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        const context = actorContext(request);
        context.requestId = requestId;
        if (request.method !== "GET" && request.method !== "HEAD" && !writeEnabled) {
          throw Object.assign(new Error("Sandbox 寫入已停用"), { status: 403, code: "SANDBOX_WRITE_DISABLED" });
        }
        if (request.method === "GET" && url.pathname === "/api/v1/health") {
          const liveCollectors = database.liveCollectorCount();
          return sendJson(response, 200, { status: "ok", mode: "MVP_SANDBOX", mvp_status: "DISCOVERY_FOUNDATION", collector_runtime_available: true, real_market_discovery_enabled: liveCollectors > 0, live_collectors: liveCollectors, write_enabled: writeEnabled, database: "sqlite", production_touched: false, erp_write_enabled: false }, requestId);
        }
        if (request.method === "GET" && url.pathname === "/api/v1/dashboard") {
          requireCapability(context, "view");
          return sendJson(response, 200, database.dashboard(), requestId);
        }
        if (request.method === "GET" && url.pathname === "/api/v1/sources") {
          requireCapability(context, "view");
          return sendJson(response, 200, { items: database.listSources() }, requestId);
        }
        if (request.method === "POST" && url.pathname === "/api/v1/sources") {
          requireCapability(context, "source_admin");
          const body = await readJson(request);
          const validation = validatePublicUrl(body.base_url || "");
          if (!validation.ok) throw Object.assign(new Error(validation.reason), { status: 400, code: validation.code });
          return sendJson(response, 201, database.createSource({ ...body, base_url: validation.normalizedUrl }, context), requestId);
        }
        const sourceCollectMatch = url.pathname.match(/^\/api\/v1\/sources\/([^/]+)\/collect$/);
        if (request.method === "POST" && sourceCollectMatch) {
          requireCapability(context, "source_admin");
          const body = await readJson(request);
          const sourceId = decodeURIComponent(sourceCollectMatch[1]);
          const source = database.getSource(sourceId);
          if (!source) throw Object.assign(new Error("找不到資料來源"), { status: 404, code: "SOURCE_NOT_FOUND" });
          const replay = database.getRunByIdempotencyKey(body.idempotency_key);
          if (replay) return sendJson(response, 200, { replayed: true, run: replay, source, collector: null }, requestId);
          if (source.last_success_at) {
            const nextAllowedAt = new Date(source.last_success_at).getTime() + Number(source.collection_interval_minutes || 1440) * 60_000;
            if (Date.now() < nextAllowedAt) throw Object.assign(new Error("尚未到此來源的下一次允許採集時間"), { status: 429, code: "SOURCE_RATE_LIMITED" });
          }
          try {
            const result = await collector.collect(source);
            const idempotencyKey = body.idempotency_key || sha256({ source_id: sourceId, content_hash: result.content_hash, parser_version: result.parser_version });
            const imported = database.importObservations(result.records, {
              sourceId,
              idempotencyKey,
              allowEmpty: true,
              runMetadata: {
                target_url: result.fetched_url,
                query_text: body.query || null,
                parser_version: result.parser_version,
                content_hash: result.content_hash,
                fetched_at: result.observed_at,
              },
              ...context,
            });
            const updatedSource = database.markCollectionSuccess(sourceId, { robotsStatus: result.robots_status, robotsCheckedAt: result.robots_checked_at }, context);
            return sendJson(response, 201, { ...imported, source: updatedSource, collector: { parser_version: result.parser_version, fetched_url: result.fetched_url, emitted_count: result.records.length } }, requestId);
          } catch (error) {
            database.markCollectionFailure(sourceId, error, context);
            database.recordCollectionFailure(sourceId, {
              idempotencyKey: body.idempotency_key || sha256({ source_id: sourceId, request_id: requestId, failed_at: new Date().toISOString() }),
              error,
              runMetadata: { target_url: source.base_url, query_text: body.query || null, parser_version: source.parser_version },
            }, context);
            throw error;
          }
        }
        if (request.method === "GET" && url.pathname === "/api/v1/observations") {
          requireCapability(context, "view");
          return sendJson(response, 200, database.listObservations({ query: url.searchParams.get("query") || "", entityType: url.searchParams.get("entity_type") || "", status: url.searchParams.get("status") || "", page: url.searchParams.get("page") || 1, pageSize: url.searchParams.get("page_size") || 50 }), requestId);
        }
        if (request.method === "POST" && url.pathname === "/api/v1/observations") {
          requireCapability(context, "review");
          const body = await readJson(request);
          return sendJson(response, 201, database.createObservation(body, context), requestId);
        }
        const observationMatch = url.pathname.match(/^\/api\/v1\/observations\/([^/]+)$/);
        if (request.method === "GET" && observationMatch) {
          requireCapability(context, "view");
          const item = database.getObservation(decodeURIComponent(observationMatch[1]));
          if (!item) throw Object.assign(new Error("找不到 Observation"), { status: 404, code: "OBSERVATION_NOT_FOUND" });
          return sendJson(response, 200, item, requestId);
        }
        if (request.method === "POST" && url.pathname === "/api/v1/imports") {
          requireCapability(context, "review");
          const body = await readJson(request);
          const records = parseImportPayload(String(body.format || "json").toLowerCase(), body.payload ?? body.records);
          return sendJson(response, 201, database.importObservations(records, { sourceId: body.source_id, idempotencyKey: body.idempotency_key, ...context }), requestId);
        }
        if (request.method === "GET" && url.pathname === "/api/v1/runs") {
          requireCapability(context, "view");
          return sendJson(response, 200, { items: database.listRuns() }, requestId);
        }
        if (request.method === "POST" && url.pathname === "/api/v1/leads/rebuild") {
          requireCapability(context, "review");
          return sendJson(response, 200, database.rebuildLeads(context), requestId);
        }
        if (request.method === "GET" && url.pathname === "/api/v1/leads") {
          requireCapability(context, "view");
          const leadType = String(url.searchParams.get("lead_type") || "").toUpperCase();
          if (leadType && !LEAD_TYPES.has(leadType)) throw Object.assign(new Error("不支援的 lead_type"), { status: 400, code: "INVALID_LEAD_TYPE" });
          return sendJson(response, 200, { items: database.listLeads({ leadType, stage: url.searchParams.get("stage") || "" }) }, requestId);
        }
        const reviewMatch = url.pathname.match(/^\/api\/v1\/leads\/([^/]+)\/review$/);
        if (request.method === "POST" && reviewMatch) {
          const body = await readJson(request);
          const action = String(body.action || "").toUpperCase();
          if (!REVIEW_ACTIONS.has(action)) throw Object.assign(new Error("不支援的審核動作"), { status: 400, code: "INVALID_REVIEW_ACTION" });
          if (action === "SUBMIT") requireCapability(context, "review"); else requireCapability(context, "approve");
          return sendJson(response, 200, database.reviewLead(decodeURIComponent(reviewMatch[1]), { action, reason: body.reason, ...context }), requestId);
        }
        if (request.method === "GET" && url.pathname === "/api/v1/reviews") {
          requireCapability(context, "view");
          return sendJson(response, 200, { items: database.listReviews() }, requestId);
        }
        const promotionCreate = url.pathname.match(/^\/api\/v1\/leads\/([^/]+)\/promotion-drafts$/);
        if (request.method === "POST" && promotionCreate) {
          requireCapability(context, "integration_dry_run");
          return sendJson(response, 201, database.createPromotionDraft(decodeURIComponent(promotionCreate[1]), context), requestId);
        }
        if (request.method === "GET" && url.pathname === "/api/v1/promotion-drafts") {
          requireCapability(context, "view");
          return sendJson(response, 200, { items: database.listPromotions() }, requestId);
        }
        const dryRunMatch = url.pathname.match(/^\/api\/v1\/promotion-drafts\/([^/]+)\/dry-run$/);
        if (request.method === "POST" && dryRunMatch) {
          requireCapability(context, "integration_dry_run");
          return sendJson(response, 200, database.executePromotionDryRun(decodeURIComponent(dryRunMatch[1]), erpSnapshot, context), requestId);
        }
        if (request.method === "GET" && url.pathname === "/api/v1/audit") {
          requireCapability(context, "approve");
          return sendJson(response, 200, { items: database.listAudit({ limit: url.searchParams.get("limit") || 100 }) }, requestId);
        }
        throw Object.assign(new Error("API 路由不存在"), { status: 404, code: "ROUTE_NOT_FOUND" });
      }

      if (!["GET", "HEAD"].includes(request.method)) throw Object.assign(new Error("不支援的方法"), { status: 405, code: "METHOD_NOT_ALLOWED" });
      const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const normalizedPath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
      const filePath = resolve(ROOT, normalizedPath);
      const resolvedRoot = resolve(ROOT);
      if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${sep}`)) throw Object.assign(new Error("路徑不合法"), { status: 400, code: "INVALID_PATH" });
      let stat;
      try { stat = statSync(filePath); } catch { throw Object.assign(new Error("找不到頁面"), { status: 404, code: "NOT_FOUND" }); }
      if (!stat.isFile() || normalizedPath.startsWith(".data") || normalizedPath.startsWith("src/")) throw Object.assign(new Error("找不到頁面"), { status: 404, code: "NOT_FOUND" });
      const headers = {
        "content-type": MIME[extname(filePath)] || "application/octet-stream",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      };
      response.writeHead(200, headers);
      if (request.method === "HEAD") return response.end();
      response.end(readFileSync(filePath));
    } catch (error) {
      sendError(response, error, requestId);
    }
  });

  server.database = database;
  server.closeDatabase = () => database.close();
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentValue = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const managedPreview = process.argv.includes("--strictPort");
  const port = Number(argumentValue("--port") || process.env.PORT || 4173);
  const host = argumentValue("--host") || process.env.HOST || (process.env.SITES_MANAGED_LINUX_CONTAINER === "1" ? "0.0.0.0" : "127.0.0.1");
  const databaseFile = process.env.MR_DATABASE_FILE || (managedPreview ? join(tmpdir(), "market-radar-preview.sqlite") : DEFAULT_DB);
  const server = createRadarServer({ databaseFile });
  server.listen(port, host, () => {
    console.log(`Market Radar MVP Sandbox: http://${host}:${port}`);
    console.log("Production touched: NO | ERP write enabled: NO");
  });
}
