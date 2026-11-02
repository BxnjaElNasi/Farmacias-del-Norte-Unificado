import { NextResponse } from "next/server";
import { apiError, requireRole } from "@/lib/api";
import { withDb } from "@/lib/db";

export async function GET() {
  try {
    await requireRole("admin");
    const rows = await withDb(async (client) => {
      // Cada sucursal activa debe tener sus 3 cámaras, incluso si se creó después de la migración.
      await client.query(
        `INSERT INTO branch_cameras (branch_id, position, name)
         SELECT b.id, n, 'Cámara ' || n
         FROM branches b CROSS JOIN generate_series(1, 3) AS n
         WHERE b.active = true
         ON CONFLICT (branch_id, position) DO NOTHING`,
      );
      const result = await client.query(
        `SELECT b.id AS branch_id, b.name AS branch_name,
                c.id AS camera_id, c.position, c.name AS camera_name, c.stream_url
         FROM branches b
         JOIN branch_cameras c ON c.branch_id = b.id AND c.active = true
         WHERE b.active = true
         ORDER BY b.name, c.position`,
      );
      return result.rows;
    });

    const branches = new Map<string, { id: string; name: string; cameras: Array<{ id: string; position: number; name: string; streamUrl: string }> }>();
    for (const row of rows) {
      if (!branches.has(row.branch_id)) {
        branches.set(row.branch_id, { id: row.branch_id, name: row.branch_name, cameras: [] });
      }
      branches.get(row.branch_id)!.cameras.push({
        id: row.camera_id,
        position: row.position,
        name: row.camera_name,
        streamUrl: row.stream_url,
      });
    }
    return NextResponse.json([...branches.values()]);
  } catch (error) {
    return apiError(error);
  }
}
