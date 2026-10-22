# Himalayan Bazaar timesheets

Employees sign in and log hours. Admins review totals, set hourly rates, mark a date range paid, and manage accounts.

The app runs on Cloudflare Workers and Neon Postgres. See [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md). The browser talks only to `/api`. Sign-in is Cloudflare Access (Google or an email code) on `hbzr.cloudflareaccess.com`. The Worker checks the Access JWT and maps its email to a row in `users`. There is no Timesheet password. Old password hashes stay in the database and are not checked.

## Environment variables

Set these on the Worker (`hbzr-timesheet`). `npm run dev` also reads them from `.env`.

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon **pooled** connection string (`-pooler` hostname). The API uses `pg` on Vercel and Neon HTTP on Workers. |
| `ACCESS_AUD` | Yes | Cloudflare Access application audience tag. The Worker requires this on the JWT `aud` claim. |

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

3. Copy the data. This keeps the existing user UUIDs and the old bcrypt hashes (they stay in the table and are not used to sign in). `ledger_summary` is not copied.

   ```bash
   SUPABASE_DB_URL="postgres://..." \
   DATABASE_URL="postgres://...direct-neon-host..." \
   INACTIVE_EMAILS="samnrodriguez@gmail.com" \
   npm run migrate
   ```

   The script is safe to re-run: rows are updated by id. Emails in `INACTIVE_EMAILS` are set inactive on every run. A missing email aborts the copy. Re-running overwrites names, roles, and password hashes with the Supabase values, so do the final run after people have stopped using the old app.

4. Set `DATABASE_URL` to the **pooled** Neon string and `ACCESS_AUD` to the AUD tag of the single Access application for `hbzr.us`. Remove the Supabase env vars. Leave `PERMISSIONS_ROLE_FALLBACK` unset. There is no permissions token; the Worker calls the hub through the `HUB` service binding.
5. Deploy the Worker (see [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md)). Access must be in front of the hostname.
6. Sign in through Cloudflare Access as an admin and as an employee whose email matches `users.email`. Confirm an unknown or inactive email sees the “Ask Robin” page, and that old hours still show for admins.
7. After that check, pause or remove the Supabase project so it stops waking up.

## Local development

```bash
npm install
createdb timesheet
psql "$DATABASE_URL" -f db/schema.sql
npm run seed:demo
# In .env: ACCESS_DEV_BYPASS=1, ACCESS_DEV_EMAIL=mira@example.com, PERMISSIONS_ROLE_FALLBACK=1
npm run dev
```

Open `http://127.0.0.1:5173/timesheet/`. The apex of that dev server redirects there.

`seed:demo` loads sample October 2026 hours and refuses to touch a `neon.tech` host unless `ALLOW_DEMO_SEED=1`. For `npm run dev`, set `ACCESS_DEV_BYPASS=1`, `PERMISSIONS_ROLE_FALLBACK=1`, and `ACCESS_DEV_EMAIL` to one of:

- `mira@example.com` (admin, no rate row)
- `pemba@example.com`
- `dolma@example.com`
- `sam.inactive@example.com` (inactive; the app asks them to talk to Robin, and the history remains)

`npm test` builds nothing. It checks Access JWT verification, email-to-user mapping, the permissions adapter (including fail-closed lookups), client IP selection, and which database driver each runtime uses against `timesheet_cf` and `timesheet_perm`, then resets `timesheet_test` and `timesheet_source`, runs the migration, and checks the API. The older API checks turn on `PERMISSIONS_ROLE_FALLBACK` so they still follow `users.role`. `npm run build` produces the static client. `npm run cf:dev` and `npm run cf:deploy` are the Workers commands; see [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md).

## Access rules

The API calls the hub (`env.HUB`, service `hbzr-app`, entrypoint `Hub`) at `https://hbzr.us/internal/permissions?email=…` for `none`, `view`, or `edit` on `timesheet.own`, `timesheet.team`, `timesheet.payroll`, and `timesheet.admin`. Owners get edit on all four even when `active` is false. Anyone else with `active: false` is refused. A missing section, a bad response, or an error is no access. The browser hides tabs and disables edits to match; the API is the check. The public route is `hbzr.us/timesheet*` only.

With `PERMISSIONS_ROLE_FALLBACK=1` (local only, off in production), an active admin has edit on every section and anyone else has edit on their own hours:

- A person can read and update their own name, and can read and insert their own time entries.
- They can update their own entries only while the status is not `paid`. They cannot delete entries.
- Admins can read and update every profile, including the active flag, and can add someone by the email they use with Cloudflare Access.
- Admins can read, update, and delete every time entry, and can mark a person’s unpaid entries paid for a date range.
- Rate rows are readable by the person they belong to. Only admins insert, update, or delete them.
- Inactive users, and emails that are not in `users`, see “Your account isn't set up in Timesheet. Ask Robin.” Someone with a user row but no section access sees “Ask Robin for access.” Admins still see inactive people in the team list and in reports.
- There is no self sign-up and no Timesheet password. Access is the only login. Log out goes to `https://hbzr.cloudflareaccess.com/cdn-cgi/access/logout`.

Submitting hours stores the hourly rate from `employee_rates` whose `effective_from` is on or before the work date (latest one). Later raises do not change older entries. Several entries on the same day are allowed.
