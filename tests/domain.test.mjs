import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPromotionDraft,
  executeDryRun,
  findMatchCandidates,
  normalizeObservation,
  observationFingerprint,
  parseCsv,
  scoreVendor,
  validatePublicUrl,
} from "../src/domain.mjs";

test("public URL validation blocks unsafe protocols and private networks", () => {
  assert.equal(validatePublicUrl("javascript:alert(1)").ok, false);
  assert.equal(validatePublicUrl("http://127.0.0.1/admin").code, "PRIVATE_IP_BLOCKED");
  assert.equal(validatePublicUrl("http://169.254.169.254/latest/meta-data").ok, false);
  assert.equal(validatePublicUrl("http://100.64.0.1/internal").ok, false);
  assert.equal(validatePublicUrl("http://203.0.113.8/example").ok, false);
  assert.equal(validatePublicUrl("https://example.com/product?utm_source=x&id=1#top").normalizedUrl, "https://example.com/product?id=1");
});

test("normalization and fingerprint are deterministic", () => {
  const a = normalizeObservation({ source_url: "https://EXAMPLE.com/item?utm_campaign=x", entity_type: "product", title: "  商品 Ａ ", product_name: "商品 A" });
  const b = normalizeObservation({ source_url: "https://example.com/item", entity_type: "PRODUCT", title: "商品 A", product_name: "商品 A" });
  assert.equal(a.source_url, b.source_url);
  assert.equal(observationFingerprint(a), observationFingerprint(b));
});

test("CSV parser supports quoted commas and escaped quotes", () => {
  const rows = parseCsv('title,source_url,notes\n"商品, A",https://example.com/a,"他說""可以"""\n');
  assert.deepEqual(rows, [{ title: "商品, A", source_url: "https://example.com/a", notes: '他說"可以"' }]);
});

test("name-only duplicate remains a review candidate and never auto-merges", () => {
  const current = { observation_id: "obs-2", source_url: "https://example.com/b", vendor_name: "同名品牌", public_email: null, platform: null, platform_handle: null };
  const prior = { observation_id: "obs-1", source_url: "https://example.com/a", vendor_name: "同名品牌", public_email: null, platform: null, platform_handle: null };
  const [candidate] = findMatchCandidates(current, [prior]);
  assert.equal(candidate.confidence, 0.45);
  assert.deepEqual(candidate.conflicts, ["NAME_ONLY_MATCH_NOT_ALLOWED"]);
  assert.equal(candidate.status, "POSSIBLE");
});

test("score breakdown preserves UNKNOWN instead of inventing zero data", () => {
  const result = scoreVendor({ canonical_name: "品牌", observation_count: 2, evidence_count: 2, category: null, public_email: null, source_url: "https://example.com", last_observed_at: new Date().toISOString() });
  assert.equal(result.breakdown.category_fit.points, null);
  assert.equal(result.breakdown.category_fit.status, "UNKNOWN");
  assert.ok(result.data_sufficiency < 100);
});

test("ERP dry-run links only by stable public evidence and rejects name-only matches", () => {
  const lead = { lead_id: "lead-1", lead_type: "VENDOR", canonical_name: "同名品牌", metadata: { source_url: "https://new.example.com", public_email: null }, source_observation_ids: ["obs-1"] };
  const observation = { observation_id: "obs-1", source_url: "https://new.example.com", observed_at: "2026-11-04T00:00:00Z" };
  const draft = buildPromotionDraft(lead, [observation]);
  const result = executeDryRun(draft, { vendors: [{ id: "VEN-1", display_name: "同名品牌", website_url: "https://different.example.com" }], hosts: [] });
  assert.equal(result.result, "CONFLICT");
  assert.equal(result.would_update, false);
  assert.equal(result.conflicts[0].reason, "NAME_ONLY_MATCH_NOT_ALLOWED");
});
