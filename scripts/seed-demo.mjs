#!/usr/bin/env node
/**
 * Local demo data for the UI. Refuses to run against a Neon host unless
 * ALLOW_DEMO_SEED=1 is set. Pass --reset to wipe and reload.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";

pg.types.setTypeParser(1082, (value) => value);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Set DATABASE_URL to a local Postgres database first.");
  process.exit(1);
}

let host = "";
try {
  host = new URL(DATABASE_URL).hostname;
} catch {
  console.error("DATABASE_URL is not a valid Postgres URL");
  process.exit(1);
}
if (host.includes("neon.tech") && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("Refusing to seed a Neon database. Set ALLOW_DEMO_SEED=1 to override.");
  process.exit(1);
}

const reset = process.argv.includes("--reset");
const MIRA = "11111111-1111-4111-8111-111111111111";
const PEMBA = "22222222-2222-4222-8222-222222222222";
const DOLMA = "33333333-3333-4333-8333-333333333333";
const SAM = "44444444-4444-4444-8444-444444444444";

function psql(args) {
  const result = spawnSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
}

async function main() {
  if (reset) psql(["-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"]);
  psql(["-f", "db/schema.sql"]);

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: host === "localhost" || host === "127.0.0.1" ? false : undefined });
  await client.connect();
  try {
    const existing = await client.query(`SELECT count(*)::int AS n FROM users`);
    if (existing.rows[0].n > 0 && !reset) {
      console.log("Demo data already present. Re-run with --reset to replace it.");
      return;
    }
    if (reset) await client.query(`TRUNCATE time_entries, employee_rates, login_attempts, users CASCADE`);

    const people = {
      [MIRA]: ["mira@example.com", "Mira Gurung", "admin", true],
      [PEMBA]: ["pemba@example.com", "Pemba Sherpa", "employee", true],
      [DOLMA]: ["dolma@example.com", "Dolma Tamang", "employee", true],
      [SAM]: ["sam.inactive@example.com", "Sam Inactive", "employee", false],
    };
    for (const [id, [email, name, role, active]] of Object.entries(people)) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, role, active)
         VALUES ($1, $2, 'not-used', $3, $4, $5)`,
        [id, email, name, role, active],
      );
    }
    await client.query(
      `INSERT INTO employee_rates (user_id, hourly_rate, effective_from, created_by) VALUES
         ($1, 22, '2026-01-01', $2),
         ($1, 26, '2026-10-01', $2),
         ($3, 20, '2026-03-01', $2),
         ($4, 18, '2025-06-01', NULL)`,
      [PEMBA, MIRA, DOLMA, SAM],
    );
    await client.query(
      `INSERT INTO time_entries (
         user_id, work_date, hours, notes, status, hourly_rate, paid_at, paid_by, paid_reference
       ) VALUES
         ($1, '2026-10-02', 7.5, 'Stock and opening', 'submitted', 26, NULL, NULL, NULL),
         ($1, '2026-10-06', 8, 'Floor sales', 'submitted', 26, NULL, NULL, NULL),
         ($1, '2026-10-09', 6.5, 'Inventory count', 'paid', 26, '2026-10-10T15:00:00Z', $2, 'Zelle 1042'),
         ($1, '2026-10-18', 4, 'Morning shift', 'submitted', 26, NULL, NULL, NULL),
         ($1, '2026-10-18', 3.5, 'Evening shift', 'submitted', 26, NULL, NULL, NULL),
         ($1, '2026-09-28', 8, 'September close', 'paid', 22, '2026-09-30T15:00:00Z', $2, 'Check 77'),
         ($3, '2026-10-03', 6, 'Receiving', 'submitted', 20, NULL, NULL, NULL),
         ($3, '2026-10-11', 7.25, 'Weekend floor', 'submitted', 20, NULL, NULL, NULL),
         ($3, '2026-10-15', 8, 'Register', 'paid', 20, '2026-10-16T15:00:00Z', $2, 'Check 88'),
         ($4, '2026-10-04', 5, 'Last week on the floor', 'submitted', 18, NULL, NULL, NULL),
         ($4, '2026-09-12', 8, 'September shift', 'paid', 18, '2026-09-20T15:00:00Z', NULL, NULL)`,
      [PEMBA, MIRA, DOLMA, SAM],
    );
    console.log("Demo users (local only). Set ACCESS_DEV_EMAIL to one of these:");
    console.log("  mira@example.com (admin)");
    console.log("  pemba@example.com");
    console.log("  dolma@example.com");
    console.log("  sam.inactive@example.com (inactive)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
