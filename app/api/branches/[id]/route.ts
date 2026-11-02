import { NextResponse } from "next/server";
import { apiError, HttpError, optionalImageUrl, readJson, requireRole, requiredText, requiredUuid } from "@/lib/api";
import { withTransaction } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireRole("admin");
    const { id: rawId } = await context.params;
    const branchId = requiredUuid(rawId, "Sucursal");
    const body = await readJson(request);

    const branch = await withTransaction(async (client) => {
      const currentResult = await client.query(
        "SELECT id, code, name, address, phone, email, image_url, delivery_zone, active FROM branches WHERE id = $1 FOR UPDATE",
        [branchId],
      );
      const current = currentResult.rows[0];
      if (!current) throw new HttpError("La sucursal no existe.", 404);
      const code = body.code === undefined ? current.code : requiredText(body.code, "Código", 24).toUpperCase();
      const name = body.name === undefined ? current.name : requiredText(body.name, "Nombre de sucursal");
      const address = optionalText(body.address, current.address, "Dirección", 240);
      const phone = optionalText(body.phone, current.phone, "Teléfono", 60);
      const email = optionalText(body.email, current.email, "Correo", 254);
      const imageUrl = optionalImageUrl(body.imageUrl, "Imagen", current.image_url);
      const deliveryZone = optionalText(body.deliveryZone, current.delivery_zone, "Zona de entrega", 160);
      const active = body.active === undefined ? current.active : body.active;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Correo de sucursal no válido.");
      if (typeof active !== "boolean") throw new HttpError("El estado debe ser verdadero o falso.");

      const result = await client.query(
        `UPDATE branches SET code = $2, name = $3, address = $4, phone = $5, email = $6,
           image_url = $7, delivery_zone = $8, active = $9, updated_at = now()
         WHERE id = $1 RETURNING id, code, name, address, phone, email, image_url, delivery_zone, active`,
        [branchId, code, name, address, phone, email, imageUrl, deliveryZone, active],
      );
      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'branch.updated', 'branch', $2, $3)`,
        [user.id, branchId, JSON.stringify({ code, name, imageUrl, deliveryZone, active })],
      );
      return result.rows[0];
    });
    return NextResponse.json(branch);
  } catch (error) {
    return apiError(error);
  }
}

function optionalText(value: unknown, fallback: string, label: string, maxLength: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new HttpError(`${label} debe ser texto de hasta ${maxLength} caracteres.`);
  }
  return value.trim();
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireRole("admin");
    const { id: rawId } = await context.params;
    const branchId = requiredUuid(rawId, "Sucursal");

    const outcome = await withTransaction(async (client) => {
      const found = await client.query("SELECT id, name FROM branches WHERE id = $1 FOR UPDATE", [branchId]);
      const branch = found.rows[0];
      if (!branch) throw new HttpError("La sucursal no existe.", 404);

      await client.query("SAVEPOINT branch_delete");
      try {
        // El registro de auditoría se conserva; solo se desvincula de la sucursal borrada.
        await client.query("UPDATE audit_log SET branch_id = NULL WHERE branch_id = $1", [branchId]);
        await client.query("DELETE FROM branch_cameras WHERE branch_id = $1", [branchId]);
        await client.query("DELETE FROM branch_prices WHERE branch_id = $1", [branchId]);
        await client.query("DELETE FROM inventory_lots WHERE branch_id = $1", [branchId]);
        await client.query("DELETE FROM inventory WHERE branch_id = $1", [branchId]);
        await client.query("DELETE FROM branches WHERE id = $1", [branchId]);
        await client.query("RELEASE SAVEPOINT branch_delete");
        return { deleted: true, archived: false, name: branch.name };
      } catch (error) {
        if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "23503") throw error;
        // Tiene ventas, movimientos, pedidos o usuarios asignados: no se puede borrar sin perder historial.
        await client.query("ROLLBACK TO SAVEPOINT branch_delete");
        await client.query("UPDATE branches SET active = false, updated_at = now() WHERE id = $1", [branchId]);
        return { deleted: false, archived: true, name: branch.name };
      }
    });

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, NULL, $2, 'branch', $3, $4)`,
        [user.id, outcome.deleted ? "branch.deleted" : "branch.archived", branchId, JSON.stringify({ name: outcome.name })],
      );
    });
    return NextResponse.json(outcome);
  } catch (error) {
    return apiError(error);
  }
}
