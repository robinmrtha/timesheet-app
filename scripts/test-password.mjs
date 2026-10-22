import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import pg from "pg";
import { clientIp } from "../server/http.js";
import { closePool, query, selectDriver } from "../server/db.js";

const DATABASE_URL = "postgres://timesheet:timesheet@127.0.0.1:5432/timesheet_cf";
const SECRET = "test-auth-secret-with-32-characters-min";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const WORKER_ID = "22222222-2222-4222-8222-222222222222";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function psql(args) {
  const result = spawnSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
}

function clientIpTests() {
  const spoofed = {
    cf: undefined,
    headers: new Headers({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.4, 10.0.0.1",
    }),
  };
  check(clientIp(spoofed) === "198.51.100.4", "Vercel ignores a client-supplied cf-connecting-ip");

  const worker = {
    cf: { colo: "KTM" },
    headers: new Headers({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.4",
    }),
  };
  check(clientIp(worker) === "203.0.113.9", "Workers use cf-connecting-ip");

  const forwardedOnly = {
    headers: new Headers({ "x-forwarded-for": "::ffff:192.0.2.10" }),
  };
  check(clientIp(forwardedOnly) === "192.0.2.10", "x-forwarded-for is the fallback");

  const workerMissing = {
    cf: { colo: "EWR" },
    headers: new Headers({ "x-forwarded-for": "192.0.2.8" }),
  };
  check(
    clientIp(workerMissing) === "192.0.2.8",
    "Workers fall back to x-forwarded-for when cf-connecting-ip is absent",
  );
}

function driverTests() {
  const neonUrl = "postgres://user:pass@ep-example.us-east-1.aws.neon.tech/neondb?sslmode=require";
  const localUrl = DATABASE_URL;
  check(selectDriver(false, neonUrl) === "pg", "Vercel keeps node-postgres for Neon");
  check(selectDriver(true, neonUrl) === "neon-http", "Workers use the Neon HTTP driver");
  check(selectDriver(true, localUrl) === "pg", "Workers local dev uses pg for localhost");
  check(selectDriver(true, "") === "pg", "missing URL does not select the HTTP driver");
}

async function request(handle, path, { method = "GET", body, cookie } = {}) {
  const headers = new Headers({ origin: "http://127.0.0.1" });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await handle(
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
    setCookie: response.headers.getSetCookie?.() || [],
  };
}

function cookieOf(setCookie) {
  const raw = setCookie.find((item) => item.startsWith("hb_session="));
  return raw ? raw.split(";")[0] : "";
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function main() {
  clientIpTests();
  driverTests();

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.AUTH_SECRET = SECRET;
  process.env.PASSWORD_BACKEND = "pgcrypto";

  psql(["-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"]);
  psql(["-f", "db/schema.sql"]);

  const hash2a = (await bcrypt.hash("Admin-Pass-123", 10)).replace(/^\$2b\$/, "$2a$");
  const hash2b = await bcrypt.hash("Worker-Pass-123", 10);
  check(hash2a.startsWith("$2a$"), "admin fixture is $2a$");
  check(hash2b.startsWith("$2b$"), "worker fixture is $2b$");

  await withClient(async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, name, role, active)
       VALUES ($1, 'admin@example.com', $2, 'Mira Admin', 'admin', true),
              ($3, 'worker@example.com', $4, 'Pemba Worker', 'employee', true)`,
      [ADMIN_ID, hash2a, WORKER_ID, hash2b],
    );
  });

  const { handle } = await import("../server/router.js");
  try {
    const unknown = await request(handle, "/api/auth/login", {
      method: "POST",
      body: { email: "nobody@example.com", password: "Admin-Pass-123" },
    });
    check(unknown.status === 401, "unknown email is rejected without a 500 from pgcrypto");

    const admin = await request(handle, "/api/auth/login", {
      method: "POST",
      body: { email: "admin@example.com", password: "Admin-Pass-123" },
    });
    check(admin.status === 200 && admin.data.user.role === "admin", "pgcrypto verifies a $2a$ hash");

    const worker = await request(handle, "/api/auth/login", {
      method: "POST",
      body: { email: "worker@example.com", password: "Worker-Pass-123" },
    });
    check(worker.status === 200, "pgcrypto verifies a $2b$ hash by prefix rewrite");
    const workerCookie = cookieOf(worker.setCookie);

    await withClient(async (client) => {
      const row = await client.query(`SELECT password_hash FROM users WHERE id = $1`, [WORKER_ID]);
      check(row.rows[0].password_hash === hash2b, "login leaves the stored bcrypt hash unchanged");
    });

    const me = await request(handle, "/api/me", { cookie: workerCookie });
    check(me.status === 200 && me.data.user.email === "worker@example.com", "session works after pgcrypto login");

    const created = await request(handle, "/api/users", {
      method: "POST",
      cookie: cookieOf(admin.setCookie),
      body: { name: "New Hire", email: "new.hire@example.com", password: "New-Hire-123", role: "employee" },
    });
    check(created.status === 201, "pgcrypto hashes a new password");

    await withClient(async (client) => {
      const row = await client.query(`SELECT password_hash FROM users WHERE email = 'new.hire@example.com'`);
      check(row.rows[0].password_hash.startsWith("$2a$10$"), "new Worker hashes are pgcrypto cost-10 bcrypt");
    });

    process.env.PASSWORD_BACKEND = "bcryptjs";
    const cross = await request(handle, "/api/auth/login", {
      method: "POST",
      body: { email: "new.hire@example.com", password: "New-Hire-123" },
    });
    check(cross.status === 200, "bcryptjs verifies a pgcrypto hash");

    const stillBcrypt = await request(handle, "/api/auth/login", {
      method: "POST",
      body: { email: "worker@example.com", password: "Worker-Pass-123" },
    });
    check(stillBcrypt.status === 200, "bcryptjs still verifies an existing $2b$ hash");
  } finally {
    await closePool();
  }

  await closePool();
  await neonHttpTests();

  console.log("Password, IP, and driver checks passed.");
}

async function neonHttpTests() {
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  const calls = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Cloudflare-Workers" },
  });
  process.env.DATABASE_URL = "postgres://user:secret@ep-example.us-east-1.aws.neon.tech/neondb";
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const sql = calls.at(-1).body.query;
    const payload = sql.startsWith("DELETE")
      ? { command: "DELETE", rowCount: 0, fields: [], rows: [] }
      : {
          command: "SELECT",
          rowCount: 1,
          fields: [
            { name: "ok", dataTypeID: 16 },
            { name: "work_date", dataTypeID: 1082 },
            { name: "hours", dataTypeID: 1700 },
          ],
          rows: [["t", "2026-10-22", "3.50"]],
        };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const selected = await query("SELECT crypt($1, $2) = $2 AS ok, work_date, hours", [
      "plain-secret",
      "$2a$10$hash",
    ]);
    check(calls.length === 1, "Workers query uses one HTTP request");
    check(
      calls[0].url === "https://api.us-east-1.aws.neon.tech/sql",
      `Neon HTTP endpoint was ${calls[0].url}`,
    );
    check(calls[0].body.query.includes("$1") && !calls[0].body.query.includes("plain-secret"), "password stays a bound parameter");
    check(calls[0].body.params[0] === "plain-secret", "parameter array carries the password");
    check(selected.rows[0].ok === true, "Neon bool parses to true");
    check(selected.rows[0].work_date === "2026-10-22", "Neon DATE stays YYYY-MM-DD");
    check(selected.rows[0].hours === "3.50", "Neon numeric stays a string, like node-pg");
    const removed = await query("DELETE FROM time_entries WHERE id = $1", ["missing"]);
    check(removed.rowCount === 0, "Neon DELETE rowCount of 0 is preserved");
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    await closePool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
