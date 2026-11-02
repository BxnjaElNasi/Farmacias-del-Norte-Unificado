import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hashSessionToken, LEGACY_SESSION_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { isDatabaseConfigured, withDb } from "@/lib/db";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const tokens = [SESSION_COOKIE, LEGACY_SESSION_COOKIE]
      .map((name) => cookieStore.get(name)?.value)
      .filter((token): token is string => Boolean(token))
      .map(hashSessionToken);
    if (tokens.length && isDatabaseConfigured()) {
      await withDb((client) =>
        client.query("DELETE FROM user_sessions WHERE token_hash = ANY($1::text[])", [tokens]),
      );
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    response.cookies.delete(LEGACY_SESSION_COOKIE);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
