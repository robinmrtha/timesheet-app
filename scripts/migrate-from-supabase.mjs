#!/usr/bin/env node
/**
 * Copy Supabase auth users, profiles, time entries, and employee rates into Neon.
 *
 * Required:
 *   SUPABASE_DB_URL  direct Postgres URL for the Supabase project (not the transaction pooler)
 *   DATABASE_URL     direct Postgres URL for the empty Neon database (schema already applied)
 *
 * Optional:
 *   INACTIVE_EMAILS  comma-separated emails to mark active = false (history is kept)
 *
 * The script is idempotent: re-running updates rows by id and does not duplicate them.
 * Re-runs copy passwords and profile fields from Supabase again. Active flags are not
 * turned back on. Emails in INACTIVE_EMAILS are set inactive on every run.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

pg.types.setTypeParser(1082, (value) => value);

const STATUSES = new Set(["submitted", "approved", "paid"]);

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
}

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

function inactiveList() {
  return [...new Set(
    (process.env.INACTIVE_EMAILS || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeRole(role, id) {
  if (role == null || role === "") return "employee";
  if (role === "admin" || role === "employee") return role;
  throw new Error(`User ${id} has unexpected role "${role}"`);
}

function matchesInactive(inactive, ...emails) {
  return emails.some((email) => email && inactive.includes(email));
}

async function upsertUser(client, user) {
  await client.query(
    `INSERT INTO users (id, email, password_hash, name, role, hourly_rate, active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       password_hash = EXCLUDED.password_hash,
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       hourly_rate = EXCLUDED.hourly_rate,
       updated_at = now()`,
    [
      user.id,
      user.email,
      user.passwordHash,
      user.name,
      user.role,
      user.hourlyRate,
      user.active,
      user.createdAt,
    ],
  );
}

async function main() {
  const sourceUrl = required("SUPABASE_DB_URL");
  const targetUrl = required("DATABASE_URL");
  const inactive = inactiveList();
  const source = new pg.Client({
    connectionString: sourceUrl,
    ssl: sslFor(sourceUrl),
    application_name: "timesheet-migrate-source",
  });
  const target = new pg.Client({
    connectionString: targetUrl,
    ssl: sslFor(targetUrl),
    application_name: "timesheet-migrate-target",
  });

  await source.connect();
  await target.connect();
  try {
    const ready = await target.query(`SELECT to_regclass('public.users') AS users`);
    if (!ready.rows[0].users) {
      throw new Error(
        "Target database has no users table. Apply db/schema.sql with a direct Neon connection first.",
      );
    }

    const authUsers = await source.query(`
      SELECT u.id,
             u.email AS auth_email,
             u.encrypted_password,
             u.created_at,
             p.email AS profile_email,
             p.name,
             p.role,
             p.hourly_rate
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
    `);
    const orphans = await source.query(`
      SELECT p.id, p.email, p.name, p.role, p.hourly_rate
      FROM public.profiles p
      LEFT JOIN auth.users u ON u.id = p.id
      WHERE u.id IS NULL
    `);
    const rates = await source.query(`
      SELECT id, user_id, hourly_rate, effective_from, created_at, created_by
      FROM public.employee_rates
    `);
    const entries = await source.query(`
      SELECT id, user_id, work_date, hours, notes, status, unpaid_reason,
             approved_at, approved_by, paid_at, paid_by, paid_reference,
             created_at, hourly_rate
      FROM public.time_entries
    `);

    const seenEmails = new Set();
    const forceInactive = [];

    await target.query("BEGIN");
    try {
      for (const row of authUsers.rows) {
        const email = String(row.auth_email || "").trim().toLowerCase();
        if (!email) throw new Error(`auth.users ${row.id} has no email`);
        const profileEmail = row.profile_email ? String(row.profile_email).trim().toLowerCase() : "";
        if (profileEmail && profileEmail !== email) {
          console.warn(
            `User ${row.id}: profile email differs from the login email. The login email is kept.`,
          );
        }
        seenEmails.add(email);
        if (profileEmail) seenEmails.add(profileEmail);

        let passwordHash = row.encrypted_password;
        let active = !matchesInactive(inactive, email, profileEmail);
        if (typeof passwordHash !== "string" || !passwordHash.startsWith("$2")) {
          console.warn(`User ${email} has no bcrypt password and will be inactive.`);
          passwordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
          active = false;
          forceInactive.push(row.id);
        } else if (!active) {
          forceInactive.push(row.id);
        }

        await upsertUser(target, {
          id: row.id,
          email,
          passwordHash,
          name: row.name ?? null,
          role: normalizeRole(row.role, row.id),
          hourlyRate: row.hourly_rate,
          active,
          createdAt: row.created_at || new Date(),
        });
      }

      for (const row of orphans.rows) {
        const email = String(row.email || "").trim().toLowerCase();
        if (!email) throw new Error(`Profile ${row.id} has no auth user and no email`);
        seenEmails.add(email);
        console.warn(`Profile ${email} has no auth.users row. Importing inactive, with no known password.`);
        forceInactive.push(row.id);
        await upsertUser(target, {
          id: row.id,
          email,
          passwordHash: await bcrypt.hash(randomBytes(24).toString("hex"), 10),
          name: row.name ?? null,
          role: normalizeRole(row.role, row.id),
          hourlyRate: row.hourly_rate,
          active: false,
          createdAt: new Date(),
        });
      }

      if (forceInactive.length) {
        await target.query(
          `UPDATE users SET active = false, updated_at = now() WHERE id = ANY($1::uuid[])`,
          [forceInactive],
        );
      }

      const missing = inactive.filter((email) => !seenEmails.has(email));
      if (missing.length) {
        throw new Error(`INACTIVE_EMAILS not found in Supabase: ${missing.join(", ")}`);
      }

      for (const row of rates.rows) {
        await target.query(
          `INSERT INTO employee_rates (id, user_id, hourly_rate, effective_from, created_at, created_by)
           VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6)
           ON CONFLICT (id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             hourly_rate = EXCLUDED.hourly_rate,
             effective_from = EXCLUDED.effective_from,
             created_at = EXCLUDED.created_at,
             created_by = EXCLUDED.created_by`,
          [row.id, row.user_id, row.hourly_rate, row.effective_from, row.created_at, row.created_by],
        );
      }

      for (const row of entries.rows) {
        if (row.status && !STATUSES.has(row.status)) {
          throw new Error(`Time entry ${row.id} has unsupported status "${row.status}"`);
        }
        await target.query(
          `INSERT INTO time_entries (
             id, user_id, work_date, hours, notes, status, unpaid_reason,
             approved_at, approved_by, paid_at, paid_by, paid_reference, created_at, hourly_rate
           ) VALUES (
             $1, $2, $3, $4, $5, COALESCE($6, 'submitted'), $7,
             $8, $9, $10, $11, $12, COALESCE($13, now()), $14
           )
           ON CONFLICT (id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             work_date = EXCLUDED.work_date,
             hours = EXCLUDED.hours,
             notes = EXCLUDED.notes,
             status = EXCLUDED.status,
             unpaid_reason = EXCLUDED.unpaid_reason,
             approved_at = EXCLUDED.approved_at,
             approved_by = EXCLUDED.approved_by,
             paid_at = EXCLUDED.paid_at,
             paid_by = EXCLUDED.paid_by,
             paid_reference = EXCLUDED.paid_reference,
             created_at = EXCLUDED.created_at,
             hourly_rate = EXCLUDED.hourly_rate`,
          [
            row.id,
            row.user_id,
            row.work_date,
            row.hours,
            row.notes,
            row.status,
            row.unpaid_reason,
            row.approved_at,
            row.approved_by,
            row.paid_at,
            row.paid_by,
            row.paid_reference,
            row.created_at,
            row.hourly_rate,
          ],
        );
      }

      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }

    const counts = await target.query(`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM users WHERE active = false) AS inactive_users,
        (SELECT count(*)::int FROM time_entries) AS time_entries,
        (SELECT count(*)::int FROM employee_rates) AS employee_rates
    `);
    console.log(
      JSON.stringify(
        {
          ok: true,
          inactiveEmails: inactive,
          source: {
            authUsers: authUsers.rows.length,
            orphanProfiles: orphans.rows.length,
            timeEntries: entries.rows.length,
            employeeRates: rates.rows.length,
          },
          target: counts.rows[0],
        },
        null,
        2,
      ),
    );
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  const secrets = [process.env.SUPABASE_DB_URL, process.env.DATABASE_URL].filter(Boolean);
  let message = error?.stack || String(error);
  for (const secret of secrets) message = message.split(secret).join("[redacted]");
  console.error(message);
  process.exit(1);
});
