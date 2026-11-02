import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  LEGACY_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { apiError, HttpError, readJson, requiredText } from "@/lib/api";
import { withTransaction } from "@/lib/db";

const DUMMY_PASSWORD_HASH = hashPassword("timing-protection-only", "4e2c15b940ff7a613a8c3280b42b9c5e");

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email = requiredText(body.email, "Correo", 254).toLowerCase();
    const password = requiredText(body.password, "Contraseña", 256);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Correo no válido.");

    const cookieStore = await cookies();
    const previousSessionHashes = [SESSION_COOKIE, LEGACY_SESSION_COOKIE]
      .map((name) => cookieStore.get(name)?.value)
      .filter((token): token is string => Boolean(token))
      .map(hashSessionToken);
    const sessionToken = createSessionToken();
    const emailHash = createHash("sha256").update(email).digest("hex");
    const userId = await withTransaction(async (client) => {
      const attempts = await client.query(
        "SELECT locked_until > now() AS locked FROM login_attempts WHERE email_hash = $1",
        [emailHash],
      );
      if (attempts.rows[0]?.locked) throw new HttpError("Demasiados intentos. Espera 15 minutos antes de volver a probar.", 429);
      const result = await client.query<{
        id: string;
        password_hash: string;
        active: boolean;
      }>("SELECT id, password_hash, active FROM users WHERE email = $1 LIMIT 1", [email]);
      const candidate = result.rows[0];
      const passwordMatches = verifyPassword(password, candidate?.password_hash ?? DUMMY_PASSWORD_HASH);
      if (!candidate || !candidate.active || !passwordMatches) {
        await client.query(
          `INSERT INTO login_attempts (email_hash, failed_attempts)
           VALUES ($1, 1)
           ON CONFLICT (email_hash) DO UPDATE SET
             failed_attempts = CASE
               WHEN login_attempts.window_started_at <= now() - interval '15 minutes' THEN 1
               ELSE login_attempts.failed_attempts + 1
             END,
             window_started_at = CASE
               WHEN login_attempts.window_started_at <= now() - interval '15 minutes' THEN now()
               ELSE login_attempts.window_started_at
             END,
             locked_until = CASE
               WHEN (CASE
                 WHEN login_attempts.window_started_at <= now() - interval '15 minutes' THEN 1
                 ELSE login_attempts.failed_attempts + 1
               END) >= 5 THEN now() + interval '15 minutes'
               ELSE NULL
             END`,
          [emailHash],
        );
        return null;
      }
      await client.query("DELETE FROM login_attempts WHERE email_hash = $1", [emailHash]);
      await client.query("DELETE FROM user_sessions WHERE expires_at <= now()");
      if (previousSessionHashes.length) {
        await client.query(
          "DELETE FROM user_sessions WHERE token_hash = ANY($1::text[])",
          [previousSessionHashes],
        );
      }
      await client.query(
        `INSERT INTO user_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
        [candidate.id, hashSessionToken(sessionToken), SESSION_TTL_SECONDS],
      );
      return candidate.id;
    });

    if (!userId) throw new HttpError("Correo o contraseña incorrectos.", 401);
    const response = NextResponse.json({ ok: true, user: { id: userId } });
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    return response;
  } catch (error) {
    return apiError(error);
  }
}
