import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { apiError, HttpError, readJson, requireRole, requiredText, requiredUuid } from "@/lib/api";
import { withDb, withTransaction } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireRole("admin");
    const users = await withDb(async (client) => {
      const result = await client.query(
        `SELECT u.id, u.email, u.full_name, u.role, u.active, u.created_at, u.branch_id, b.name AS branch_name
         FROM users u LEFT JOIN branches b ON b.id = u.branch_id
         ORDER BY u.full_name`,
      );
      return result.rows.map((row) => ({ ...row, isCurrentUser: row.id === user.id }));
    });
    return NextResponse.json(users);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const administrator = await requireRole("admin");
    const body = await readJson(request);
    const email = requiredText(body.email, "Correo", 254).toLowerCase();
    const fullName = requiredText(body.fullName, "Nombre completo", 160);
    const password = requiredText(body.password, "Contraseña inicial", 256);
    const role = body.role;
    const branchId = requiredUuid(body.branchId, "Sucursal");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Correo no válido.");
    if (password.length < 12) throw new HttpError("La contraseña inicial debe tener al menos 12 caracteres.");
    if (role !== "employee") throw new HttpError("El único rol operativo disponible es empleado.");
    const passwordHash = hashPassword(password);

    const created = await withTransaction(async (client) => {
      const branch = await client.query("SELECT id FROM branches WHERE id = $1 AND active = true", [branchId]);
      if (!branch.rowCount) throw new HttpError("La sucursal no existe o está inactiva.", 404);
      const result = await client.query(
        `INSERT INTO users (email, full_name, password_hash, role, branch_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, full_name, role, branch_id, active`,
        [email, fullName, passwordHash, role, branchId],
      );
      const row = result.rows[0];
      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'user.created', 'user', $3, $4)`,
        [administrator.id, branchId, row.id, JSON.stringify({ email, role })],
      );
      return row;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
