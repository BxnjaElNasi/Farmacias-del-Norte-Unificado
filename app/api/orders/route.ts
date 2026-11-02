import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, branchScopeForUser, HttpError, positiveInteger, readJson, requireRole, requiredText, requiredUuid } from "@/lib/api";
import { withDb, withTransaction } from "@/lib/db";
import { allocateLotsFefo } from "@/lib/stock-math.mjs";

const allowedTransitions: Record<string, string[]> = {
  pending_review: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready_for_pickup", "out_for_delivery", "cancelled"],
  ready_for_pickup: ["completed", "cancelled"],
  out_for_delivery: ["completed", "cancelled"],
};

export async function GET(request: Request) {
  try {
    const user = await requireRole("admin", "employee");
    const requestedBranch = new URL(request.url).searchParams.get("branchId");
    const branchId = branchScopeForUser(user, requestedBranch);
    const orders = await withDb(async (client) => {
      const result = await client.query(
        `SELECT o.id, o.order_number, o.branch_id, b.name AS branch_name, o.status,
                o.fulfillment_mode, o.customer_name, o.customer_email, o.customer_phone,
                o.delivery_address, o.delivery_zone, o.payment_method,
                o.subtotal::float8 AS subtotal, o.total::float8 AS total,
                o.reservation_expires_at, o.created_at,
                coalesce(json_agg(json_build_object(
                  'name', oi.product_name, 'code', oi.internal_code, 'quantity', oi.quantity,
                  'unitPrice', oi.unit_price::float8, 'lineTotal', oi.line_total::float8
                )) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
         FROM online_orders o JOIN branches b ON b.id = o.branch_id
         LEFT JOIN online_order_items oi ON oi.order_id = o.id
         WHERE ($1::uuid IS NULL OR o.branch_id = $1)
         GROUP BY o.id, b.name ORDER BY o.created_at DESC LIMIT 100`,
        [branchId],
      );
      return result.rows;
    });
    return NextResponse.json(orders);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const branchId = requiredUuid(body.branchId, "Sucursal");
    const fulfillmentMode = body.fulfillmentMode;
    if (fulfillmentMode !== "pickup" && fulfillmentMode !== "delivery") {
      throw new HttpError("Selecciona retiro o entrega.");
    }
    const customerName = requiredText(body.customerName, "Nombre", 160);
    const customerEmail = requiredText(body.customerEmail, "Correo", 254).toLowerCase();
    const customerPhone = requiredText(body.customerPhone, "Teléfono", 60);
    const deliveryAddress = fulfillmentMode === "delivery"
      ? requiredText(body.deliveryAddress, "Dirección de entrega", 240)
      : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new HttpError("Correo no válido.");
    const paymentMethod = body.paymentMethod ?? "to_confirm";
    if (!["to_confirm", "cash", "transfer", "card", "mercado_pago"].includes(String(paymentMethod))) {
      throw new HttpError("Selecciona un medio de pago válido.");
    }
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
      throw new HttpError("El pedido debe incluir entre 1 y 30 productos.");
    }
    if (body.privacyConsent !== true) throw new HttpError("Confirma el uso de tus datos para procesar este pedido.");

    const itemMap = new Map<string, number>();
    for (const raw of body.items) {
      if (typeof raw !== "object" || raw === null) throw new HttpError("Hay un producto no válido en el pedido.");
      const item = raw as Record<string, unknown>;
      const productId = requiredUuid(item.productId, "Producto");
      itemMap.set(productId, (itemMap.get(productId) ?? 0) + positiveInteger(item.quantity, "Cantidad", 50));
    }
    const items = [...itemMap].sort(([a], [b]) => a.localeCompare(b));
    const orderNumber = `WEB-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const order = await withTransaction(async (client) => {
      const branchResult = await client.query(
        "SELECT id, name, active, delivery_zone FROM branches WHERE id = $1 FOR SHARE",
        [branchId],
      );
      const branch = branchResult.rows[0];
      if (!branch?.active) throw new HttpError("La sucursal no está disponible.", 404);
      if (fulfillmentMode === "delivery" && !branch.delivery_zone) {
        throw new HttpError("Esta sucursal aún no tiene una zona de entrega configurada.");
      }

      const normalized: Array<{ id: string; name: string; code: string; quantity: number; price: number; total: number }> = [];
      let totalCents = 0;
      for (const [productId, quantity] of items) {
        await client.query(
          `INSERT INTO inventory (branch_id, product_id, quantity) VALUES ($1, $2, 0)
           ON CONFLICT (branch_id, product_id) DO NOTHING`,
          [branchId, productId],
        );
        await client.query(
          "SELECT quantity FROM inventory WHERE branch_id = $1 AND product_id = $2 FOR UPDATE",
          [branchId, productId],
        );
        const productResult = await client.query(
          `SELECT p.id, p.name, p.internal_code, p.requires_prescription, p.online_enabled,
                  coalesce(bp.sale_price, p.sale_price)::float8 AS price,
                  (SELECT coalesce(sum(l.quantity), 0)::int FROM inventory_lots l
                   WHERE l.branch_id = $2 AND l.product_id = p.id AND l.quantity > 0
                     AND (l.expires_on IS NULL OR l.expires_on >= current_date)) AS valid_stock,
                  (SELECT coalesce(sum(oi.quantity), 0)::int
                   FROM online_order_items oi JOIN online_orders o ON o.id = oi.order_id
                   WHERE o.branch_id = $2 AND oi.product_id = p.id
                     AND o.status NOT IN ('cancelled', 'completed')
                     AND (o.status <> 'pending_review' OR o.reservation_expires_at > now())) AS reserved_stock
           FROM products p LEFT JOIN branch_prices bp ON bp.product_id = p.id AND bp.branch_id = $2
           JOIN categories c ON c.id = p.category_id AND c.active = true
           WHERE p.id = $1 AND p.active = true AND p.online_enabled = true
             AND p.requires_prescription = false FOR SHARE OF p`,
          [productId, branchId],
        );
        const product = productResult.rows[0];
        if (!product) throw new HttpError("Uno de los productos no está habilitado para venta online.", 400);
        const available = Number(product.valid_stock) - Number(product.reserved_stock);
        if (available < quantity) throw new HttpError(`No hay stock suficiente de ${product.name} en esa sucursal.`);
        const priceCents = Math.round(Number(product.price) * 100);
        const lineTotalCents = priceCents * quantity;
        totalCents += lineTotalCents;
        normalized.push({
          id: productId,
          name: product.name,
          code: product.internal_code,
          quantity,
          price: priceCents / 100,
          total: lineTotalCents / 100,
        });
      }

      const zone = fulfillmentMode === "delivery" ? String(branch.delivery_zone) : "";
      const created = await client.query(
        `INSERT INTO online_orders
           (order_number, branch_id, fulfillment_mode, customer_name, customer_email, customer_phone,
            delivery_address, delivery_zone, payment_method, subtotal, total, reservation_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, now() + interval '20 minutes')
         RETURNING id, order_number, total::float8 AS total, reservation_expires_at`,
        [orderNumber, branchId, fulfillmentMode, customerName, customerEmail, customerPhone, deliveryAddress, zone, paymentMethod, totalCents / 100],
      );
      const row = created.rows[0];
      for (const item of normalized) {
        await client.query(
          `INSERT INTO online_order_items (order_id, product_id, product_name, internal_code, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [row.id, item.id, item.name, item.code, item.quantity, item.price, item.total],
        );
      }
      await client.query(
        `INSERT INTO online_order_events (order_id, action, details)
         VALUES ($1, 'created', $2)`,
        [row.id, JSON.stringify({ orderNumber, fulfillmentMode, itemCount: normalized.length, total: row.total })],
      );
      return {
        ...row,
        branchName: branch.name,
        status: "pending_review",
        reservationMinutes: 20,
        items: normalized.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.price,
          lineTotal: item.total,
        })),
      };
    });
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireRole("admin", "employee");
    const body = await readJson(request);
    const id = requiredUuid(body.id, "Pedido");
    const status = requiredText(body.status, "Estado", 32);
    const result = await withTransaction(async (client) => {
      const currentResult = await client.query(
        "SELECT id, branch_id, status, order_number, reservation_expires_at FROM online_orders WHERE id = $1 FOR UPDATE",
        [id],
      );
      const current = currentResult.rows[0];
      if (!current) throw new HttpError("El pedido no existe.", 404);
      if (user.branchId && user.branchId !== current.branch_id) throw new HttpError("No tienes acceso a ese pedido.", 403);
      if (!(allowedTransitions[current.status] ?? []).includes(status)) {
        throw new HttpError("El estado seleccionado no es una transición válida.");
      }
      if (current.status === "pending_review" && new Date(current.reservation_expires_at).getTime() <= Date.now()) {
        throw new HttpError("La reserva temporal venció. Cancela este pedido y solicita uno nuevo para verificar el stock.");
      }
      if (status === "completed") {
        const orderItems = await client.query(
          "SELECT product_id, quantity FROM online_order_items WHERE order_id = $1 ORDER BY product_id",
          [id],
        );
        for (const item of orderItems.rows) {
          const inventory = await client.query(
            "SELECT quantity FROM inventory WHERE branch_id = $1 AND product_id = $2 FOR UPDATE",
            [current.branch_id, item.product_id],
          );
          if (!inventory.rows[0] || Number(inventory.rows[0].quantity) < Number(item.quantity)) {
            throw new HttpError("No hay existencias suficientes para completar el pedido.");
          }
          const lots = await client.query(
            `SELECT id, quantity, expires_on, created_at FROM inventory_lots
             WHERE branch_id = $1 AND product_id = $2 AND quantity > 0
               AND (expires_on IS NULL OR expires_on >= current_date)
             ORDER BY expires_on ASC NULLS LAST, created_at ASC FOR UPDATE`,
            [current.branch_id, item.product_id],
          );
          const otherReservations = await client.query(
            `SELECT coalesce(sum(oi.quantity), 0)::int AS quantity
             FROM online_order_items oi JOIN online_orders o ON o.id = oi.order_id
             WHERE o.branch_id = $1 AND oi.product_id = $2 AND o.id <> $3
               AND o.status NOT IN ('cancelled', 'completed')
               AND (o.status <> 'pending_review' OR o.reservation_expires_at > now())`,
            [current.branch_id, item.product_id, id],
          );
          const validStock = lots.rows.reduce((total, lot) => total + Number(lot.quantity), 0);
          if (validStock - Number(otherReservations.rows[0].quantity) < Number(item.quantity)) {
            throw new HttpError("El stock disponible no alcanza para completar este pedido.");
          }
          const allocation = allocateLotsFefo(lots.rows.map((lot) => ({
            id: lot.id,
            quantity: Number(lot.quantity),
            expiresOn: lot.expires_on,
            createdAt: lot.created_at,
          })), Number(item.quantity));
          if (allocation.remaining > 0) throw new HttpError("No hay lotes vigentes suficientes para completar el pedido.");
          for (const entry of allocation.allocations) {
            await client.query("UPDATE inventory_lots SET quantity = quantity - $1 WHERE id = $2", [entry.quantity, entry.lotId]);
            await client.query(
              `INSERT INTO stock_movements (branch_id, product_id, lot_id, user_id, movement_type, quantity, reason, reference_id)
               VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7)`,
              [current.branch_id, item.product_id, entry.lotId, user.id, -entry.quantity, `Pedido online ${current.order_number}`, id],
            );
          }
          await client.query(
            `UPDATE inventory SET quantity = quantity - $3, updated_at = now()
             WHERE branch_id = $1 AND product_id = $2`,
            [current.branch_id, item.product_id, item.quantity],
          );
        }
      }
      const updated = await client.query(
        "UPDATE online_orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status",
        [id, status],
      );
      await client.query(
        `INSERT INTO online_order_events (order_id, actor_user_id, action, details)
         VALUES ($1, $2, 'status_changed', $3)`,
        [id, user.id, JSON.stringify({ orderNumber: current.order_number, from: current.status, to: status })],
      );
      return updated.rows[0];
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
