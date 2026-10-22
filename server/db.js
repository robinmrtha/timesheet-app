import pg from "pg";
import { neon } from "@neondatabase/serverless";
import { attachDatabasePool } from "@vercel/functions";
import { isLocalDatabaseHost, onWorkers } from "./runtime.js";

// Return DATE columns as YYYY-MM-DD strings. node-pg otherwise parses them as
// local Date objects and can shift the calendar day for US and Nepal timezones.
pg.types.setTypeParser(1082, (value) => value);

const neonTypes = {
  getTypeParser(oid, format) {
    if (oid === 1082) return (value) => value;
    return pg.types.getTypeParser(oid, format);
  },
};

let pool;
let neonSql;

function databaseUrl() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const error = new Error("DATABASE_URL is not set");
    error.status = 500;
    throw error;
  }
  return connectionString;
}

// Workers talk to Neon over HTTPS (fetch, so the wait is not CPU time).
// Vercel keeps node-postgres plus attachDatabasePool. Local Postgres has no
// Neon HTTP endpoint, so Workers local dev uses pg over TCP instead.
export function selectDriver(worker, connectionString) {
  if (worker && connectionString && !isLocalDatabaseHost(connectionString)) return "neon-http";
  return "pg";
}

export function usesNeonHttp(connectionString = process.env.DATABASE_URL) {
  return selectDriver(onWorkers(), connectionString) === "neon-http";
}

function sslFor(connectionString) {
  if (isLocalDatabaseHost(connectionString)) return false;
  return { rejectUnauthorized: false };
}

export function getPool() {
  if (pool) return pool;
  const connectionString = databaseUrl();
  pool = new pg.Pool({
    connectionString,
    max: process.env.VERCEL ? 2 : 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslFor(connectionString),
    application_name: "timesheet-api",
  });
  pool.on("error", (error) => {
    console.error(JSON.stringify({ message: "pg pool error", code: error.code || "unknown" }));
  });
  attachDatabasePool(pool);
  return pool;
}

function getNeon() {
  if (!neonSql) neonSql = neon(databaseUrl(), { fullResults: true });
  return neonSql;
}

async function queryNeon(text, params) {
  const result = await getNeon().query(text, params ?? [], { types: neonTypes });
  if (Array.isArray(result)) return { rows: result, rowCount: result.length };
  return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
}

// A pooled client cached on the isolate can throw "I/O from another request"
// inside workerd. Local dev opens one client per query instead.
async function queryLocalWorker(text, params) {
  const connectionString = databaseUrl();
  const client = new pg.Client({
    connectionString,
    ssl: sslFor(connectionString),
    connectionTimeoutMillis: 10_000,
    application_name: "timesheet-api",
  });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

export async function query(text, params) {
  if (usesNeonHttp()) return queryNeon(text, params);
  if (onWorkers()) return queryLocalWorker(text, params);
  return getPool().query(text, params);
}

export async function closePool() {
  neonSql = null;
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
