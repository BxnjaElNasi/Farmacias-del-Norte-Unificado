import { NextResponse } from "next/server";
import { apiError, branchScopeForUser, requireRole } from "@/lib/api";
import { withDb } from "@/lib/db";
import { buildSalesWorkbook } from "@/lib/sales-export.mjs";

export async function GET(request: Request) {
  try {
    const user = await requireRole("admin", "employee");
    const requestedBranch = new URL(request.url).searchParams.get("branchId");
    const branchId = branchScopeForUser(user, requestedBranch);
    const sales = await withDb(async (client) => {
      const result = await client.query(
        `WITH recent AS (
           SELECT s.id, s.transaction_number, s.status, s.payment_method,
                  s.subtotal::float8 AS subtotal, s.discount::float8 AS discount,
                  s.total::float8 AS total, s.created_at, b.name AS branch_name,
                  u.full_name AS cashier
           FROM sales s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.user_id
           WHERE ($1::uuid IS NULL OR s.branch_id = $1)
           ORDER BY s.created_at DESC LIMIT 50
         )
         SELECT r.*, si.quantity, si.unit_price::float8 AS unit_price,
                si.line_total::float8 AS line_total, p.internal_code, p.name AS product_name
         FROM recent r JOIN sale_items si ON si.sale_id = r.id
         JOIN products p ON p.id = si.product_id
         ORDER BY r.created_at DESC, p.name`,
        [branchId],
      );
      return result.rows;
    });

    const workbook = await buildSalesWorkbook(sales);
    const buffer = await workbook.xlsx.writeBuffer();
    const fileDate = new Date().toISOString().slice(0, 10);
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ventas-farmacias-del-norte-${fileDate}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
