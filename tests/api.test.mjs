import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRadarServer } from "../server.mjs";

async function withServer(fn) {
  const directory = mkdtempSync(join(tmpdir(), "market-radar-"));
  const server = createRadarServer({ databaseFile: join(directory, "test.sqlite"), seedDemo: false });
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
  assert.equal(result.payload.erp_write_enabled, false);
  assert.equal(result.payload.production_touched, false);
}));

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
