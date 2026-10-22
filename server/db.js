import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";

// Return DATE columns as YYYY-MM-DD strings. node-pg otherwise parses them as
// local Date objects and can shift the calendar day.
pg.types.setTypeParser(1082, (value) => value);

let pool;

function sslFor(connectionString) {
  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return false;
  }
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  return { rejectUnauthorized: false };
}

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const error = new Error("DATABASE_URL is not set");
    error.status = 500;
    throw error;
  }
  pool = new pg.Pool({
    connectionString,
    max: process.env.VERCEL ? 2 : 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslFor(connectionString),
    application_name: "timesheet-api",
  });
  pool.on("error", (error) => {
    console.error("pg pool error", error);
  });
  attachDatabasePool(pool);
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
