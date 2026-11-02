import test from "node:test";
import assert from "node:assert/strict";
import {
  USER_ROLES,
  canAccessBranch,
  canManageCatalog,
  canManageInventory,
  isUserRole,
} from "../lib/role-policy.mjs";

test("the supported account roles are admin and employee only", () => {
  assert.deepEqual(USER_ROLES, ["admin", "employee"]);
  assert.equal(isUserRole("manager"), false);
  assert.equal(isUserRole("admin"), true);
  assert.equal(isUserRole("employee"), true);
});

test("employees can only access their assigned branch while admins can access any branch", () => {
  assert.equal(canAccessBranch("employee", "branch-a", "branch-a"), true);
  assert.equal(canAccessBranch("employee", "branch-a", "branch-b"), false);
  assert.equal(canAccessBranch("employee", null, "branch-a"), false);
  assert.equal(canAccessBranch("admin", null, "branch-b"), true);
});

test("only admins can manage catalog and inventory", () => {
  assert.equal(canManageCatalog("admin"), true);
  assert.equal(canManageInventory("admin"), true);
  assert.equal(canManageCatalog("employee"), false);
  assert.equal(canManageInventory("employee"), false);
});
