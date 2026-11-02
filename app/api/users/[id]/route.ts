import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { apiError, HttpError, readJson, requireRole, requiredText, requiredUuid } from "@/lib/api";
import { withTransaction } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const administrator = await requireRole("admin");
    const { id: rawId } = await context.params;
    const userId = requiredUuid(rawId, "Usuario");
    const body = await readJson(request);

    const updated = await withTransaction(async (client) => {
      const currentResult = await client.query(
        "SELECT id, email, full_name, role, branch_id, active FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      const current = currentResult.rows[0];
      if (!current) throw new HttpError("El usuario no existe.", 404);
      const email = body.email === undefined ? current.email : requiredText(body.email, "Correo", 254).toLowerCase();
      const fullName = body.fullName === undefined ? current.full_name : requiredText(body.fullName, "Nombre completo", 160);
      const active = body.active === undefined ? current.active : body.active;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Correo no válido.");
      if (typeof active !== "boolean") throw new HttpError("El estado debe ser verdadero o falso.");
      if (administrator.id === userId && !active) throw new HttpError("No puedes desactivar tu propia cuenta.");
      if (current.role === "admin" && current.active && !active) {
        await client.query("SELECT pg_advisory_xact_lock(118203, 1)");
        const activeAdmins = await client.query(
          "SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND active = true",
        );
        if (Number(activeAdmins.rows[0].count) <= 1) {
          throw new HttpError("No puedes desactivar al último usuario administrador activo.");
        }
      }
      const branchId = current.role === "admin"
        ? null
        : body.branchId === undefined
          ? current.branch_id
          : requiredUuid(body.branchId, "Sucursal");
      if (current.role !== "admin" && branchId !== current.branch_id) {
        const branch = await client.query("SELECT id FROM branches WHERE id = $1 AND active = true", [branchId]);
        if (!branch.rowCount) throw new HttpError("La sucursal no existe o está inactiva.", 404);
      }

      const password = body.password === undefined || body.password === "" ? null : requiredText(body.password, "Contraseña", 256);
      if (password && password.length < 12) throw new HttpError("La contraseña debe tener al menos 12 caracteres.");
      const passwordHash = password ? hashPassword(password) : null;
      const result = await client.query(
        `UPDATE users SET email = $2, full_name = $3, branch_id = $4, active = $5,
           password_hash = coalesce($6, password_hash)
         WHERE id = $1
         RETURNING id, email, full_name, role, branch_id, active`,
        [userId, email, fullName, branchId, active, passwordHash],
      );
      if (!active || password) {
        await client.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
      }
      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'user.updated', 'user', $3, $4)`,
        [
          administrator.id,
          branchId,
          userId,
          JSON.stringify({ email, fullName, active, passwordChanged: Boolean(password) }),
        ],
      );
      return result.rows[0];
    });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}
