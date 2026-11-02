import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser, type SessionUser, type UserRole } from "@/lib/auth";
import { resolveBranchScope } from "@/lib/branch-scope.mjs";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new HttpError("Inicia sesión para continuar.", 401);
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw new HttpError("No tienes permiso para esta operación.", 403);
  return user;
}

export function branchScopeForUser(user: Pick<SessionUser, "role" | "branchId">, requested: string | null) {
  const scope = resolveBranchScope(user.role, user.branchId, requested);
  if (!scope.allowed) throw new HttpError("No tienes acceso a esa sucursal.", 403);
  return scope.branchId ? requiredUuid(scope.branchId, "Sucursal") : null;
}

export function apiError(error: unknown) {
  unstable_rethrow(error);
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
    return NextResponse.json(
      { error: "Ya existe un registro con ese código o identificador." },
      { status: 409 },
    );
  }
  if (typeof error === "object" && error !== null && "code" in error && (error.code === "42P01" || error.code === "42703")) {
    return NextResponse.json(
      { error: "La base de datos necesita actualizar su esquema. Ejecuta npm run db:migrate y vuelve a intentar." },
      { status: 503 },
    );
  }
  if (error instanceof Error && error.message.includes("DATABASE_URL")) {
    return NextResponse.json(
      { error: "Configura DATABASE_URL con la cadena de conexión de Neon." },
      { status: 503 },
    );
  }
  console.error("Error en API:", error);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

export async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new HttpError("El cuerpo de la solicitud debe ser JSON válido.");
  }
}

export function requiredText(value: unknown, label: string, maxLength = 180) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(`${label} es obligatorio y debe tener como máximo ${maxLength} caracteres.`);
  }
  return value.trim();
}

export function optionalText(value: unknown, label: string, maxLength: number, fallback = "") {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new HttpError(`${label} debe ser texto de hasta ${maxLength} caracteres.`);
  }
  return value.trim();
}

export function optionalImageUrl(value: unknown, label: string, fallback = "") {
  const imageUrl = optionalText(value, label, 2048, fallback);
  if (!imageUrl) return "";
  if (imageUrl.startsWith("/") && !imageUrl.startsWith("//") && !imageUrl.includes("\\")) return imageUrl;
  try {
    const url = new URL(imageUrl);
    if (url.protocol === "https:" && !url.username && !url.password) return imageUrl;
  } catch {
    throw new HttpError(`${label} debe ser una ruta local o una URL HTTPS válida.`);
  }
  throw new HttpError(`${label} debe ser una ruta local o una URL HTTPS válida.`);
}

export function requiredUuid(value: unknown, label: string) {
  const id = requiredText(value, label, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(`${label} no es válido.`);
  }
  return id;
}

export function nonNegativeMoney(value: unknown, label: string) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) {
    throw new HttpError(`${label} debe ser un importe válido mayor o igual a cero.`);
  }
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
    throw new HttpError(`${label} debe ser un importe válido mayor o igual a cero.`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function positiveInteger(value: unknown, label: string, max = 100_000) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) {
    throw new HttpError(`${label} debe ser un entero positivo menor o igual a ${max}.`);
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > max) {
    throw new HttpError(`${label} debe ser un entero positivo menor o igual a ${max}.`);
  }
  return amount;
}

export function nonNegativeInteger(value: unknown, label: string, max = 100_000) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) {
    throw new HttpError(`${label} debe ser un entero no negativo menor o igual a ${max}.`);
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > max) {
    throw new HttpError(`${label} debe ser un entero no negativo menor o igual a ${max}.`);
  }
  return amount;
}
