# Deploy the timesheet app on Cloudflare Workers

Vercel stays the production target until you cut DNS over. Both targets build from `main`:

| | Vercel (current) | Cloudflare Workers |
| --- | --- | --- |
| App | Vite build, `vercel.json` SPA rewrite | Vite build, Workers static assets, SPA fallback |
| API | `api/index.js` rewrites `/api/*` to `server/router.js` | `worker/index.js` sends `/api` and `/api/*` to the same router |
| Database | `pg` + `@vercel/functions` `attachDatabasePool` | `@neondatabase/serverless` HTTP, except localhost (see below) |
| Secrets | Vercel project env | `wrangler secret put` (`DATABASE_URL`, `AUTH_SECRET`) |

Do not commit secret values. `wrangler.jsonc` lists the secret **names** only.

## Database driver

Workers use the Neon serverless driver’s HTTP API (`neon()` from `@neondatabase/serverless`, `fullResults: true`). Each query is a `fetch` to Neon’s SQL-over-HTTP endpoint. Time spent waiting on that fetch does not count toward the Worker CPU limit.

This fits the Neon free plan and this app better than `pg` through Hyperdrive:

- The free Neon plan already exposes SQL-over-HTTP. No Hyperdrive config id, and the Worker secret stays the same pooled `DATABASE_URL` Vercel uses (hostname contains `-pooler`).
- The API issues one statement at a time. There is no multi-statement transaction. A login is a handful of queries, under the free-plan limit of 50 external subrequests per request.
- Hyperdrive is on the Workers free plan (100,000 queries per day) and would let us keep `pg`, but it caches non-mutating queries by default. Hours, pay status, and lockouts need to be visible on the next request. Turning that cache off removes the reason to add another service.
- Hyperdrive would also replace `DATABASE_URL` with a binding connection string. The HTTP driver reads the secret directly.

Vercel does not take this path. Outside Workers, `server/db.js` still uses `pg` and `attachDatabasePool`. Both drivers return `DATE` columns as `YYYY-MM-DD` strings, so a browser in the US or Nepal does not shift the work date.

`wrangler dev` against `localhost` / `127.0.0.1` uses `pg` over TCP, because local Postgres does not speak Neon’s HTTP protocol. Any other host, including Neon, uses the HTTP driver. Use one client per query in local dev so a connection is not reused across Workers requests.

People in the US and Nepal hit a Worker near them. The hop to Neon is wall-clock time, not CPU. If the Neon compute is in the US, Nepal is slower by that round trip, and a compute that has scaled to zero adds a cold start of a few hundred milliseconds on the first query. Use the pooled connection string either way.

## Passwords and the 10 ms CPU limit

The Workers free plan allows **10 ms of CPU time per HTTP request**. Waiting on the network does not count. [Limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

Existing hashes are bcrypt cost 10 (`$2a$` from Supabase, `$2b$` from bcryptjs). They have to keep working, and nobody should reset a password for the move.

Measured on this machine. Node 22 figures are the middle of three runs. The workerd column is one request to a local Worker (`navigator.userAgent` was `Cloudflare-Workers`):

| Operation | Node 22 | local workerd |
| --- | --- | --- |
| `bcryptjs` `compare`, cost 10 | 62 ms | 72 ms |
| PBKDF2-SHA256, 20,000 iterations (`crypto.subtle`) | 3 ms | 2 ms |
| PBKDF2-SHA256, 100,000 iterations | 12 ms | 12 ms |
| PBKDF2-SHA256, 600,000 iterations (OWASP 2023) | 72 ms | 71 ms |

`wrangler dev` does not enforce the 10 ms cap, so these are the cost of the work, not a production CPU trace from Cloudflare’s edge.

Cloudflare recommends the Web Crypto API because it is faster than pure JavaScript, not because it is excluded from CPU time. Native PBKDF2 at a cost comparable to bcrypt does not fit in 10 ms. Dropping to ~20,000 iterations would fit and would be a weaker hash than the cost-10 bcrypt already stored.

So the Worker does not re-hash, and it does not run bcryptjs on the Neon path:

- Verification is `SELECT crypt($1, $2) = $2` in Postgres (`pgcrypto`). Cost-10 bcrypt runs on the database. The Worker waits on the query.
- New passwords on Workers are `crypt(password, gen_salt('bf', 10))`, still `$2a$` cost 10.
- Vercel keeps bcryptjs. It can verify pgcrypto hashes, and pgcrypto can verify bcryptjs hashes.
- `pgcrypto` does not accept a `$2b$` or `$2y$` label (it returns false, it does not throw). The Worker copies that prefix to `$2a$` for the `crypt()` call only. The value stored in `users.password_hash` stays as it was. Checked for ASCII, non-ASCII, and high-bit passwords against PostgreSQL 16.
- The password is a bound parameter, not interpolated into the SQL text. Application logs record the backend name and Postgres error codes, not the password or the query text.
- Unknown emails are checked against a precomputed cost-10 dummy hash. The Worker never calls `bcrypt.hash()` during a request.

Before the first Workers login, enable the extension once on the **direct** Neon connection (no `-pooler`):

```bash
psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

`db/schema.sql` already includes that statement for new databases. A pooled connection can run `crypt()` afterwards; it should not be used to create the extension.

## Local development

```bash
npm install
createdb timesheet   # or any local database
psql "$DATABASE_URL" -f db/schema.sql
cp .dev.vars.example .dev.vars
# Edit .dev.vars: local DATABASE_URL and an AUTH_SECRET of at least 16 characters.
npm run cf:dev
```

`npm run cf:dev` builds the Vite client into `dist/` and starts `wrangler dev` (default http://127.0.0.1:8787). `.dev.vars` is gitignored. If that file exists, Wrangler does not also load `.env`.

Sign in, then call an API such as `GET /api/me` with the `hb_session` cookie. `POST` requests need an `Origin` header equal to the page origin.

`npm test` resets the local `timesheet_test`, `timesheet_source`, and `timesheet_cf` databases. It checks pgcrypto verification (including a `$2b$` hash), bcryptjs verification of a pgcrypto hash, client IP selection, and the existing API.

## Deploy the Worker (no custom domain yet)

This does not attach `hbzr.us` and does not change Vercel.

```bash
npx wrangler login
printf '%s' "$DATABASE_URL" | npx wrangler secret put DATABASE_URL
printf '%s' "$AUTH_SECRET" | npx wrangler secret put AUTH_SECRET
npm run cf:deploy
```

Use the pooled Neon URL for `DATABASE_URL`, the same value as on Vercel. Use the same `AUTH_SECRET` as Vercel so a session cookie issued on one host verifies on the other after DNS moves.

`wrangler deploy` refuses to continue when `DATABASE_URL` or `AUTH_SECRET` is missing on the Worker. `npm run cf:deploy` is `npm run build && wrangler deploy`.

Open the `workers.dev` URL Wrangler prints (`hbzr-timesheet.<account>.workers.dev`). Sign in as an admin and as an employee with their current passwords. Confirm an inactive account still cannot sign in, and that a new entry shows up on refresh.

Workers Logs and traces are enabled at full sample rate. This is a small staff app. Lower `observability.logs.head_sampling_rate` and `observability.traces.head_sampling_rate` in `wrangler.jsonc` if the volume grows. The top-level `observability.enabled` flag turns on logs; traces are enabled on their own.

## Cut over hbzr.us

Do this only after the `workers.dev` check. The Worker config intentionally has no route, so deploy does not take the domain.

`hbzr.us` has to be an active zone on the same Cloudflare account. Custom domains are not created on a hostname that already has a CNAME. Vercel’s record has to be removed before the Worker domain can be added, so this step is the cut.

1. In the Cloudflare dashboard, open the `hbzr.us` zone and confirm the account owns it. If the zone is still on another DNS host, add the site to Cloudflare and point the registrar at Cloudflare’s nameservers first. Leave the existing records in place until the window below.
2. Remove the Vercel DNS record for the hostname you are moving (apex `hbzr.us`, and `www` if you use it).
3. Attach the Worker. Either in the dashboard: **Workers & Pages** → **hbzr-timesheet** → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `hbzr.us`. Or add this to `wrangler.jsonc` and run `npm run cf:deploy`:

   ```jsonc
   "routes": [
     { "pattern": "hbzr.us", "custom_domain": true }
   ]
   ```

   Add `{ "pattern": "www.hbzr.us", "custom_domain": true }` as well if `www` should hit the Worker. Cloudflare creates the DNS record and the certificate. Certificate issuance can take a few minutes.
4. Sign in on `https://hbzr.us` with an existing password. Confirm hours and rates. Cookies are host-only, so a session started on `workers.dev` is not sent to `hbzr.us`; sign in again on the real host.
5. Leave the Vercel project in place until that check is done. Then remove `hbzr.us` from the Vercel project so it does not try to claim the name. The Vercel app can stay deployed on its `vercel.app` hostname.

To roll back, remove the custom domain from the Worker and point the DNS record back at Vercel. Database rows are shared, including any cost-10 hashes created while the Worker was live. Vercel’s bcryptjs path verifies those.

## Commands

| Command | What it does |
| --- | --- |
| `npm run cf:dev` | Production client build, then `wrangler dev` |
| `npm run cf:deploy` | Production client build, then `wrangler deploy` |
| `npx wrangler secret put DATABASE_URL` | Store the pooled Neon URL on the Worker |
| `npx wrangler secret put AUTH_SECRET` | Store the session signing secret |
| `npx wrangler secret list` | Show secret names (not values) |
