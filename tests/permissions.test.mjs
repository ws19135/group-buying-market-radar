import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, PUBLIC_PREVIEW, can, getRole, actionState } from "../permissions.js";

test("public preview is explicitly enabled", () => assert.equal(PUBLIC_PREVIEW, true));
test("all six role previews are available", () => assert.equal(Object.keys(ROLES).length, 6));
test("manager can approve but editor cannot", () => {
  assert.equal(can("OPS_MANAGER", "approve"), true);
  assert.equal(can("OPS_EDITOR", "approve"), false);
});
test("public preview never enables a mutation", () => {
  assert.equal(actionState("SYSTEM_ADMIN", "source_admin").enabled, false);
  assert.match(actionState("SYSTEM_ADMIN", "source_admin").reason, /不執行寫入/);
});
test("role can be selected by URL and invalid role falls back", () => {
  assert.equal(getRole("?role=FINANCE"), "FINANCE");
  assert.equal(getRole("?role=INVALID"), "OPS_MANAGER");
});
