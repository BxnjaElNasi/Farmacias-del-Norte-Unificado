import { NextResponse } from "next/server";
import { apiError, HttpError, readJson, requireRole, requiredText, requiredUuid } from "@/lib/api";
import { withTransaction, withDb } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "1";
    if (includeInactive) await requireRole("admin");
    const rows = await withDb(async (client) => {
      const result = await client.query(
        `SELECT id, name, active FROM categories
         WHERE $1::boolean OR active = true ORDER BY name`,
        [includeInactive],
      );
      return result.rows;
    });
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRole("admin");
    const body = await readJson(request);
    const name = requiredText(body.name, "Nombre de categoría", 100);
    const category = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO categories (name) VALUES ($1) RETURNING id, name, active`,
        [name],
      );
      await client.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'category.created', 'category', $2, $3)`,
        [user.id, result.rows[0].id, JSON.stringify({ name })],
      );
      return result.rows[0];
    });
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireRole("admin");
    const body = await readJson(request);
    const id = requiredUuid(body.id, "Categoría");
    if (typeof body.active !== "boolean" && typeof body.name !== "string") {
      throw new HttpError("Indica el nombre o estado de la categoría.");
    }
    const category = await withTransaction(async (client) => {
      const current = await client.query(
        "SELECT id, name, active FROM categories WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!current.rows[0]) throw new HttpError("La categoría no existe.", 404);
      const name = body.name === undefined ? current.rows[0].name : requiredText(body.name, "Nombre de categoría", 100);
      const active = body.active === undefined ? current.rows[0].active : body.active;
      if (typeof active !== "boolean") throw new HttpError("El estado debe ser verdadero o falso.");
      const updated = await client.query(
        `UPDATE categories SET name = $2, active = $3, updated_at = now()
         WHERE id = $1 RETURNING id, name, active`,
        [id, name, active],
      );
      await client.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'category.updated', 'category', $2, $3)`,
        [user.id, id, JSON.stringify({ name, active })],
      );
      return updated.rows[0];
    });
    return NextResponse.json(category);
  } catch (error) {
    return apiError(error);
  }
}
