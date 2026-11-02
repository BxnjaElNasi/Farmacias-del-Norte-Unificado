export function resolveBranchScope(
  role: "admin" | "employee",
  assignedBranchId: string | null,
  requestedBranchId: string | null,
): { allowed: boolean; branchId: string | null };
