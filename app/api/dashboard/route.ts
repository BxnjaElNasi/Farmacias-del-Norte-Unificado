import { NextResponse } from "next/server";
import { apiError, branchScopeForUser, requireRole } from "@/lib/api";
import { withDb } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireRole("admin", "employee");
    const requestedBranch = new URL(request.url).searchParams.get("branchId");
    const branchId = branchScopeForUser(user, requestedBranch);
    const data = await withDb(async (client) => {
      const filter = "$1::uuid IS NULL OR branch_id = $1";
      const [
        summary,
        lowStock,
        expiring,
        expired,
        movements,
        dailySales,
        branchSales,
        topProducts,
      ] = await Promise.all([
        client.query(
          `SELECT
             (SELECT count(*)::int FROM products WHERE active = true) AS product_count,
             (SELECT count(*)::int FROM branches WHERE active = true AND ($1::uuid IS NULL OR id = $1)) AS branch_count,
             (SELECT count(*)::int FROM sales WHERE status = 'completed' AND created_at >= date_trunc('day', now()) AND (${filter})) AS sales_today,
             (SELECT coalesce(sum(total), 0)::float8 FROM sales WHERE status = 'completed' AND created_at >= date_trunc('day', now()) AND (${filter})) AS revenue_today,
             (SELECT count(*)::int FROM inventory i JOIN products p ON p.id = i.product_id
              WHERE p.active = true AND i.quantity <= p.minimum_stock AND ($1::uuid IS NULL OR i.branch_id = $1)) AS low_stock_count,
             (SELECT count(*)::int FROM inventory_lots
              WHERE quantity > 0 AND expires_on BETWEEN current_date AND current_date + 30
                AND ($1::uuid IS NULL OR branch_id = $1)) AS expiring_count,
             (SELECT count(*)::int FROM inventory_lots
              WHERE quantity > 0 AND expires_on < current_date
                AND ($1::uuid IS NULL OR branch_id = $1)) AS expired_count`,
          [branchId],
        ),
        client.query(
          `SELECT p.id, p.name, p.internal_code, p.minimum_stock, b.name AS branch_name,
                  i.quantity::int AS quantity
           FROM inventory i JOIN products p ON p.id = i.product_id JOIN branches b ON b.id = i.branch_id
           WHERE p.active = true AND i.quantity <= p.minimum_stock AND ($1::uuid IS NULL OR i.branch_id = $1)
           ORDER BY i.quantity ASC, p.name LIMIT 8`,
          [branchId],
        ),
        client.query(
          `SELECT p.name, l.lot_number, to_char(l.expires_on, 'YYYY-MM-DD') AS expires_on, l.quantity::int AS quantity, b.name AS branch_name
           FROM inventory_lots l JOIN products p ON p.id = l.product_id JOIN branches b ON b.id = l.branch_id
           WHERE l.quantity > 0 AND l.expires_on BETWEEN current_date AND current_date + 30
             AND ($1::uuid IS NULL OR l.branch_id = $1)
           ORDER BY l.expires_on ASC LIMIT 8`,
          [branchId],
        ),
        client.query(
          `SELECT p.name, l.lot_number, to_char(l.expires_on, 'YYYY-MM-DD') AS expires_on, l.quantity::int AS quantity, b.name AS branch_name
           FROM inventory_lots l JOIN products p ON p.id = l.product_id JOIN branches b ON b.id = l.branch_id
           WHERE l.quantity > 0 AND l.expires_on < current_date
             AND ($1::uuid IS NULL OR l.branch_id = $1)
           ORDER BY l.expires_on ASC LIMIT 8`,
          [branchId],
        ),
        client.query(
          `SELECT m.id, m.movement_type, m.quantity, m.reason, m.created_at,
                  p.name AS product_name, b.name AS branch_name, u.full_name AS user_name
           FROM stock_movements m JOIN products p ON p.id = m.product_id
           JOIN branches b ON b.id = m.branch_id JOIN users u ON u.id = m.user_id
           WHERE ($1::uuid IS NULL OR m.branch_id = $1) ORDER BY m.created_at DESC LIMIT 6`,
          [branchId],
        ),
        client.query(
          `SELECT CASE extract(dow FROM day)::int
                    WHEN 0 THEN 'Dom' WHEN 1 THEN 'Lun' WHEN 2 THEN 'Mar' WHEN 3 THEN 'Mié'
                    WHEN 4 THEN 'Jue' WHEN 5 THEN 'Vie' ELSE 'Sáb' END AS label,
                  coalesce(sum(s.total), 0)::float8 AS total
           FROM generate_series(current_date - 6, current_date, interval '1 day') day
           LEFT JOIN sales s ON s.created_at >= day AND s.created_at < day + interval '1 day'
             AND s.status = 'completed' AND ($1::uuid IS NULL OR s.branch_id = $1)
           GROUP BY day ORDER BY day`,
          [branchId],
        ),
        client.query(
          `SELECT b.id, b.name, coalesce(sum(s.total), 0)::float8 AS total
           FROM branches b LEFT JOIN sales s ON s.branch_id = b.id AND s.status = 'completed'
             AND s.created_at >= now() - interval '7 days'
           WHERE b.active = true AND ($1::uuid IS NULL OR b.id = $1)
           GROUP BY b.id ORDER BY total DESC LIMIT 5`,
          [branchId],
        ),
        client.query(
          `SELECT p.name, sum(si.quantity)::int AS quantity, sum(si.line_total)::float8 AS revenue
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
           WHERE s.status = 'completed' AND s.created_at >= now() - interval '7 days'
             AND ($1::uuid IS NULL OR s.branch_id = $1)
           GROUP BY p.id ORDER BY quantity DESC LIMIT 5`,
          [branchId],
        ),
      ]);

      return {
        summary: summary.rows[0],
        lowStock: lowStock.rows,
        expiring: expiring.rows,
        expired: expired.rows,
        movements: movements.rows,
        dailySales: dailySales.rows,
        branchSales: branchSales.rows,
        topProducts: topProducts.rows,
      };
    });
    return NextResponse.json(data);
  } catch (error) {
    return apiError(error);
  }
}
