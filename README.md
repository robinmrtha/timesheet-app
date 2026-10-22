# Himalayan Bazaar timesheets

Employees sign in and log hours. Admins review totals, set hourly rates, mark a date range paid, and manage accounts.

The app runs on Vercel (Hobby) and Neon Postgres. The same code can also run on Cloudflare Workers without taking Vercel down; see [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md). The browser talks only to `/api`. Passwords stay cost-10 bcrypt, including the `$2a$` hashes exported from Supabase. Vercel checks them with bcryptjs. Workers check them with Postgres `pgcrypto` so the free-plan CPU limit is not spent inside bcryptjs. The session is an HttpOnly cookie.

## Environment variables

Set these on the Vercel project (`timesheet-app-eict`) for Production (and Preview, if you use it):

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon **pooled** connection string (`-pooler` hostname). The API uses `pg`. |
| `AUTH_SECRET` | Yes | Signs the session cookie. Use at least 32 random characters (`openssl rand -base64 32`). |

Do not set `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`. Nothing in the client reads them.

Migration-only variables, used on your machine, not on Vercel:

| Name | Purpose |
| --- | --- |
| `SUPABASE_DB_URL` | Direct Supabase Postgres URL (`db.<ref>.supabase.co:5432`). Not the transaction pooler on port 6543. |
| `DATABASE_URL` | Direct Neon URL (no `-pooler`) while you apply the schema and copy rows. |
| `INACTIVE_EMAILS` | Optional comma-separated emails to mark `active = false`. Their hours stay in the database. |

## Cutover from Supabase

1. Create a Neon project on the free plan and copy both connection strings (pooled and direct).
2. Apply the schema with the **direct** URL:

   ```bash
   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f db/schema.sql
   ```

3. Copy the data. This keeps the existing user UUIDs and bcrypt hashes, so time entries and rates stay linked and current passwords still work. `ledger_summary` is not copied.

   ```bash
   SUPABASE_DB_URL="postgres://..." \
   DATABASE_URL="postgres://...direct-neon-host..." \
   INACTIVE_EMAILS="samnrodriguez@gmail.com" \
   npm run migrate
   ```

   The script is safe to re-run: rows are updated by id. Emails in `INACTIVE_EMAILS` are set inactive on every run. A missing email aborts the copy. Re-running overwrites names, roles, and password hashes with the Supabase values, so do the final run after people have stopped using the old app.

4. In Vercel, set `DATABASE_URL` to the **pooled** Neon string and set `AUTH_SECRET`. Remove the Supabase env vars.
5. Merge this branch to `main`. Vercel builds the Vite app and the `/api` function from that branch.
6. Sign in as an admin and as an employee with their existing passwords. Confirm inactive staff cannot sign in and that their old hours still show for admins.
7. After that check, pause or remove the Supabase project so it stops waking up.

## Local development

```bash
npm install
createdb timesheet
psql "$DATABASE_URL" -f db/schema.sql
npm run seed:demo
npm run dev
```

`seed:demo` loads sample October 2026 hours and refuses to touch a `neon.tech` host unless `ALLOW_DEMO_SEED=1`. Sample sign-ins:

- `mira@example.com` / `Mira-Admin-2026` (admin, no rate row)
- `pemba@example.com` / `Pemba-Hours-2026`
- `dolma@example.com` / `Dolma-Hours-2026`
- `sam.inactive@example.com` / `Sam-Inactive-2026` (inactive; history remains)

`npm test` builds nothing. It checks password verification, client IP selection, and which database driver each runtime uses against `timesheet_cf`, then resets `timesheet_test` and `timesheet_source`, runs the migration, and checks the API as both an admin and an employee. `npm run build` produces the static client. `npm run cf:dev` and `npm run cf:deploy` are the Workers commands; see [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md).

## Access rules

Enforced in the API, not in the browser:

- A person can read and update their own name, and can read and insert their own time entries.
- They can update their own entries only while the status is not `paid`. They cannot delete entries.
- Admins can read and update every profile, including the active flag, and can create accounts and set passwords.
- Admins can read, update, and delete every time entry, and can mark a person’s unpaid entries paid for a date range.
- Rate rows are readable by the person they belong to. Only admins insert, update, or delete them.
- Inactive users cannot sign in. Admins still see them in the team list and in reports.
- There is no self sign-up and no emailed password reset. An admin sets the new password and shares it directly.

Submitting hours stores the hourly rate from `employee_rates` whose `effective_from` is on or before the work date (latest one). Later raises do not change older entries. Several entries on the same day are allowed.
