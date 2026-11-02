import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { withDb } from "@/lib/db";

export async function GET() {
  try {
    const branches = await withDb(async (client) => {
      const result = await client.query(
        `SELECT id, name, address, phone, image_url, delivery_zone
         FROM branches WHERE active = true ORDER BY name`,
      );
      return result.rows;
    });
    return NextResponse.json(branches);
  } catch (error) {
    return apiError(error);
  }
}
