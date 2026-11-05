import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRadarServer } from "../server.mjs";

async function withServer(fn, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "market-radar-"));
  const server = createRadarServer({ databaseFile: join(directory, "test.sqlite"), seedDemo: false, ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try { await fn({ base, server }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    server.closeDatabase();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function api(base, path, { method = "GET", role = "OPS_MANAGER", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-role": role, "x-request-id": "req-test" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

test("health describes an isolated MVP sandbox with ERP writes disabled", async () => withServer(async ({ base }) => {
  const result = await api(base, "/api/v1/health");
  assert.equal(result.status, 200);
  assert.equal(result.payload.mode, "MVP_SANDBOX");
  assert.equal(result.payload.mvp_status, "M2_DISCOVERY_READY");
  assert.equal(result.payload.collector_runtime_available, true);
  assert.equal(result.payload.real_market_discovery_enabled, false);
  assert.equal(result.payload.live_collectors, 0);
  assert.equal(result.payload.erp_write_enabled, false);
  assert.equal(result.payload.production_touched, false);
}));

test("approved public source can collect, preserve run metadata and replay safely", async () => {
  const collector = {
    async collect(source) {
      return {
        records: [{
          source_url: source.base_url,
          entity_type: "PRODUCT",
          title: "山海燕麥脆片限時開團",
          product_name: "山海燕麥脆片 6 入組",
          vendor_name: "山海食品",
          host_name: "好物研究室",
          platform: "market.example",
          price_amount: 1080,
          observed_at: "2026-11-04T12:00:00.000Z",
          parser_version: "public-page-1.0.0",
          status: "ACTIVE_OR_RECENT",
        }],
        robots_status: "ALLOWED",
        robots_checked_at: "2026-11-04T12:00:00.000Z",
        fetched_url: source.base_url,
        content_hash: "fixture-hash",
        parser_version: "public-page-1.0.0",
        observed_at: "2026-11-04T12:00:00.000Z",
      };
    },
  };
  await withServer(async ({ base }) => {
    const sourceResult = await api(base, "/api/v1/sources", { method: "POST", role: "SYSTEM_ADMIN", body: {
      name: "公開團購頁",
      type: "PUBLIC_GROUP_BUY_PAGE",
      base_url: "https://market.example/group/oat",
      policy_status: "APPROVED",
      terms_status: "REVIEWED_PUBLIC",
      access_mode: "PUBLIC_NO_LOGIN",
      scrape_allowed: true,
      review_notes: "公開頁，不需登入",
    } });
    assert.equal(sourceResult.status, 201);
    const sourceId = sourceResult.payload.source.source_id;

    const health = await api(base, "/api/v1/health");
    assert.equal(health.payload.real_market_discovery_enabled, true);
    assert.equal(health.payload.live_collectors, 1);

    const collected = await api(base, `/api/v1/sources/${sourceId}/collect`, { method: "POST", role: "SYSTEM_ADMIN", body: { idempotency_key: "collect-fixture-1" } });
    assert.equal(collected.status, 201);
    assert.equal(collected.payload.run.created_count, 1);
    assert.equal(collected.payload.source.robots_status, "ALLOWED");

    const feed = await api(base, "/api/v1/discovery-feed");
    assert.equal(feed.status, 200);
    assert.equal(feed.payload.summary.total, 1);
    assert.equal(feed.payload.summary.active, 1);
    assert.equal(feed.payload.items[0].product_name, "山海燕麥脆片 6 入組");

    const replayed = await api(base, `/api/v1/sources/${sourceId}/collect`, { method: "POST", role: "SYSTEM_ADMIN", body: { idempotency_key: "collect-fixture-1" } });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.payload.replayed, true);

    const runs = await api(base, "/api/v1/runs");
    assert.equal(runs.payload.items[0].target_url, "https://market.example/group/oat");
    assert.equal(runs.payload.items[0].run_parser_version, "public-page-1.0.0");
  }, { collector });
});

test("MVP flow imports observations, rebuilds leads, reviews, audits and dry-runs", async () => withServer(async ({ base }) => {
  const forbiddenSource = await api(base, "/api/v1/sources", { method: "POST", role: "OPS_EDITOR", body: { name: "來源", base_url: "https://example.com" } });
  assert.equal(forbiddenSource.status, 403);

  const sourceResult = await api(base, "/api/v1/sources", { method: "POST", role: "SYSTEM_ADMIN", body: { name: "公開品牌頁", type: "MANUAL_URL", base_url: "https://example.com/", policy_status: "APPROVED" } });
  assert.equal(sourceResult.status, 201);
  const sourceId = sourceResult.payload.source.source_id;

  const blocked = await api(base, "/api/v1/observations", { method: "POST", role: "OPS_EDITOR", body: { source_url: "http://127.0.0.1/internal", entity_type: "VENDOR", vendor_name: "內網" } });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.payload.error.code, "PRIVATE_IP_BLOCKED");

  const observation = {
    source_id: sourceId,
    source_url: "https://example.com/group/alpha",
    entity_type: "VENDOR",
    title: "晨光食品",
    vendor_name: "晨光食品",
    host_name: "好物研究室",
    category: "食品飲料",
    public_email: "sales@example.com"
  };
  const created = await api(base, "/api/v1/observations", { method: "POST", role: "OPS_EDITOR", body: observation });
  assert.equal(created.status, 201);
  assert.equal(created.payload.created, true);
  const duplicate = await api(base, "/api/v1/observations", { method: "POST", role: "OPS_EDITOR", body: observation });
  assert.equal(duplicate.payload.duplicate, true);

  const csv = "source_url,entity_type,title,vendor_name,host_name,category\nhttps://example.com/group/beta,PRODUCT,商品B,晨光食品,好物研究室,食品飲料\nhttps://example.com/group/gamma,KOL,親子慢生活,沐光日用,親子慢生活,親子用品\n";
  const imported = await api(base, "/api/v1/imports", { method: "POST", role: "OPS_EDITOR", body: { format: "csv", payload: csv, source_id: sourceId, idempotency_key: "import-1" } });
  assert.equal(imported.status, 201);
  assert.equal(imported.payload.run.status, "COMPLETED");
  assert.equal(imported.payload.run.created_count, 2);
  const replay = await api(base, "/api/v1/imports", { method: "POST", role: "OPS_EDITOR", body: { format: "csv", payload: csv, source_id: sourceId, idempotency_key: "import-1" } });
  assert.equal(replay.payload.replayed, true);

  const rebuilt = await api(base, "/api/v1/leads/rebuild", { method: "POST", role: "OPS_EDITOR" });
  assert.equal(rebuilt.status, 200);
  assert.ok(rebuilt.payload.total >= 3);
  const leads = await api(base, "/api/v1/leads?lead_type=VENDOR");
  const lead = leads.payload.items.find(item => item.canonical_name === "晨光食品");
  assert.ok(lead);
  assert.equal(lead.score_version, "1.0.0");

  const forbiddenApprove = await api(base, `/api/v1/leads/${lead.lead_id}/review`, { method: "POST", role: "OPS_EDITOR", body: { action: "APPROVE", reason: "證據完整" } });
  assert.equal(forbiddenApprove.status, 403);
  const approved = await api(base, `/api/v1/leads/${lead.lead_id}/review`, { method: "POST", role: "OPS_MANAGER", body: { action: "APPROVE", reason: "公開來源與聯絡方式已確認" } });
  assert.equal(approved.payload.lead.stage, "APPROVED");

  const promotion = await api(base, `/api/v1/leads/${lead.lead_id}/promotion-drafts`, { method: "POST", role: "OPS_MANAGER" });
  assert.equal(promotion.status, 201);
  assert.equal(promotion.payload.draft.requested_mode, "DRY_RUN");
  const dryRun = await api(base, `/api/v1/promotion-drafts/${promotion.payload.draft.promotion_draft_id}/dry-run`, { method: "POST", role: "OPS_MANAGER" });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.payload.dry_run_result.would_update, false);

  const audit = await api(base, "/api/v1/audit", { role: "SYSTEM_ADMIN" });
  assert.equal(audit.status, 200);
  assert.ok(audit.payload.items.some(item => item.action === "PROMOTION_DRY_RUN_COMPLETED"));
}));

test("API exposes no hard-delete route", async () => withServer(async ({ base }) => {
  const result = await api(base, "/api/v1/observations/anything", { method: "DELETE", role: "SYSTEM_ADMIN" });
  assert.equal(result.status, 404);
}));

test("M3 to M6 flow aggregates products and KOLs, enriches vendors and assigns prospects", async () => withServer(async ({ base }) => {
  const sourceResult = await api(base, "/api/v1/sources", { method: "POST", role: "SYSTEM_ADMIN", body: {
    name: "公開團購測試頁", type: "MANUAL_URL", base_url: "https://market.example/", policy_status: "APPROVED"
  } });
  const sourceId = sourceResult.payload.source.source_id;
  const records = [
    { source_url: "https://market.example/a", entity_type: "CAMPAIGN", title: "山海燕麥脆片", product_name: "山海燕麥脆片 6 入", brand: "山海", vendor_name: "山海食品", public_email: "sales@mountain.example", host_name: "好物研究室", platform: "Instagram", platform_handle: "good.lab", starts_at: "2026-11-05T00:00:00.000Z", status: "ACTIVE_OR_RECENT" },
    { source_url: "https://market.example/b", entity_type: "CAMPAIGN", title: "山海燕麥脆片", product_name: "山海燕麥脆片 6 入", brand: "山海", vendor_name: "山海食品", public_email: "sales@mountain.example", host_name: "親子慢生活", platform: "Instagram", platform_handle: "slow.family", starts_at: "2026-11-06T00:00:00.000Z", status: "UPCOMING" },
    { source_url: "https://market.example/c", entity_type: "CAMPAIGN", title: "山海燕麥脆片", product_name: "山海燕麥脆片 6 入", vendor_name: "山海食品", public_email: "sales@mountain.example", host_name: "團購媽媽", platform: "Instagram", platform_handle: "group.mom", starts_at: "2026-11-07T00:00:00.000Z", status: "UPCOMING" },
  ];
  const imported = await api(base, "/api/v1/imports", { method: "POST", role: "OPS_EDITOR", body: { format: "json", records, source_id: sourceId, idempotency_key: "m3-m6-flow" } });
  assert.equal(imported.status, 201);
  assert.equal(imported.payload.graph.processed_observations, 3);

  const products = await api(base, "/api/v1/products");
  assert.equal(products.status, 200);
  assert.equal(products.payload.items.length, 2);
  const stableProduct = products.payload.items.find(item => item.identity_basis === "BRAND_AND_EXACT_PRODUCT");
  assert.equal(stableProduct.event_count, 2);
  assert.equal(stableProduct.kol_count, 2);
  const stableDetail = await api(base, `/api/v1/products/${stableProduct.product_id}`);
  assert.equal(stableDetail.payload.kols.length, 2);
  assert.equal(stableDetail.payload.events.every(item => item.source_url.startsWith("https://market.example/")), true);

  const nameOnlyProduct = products.payload.items.find(item => item.identity_basis === "OBSERVATION_SCOPED");
  const nameOnlyDetail = await api(base, `/api/v1/products/${nameOnlyProduct.product_id}`);
  assert.equal(nameOnlyDetail.payload.match_candidates.length, 1);
  const matchId = nameOnlyDetail.payload.match_candidates[0].product_match_id;
  const merged = await api(base, `/api/v1/product-matches/${matchId}/review`, { method: "POST", role: "OPS_MANAGER", body: { action: "MERGE" } });
  assert.equal(merged.status, 200);
  assert.equal(merged.payload.match.status, "APPROVED");
  const activeProducts = await api(base, "/api/v1/products");
  assert.equal(activeProducts.payload.items.length, 1);
  assert.equal(activeProducts.payload.items[0].event_count, 3);
  assert.equal(activeProducts.payload.items[0].kol_count, 3);

  const mergedDetail = await api(base, `/api/v1/products/${merged.payload.product.product_id}`);
  const scopedAlias = mergedDetail.payload.aliases.find(item => item.match_basis === "OBSERVATION_SCOPED");
  assert.ok(scopedAlias);
  const split = await api(base, `/api/v1/product-aliases/${scopedAlias.alias_id}/split`, { method: "POST", role: "OPS_MANAGER", body: {} });
  assert.equal(split.status, 200);
  assert.notEqual(split.payload.product.product_id, merged.payload.product.product_id);
  const splitProducts = await api(base, "/api/v1/products");
  assert.equal(splitProducts.payload.items.length, 2);

  const vendors = await api(base, "/api/v1/vendor-candidates");
  const vendor = vendors.payload.items.find(item => item.display_name === "山海食品");
  assert.ok(vendor);
  const enriched = await api(base, `/api/v1/vendor-candidates/${vendor.vendor_id}/enrichment`, { method: "PATCH", role: "OPS_EDITOR", body: {
    display_name: "山海食品", website_url: "https://brand.example/", collaboration_url: "https://brand.example/partners", public_business_email: "sales@mountain.example", region: "台灣", evidence_source_url: "https://brand.example/about", confidence: 0.98
  } });
  assert.equal(enriched.status, 200);
  assert.equal(enriched.payload.status, "ENRICHED");
  assert.ok(enriched.payload.evidence.length >= 4);

  const prospect = await api(base, `/api/v1/vendor-candidates/${vendor.vendor_id}/prospects`, { method: "POST", role: "OPS_EDITOR", body: { priority: "HIGH", next_action_at: "2026-11-10T01:00:00.000Z", note: "先確認合作窗口" } });
  assert.equal(prospect.status, 201);
  assert.equal(prospect.payload.created, true);
  const replayed = await api(base, `/api/v1/vendor-candidates/${vendor.vendor_id}/prospects`, { method: "POST", role: "OPS_EDITOR", body: { priority: "HIGH" } });
  assert.equal(replayed.payload.created, false);
  const prospectId = prospect.payload.prospect.prospect_id;
  const forbiddenAssign = await api(base, `/api/v1/prospects/${prospectId}`, { method: "PATCH", role: "OPS_EDITOR", body: { owner_id: "host-amy", stage: "ASSIGNED" } });
  assert.equal(forbiddenAssign.status, 403);
  const assigned = await api(base, `/api/v1/prospects/${prospectId}`, { method: "PATCH", role: "OPS_MANAGER", body: { owner_id: "host-amy", stage: "ASSIGNED", priority: "URGENT", note: "本週優先接洽" } });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.payload.owner_id, "host-amy");
  assert.equal(assigned.payload.stage, "ASSIGNED");
  const activity = await api(base, `/api/v1/prospects/${prospectId}/activities`, { method: "POST", role: "OPS_EDITOR", body: { action_type: "NOTE", note: "已整理公開合作資料" } });
  assert.equal(activity.status, 201);
  const pipeline = await api(base, "/api/v1/prospects?owner_id=host-amy", { role: "OPS_MANAGER" });
  assert.equal(pipeline.payload.items.length, 1);
  assert.equal(pipeline.payload.summary.stages.ASSIGNED, 1);

  const health = await api(base, "/api/v1/health");
  assert.equal(health.payload.mvp_status, "M6_PIPELINE_READY");
  assert.equal(health.payload.market_graph.kol_product_relations, 3);
  const audit = await api(base, "/api/v1/audit", { role: "SYSTEM_ADMIN" });
  for (const action of ["PRODUCT_MATCH_MERGE", "PRODUCT_ALIAS_SPLIT", "VENDOR_PUBLIC_DATA_ENRICHED", "DEVELOPMENT_PROSPECT_CREATED", "DEVELOPMENT_PROSPECT_UPDATED", "DEVELOPMENT_ACTIVITY_ADDED"]) {
    assert.ok(audit.payload.items.some(item => item.action === action), action);
  }
}));
