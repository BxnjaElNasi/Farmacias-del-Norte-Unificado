import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import WebSocket from "ws";

type DbHandler<T> = (client: PoolClient) => Promise<T>;

neonConfig.webSocketConstructor = WebSocket;

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Falta configurar DATABASE_URL para conectar con Neon.");
  }
  return new Pool({ connectionString, max: 1 });
}

export async function withDb<T>(handler: DbHandler<T>): Promise<T> {
  const pool = createPool();
  try {
    const client = await pool.connect();
    try {
      return await handler(client);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export async function withTransaction<T>(handler: DbHandler<T>): Promise<T> {
  return withDb(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}
