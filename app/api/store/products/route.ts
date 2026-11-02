import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { withDb } from "@/lib/db";

export async function GET() {
  try {
    const products = await withDb(async (client) => {
      const result = await client.query(
        `WITH valid_lot_stock AS (
           SELECT l.branch_id, l.product_id, sum(l.quantity)::int AS quantity
           FROM inventory_lots l
           JOIN branches b ON b.id = l.branch_id AND b.active = true
           WHERE l.quantity > 0 AND (l.expires_on IS NULL OR l.expires_on >= current_date)
           GROUP BY l.branch_id, l.product_id
         ),
         reservations AS (
           SELECT o.branch_id, oi.product_id, sum(oi.quantity)::int AS quantity
           FROM online_order_items oi JOIN online_orders o ON o.id = oi.order_id
           WHERE o.status NOT IN ('cancelled', 'completed')
             AND (o.status <> 'pending_review' OR o.reservation_expires_at > now())
           GROUP BY o.branch_id, oi.product_id
         ),
         available_by_branch AS (
           SELECT p.id AS product_id, b.id AS branch_id, b.name AS branch_name,
                  greatest(0, v.quantity - coalesce(r.quantity, 0))::int AS quantity,
                  coalesce(bp.sale_price, p.sale_price)::float8 AS price
           FROM products p
           JOIN inventory i ON i.product_id = p.id
           JOIN branches b ON b.id = i.branch_id AND b.active = true
           JOIN valid_lot_stock v ON v.branch_id = i.branch_id AND v.product_id = p.id
           LEFT JOIN reservations r ON r.branch_id = b.id AND r.product_id = p.id
           LEFT JOIN branch_prices bp ON bp.branch_id = b.id AND bp.product_id = p.id
           WHERE greatest(0, v.quantity - coalesce(r.quantity, 0)) > 0
         ),
         available_products AS (
           SELECT product_id,
                  json_agg(json_build_object(
                    'branchId', branch_id,
                    'name', branch_name,
                    'quantity', quantity,
                    'price', price
                  ) ORDER BY branch_name) AS branches
           FROM available_by_branch
           GROUP BY product_id
         )
         SELECT p.id, p.internal_code, p.name, p.category_id, c.name AS category,
                p.presentation, p.manufacturer, p.cover_image_url, p.online_description,
                p.online_featured, a.branches
         FROM products p JOIN categories c ON c.id = p.category_id AND c.active = true
         JOIN available_products a ON a.product_id = p.id
         WHERE p.active = true AND p.online_enabled = true AND p.requires_prescription = false
         ORDER BY p.online_featured DESC, p.name LIMIT 300`,
      );
      return result.rows;
    });
    return NextResponse.json(products);
  } catch (error) {
    return apiError(error);
  }
}
