import { NextResponse } from "next/server";
import {
  apiError,
  HttpError,
  nonNegativeMoney,
  nonNegativeInteger,
  optionalImageUrl,
  optionalText,
  readJson,
  requireRole,
  requiredText,
  requiredUuid,
} from "@/lib/api";
import { withDb, withTransaction } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireRole("admin");
    const { id: rawId } = await context.params;
    const productId = requiredUuid(rawId, "Producto");
    const history = await withDb(async (client) => {
      const exists = await client.query("SELECT id FROM products WHERE id = $1", [productId]);
      if (!exists.rowCount) throw new HttpError("El producto no existe.", 404);
      const result = await client.query(
        `SELECT h.id, h.branch_id, b.name AS branch_name, u.full_name AS changed_by,
                h.old_cost::float8 AS old_cost, h.new_cost::float8 AS new_cost,
                h.old_price::float8 AS old_price, h.new_price::float8 AS new_price, h.created_at
         FROM price_history h LEFT JOIN branches b ON b.id = h.branch_id
         JOIN users u ON u.id = h.changed_by
         WHERE h.product_id = $1 ORDER BY h.created_at DESC LIMIT 100`,
        [productId],
      );
      return result.rows;
    });
    return NextResponse.json(history);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireRole("admin");
    const { id: rawId } = await context.params;
    const productId = requiredUuid(rawId, "Producto");
    const body = await readJson(request);
    const branchId = body.branchId ? requiredUuid(body.branchId, "Sucursal") : null;

    const product = await withTransaction(async (client) => {
      const currentResult = await client.query(
        `SELECT id, internal_code, barcode, name, active_ingredient, category, category_id, manufacturer,
                presentation, cost_price::float8 AS cost_price, sale_price::float8 AS sale_price,
                minimum_stock, active, requires_prescription, cover_image_url, online_enabled, online_featured, online_description
         FROM products WHERE id = $1 FOR UPDATE`,
        [productId],
      );
      const current = currentResult.rows[0];
      if (!current) throw new HttpError("El producto no existe.", 404);

      if (branchId) {
        const keys = Object.keys(body).filter((key) => key !== "branchId");
        if (keys.some((key) => key !== "salePrice") || body.salePrice === undefined) {
          throw new HttpError("Para fijar un precio por sucursal, envía únicamente branchId y salePrice.");
        }
        const newPrice = nonNegativeMoney(body.salePrice, "Precio de venta");
        const branch = await client.query("SELECT id FROM branches WHERE id = $1 AND active = true", [branchId]);
        if (!branch.rowCount) throw new HttpError("La sucursal no existe o está inactiva.", 404);
        const existingPrice = await client.query(
          "SELECT sale_price::float8 AS sale_price FROM branch_prices WHERE branch_id = $1 AND product_id = $2 FOR UPDATE",
          [branchId, productId],
        );
        const previousPrice = Number(existingPrice.rows[0]?.sale_price ?? current.sale_price);
        await client.query(
          `INSERT INTO branch_prices (branch_id, product_id, sale_price, updated_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (branch_id, product_id)
           DO UPDATE SET sale_price = excluded.sale_price, updated_by = excluded.updated_by, updated_at = now()`,
          [branchId, productId, newPrice, user.id],
        );
        await client.query(
          `INSERT INTO price_history (product_id, branch_id, changed_by, old_cost, new_cost, old_price, new_price)
           VALUES ($1, $2, $3, $4, $4, $5, $6)`,
          [productId, branchId, user.id, current.cost_price, previousPrice, newPrice],
        );
        await client.query(
          `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
           VALUES ($1, $2, 'product.branch_price_changed', 'product', $3, $4)`,
          [user.id, branchId, productId, JSON.stringify({ oldPrice: previousPrice, newPrice })],
        );
        return { id: productId, branchId, oldPrice: previousPrice, salePrice: newPrice };
      }

      const internalCode = body.internalCode === undefined ? current.internal_code : requiredText(body.internalCode, "Código interno", 48).toUpperCase();
      const name = body.name === undefined ? current.name : requiredText(body.name, "Nombre", 180);
      const barcode = body.barcode === undefined ? current.barcode : body.barcode === null ? null : optionalText(body.barcode, "Código de barras", 64) || null;
      const activeIngredient = optionalText(body.activeIngredient, "Principio activo", 160, current.active_ingredient);
      const categoryId = body.categoryId === undefined ? current.category_id : requiredUuid(body.categoryId, "Categoría");
      const manufacturer = optionalText(body.manufacturer, "Laboratorio", 160, current.manufacturer);
      const presentation = optionalText(body.presentation, "Presentación", 160, current.presentation);
      const coverImageUrl = optionalImageUrl(body.coverImageUrl, "Imagen", current.cover_image_url);
      const onlineDescription = optionalText(body.onlineDescription, "Descripción online", 500, current.online_description);
      const costPrice = body.costPrice === undefined ? Number(current.cost_price) : nonNegativeMoney(body.costPrice, "Costo");
      const salePrice = body.salePrice === undefined ? Number(current.sale_price) : nonNegativeMoney(body.salePrice, "Precio de venta");
      const minimumStock = body.minimumStock === undefined ? current.minimum_stock : nonNegativeInteger(body.minimumStock, "Stock mínimo");
      const active = body.active === undefined ? current.active : body.active;
      const requiresPrescription = body.requiresPrescription === undefined ? current.requires_prescription : body.requiresPrescription;
      const onlineEnabled = body.onlineEnabled === undefined ? current.online_enabled : body.onlineEnabled;
      const onlineFeatured = body.onlineFeatured === undefined ? current.online_featured : body.onlineFeatured;
      if (typeof active !== "boolean" || typeof requiresPrescription !== "boolean") {
        throw new HttpError("Los estados del producto deben ser verdaderos o falsos.");
      }
      if (typeof onlineEnabled !== "boolean") throw new HttpError("La aprobación de venta online debe ser verdadera o falsa.");
      if (typeof onlineFeatured !== "boolean") throw new HttpError("El destacado online debe ser verdadero o falso.");
      const categoryResult = await client.query(
        "SELECT id, name FROM categories WHERE id = $1 AND (active = true OR id = $2)",
        [categoryId, current.category_id],
      );
      if (!categoryResult.rows[0]) throw new HttpError("La categoría no existe o está inactiva.", 404);
      const category = categoryResult.rows[0];

      const updated = await client.query(
        `UPDATE products SET internal_code = $2, name = $3, barcode = $4, active_ingredient = $5,
           category = $6, category_id = $7, manufacturer = $8, presentation = $9, cost_price = $10, sale_price = $11,
           minimum_stock = $12, active = $13, requires_prescription = $14, cover_image_url = $15,
           online_enabled = $16, online_featured = $17, online_description = $18, updated_at = now()
         WHERE id = $1
         RETURNING id, internal_code, barcode, name, active_ingredient, category, category_id, manufacturer, presentation,
                   cost_price::float8 AS cost_price, sale_price::float8 AS sale_price, minimum_stock, active, requires_prescription,
                   cover_image_url, online_enabled, online_featured, online_description`,
        [productId, internalCode, name, barcode, activeIngredient, category.name, category.id, manufacturer, presentation, costPrice, salePrice, minimumStock, active, requiresPrescription, coverImageUrl, onlineEnabled, onlineFeatured, onlineDescription],
      );
      if (costPrice !== Number(current.cost_price) || salePrice !== Number(current.sale_price)) {
        await client.query(
          `INSERT INTO price_history (product_id, changed_by, old_cost, new_cost, old_price, new_price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [productId, user.id, current.cost_price, costPrice, current.sale_price, salePrice],
        );
      }
      await client.query(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'product.updated', 'product', $2, $3)`,
        [user.id, productId, JSON.stringify({ internalCode, name, costPrice, salePrice, minimumStock, active })],
      );
      return updated.rows[0];
    });
    return NextResponse.json(product);
  } catch (error) {
    return apiError(error);
  }
}
