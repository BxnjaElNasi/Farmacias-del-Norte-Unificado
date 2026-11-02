export const USER_ROLES = Object.freeze(["admin", "employee"]);

export function isUserRole(role) {
  return USER_ROLES.includes(role);
}

export function canAccessBranch(role, userBranchId, branchId) {
  return role === "admin" || (role === "employee" && userBranchId !== null && userBranchId === branchId);
}

export function canManageCatalog(role) {
  return role === "admin";
}

export function canManageInventory(role) {
  return role === "admin";
}
