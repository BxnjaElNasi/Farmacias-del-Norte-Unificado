import { NextResponse } from "next/server";
import { requireRole, apiError, readJson, requiredText, optionalText, optionalImageUrl, HttpError } from "@/lib/api";
import { withDb, withTransaction } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireRole("admin", "employee");
    const branches = await withDb(async (client) => {
      const result =
        user.role === "admin"
          ? await client.query(
              `SELECT b.id, b.code, b.name, b.address, b.phone, b.email, b.image_url, b.delivery_zone, b.active,
                      count(DISTINCT i.product_id)::int AS product_count,
                      coalesce(sum(i.quantity), 0)::int AS total_stock
               FROM branches b LEFT JOIN inventory i ON i.branch_id = b.id
               GROUP BY b.id ORDER BY b.name`,
            )
          : await client.query(
              `SELECT b.id, b.code, b.name, b.address, b.phone, b.email, b.image_url, b.delivery_zone, b.active,
                      count(DISTINCT i.product_id)::int AS product_count,
                      coalesce(sum(i.quantity), 0)::int AS total_stock
               FROM branches b LEFT JOIN inventory i ON i.branch_id = b.id
               WHERE b.id = $1 GROUP BY b.id`,
              [user.branchId],
            );
      return result.rows;
    });
    return NextResponse.json(branches);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRole("admin");
    const body = await readJson(request);
    const code = requiredText(body.code, "Código", 24).toUpperCase();
    const name = requiredText(body.name, "Nombre de sucursal");
    const address = optionalText(body.address, "Dirección", 240);
    const phone = optionalText(body.phone, "Teléfono", 60);
    const email = optionalText(body.email, "Correo", 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Correo de sucursal no válido.");
    const imageUrl = optionalImageUrl(body.imageUrl, "Imagen");
    const deliveryZone = optionalText(body.deliveryZone, "Zona de entrega", 160);

    const branch = await withTransaction(async (client) => {
      const created = await client.query(
        `INSERT INTO branches (code, name, address, phone, email, image_url, delivery_zone)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, code, name, address, phone, email, image_url, delivery_zone, active`,
        [code, name, address, phone, email, imageUrl, deliveryZone],
      );
      const row = created.rows[0];
      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'branch.created', 'branch', $2, $3)`,
        [user.id, row.id, JSON.stringify({ code, name })],
      );
      return row;
    });
    return NextResponse.json(branch, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
