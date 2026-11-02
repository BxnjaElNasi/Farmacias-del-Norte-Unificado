import { randomBytes, scryptSync } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { neonConfig, Pool } from "@neondatabase/serverless";
import WebSocket from "ws";

dotenv.config({ path: ".env.local" });
dotenv.config();
neonConfig.webSocketConstructor = WebSocket;

const { DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL } = process.env;
if (!DATABASE_URL || !BOOTSTRAP_ADMIN_EMAIL) {
  console.error("Configura DATABASE_URL y BOOTSTRAP_ADMIN_EMAIL en .env o .env.local.");
  process.exit(1);
}

const credentialFile = new URL("../.demo-credentials.txt", import.meta.url);
const branches = [
  { code: "DEMO-CENTRO", name: "Sucursal DEMO Centro", email: "empleado.centro@demo.farmacias.local" },
  { code: "DEMO-NORTE", name: "Sucursal DEMO Norte", email: "empleado.norte@demo.farmacias.local" },
];
const products = [
  { code: "DEMO-PROD-001", name: "Producto DEMO A", cost: 1200, price: 1800, minimum: 5, quantity: 24 },
  { code: "DEMO-PROD-002", name: "Producto DEMO B", cost: 2300, price: 3200, minimum: 4, quantity: 18 },
  { code: "DEMO-PROD-003", name: "Producto DEMO C", cost: 800, price: 1250, minimum: 3, quantity: 12 },
];
const lotExpiry = "2030-12-31";
const passwordHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
const makePassword = () => randomBytes(24).toString("base64url");
const hasCredentialFile = await access(credentialFile).then(() => true).catch(() => false);
let credentials = {};

if (hasCredentialFile) {
  try {
    const savedCredentials = JSON.parse(await readFile(credentialFile, "utf8"));
    if (typeof savedCredentials.accounts !== "object" || savedCredentials.accounts === null) {
      throw new Error("Missing accounts map");
    }
    credentials = savedCredentials.accounts;
  } catch {
    console.error(".demo-credentials.txt existe pero no se pudo leer; no se modificó la base.");
    process.exit(1);
  }
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
let client;
let credentialsChanged = false;

try {
  client = await pool.connect();
  await client.query("BEGIN");

  const admin = await client.query(
    "SELECT id FROM users WHERE lower(email) = lower($1) AND role = 'admin' AND active = true LIMIT 1",
    [BOOTSTRAP_ADMIN_EMAIL],
  );
  if (!admin.rows[0]) throw new Error("No se encontró un administrador activo configurado; ejecuta primero db:bootstrap-admin.");

  const branchIds = new Map();
  const demoCategory = await client.query(
    `INSERT INTO categories (name) VALUES ('DEMOSTRACIÓN')
     ON CONFLICT (name) DO UPDATE SET active = true
     RETURNING id`,
  );
  const demoCategoryId = demoCategory.rows[0].id;
  for (const branch of branches) {
    const result = await client.query(
      `INSERT INTO branches (code, name, address, email)
       VALUES ($1, $2, 'Datos sintéticos de demostración', $3)
       ON CONFLICT (code) DO NOTHING
       RETURNING id, name`,
      [branch.code, branch.name, branch.email],
    );
    const existing = result.rows[0]
      ? result.rows[0]
      : (await client.query("SELECT id, name FROM branches WHERE code = $1", [branch.code])).rows[0];
    if (!existing || existing.name !== branch.name) throw new Error(`El código ${branch.code} ya está asociado a otra sucursal.`);
    branchIds.set(branch.code, existing.id);
  }

  for (const [index, branch] of branches.entries()) {
    const branchId = branchIds.get(branch.code);
    const existingUser = await client.query(
      "SELECT id, role, branch_id FROM users WHERE lower(email) = lower($1) LIMIT 1",
      [branch.email],
    );
    let userId;
    if (existingUser.rows[0]) {
      const current = existingUser.rows[0];
      if (current.role !== "employee" || current.branch_id !== branchId) {
        throw new Error(`La cuenta ${branch.email} ya existe con otro rol o sucursal; no se modificó.`);
      }
      if (typeof credentials[branch.email] !== "string") {
        throw new Error(`La cuenta ${branch.email} ya existe y falta su contraseña local; no se cambió su contraseña.`);
      }
      userId = current.id;
    } else {
      credentials[branch.email] ??= makePassword();
      credentialsChanged = true;
      const created = await client.query(
        `INSERT INTO users (email, full_name, password_hash, role, branch_id)
         VALUES ($1, $2, $3, 'employee', $4)
         RETURNING id`,
        [branch.email, index === 0 ? "Empleado DEMO Centro" : "Empleado DEMO Norte", passwordHash(credentials[branch.email]), branchId],
      );
      userId = created.rows[0].id;
      await client.query(
        `INSERT INTO audit_log (user_id, branch_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'user.created', 'user', $3, $4)`,
        [admin.rows[0].id, branchId, userId, JSON.stringify({ email: branch.email, role: "employee", source: "demo_seed" })],
      );
    }

    for (const product of products) {
      const createdProduct = await client.query(
        `INSERT INTO products
           (internal_code, name, category, category_id, manufacturer, presentation, cost_price, sale_price, minimum_stock,
            online_enabled, online_featured, online_description)
         VALUES ($1, $2, 'DEMOSTRACIÓN', $3, 'LAB DEMO', 'Unidad de muestra', $4, $5, $6, true, true, 'Producto sintético para probar el catálogo online. No es una oferta real.')
         ON CONFLICT (internal_code) DO NOTHING
         RETURNING id, name`,
        [product.code, product.name, demoCategoryId, product.cost, product.price, product.minimum],
      );
      const item = createdProduct.rows[0]
        ? createdProduct.rows[0]
        : (await client.query("SELECT id, name FROM products WHERE internal_code = $1", [product.code])).rows[0];
      if (!item || item.name !== product.name) throw new Error(`El código ${product.code} ya está asociado a otro producto.`);
      await client.query(
        `UPDATE products
         SET category = 'DEMOSTRACIÓN', category_id = $1, online_enabled = true,
             online_featured = true,
             online_description = 'Producto sintético para probar el catálogo online. No es una oferta real.'
         WHERE id = $2`,
        [demoCategoryId, item.id],
      );

      const lotNumber = `${branch.code}-${product.code}`;
      const lot = await client.query(
        `INSERT INTO inventory_lots (branch_id, product_id, lot_number, expires_on, quantity)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (branch_id, product_id, lot_number) DO NOTHING
         RETURNING id`,
        [branchId, item.id, lotNumber, lotExpiry, product.quantity],
      );
      if (lot.rows[0]) {
        await client.query(
          `INSERT INTO stock_movements (branch_id, product_id, lot_id, user_id, movement_type, quantity, reason)
           VALUES ($1, $2, $3, $4, 'in', $5, 'Existencia inicial DEMO')`,
          [branchId, item.id, lot.rows[0].id, admin.rows[0].id, product.quantity],
        );
      } else {
        const existingLot = await client.query(
          `SELECT id, expires_on FROM inventory_lots
           WHERE branch_id = $1 AND product_id = $2 AND lot_number = $3`,
          [branchId, item.id, lotNumber],
        );
        const expiry = existingLot.rows[0]?.expires_on instanceof Date
          ? existingLot.rows[0].expires_on.toISOString().slice(0, 10)
          : String(existingLot.rows[0]?.expires_on ?? "").slice(0, 10);
        if (!existingLot.rows[0] || expiry !== lotExpiry) throw new Error(`El lote ${lotNumber} ya existe con datos diferentes.`);
      }

      await client.query(
        `INSERT INTO inventory (branch_id, product_id, quantity)
         SELECT $1, $2, coalesce(sum(quantity), 0)::int
         FROM inventory_lots WHERE branch_id = $1 AND product_id = $2
         ON CONFLICT (branch_id, product_id)
         DO UPDATE SET quantity = excluded.quantity, updated_at = now()`,
        [branchId, item.id],
      );
    }
  }

  if (credentialsChanged) {
    await writeFile(
      credentialFile,
      `${JSON.stringify({
        notice: "Cuentas sintéticas de demostración. Guarda estas contraseñas en un gestor y cámbialas antes de usar cuentas reales.",
        accounts: Object.fromEntries(branches.map(({ email }) => [email, credentials[email]])),
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  await client.query("COMMIT");
  console.log("Datos DEMO creados o verificados: 2 sucursales, 2 empleados y 3 productos con stock por sucursal.");
  console.log(`Credenciales temporales locales: ${credentialsChanged || hasCredentialFile ? ".demo-credentials.txt" : "no se generaron cuentas nuevas"}`);
} catch (error) {
  if (client) await client.query("ROLLBACK");
  console.error("No se pudieron preparar los datos DEMO:", error);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
