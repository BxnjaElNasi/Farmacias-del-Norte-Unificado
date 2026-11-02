export type UserRole = "admin" | "employee";

export const USER_ROLES: readonly UserRole[];
export function isUserRole(role: unknown): role is UserRole;
export function canAccessBranch(role: UserRole, userBranchId: string | null, branchId: string): boolean;
export function canManageCatalog(role: UserRole): boolean;
export function canManageInventory(role: UserRole): boolean;
