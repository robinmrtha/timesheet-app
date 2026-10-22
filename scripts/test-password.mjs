import { clientIp } from "../server/http.js";
import { closePool, query, selectDriver } from "../server/db.js";

const DATABASE_URL = "postgres://timesheet:timesheet@127.0.0.1:5432/timesheet_cf";

function check(condition, message) {
  if (!condition) throw new Error(message);
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
    const selected = await query("SELECT $1::text AS ok, work_date, hours", ["plain-value"]);
    check(calls.length === 1, "Workers query uses one HTTP request");
    check(
      calls[0].url === "https://api.us-east-1.aws.neon.tech/sql",
      `Neon HTTP endpoint was ${calls[0].url}`,
    );
    check(calls[0].body.query.includes("$1") && !calls[0].body.query.includes("plain-value"), "value stays a bound parameter");
    check(calls[0].body.params[0] === "plain-value", "parameter array carries the value");
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

async function main() {
  clientIpTests();
  driverTests();
  await neonHttpTests();
  console.log("IP and driver checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
