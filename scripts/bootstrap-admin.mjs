import dotenv from "dotenv";
import { randomBytes, scryptSync } from "node:crypto";
import { neonConfig, Pool } from "@neondatabase/serverless";
import WebSocket from "ws";

dotenv.config({ path: ".env.local" });
dotenv.config();
neonConfig.webSocketConstructor = WebSocket;

const { DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !BOOTSTRAP_ADMIN_EMAIL || !BOOTSTRAP_ADMIN_NAME || !BOOTSTRAP_ADMIN_PASSWORD) {
  console.error("Configura DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME y BOOTSTRAP_ADMIN_PASSWORD en .env.local.");
  process.exit(1);
}
if (BOOTSTRAP_ADMIN_PASSWORD.length < 12) {
  console.error("La contraseña inicial debe tener al menos 12 caracteres.");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(BOOTSTRAP_ADMIN_EMAIL)) {
  console.error("BOOTSTRAP_ADMIN_EMAIL no tiene un formato válido.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const passwordHash = `${salt}:${scryptSync(BOOTSTRAP_ADMIN_PASSWORD, salt, 64).toString("hex")}`;
const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });

try {
  const result = await pool.query(
    `INSERT INTO users (email, full_name, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase(), BOOTSTRAP_ADMIN_NAME.trim(), passwordHash],
  );
  if (result.rowCount) {
    console.log("Administrador inicial creado. Guarda sus credenciales en un gestor de contraseñas y elimina las variables de bootstrap.");
  } else {
    console.log("Ese correo ya existe; no se modificó ninguna contraseña.");
  }
} catch (error) {
  console.error("No se pudo crear el administrador inicial. Comprueba que las migraciones ya estén aplicadas.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
