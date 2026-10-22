import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import pg from "pg";

pg.types.setTypeParser(1082, (value) => value);

const TARGET = "postgres://timesheet:timesheet@127.0.0.1:5432/timesheet_test";
const SOURCE = "postgres://timesheet:timesheet@127.0.0.1:5432/timesheet_source";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FORMER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORPHAN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LOCK_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function psql(connectionString, args) {
  const result = spawnSync("psql", [connectionString, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
}

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString, ssl: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function hash2a(password) {
  const hash = await bcrypt.hash(password, 10);
  const prefixed = hash.replace(/^\$2b\$/, "$2a$");
  check(prefixed.startsWith("$2a$"), `expected a $2a$ hash, got ${prefixed.slice(0, 4)}`);
  check(await bcrypt.compare(password, prefixed), "rewritten $2a$ hash did not verify");
  return prefixed;
}

function runMigration(inactiveEmails) {
  return spawnSync("node", ["scripts/migrate-from-supabase.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_DB_URL: SOURCE,
      DATABASE_URL: TARGET,
      INACTIVE_EMAILS: inactiveEmails,
    },
  });
}

async function request(base, path, { method = "GET", body, cookie, email, origin = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (email) headers["x-dev-user-email"] = email;
  if (origin) headers.origin = base;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) data = JSON.parse(text);
  const setCookie = response.headers.getSetCookie?.() || [];
  return { status: response.status, data, setCookie };
}

async function resetDatabases() {
  psql(TARGET, ["-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"]);
  psql(TARGET, ["-f", "db/schema.sql"]);
  psql(SOURCE, [
    "-c",
    "DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA auth; CREATE SCHEMA public;",
  ]);
  await withClient(SOURCE, async (client) => {
    await client.query(`
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text,
        encrypted_password text,
        raw_user_meta_data jsonb,
        created_at timestamptz
      )
    `);
    await client.query(`
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY,
        email text,
        name text,
        role text,
        hourly_rate numeric
      )
    `);
    await client.query(`
      CREATE TABLE public.time_entries (
        id uuid PRIMARY KEY,
        user_id uuid,
        work_date date,
        hours numeric,
        notes text,
        status text,
        unpaid_reason text,
        approved_at timestamptz,
        approved_by uuid,
        paid_at timestamptz,
        paid_by uuid,
        paid_reference text,
        created_at timestamptz,
        hourly_rate numeric
      )
    `);
    await client.query(`
      CREATE TABLE public.employee_rates (
        id uuid PRIMARY KEY,
        user_id uuid,
        hourly_rate numeric,
        effective_from date,
        created_at timestamptz,
        created_by uuid
      )
    `);
    await client.query(`CREATE TABLE public.ledger_summary (id int)`);
    await client.query(`INSERT INTO public.ledger_summary (id) VALUES (1)`);
  });
}

async function seedSource(hashes) {
  await withClient(SOURCE, async (client) => {
    const users = [
      [ADMIN_ID, "Admin@Example.com", hashes.admin, { name: "Not From Metadata" }, "Mira Admin", "admin"],
      [WORKER_ID, "worker@example.com", hashes.worker, { email_verified: true }, "Pemba Worker", "employee"],
      [FORMER_ID, "Former@Example.com", hashes.former, { email_verified: true }, "Former Staff", "employee"],
    ];
    for (const [id, email, passwordHash, meta, name, role] of users) {
      await client.query(
        `INSERT INTO auth.users (id, email, encrypted_password, raw_user_meta_data, created_at)
         VALUES ($1, $2, $3, $4, '2024-01-01T00:00:00Z')`,
        [id, email, passwordHash, meta],
      );
      await client.query(
        `INSERT INTO public.profiles (id, email, name, role, hourly_rate)
         VALUES ($1, $2, $3, $4, NULL)`,
        [id, email, name, role],
      );
    }
    await client.query(
      `INSERT INTO public.profiles (id, email, name, role, hourly_rate)
       VALUES ($1, 'orphan@example.com', 'Orphan Profile', 'employee', NULL)`,
      [ORPHAN_ID],
    );
    await client.query(
      `INSERT INTO public.employee_rates (id, user_id, hourly_rate, effective_from, created_at, created_by)
       VALUES
         ('11111111-1111-4111-8111-111111111111', $1, 22, '2026-01-01', '2026-01-01T00:00:00Z', NULL),
         ('11111111-1111-4111-8111-111111111112', $1, 26, '2026-10-01', '2026-10-01T00:00:00Z', $2)`,
      [WORKER_ID, ADMIN_ID],
    );
    await client.query(
      `INSERT INTO public.time_entries (
         id, user_id, work_date, hours, notes, status, hourly_rate, paid_at, paid_by, paid_reference, created_at
       ) VALUES
         ('22222222-2222-4222-8222-222222222221', $1, '2026-10-18', 4, 'Morning', 'submitted', 26, NULL, NULL, NULL, '2026-10-18T12:00:00Z'),
         ('22222222-2222-4222-8222-222222222222', $1, '2026-10-18', 3.5, 'Evening', 'paid', 26, '2026-10-19T00:00:00Z', NULL, 'Zelle', '2026-10-18T18:00:00Z')`,
      [WORKER_ID],
    );
  });
}

async function assertMigration(hashes) {
  const first = runMigration("Former@Example.com");
  if (first.status !== 0) throw new Error(first.stderr || first.stdout);
  await withClient(TARGET, async (client) => {
    const users = await client.query(`SELECT id, email, name, role, active, hourly_rate, password_hash FROM users ORDER BY email`);
    check(users.rows.length === 4, `expected 4 users, got ${users.rows.length}`);
    const byEmail = Object.fromEntries(users.rows.map((row) => [row.email, row]));
    check(byEmail["admin@example.com"].name === "Mira Admin", "name must come from profiles, not auth metadata");
    check(byEmail["admin@example.com"].role === "admin", "admin role");
    check(byEmail["admin@example.com"].hourly_rate === null, "profile hourly_rate stays null");
    check(byEmail["admin@example.com"].password_hash === hashes.admin, "bcrypt hash copied unchanged");
    check(byEmail["admin@example.com"].password_hash.startsWith("$2a$"), "imported hash keeps $2a$");
    check(byEmail["former@example.com"].active === false, "INACTIVE_EMAILS marks the user inactive");
    check(byEmail["worker@example.com"].active === true, "other users stay active");
    check(byEmail["orphan@example.com"].active === false, "profile without auth user is inactive");

    const sameDay = await client.query(
      `SELECT count(*)::int AS n FROM time_entries WHERE user_id = $1 AND work_date = '2026-10-18'`,
      [WORKER_ID],
    );
    check(sameDay.rows[0].n === 2, "split shifts on the same date are both kept");
    const paidBy = await client.query(
      `SELECT paid_by FROM time_entries WHERE id = '22222222-2222-4222-8222-222222222222'`,
    );
    check(paidBy.rows[0].paid_by === null, "null paid_by is preserved");
    const createdBy = await client.query(
      `SELECT created_by FROM employee_rates WHERE id = '11111111-1111-4111-8111-111111111111'`,
    );
    check(createdBy.rows[0].created_by === null, "null created_by is preserved");
    const uniques = await client.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'time_entries'::regclass AND contype = 'u'`,
    );
    check(uniques.rows.length === 0, "time_entries must not have a unique constraint");
    const ledger = await client.query(`SELECT to_regclass('public.ledger_summary') AS name`);
    check(ledger.rows[0].name === null, "ledger_summary is not created");
    await client.query(`UPDATE users SET name = 'Changed', active = true WHERE id = $1`, [FORMER_ID]);
  });

  const second = runMigration("Former@Example.com");
  if (second.status !== 0) throw new Error(second.stderr || second.stdout);
  await withClient(TARGET, async (client) => {
    const again = await client.query(`SELECT count(*)::int AS n FROM users`);
    check(again.rows[0].n === 4, "second migration does not duplicate users");
    const former = await client.query(`SELECT name, active, password_hash FROM users WHERE id = $1`, [FORMER_ID]);
    check(former.rows[0].name === "Former Staff", "re-run restores profile fields from the source");
    check(former.rows[0].active === false, "re-run keeps INACTIVE_EMAILS inactive");
    check(former.rows[0].password_hash === hashes.former, "re-run keeps the source bcrypt hash");
    const entries = await client.query(`SELECT count(*)::int AS n FROM time_entries`);
    check(entries.rows[0].n === 2, "second migration does not duplicate entries");
  });

  const missing = runMigration("Former@Example.com, missing.person@example.com");
  check(missing.status === 1, "unknown INACTIVE_EMAILS should fail the migration");
  await withClient(TARGET, async (client) => {
    const count = await client.query(`SELECT count(*)::int AS n FROM users`);
    check(count.rows[0].n === 4, "failed migration rolls back");
  });
}

async function seedApi(hashes) {
  await withClient(TARGET, async (client) => {
    await client.query(`TRUNCATE time_entries, employee_rates, login_attempts, users CASCADE`);
    const people = [
      [ADMIN_ID, "admin@example.com", hashes.admin, "Mira Admin", "admin", true],
      [WORKER_ID, "worker@example.com", hashes.worker, "Pemba Worker", "employee", true],
      [OTHER_ID, "other@example.com", hashes.other, "Dolma Other", "employee", true],
      [FORMER_ID, "former@example.com", hashes.former, "Former Staff", "employee", false],
      [LOCK_ID, "lockout@example.com", hashes.lock, "Lock Out", "employee", true],
    ];
    for (const [id, email, passwordHash, name, role, active] of people) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, role, active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, email, passwordHash, name, role, active],
      );
    }
    await client.query(
      `INSERT INTO employee_rates (user_id, hourly_rate, effective_from, created_by)
       VALUES ($1, 20, '2024-01-01', $2), ($1, 30, '2026-06-01', $2)`,
      [WORKER_ID, ADMIN_ID],
    );
    await client.query(
      `INSERT INTO time_entries (id, user_id, work_date, hours, notes, status, hourly_rate, paid_at, paid_by, paid_reference)
       VALUES
         ('33333333-3333-4333-8333-333333333331', $1, '2026-10-09', 6.5, 'Paid day', 'paid', 30, now(), $2, 'Zelle 1042'),
         ('33333333-3333-4333-8333-333333333332', $1, '2026-10-18', 4, 'Open day', 'submitted', 30, NULL, NULL, NULL),
         ('33333333-3333-4333-8333-333333333333', $3, '2026-10-03', 5, 'Other person', 'submitted', 20, NULL, NULL, NULL),
         ('33333333-3333-4333-8333-333333333334', $4, '2026-10-04', 2, 'Former person', 'submitted', 18, NULL, NULL, NULL)`,
      [WORKER_ID, ADMIN_ID, OTHER_ID, FORMER_ID],
    );
  });
}

async function apiTests(base, hashes) {
  const openId = "33333333-3333-4333-8333-333333333332";
  const paidId = "33333333-3333-4333-8333-333333333331";
  const otherId = "33333333-3333-4333-8333-333333333333";
  const formerEntryId = "33333333-3333-4333-8333-333333333334";

  const anonymous = await request(base, "/api/auth/session");
  check(
    anonymous.status === 200 && anonymous.data.user === null && anonymous.data.reason === "unauthenticated",
    "anonymous session is empty",
  );

  const removedLogin = await request(base, "/api/auth/login", {
    method: "POST",
    body: { email: "worker@example.com", password: "Worker-Pass-123" },
  });
  check(removedLogin.status === 404, "password login is removed");

  const inactive = await request(base, "/api/auth/session", { email: "former@example.com" });
  check(inactive.status === 200 && inactive.data.reason === "not_setup", "inactive user is not set up");
  check(
    inactive.data.message === "Your account isn't set up in Timesheet. Ask Robin.",
    "inactive session explains who to ask",
  );
  const inactiveMe = await request(base, "/api/me", { email: "former@example.com" });
  check(inactiveMe.status === 403, "inactive user cannot call the API");

  const workerSession = await request(base, "/api/auth/session", { email: "Worker@Example.com" });
  check(workerSession.status === 200 && workerSession.data.user.email === "worker@example.com", "email maps case-insensitively");
  check(workerSession.data.user.role === "employee", "mapped user keeps the employee role");
  check(!JSON.stringify(workerSession.data).includes("password"), "session response has no password hash");

  const workerEntries = await request(base, `/api/entries?userId=${OTHER_ID}`, { email: "worker@example.com" });
  check(workerEntries.status === 200, "employee can list entries");
  const workerIds = workerEntries.data.entries.map((entry) => entry.userId);
  check(workerIds.every((id) => id === WORKER_ID), "employee cannot see other people's entries");
  check(!workerIds.includes(OTHER_ID) && !workerIds.includes(FORMER_ID), "foreign entries are absent");

  const forbiddenUsers = await request(base, "/api/users", { email: "worker@example.com" });
  check(forbiddenUsers.status === 403, "employee cannot list the team");
  const forbiddenPay = await request(base, "/api/admin/pay", {
    method: "POST",
    email: "worker@example.com",
    body: { userId: WORKER_ID },
  });
  check(forbiddenPay.status === 403, "employee cannot mark entries paid");
  const forbiddenRate = await request(base, "/api/rates", {
    method: "POST",
    email: "worker@example.com",
    body: { userId: WORKER_ID, hourlyRate: 40, effectiveFrom: "2026-01-01" },
  });
  check(forbiddenRate.status === 403, "employee cannot create rates");
  const foreignRates = await request(base, `/api/rates?userId=${OTHER_ID}`, { email: "worker@example.com" });
  check(foreignRates.status === 403, "employee cannot read someone else's rates");
  const ownRates = await request(base, "/api/rates", { email: "worker@example.com" });
  check(ownRates.status === 200 && ownRates.data.rates.length === 2, "employee can read their own rates");

  const escalate = await request(base, "/api/me", {
    method: "PATCH",
    email: "worker@example.com",
    body: { role: "admin" },
  });
  check(escalate.status === 403, "employee cannot change their role");

  const editPaid = await request(base, `/api/entries/${paidId}`, {
    method: "PATCH",
    email: "worker@example.com",
    body: { hours: 1 },
  });
  check(editPaid.status === 403, "employee cannot edit a paid entry");
  const editOther = await request(base, `/api/entries/${otherId}`, {
    method: "PATCH",
    email: "worker@example.com",
    body: { hours: 1 },
  });
  check(editOther.status === 404, "employee cannot edit someone else's entry");
  const remove = await request(base, `/api/entries/${openId}`, { method: "DELETE", email: "worker@example.com" });
  check(remove.status === 403, "employee cannot delete entries");
  const editOpen = await request(base, `/api/entries/${openId}`, {
    method: "PATCH",
    email: "worker@example.com",
    body: { hours: 4.5, notes: "Updated open day" },
  });
  check(editOpen.status === 200 && editOpen.data.entry.hours === 4.5, "employee can edit an unpaid entry");
  check(editOpen.data.entry.hourlyRate === 30, "editing hours keeps the saved rate");

  const noOrigin = await request(base, "/api/me", {
    method: "PATCH",
    email: "worker@example.com",
    origin: false,
    body: { name: "No Origin" },
  });
  check(noOrigin.status === 403, "mutating requests require an Origin header");

  const adminSession = await request(base, "/api/auth/session", { email: "admin@example.com" });
  check(adminSession.status === 200 && adminSession.data.user.role === "admin", "admin email maps to the admin role");

  const rewritten = await request(base, "/api?__path=auth/session", { email: "admin@example.com" });
  check(rewritten.status === 200 && rewritten.data.user.email === "admin@example.com", "rewritten /api path still routes");

  const allEntries = await request(base, "/api/entries?from=2026-10-01&to=2026-10-31", { email: "admin@example.com" });
  const visible = new Set(allEntries.data.entries.map((entry) => entry.id));
  check(visible.has(formerEntryId), "admin still sees an inactive user's entries");
  check(visible.has(otherId), "admin sees every employee's entries");

  const team = await request(base, "/api/users", { email: "admin@example.com" });
  check(team.data.users.some((user) => user.email === "former@example.com" && user.active === false), "team list includes inactive users");

  const zeroRate = await request(base, "/api/entries", {
    method: "POST",
    email: "worker@example.com",
    body: { workDate: "2023-01-01", hours: 1, notes: "before rates", hourlyRate: 999 },
  });
  check(zeroRate.status === 201 && zeroRate.data.entry.hourlyRate === 0, "no rate on or before the date snapshots $0");
  check(zeroRate.data.rateFound === false, "client cannot supply the rate");
  const midRate = await request(base, "/api/entries", {
    method: "POST",
    email: "worker@example.com",
    body: { workDate: "2025-05-01", hours: 2, notes: "first rate" },
  });
  check(midRate.data.entry.hourlyRate === 20, "snapshot uses the latest rate on or before the date");
  const newRate = await request(base, "/api/entries", {
    method: "POST",
    email: "worker@example.com",
    body: { workDate: "2026-06-01", hours: 3, notes: "raise day" },
  });
  check(newRate.data.entry.hourlyRate === 30, "snapshot uses the rate effective that day");
  const splitA = await request(base, "/api/entries", {
    method: "POST",
    email: "worker@example.com",
    body: { workDate: "2026-10-20", hours: 4, notes: "Morning shift" },
  });
  const splitB = await request(base, "/api/entries", {
    method: "POST",
    email: "worker@example.com",
    body: { workDate: "2026-10-20", hours: 3.5, notes: "Evening shift" },
  });
  check(splitA.status === 201 && splitB.status === 201, "two entries on the same date are allowed");

  const tooLong = await request(base, "/api/entries", {
    method: "POST",
    email: "worker@example.com",
    body: { workDate: "2026-10-21", hours: 30, notes: "too long" },
  });
  check(tooLong.status === 400, "more than 24 hours is rejected");

  const pay = await request(base, "/api/admin/pay", {
    method: "POST",
    email: "admin@example.com",
    body: { userId: WORKER_ID, from: "2026-10-01", to: "2026-10-31", reference: "Check 88" },
  });
  check(pay.status === 200 && pay.data.updated >= 1, "admin marks unpaid entries in the range");
  await withClient(TARGET, async (client) => {
    const paid = await client.query(`SELECT status, paid_by, paid_reference, hours FROM time_entries WHERE id = $1`, [openId]);
    check(paid.rows[0].status === "paid" && paid.rows[0].paid_by === ADMIN_ID, "pay sets status and paid_by");
    check(paid.rows[0].paid_reference === "Check 88", "pay stores the reference");
    const already = await client.query(`SELECT paid_reference FROM time_entries WHERE id = $1`, [paidId]);
    check(already.rows[0].paid_reference === "Zelle 1042", "already-paid rows are left alone");
    const outside = await client.query(
      `SELECT status FROM time_entries WHERE user_id = $1 AND work_date = '2026-06-01'`,
      [WORKER_ID],
    );
    check(outside.rows[0].status === "submitted", "entries outside the date range stay unpaid");
  });

  const adminEditPaid = await request(base, `/api/entries/${paidId}`, {
    method: "PATCH",
    email: "admin@example.com",
    body: { hours: 6 },
  });
  check(adminEditPaid.status === 200 && adminEditPaid.data.entry.hours === 6, "admin can correct a paid entry");
  const employeeLocked = await request(base, `/api/entries/${openId}`, {
    method: "PATCH",
    email: "worker@example.com",
    body: { hours: 1 },
  });
  check(employeeLocked.status === 403, "employee still cannot edit after it is paid");

  const created = await request(base, "/api/users", {
    method: "POST",
    email: "admin@example.com",
    body: { name: "New Hire", email: "new.hire@example.com", password: "New-Hire-123", role: "employee" },
  });
  check(created.status === 201, "admin can create an employee without a password");
  const hire = await request(base, "/api/me", { email: "new.hire@example.com" });
  check(hire.status === 200 && hire.data.user.role === "employee", "created employee is mapped by email");
  await withClient(TARGET, async (client) => {
    const hireRow = await client.query(`SELECT password_hash FROM users WHERE email = 'new.hire@example.com'`);
    check(hireRow.rows[0].password_hash === "not-used", "new accounts do not store a password");
    const kept = await client.query(`SELECT password_hash FROM users WHERE email = 'worker@example.com'`);
    check(kept.rows[0].password_hash === hashes.worker, "existing password hashes stay in the table");
  });

  const reset = await request(base, `/api/users/${WORKER_ID}/password`, {
    method: "POST",
    email: "admin@example.com",
    body: { password: "Reset-Pass-123" },
  });
  check(reset.status === 404, "password reset is removed");
  const changed = await request(base, "/api/auth/password", {
    method: "POST",
    email: "worker@example.com",
    body: { currentPassword: "Reset-Pass-123", newPassword: "Changed-Pass-123" },
  });
  check(changed.status === 404, "password change is removed");

  const selfDemote = await request(base, `/api/users/${ADMIN_ID}`, {
    method: "PATCH",
    email: "admin@example.com",
    body: { active: false },
  });
  check(selfDemote.status === 400, "admin cannot deactivate their own account");
}

async function main() {
  const hashes = {
    admin: await hash2a("Admin-Pass-123"),
    worker: await hash2a("Worker-Pass-123"),
    other: await hash2a("Other-Pass-123"),
    former: await hash2a("Former-Pass-123"),
    lock: await hash2a("Lock-Pass-123"),
  };
  await resetDatabases();
  await seedSource(hashes);
  await assertMigration(hashes);
  await seedApi(hashes);

  process.env.DATABASE_URL = TARGET;
  process.env.ACCESS_DEV_BYPASS = "1";
  delete process.env.ACCESS_DEV_EMAIL;
  delete process.env.ACCESS_AUD;
  const { startServer } = await import("../server/local-server.js");
  const { closePool } = await import("../server/db.js");
  const started = await startServer(0);
  try {
    await apiTests(started.url, hashes);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
    await closePool();
  }
  console.log("All API and migration checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
