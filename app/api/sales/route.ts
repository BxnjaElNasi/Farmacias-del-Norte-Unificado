import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  apiError,
  branchScopeForUser,
  HttpError,
  nonNegativeMoney,
  positiveInteger,
  readJson,
  requireRole,
  requiredUuid,
  requiredText,
} from "@/lib/api";
import { withDb, withTransaction } from "@/lib/db";
import { allocateLotsFefo } from "@/lib/stock-math.mjs";

type SaleItemInput = { productId: string; quantity: number };

export async function GET(request: Request) {
  try {
    const user = await requireRole("admin", "employee");
    const requestedBranch = new URL(request.url).searchParams.get("branchId");
    const branchId = branchScopeForUser(user, requestedBranch);
    const sales = await withDb(async (client) => {
      const result = await client.query(
        `SELECT s.id, s.transaction_number, s.status, s.payment_method, b.name AS branch_name,
                s.subtotal::float8 AS subtotal,
                s.discount::float8 AS discount, s.total::float8 AS total, s.created_at,
                u.full_name AS cashier,
                coalesce(json_agg(json_build_object(
                  'name', p.name, 'code', p.internal_code, 'quantity', si.quantity,
                  'unitPrice', si.unit_price::float8, 'lineTotal', si.line_total::float8
                ))
                  FILTER (WHERE si.id IS NOT NULL), '[]'::json) AS items
         FROM sales s JOIN users u ON u.id = s.user_id JOIN branches b ON b.id = s.branch_id
         LEFT JOIN sale_items si ON si.sale_id = s.id
         LEFT JOIN products p ON p.id = si.product_id
         WHERE ($1::uuid IS NULL OR s.branch_id = $1)
         GROUP BY s.id, u.full_name, b.name ORDER BY s.created_at DESC LIMIT 50`,
        [branchId],
      );
      return result.rows;
    });
    return NextResponse.json(sales);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRole("admin", "employee");
    const body = await readJson(request);
    const branchId = branchScopeForUser(user, typeof body.branchId === "string" ? body.branchId : null);
    if (!branchId) throw new HttpError("Selecciona una sucursal.", 400);
    const key = requiredText(body.idempotencyKey, "Identificador de operación", 80);
    const paymentMethod = body.paymentMethod;
    if (!["cash", "card", "digital_wallet", "other"].includes(String(paymentMethod))) {
      throw new HttpError("Medio de pago no válido.");
    }
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
      throw new HttpError("La venta debe incluir entre 1 y 50 productos.");
    }
    const itemMap = new Map<string, number>();
    for (const raw of body.items) {
      if (typeof raw !== "object" || raw === null) throw new HttpError("Hay un producto no válido en la venta.");
      const item = raw as Record<string, unknown>;
      const productId = requiredUuid(item.productId, "Producto");
      const quantity = positiveInteger(item.quantity, "Cantidad", 10_000);
      itemMap.set(productId, (itemMap.get(productId) ?? 0) + quantity);
    }
    const items: SaleItemInput[] = [...itemMap].map(([productId, quantity]) => ({ productId, quantity }));
    const discount = body.discount === undefined ? 0 : nonNegativeMoney(body.discount, "Descuento");
    if (discount > 0 && user.role === "employee") {
      throw new HttpError("Solo el gerente general puede autorizar descuentos.", 403);
    }
    const transactionNumber = `V-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const sale = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id, transaction_number, total::float8 AS total FROM sales
         WHERE branch_id = $1 AND idempotency_key = $2 AND user_id = $3`,
        [branchId, key, user.id],
      );
      if (existing.rows[0]) return { ...existing.rows[0], duplicate: true };

      const branch = await client.query("SELECT id FROM branches WHERE id = $1 AND active = true", [branchId]);
      if (!branch.rowCount) throw new HttpError("La sucursal no existe o está inactiva.", 404);

      const normalizedItems: Array<{
        productId: string;
        quantity: number;
        price: number;
        cost: number;
        lineTotal: number;
      }> = [];
      let subtotalCents = 0;
      for (const item of [...items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const product = await client.query(
          `SELECT p.id, p.cost_price::float8 AS cost_price,
                  coalesce(bp.sale_price, p.sale_price)::float8 AS sale_price
           FROM products p LEFT JOIN branch_prices bp ON bp.product_id = p.id AND bp.branch_id = $2
           WHERE p.id = $1 AND p.active = true FOR SHARE OF p`,
          [item.productId, branchId],
        );
        if (!product.rows[0]) throw new HttpError("Uno de los productos no existe o está inactivo.", 404);
        const priceCents = Math.round(Number(product.rows[0].sale_price) * 100);
        const costCents = Math.round(Number(product.rows[0].cost_price) * 100);
        const lineCents = priceCents * item.quantity;
        subtotalCents += lineCents;
        normalizedItems.push({
          productId: item.productId,
          quantity: item.quantity,
          price: priceCents / 100,
          cost: costCents / 100,
          lineTotal: lineCents / 100,
        });
      }

      const subtotal = subtotalCents / 100;
      if (discount > subtotal) throw new HttpError("El descuento no puede superar el subtotal.");
      const total = (subtotalCents - Math.round(discount * 100)) / 100;
      const inserted = await client.query(
        `INSERT INTO sales (transaction_number, branch_id, user_id, payment_method, subtotal, discount, total, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (branch_id, idempotency_key) DO NOTHING
         RETURNING id, transaction_number, total::float8 AS total`,
        [transactionNumber, branchId, user.id, paymentMethod, subtotal, discount, total, key],
      );
      if (!inserted.rows[0]) {
        const duplicate = await client.query(
          `SELECT id, transaction_number, total::float8 AS total FROM sales
           WHERE branch_id = $1 AND idempotency_key = $2 AND user_id = $3`,
          [branchId, key, user.id],
        );
        if (!duplicate.rows[0]) throw new HttpError("La clave de operación ya fue utilizada.", 409);
        return { ...duplicate.rows[0], duplicate: true };
      }
      const createdSale = inserted.rows[0];

      for (const item of normalizedItems) {
        await client.query(
          `INSERT INTO inventory (branch_id, product_id, quantity) VALUES ($1, $2, 0)
           ON CONFLICT (branch_id, product_id) DO NOTHING`,
          [branchId, item.productId],
        );
        const locked = await client.query(
          "SELECT quantity FROM inventory WHERE branch_id = $1 AND product_id = $2 FOR UPDATE",
          [branchId, item.productId],
        );
        if (Number(locked.rows[0].quantity) < item.quantity) {
          throw new HttpError("Stock insuficiente para completar la venta.");
        }
        const lots = await client.query(
          `SELECT id, quantity, expires_on, created_at FROM inventory_lots
           WHERE branch_id = $1 AND product_id = $2 AND quantity > 0
             AND (expires_on IS NULL OR expires_on >= current_date)
           ORDER BY expires_on ASC NULLS LAST, created_at ASC FOR UPDATE`,
          [branchId, item.productId],
        );
        const reservations = await client.query(
          `SELECT coalesce(sum(oi.quantity), 0)::int AS quantity
           FROM online_order_items oi JOIN online_orders o ON o.id = oi.order_id
           WHERE o.branch_id = $1 AND oi.product_id = $2
             AND o.status NOT IN ('cancelled', 'completed')
             AND (o.status <> 'pending_review' OR o.reservation_expires_at > now())`,
          [branchId, item.productId],
        );
        const unreservedQuantity = lots.rows.reduce((total, lot) => total + Number(lot.quantity), 0) - Number(reservations.rows[0].quantity);
        if (unreservedQuantity < item.quantity) {
          throw new HttpError("Parte del stock está reservado para pedidos online.");
        }
        const allocation = allocateLotsFefo(lots.rows.map((lot) => ({
          id: lot.id,
          quantity: Number(lot.quantity),
          expiresOn: lot.expires_on,
          createdAt: lot.created_at,
        })), item.quantity);
        if (allocation.remaining > 0) {
          throw new HttpError("No hay suficientes unidades vigentes por lote para completar la venta.");
        }
        for (const entry of allocation.allocations) {
          await client.query("UPDATE inventory_lots SET quantity = quantity - $1 WHERE id = $2", [entry.quantity, entry.lotId]);
          await client.query(
            `INSERT INTO stock_movements (branch_id, product_id, lot_id, user_id, movement_type, quantity, reason, reference_id)
             VALUES ($1, $2, $3, $4, 'sale', $5, 'Venta', $6)`,
            [branchId, item.productId, entry.lotId, user.id, -entry.quantity, createdSale.id],
          );
        }
        await client.query(
          `UPDATE inventory SET quantity = quantity - $3, updated_at = now()
           WHERE branch_id = $1 AND product_id = $2`,
          [branchId, item.productId, item.quantity],
        );
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, line_total)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [createdSale.id, item.productId, item.quantity, item.price, item.cost, item.lineTotal],
        );
      }

      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'sale.completed', 'sale', $3, $4)`,
        [user.id, branchId, createdSale.id, JSON.stringify({ transactionNumber, total, paymentMethod, discount })],
      );
      return { ...createdSale, duplicate: false };
    });
    return NextResponse.json(sale, { status: sale.duplicate ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
