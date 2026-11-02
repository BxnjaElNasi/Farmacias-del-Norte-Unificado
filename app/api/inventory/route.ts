import { NextResponse } from "next/server";
import {
  apiError,
  branchScopeForUser,
  HttpError,
  positiveInteger,
  readJson,
  requireRole,
  requiredUuid,
  requiredText,
} from "@/lib/api";
import { canManageBranch } from "@/lib/auth";
import { withDb, withTransaction } from "@/lib/db";
import { allocateLotsFefo } from "@/lib/stock-math.mjs";

export async function GET(request: Request) {
  try {
    const user = await requireRole("admin", "employee");
    const url = new URL(request.url);
    const branchId = branchScopeForUser(user, url.searchParams.get("branchId"));
    const data = await withDb(async (client) => {
      const [stock, movements] = await Promise.all([
        client.query(
          `WITH product_stock AS (
             SELECT product_id, sum(quantity)::int AS quantity
             FROM inventory
             WHERE ($1::uuid IS NULL OR branch_id = $1)
             GROUP BY product_id
           )
           SELECT p.id AS product_id, p.internal_code, p.name, p.minimum_stock,
                  product_stock.quantity,
                  coalesce(json_agg(json_build_object(
                    'id', l.id, 'branchId', i.branch_id, 'branchName', b.name,
                    'lotNumber', l.lot_number, 'expiresOn', l.expires_on, 'quantity', l.quantity
                  ) ORDER BY b.name, l.expires_on NULLS LAST, l.created_at)
                    FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS lots
           FROM product_stock
           JOIN products p ON p.id = product_stock.product_id
           JOIN inventory i ON i.product_id = p.id AND ($1::uuid IS NULL OR i.branch_id = $1)
           JOIN branches b ON b.id = i.branch_id
           LEFT JOIN inventory_lots l ON l.branch_id = i.branch_id AND l.product_id = i.product_id AND l.quantity > 0
           WHERE p.active = true
           GROUP BY p.id, product_stock.quantity ORDER BY p.name`,
          [branchId],
        ),
        client.query(
          `SELECT m.id, m.branch_id, m.movement_type, m.quantity, m.reason, m.created_at, m.updated_at,
                  p.name AS product_name, p.internal_code, b.name AS branch_name, b.address AS branch_address,
                  b.phone AS branch_phone, u.full_name AS user_name, l.lot_number,
                  l.expires_on, editor.full_name AS edited_by
           FROM stock_movements m JOIN products p ON p.id = m.product_id
           JOIN branches b ON b.id = m.branch_id JOIN users u ON u.id = m.user_id
           LEFT JOIN inventory_lots l ON l.id = m.lot_id
           LEFT JOIN users editor ON editor.id = m.edited_by
           WHERE m.branch_id = $1 ORDER BY m.created_at DESC LIMIT 50`,
          [branchId],
        ),
      ]);
      return { stock: stock.rows, movements: movements.rows };
    });
    return NextResponse.json(data);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRole("admin");
    const body = await readJson(request);
    const branchId = branchScopeForUser(user, typeof body.branchId === "string" ? body.branchId : null);
    if (!branchId) throw new HttpError("Selecciona una sucursal.", 400);
    if (!canManageBranch(user, branchId)) throw new HttpError("No tienes acceso a esa sucursal.", 403);
    const productId = requiredUuid(body.productId, "Producto");
    const quantity = positiveInteger(body.quantity, "Cantidad");
    const reason = requiredText(body.reason, "Motivo", 240);
    const movementType = body.movementType;
    if (movementType !== "in" && movementType !== "out" && movementType !== "loss") {
      throw new HttpError("Tipo de movimiento no válido.");
    }

    const result = await withTransaction(async (client) => {
      const branch = await client.query("SELECT id FROM branches WHERE id = $1 AND active = true", [branchId]);
      if (!branch.rowCount) throw new HttpError("La sucursal no existe o está inactiva.", 404);
      const product = await client.query("SELECT id FROM products WHERE id = $1 AND active = true", [productId]);
      if (!product.rowCount) throw new HttpError("El producto no existe o está inactivo.", 404);
      await client.query(
        `INSERT INTO inventory (branch_id, product_id, quantity) VALUES ($1, $2, 0)
         ON CONFLICT (branch_id, product_id) DO NOTHING`,
        [branchId, productId],
      );
      const inventory = await client.query(
        "SELECT quantity FROM inventory WHERE branch_id = $1 AND product_id = $2 FOR UPDATE",
        [branchId, productId],
      );
      const before = inventory.rows[0].quantity as number;

      if (movementType === "in") {
        const lotNumber = requiredText(body.lotNumber, "Número de lote", 64);
        const expiresOn = body.expiresOn === null || body.expiresOn === undefined || body.expiresOn === ""
          ? null
          : requiredText(body.expiresOn, "Fecha de vencimiento", 10);
        if (expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || Number.isNaN(Date.parse(`${expiresOn}T00:00:00Z`)) || new Date(`${expiresOn}T00:00:00Z`).toISOString().slice(0, 10) !== expiresOn)) {
          throw new HttpError("La fecha de vencimiento debe tener formato AAAA-MM-DD.");
        }
        const existing = await client.query(
          `SELECT id, expires_on FROM inventory_lots
           WHERE branch_id = $1 AND product_id = $2 AND lot_number = $3 FOR UPDATE`,
          [branchId, productId, lotNumber],
        );
        let lotId: string;
        if (existing.rows[0]) {
          const currentExpiry = existing.rows[0].expires_on ? new Date(existing.rows[0].expires_on).toISOString().slice(0, 10) : null;
          if (currentExpiry !== expiresOn) throw new HttpError("El lote ya existe con otra fecha de vencimiento.");
          lotId = existing.rows[0].id;
          await client.query("UPDATE inventory_lots SET quantity = quantity + $1 WHERE id = $2", [quantity, lotId]);
        } else {
          const lot = await client.query(
            `INSERT INTO inventory_lots (branch_id, product_id, lot_number, expires_on, quantity)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [branchId, productId, lotNumber, expiresOn, quantity],
          );
          lotId = lot.rows[0].id;
        }
        await client.query(
          `INSERT INTO stock_movements (branch_id, product_id, lot_id, user_id, movement_type, quantity, reason)
           VALUES ($1, $2, $3, $4, 'in', $5, $6)`,
          [branchId, productId, lotId, user.id, quantity, reason],
        );
      } else {
        if (before < quantity) throw new HttpError("La cantidad supera el stock disponible.");
        const lots = await client.query(
          `SELECT id, quantity, expires_on, created_at FROM inventory_lots
           WHERE branch_id = $1 AND product_id = $2 AND quantity > 0
           ORDER BY expires_on ASC NULLS LAST, created_at ASC FOR UPDATE`,
          [branchId, productId],
        );
        const reservations = await client.query(
          `SELECT coalesce(sum(oi.quantity), 0)::int AS quantity
           FROM online_order_items oi JOIN online_orders o ON o.id = oi.order_id
           WHERE o.branch_id = $1 AND oi.product_id = $2
             AND o.status NOT IN ('cancelled', 'completed')
             AND (o.status <> 'pending_review' OR o.reservation_expires_at > now())`,
          [branchId, productId],
        );
        const unreservedQuantity = lots.rows.reduce((total, lot) => total + Number(lot.quantity), 0) - Number(reservations.rows[0].quantity);
        if (unreservedQuantity < quantity) throw new HttpError("Parte de las existencias está reservada para pedidos online.");
        const allocation = allocateLotsFefo(lots.rows.map((lot) => ({
          id: lot.id,
          quantity: Number(lot.quantity),
          expiresOn: lot.expires_on,
          createdAt: lot.created_at,
        })), quantity);
        for (const entry of allocation.allocations) {
          await client.query("UPDATE inventory_lots SET quantity = quantity - $1 WHERE id = $2", [entry.quantity, entry.lotId]);
          await client.query(
            `INSERT INTO stock_movements (branch_id, product_id, lot_id, user_id, movement_type, quantity, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [branchId, productId, entry.lotId, user.id, movementType, -entry.quantity, reason],
          );
        }
        if (allocation.remaining > 0) throw new HttpError("Las existencias por lote no coinciden con el inventario; revisa los movimientos.");
      }

      const delta = movementType === "in" ? quantity : -quantity;
      const updated = await client.query(
        `UPDATE inventory SET quantity = quantity + $3, updated_at = now()
         WHERE branch_id = $1 AND product_id = $2 RETURNING quantity::int AS quantity`,
        [branchId, productId, delta],
      );
      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'inventory.adjusted', 'product', $3, $4)`,
        [user.id, branchId, productId, JSON.stringify({ movementType, quantity, reason, before, after: updated.rows[0].quantity })],
      );
      return updated.rows[0];
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
