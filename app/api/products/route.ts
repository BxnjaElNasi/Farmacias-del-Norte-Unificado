import { NextResponse } from "next/server";
import {
  apiError,
  branchScopeForUser,
  HttpError,
  nonNegativeMoney,
  nonNegativeInteger,
  optionalImageUrl,
  optionalText,
  readJson,
  requireRole,
  requiredUuid,
  requiredText,
} from "@/lib/api";
import { withDb, withTransaction } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireRole("admin", "employee");
    const url = new URL(request.url);
    const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const requestedBranch = url.searchParams.get("branchId");
    const branchId = branchScopeForUser(user, requestedBranch);
    const onlyLow = url.searchParams.get("low") === "1";
    const includeInactive = user.role === "admin" && url.searchParams.get("includeInactive") === "1";
    const rows = await withDb(async (client) => {
      const result = await client.query(
        `SELECT p.id, p.internal_code, p.barcode, p.name, p.active_ingredient,
                coalesce(c.name, p.category) AS category, p.category_id,
                p.manufacturer, p.presentation,
                p.cover_image_url, p.online_enabled, p.online_featured, p.online_description,
                CASE WHEN $3::boolean THEN p.cost_price::float8 ELSE NULL END AS cost_price,
                coalesce((SELECT bp.sale_price FROM branch_prices bp WHERE bp.product_id = p.id AND bp.branch_id = $2), p.sale_price)::float8 AS sale_price,
                p.minimum_stock, p.active, p.requires_prescription,
                (SELECT coalesce(sum(i.quantity), 0)::int FROM inventory i
                 WHERE i.product_id = p.id AND ($2::uuid IS NULL OR i.branch_id = $2)) AS stock
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE ($1 = '' OR p.name ILIKE '%' || $1 || '%' OR p.internal_code ILIKE '%' || $1 || '%' OR coalesce(p.barcode, '') ILIKE '%' || $1 || '%' OR p.category ILIKE '%' || $1 || '%')
           AND ($5::boolean = true OR p.active = true)
           AND ($4::boolean = false OR (SELECT coalesce(sum(i.quantity), 0) FROM inventory i
                WHERE i.product_id = p.id AND ($2::uuid IS NULL OR i.branch_id = $2)) <= p.minimum_stock)
         ORDER BY p.name LIMIT 500`,
        [search, branchId, user.role === "admin", onlyLow, includeInactive],
      );
      return result.rows;
    });
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRole("admin");
    const body = await readJson(request);
    const internalCode = requiredText(body.internalCode, "Código interno", 48).toUpperCase();
    const name = requiredText(body.name, "Nombre", 180);
    const barcodeValue = optionalText(body.barcode, "Código de barras", 64);
    const barcode = barcodeValue || null;
    const activeIngredient = optionalText(body.activeIngredient, "Principio activo", 160);
    const categoryId = body.categoryId === undefined ? null : requiredUuid(body.categoryId, "Categoría");
    const coverImageUrl = optionalImageUrl(body.coverImageUrl, "Imagen");
    const onlineDescription = optionalText(body.onlineDescription, "Descripción online", 500);
    const manufacturer = optionalText(body.manufacturer, "Laboratorio", 160);
    const presentation = optionalText(body.presentation, "Presentación", 160);
    const costPrice = nonNegativeMoney(body.costPrice, "Costo");
    const salePrice = nonNegativeMoney(body.salePrice, "Precio de venta");
    const minimumStock = body.minimumStock === undefined ? 0 : nonNegativeInteger(body.minimumStock, "Stock mínimo");
    if (body.requiresPrescription !== undefined && typeof body.requiresPrescription !== "boolean") {
      throw new HttpError("El requisito de receta debe ser verdadero o falso.");
    }
    if (body.onlineEnabled !== undefined && typeof body.onlineEnabled !== "boolean") {
      throw new HttpError("La aprobación de venta online debe ser verdadera o falsa.");
    }
    if (body.onlineFeatured !== undefined && typeof body.onlineFeatured !== "boolean") {
      throw new HttpError("El destacado online debe ser verdadero o falso.");
    }

    const product = await withTransaction(async (client) => {
      const category = categoryId
        ? await client.query("SELECT id, name FROM categories WHERE id = $1 AND active = true", [categoryId])
        : await client.query("SELECT id, name FROM categories WHERE name = 'General' AND active = true");
      if (!category.rows[0]) throw new HttpError("La categoría no existe o está inactiva.", 404);
      const created = await client.query(
        `INSERT INTO products
           (internal_code, barcode, name, active_ingredient, category, category_id, manufacturer, presentation,
            cost_price, sale_price, minimum_stock, requires_prescription, cover_image_url, online_enabled, online_featured, online_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id, internal_code, barcode, name, active_ingredient, category, category_id, manufacturer, presentation,
                   cost_price::float8 AS cost_price, sale_price::float8 AS sale_price, minimum_stock, active,
                   requires_prescription, cover_image_url, online_enabled, online_featured, online_description`,
        [
          internalCode,
          barcode,
          name,
          activeIngredient,
          category.rows[0].name,
          category.rows[0].id,
          manufacturer,
          presentation,
          costPrice,
          salePrice,
          minimumStock,
          body.requiresPrescription === true,
          coverImageUrl,
          body.onlineEnabled === true,
          body.onlineFeatured === true,
          onlineDescription,
        ],
      );
      const row = created.rows[0];
      await client.query(
        `INSERT INTO price_history (product_id, changed_by, old_cost, new_cost, old_price, new_price)
         VALUES ($1, $2, 0, $3, 0, $4)`,
        [row.id, user.id, costPrice, salePrice],
      );
      await client.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'product.created', 'product', $2, $3)`,
        [user.id, row.id, JSON.stringify({ internalCode, name, costPrice, salePrice })],
      );
      return row;
    });
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
