import { NextResponse } from "next/server";
import { apiError, HttpError, readJson, requireRole, requiredText, requiredUuid } from "@/lib/api";
import { withTransaction } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireRole("admin");
    const { id: rawId } = await context.params;
    const movementId = requiredUuid(rawId, "Movimiento");
    const body = await readJson(request);
    const reason = requiredText(body.reason, "Motivo", 240);
    const updated = await withTransaction(async (client) => {
      const currentResult = await client.query(
        `SELECT id, branch_id, movement_type, reason, created_at
         FROM stock_movements WHERE id = $1 FOR UPDATE`,
        [movementId],
      );
      const current = currentResult.rows[0];
      if (!current) throw new HttpError("El movimiento no existe.", 404);
      if (!["in", "out", "loss"].includes(current.movement_type)) {
        throw new HttpError("Este movimiento no admite edición; registra una corrección trazable.");
      }
      const age = Date.now() - new Date(current.created_at).getTime();
      if (age > 7 * 24 * 60 * 60 * 1000) throw new HttpError("Solo se pueden editar los motivos de movimientos de los últimos 7 días.");
      const result = await client.query(
        `UPDATE stock_movements SET reason = $2, edited_by = $3, updated_at = now()
         WHERE id = $1 RETURNING id, reason, updated_at`,
        [movementId, reason, user.id],
      );
      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'inventory.movement_reason_edited', 'stock_movement', $3, $4)`,
        [user.id, current.branch_id, movementId, JSON.stringify({ oldReason: current.reason, reason })],
      );
      return result.rows[0];
    });
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}
