export function resolveBranchScope(role, assignedBranchId, requestedBranchId) {
  if (role === "admin") {
    return { allowed: true, branchId: requestedBranchId || null };
  }
  if (
    role === "employee"
    && assignedBranchId
    && (!requestedBranchId || requestedBranchId === assignedBranchId)
  ) {
    return { allowed: true, branchId: assignedBranchId };
  }
  return { allowed: false, branchId: null };
}
