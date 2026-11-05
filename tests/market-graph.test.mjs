import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProspectTransition,
  kolIdentity,
  normalizeProspectPriority,
  productIdentity,
  vendorIdentity,
} from "../src/market-graph.mjs";

test("product identity only auto-merges with stable evidence", () => {
  const stable = productIdentity({ observation_id: "obs-1", product_name: "燕麥脆片 6 入", brand: "山海", raw_payload: {} });
  assert.equal(stable.auto_merge, true);
  assert.equal(stable.basis, "BRAND_AND_EXACT_PRODUCT");
  const nameOnly = productIdentity({ observation_id: "obs-2", product_name: "燕麥脆片 6 入", raw_payload: {} });
  assert.equal(nameOnly.auto_merge, false);
  assert.equal(nameOnly.value, "obs-2");
});

test("vendor and KOL identities prefer stable public evidence", () => {
  assert.equal(vendorIdentity({ public_email: "Sales@Brand.example" }, "product-1").basis, "PUBLIC_BUSINESS_EMAIL");
  const kol = kolIdentity({ observation_id: "obs-1", platform: "Instagram", platform_handle: "@host.demo" });
  assert.equal(kol.basis, "PLATFORM_HANDLE");
  assert.equal(kol.match_status, "STABLE");
});

test("development pipeline validates priorities and stage transitions", () => {
  assert.equal(normalizeProspectPriority("high"), "HIGH");
  assert.equal(assertProspectTransition("PLANNED", "ASSIGNED"), "ASSIGNED");
  assert.throws(() => assertProspectTransition("PLANNED", "WON"), error => error.code === "INVALID_PROSPECT_TRANSITION");
});
