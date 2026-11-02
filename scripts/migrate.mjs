import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { neonConfig, Pool } from "@neondatabase/serverless";
import WebSocket from "ws";

dotenv.config({ path: ".env.local" });
dotenv.config();
neonConfig.webSocketConstructor = WebSocket;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Falta DATABASE_URL. Cópiala desde Neon y configúrala en .env.local.");
  process.exit(1);
}

const migrationsDirectory = new URL("../db/migrations/", import.meta.url);
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const pool = new Pool({ connectionString, max: 1 });
let client;

try {
  client = await pool.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       migration text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  for (const migrationName of migrationNames) {
    const existing = await client.query("SELECT migration FROM schema_migrations WHERE migration = $1", [migrationName]);
    if (existing.rowCount) {
      console.log(`La migración ${migrationName} ya está aplicada.`);
      continue;
    }

    const migration = await readFile(new URL(migrationName, migrationsDirectory), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(migration);
      await client.query("INSERT INTO schema_migrations (migration) VALUES ($1)", [migrationName]);
      await client.query("COMMIT");
      console.log(`Migración aplicada: ${migrationName}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} catch (error) {
  console.error("No se pudo aplicar la migración:", error);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
