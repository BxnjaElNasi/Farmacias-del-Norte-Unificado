import test from "node:test";
import assert from "node:assert/strict";
import { resolveBranchScope } from "../lib/branch-scope.mjs";

test("admins can request one branch or the consolidated all-branches view", () => {
  assert.deepEqual(resolveBranchScope("admin", null, "branch-a"), { allowed: true, branchId: "branch-a" });
  assert.deepEqual(resolveBranchScope("admin", null, null), { allowed: true, branchId: null });
});

test("employees are always restricted to their assigned branch", () => {
  assert.deepEqual(resolveBranchScope("employee", "branch-a", null), { allowed: true, branchId: "branch-a" });
  assert.deepEqual(resolveBranchScope("employee", "branch-a", "branch-a"), { allowed: true, branchId: "branch-a" });
  assert.deepEqual(resolveBranchScope("employee", "branch-a", "branch-b"), { allowed: false, branchId: null });
  assert.deepEqual(resolveBranchScope("employee", null, null), { allowed: false, branchId: null });
});
