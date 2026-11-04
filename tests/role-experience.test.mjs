import test from "node:test";
import assert from "node:assert/strict";
import { ROLE_EXPERIENCES, canAccessRolePage, pagesForRole } from "../role-experience.js";

test("all six roles have distinct home experiences", () => {
  assert.equal(Object.keys(ROLE_EXPERIENCES).length, 6);
  assert.equal(new Set(Object.values(ROLE_EXPERIENCES).map(item => item.homeTitle)).size, 6);
  assert.equal(new Set(Object.values(ROLE_EXPERIENCES).map(item => item.badge)).size, 6);
});

test("internal roles and external roles receive different navigation", () => {
  assert.equal(canAccessRolePage("SYSTEM_ADMIN", "sources"), true);
  assert.equal(canAccessRolePage("OPS_MANAGER", "review"), true);
  assert.equal(canAccessRolePage("OPS_EDITOR", "integration"), false);
  assert.equal(canAccessRolePage("FINANCE", "observations"), false);
  assert.deepEqual(pagesForRole("VENDOR"), ["overview", "vendors", "permissions"]);
  assert.deepEqual(pagesForRole("HOST"), ["overview", "kols", "permissions"]);
});

test("external role actions are view-only", () => {
  for (const role of ["FINANCE", "VENDOR", "HOST"]) {
    assert.ok(ROLE_EXPERIENCES[role].actions.every(([, capability]) => capability === "view"));
  }
});

