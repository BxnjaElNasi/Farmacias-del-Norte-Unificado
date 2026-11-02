import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { isDatabaseConfigured, withDb } from "@/lib/db";
import { canAccessBranch, canManageCatalog, canManageInventory } from "@/lib/role-policy.mjs";
import type { UserRole } from "@/lib/role-policy.mjs";

export { canManageCatalog, canManageInventory };
export type { UserRole };

export const LEGACY_SESSION_COOKIE = "farmacias_session";
export const SESSION_COOKIE = "farmacias_session_v2";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
};

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !isDatabaseConfigured()) return null;

  return withDb(async (client) => {
    const result = await client.query<{
      id: string;
      email: string;
      full_name: string;
      role: UserRole;
      branch_id: string | null;
      branch_name: string | null;
    }>(
      `SELECT u.id, u.email, u.full_name, u.role, u.branch_id, b.name AS branch_name
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id AND u.active = true
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
       LIMIT 1`,
      [hashSessionToken(token)],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      branchId: row.branch_id,
      branchName: row.branch_name,
    };
  });
}

export function canManageBranch(user: SessionUser, branchId: string) {
  return canAccessBranch(user.role, user.branchId, branchId);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}
