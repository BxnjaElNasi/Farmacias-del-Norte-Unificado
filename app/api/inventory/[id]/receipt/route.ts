import nodemailer from "nodemailer";
import { NextResponse } from "next/server";
import { apiError, HttpError, readJson, requireRole, requiredText, requiredUuid } from "@/lib/api";
import { withDb } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireRole("admin", "employee");
    const { id: rawId } = await context.params;
    const movementId = requiredUuid(rawId, "Movimiento");
    const body = await readJson(request);
    const email = requiredText(body.email, "Correo", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Correo no válido.");
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const from = process.env.SMTP_FROM;
    if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new HttpError("El correo saliente todavía no está configurado. Imprime el comprobante desde esta pantalla.", 503);
    }

    const movement = await withDb(async (client) => {
      const result = await client.query(
        `SELECT m.id, m.branch_id, m.movement_type, m.quantity, m.reason, m.created_at,
                m.updated_at, editor.full_name AS edited_by,
                p.name AS product_name, p.internal_code, b.name AS branch_name,
                b.address, b.phone, u.full_name AS user_name,
                l.lot_number, l.expires_on
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         JOIN branches b ON b.id = m.branch_id JOIN users u ON u.id = m.user_id
         LEFT JOIN inventory_lots l ON l.id = m.lot_id
         LEFT JOIN users editor ON editor.id = m.edited_by WHERE m.id = $1`,
        [movementId],
      );
      const row = result.rows[0];
      if (!row) throw new HttpError("El movimiento no existe.", 404);
      if (user.branchId && user.branchId !== row.branch_id) throw new HttpError("No tienes acceso a ese movimiento.", 403);
      return row;
    });

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    const movementLabel = ({ in: "Entrada", out: "Salida", loss: "Merma" } as Record<string, string>)[movement.movement_type] ?? movement.movement_type;
    const subject = `Comprobante interno ${movement.id.slice(0, 8).toUpperCase()} · ${movement.branch_name}`;
    const text = [
      "COMPROBANTE INTERNO — NO FISCAL",
      `Sucursal: ${movement.branch_name}`,
      `Dirección: ${movement.address || "No informada"}`,
      `Teléfono: ${movement.phone || "No informado"}`,
      `Movimiento: ${movementLabel}`,
      `Fecha: ${new Date(movement.created_at).toLocaleString("es-AR")}`,
      `Producto: ${movement.product_name} (${movement.internal_code})`,
      `Cantidad: ${movement.quantity > 0 ? "+" : ""}${movement.quantity}`,
      `Lote: ${movement.lot_number || "No aplica"}`,
      `Vencimiento: ${movement.expires_on || "No informado"}`,
      `Motivo: ${movement.reason}`,
      `Responsable: ${movement.user_name}`,
      ...(movement.edited_by ? [`Motivo corregido por: ${movement.edited_by}`] : []),
      "Este comprobante no es factura ni documento fiscal.",
    ].join("\n");
    const html = `<main style="font:15px Arial,sans-serif;color:#203b32;max-width:620px;margin:auto"><h1 style="color:#176f5d">Farmacias del Norte</h1><p style="background:#fff3dc;padding:12px"><strong>COMPROBANTE INTERNO — NO FISCAL</strong></p><h2>${escapeHtml(movementLabel)} · ${escapeHtml(movement.id.slice(0, 8).toUpperCase())}</h2><p>${escapeHtml(movement.branch_name)} · ${escapeHtml(movement.address || "Dirección no informada")} · ${escapeHtml(movement.phone || "Teléfono no informado")}</p><table style="border-collapse:collapse;width:100%"><tbody>${[
      ["Fecha", new Date(movement.created_at).toLocaleString("es-AR")],
      ["Producto", `${movement.product_name} (${movement.internal_code})`],
      ["Cantidad", `${movement.quantity > 0 ? "+" : ""}${movement.quantity}`],
      ["Lote", movement.lot_number || "No aplica"],
      ["Vencimiento", movement.expires_on || "No informado"],
      ["Motivo", movement.reason],
      ["Responsable", movement.user_name],
      ...(movement.edited_by ? [["Motivo corregido por", movement.edited_by]] : []),
    ].map(([label, value]) => `<tr><th style="text-align:left;border-bottom:1px solid #ddd;padding:9px">${escapeHtml(label)}</th><td style="border-bottom:1px solid #ddd;padding:9px">${escapeHtml(String(value))}</td></tr>`).join("")}</tbody></table><p style="font-size:12px;color:#667">Este comprobante no es factura ni documento fiscal.</p></main>`;
    await transport.sendMail({ from, to: email, subject, text, html });
    return NextResponse.json({ sent: true });
  } catch (error) {
    return apiError(error);
  }
}
