import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { apiError, HttpError, readJson, requiredText } from "@/lib/api";
import { withDb } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email = requiredText(body.email, "Correo", 254).toLowerCase();
    const password = requiredText(body.password, "Contraseña", 256);
    const confirmation = requiredText(body.confirmPassword, "Confirmación de contraseña", 256);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("Correo no válido.");
    if (password.length < 12) throw new HttpError("La contraseña debe tener al menos 12 caracteres.");
    if (password !== confirmation) throw new HttpError("Las contraseñas no coinciden.");

    await withDb(async (client) => {
      await client.query(
        "INSERT INTO store_customer_accounts (email, password_hash) VALUES ($1, $2)",
        [email, hashPassword(password)],
      );
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
