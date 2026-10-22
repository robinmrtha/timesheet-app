# Deploy the timesheet app on Cloudflare Workers

Vercel stays the production target until you cut DNS over. Both targets build from `main`:

| | Vercel (current) | Cloudflare Workers |
| --- | --- | --- |
| App | Vite build, `vercel.json` SPA rewrite | Vite build, Workers static assets, SPA fallback |
| API | `api/index.js` rewrites `/api/*` to `server/router.js` | `worker/index.js` sends `/api` and `/api/*` to the same router |
| Database | `pg` + `@vercel/functions` `attachDatabasePool` | `@neondatabase/serverless` HTTP, except localhost (see below) |
| Secrets | Vercel project env | `wrangler secret put` (`DATABASE_URL`, `ACCESS_AUD`) |

Do not commit secret values. `wrangler.jsonc` lists the secret **names** only.

## Database driver

Workers use the Neon serverless driver’s HTTP API (`neon()` from `@neondatabase/serverless`, `fullResults: true`). Each query is a `fetch` to Neon’s SQL-over-HTTP endpoint. Time spent waiting on that fetch does not count toward the Worker CPU limit.

This fits the Neon free plan and this app better than `pg` through Hyperdrive:

- The free Neon plan already exposes SQL-over-HTTP. No Hyperdrive config id, and the Worker secret stays the same pooled `DATABASE_URL` Vercel uses (hostname contains `-pooler`).
- The API issues one statement at a time. There is no multi-statement transaction. A typical request looks up one user, under the free-plan limit of 50 external subrequests per request. The Access JWKS is cached, so it is not fetched on that request.
- Hyperdrive is on the Workers free plan (100,000 queries per day) and would let us keep `pg`, but it caches non-mutating queries by default. Hours, pay status, and lockouts need to be visible on the next request. Turning that cache off removes the reason to add another service.
- Hyperdrive would also replace `DATABASE_URL` with a binding connection string. The HTTP driver reads the secret directly.

Vercel does not take this path. Outside Workers, `server/db.js` still uses `pg` and `attachDatabasePool`. Both drivers return `DATE` columns as `YYYY-MM-DD` strings, so a browser in the US or Nepal does not shift the work date.

`wrangler dev` against `localhost` / `127.0.0.1` uses `pg` over TCP, because local Postgres does not speak Neon’s HTTP protocol. Any other host, including Neon, uses the HTTP driver. Use one client per query in local dev so a connection is not reused across Workers requests.

People in the US and Nepal hit a Worker near them. The hop to Neon is wall-clock time, not CPU. If the Neon compute is in the US, Nepal is slower by that round trip, and a compute that has scaled to zero adds a cold start of a few hundred milliseconds on the first query. Use the pooled connection string either way.

## Sign-in (Cloudflare Access)

The Workers free plan allows **10 ms of CPU time per HTTP request**. Waiting on the network does not count. [Limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

`hbzr.us` sits behind Cloudflare Access on the team domain `hbzr.cloudflareaccess.com`. People sign in once there, with Google or an email one-time code. Timesheet does not ask for a password. `users.password_hash` and the old lockout columns stay in the database and are not read.

Access adds `Cf-Access-Jwt-Assertion` to each request that reaches the Worker. The API treats a verified token as the session:

1. Check the JWT is RS256. `alg` of `none` or HMAC is rejected before any key work.
2. Verify the signature with Web Crypto (`crypto.subtle.verify`) against the public keys at `https://hbzr.cloudflareaccess.com/cdn-cgi/access/certs`. Match `kid` to a key in `keys`. Do not trust `public_cert` alone. [Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
3. Cache the imported keys in the isolate for one hour. A `kid` the cache does not know triggers one refresh, and further unknown kids are ignored for a minute, so a bad token cannot fetch the certs on every request. Access rotates keys about every 6 weeks and keeps the previous key for 7 days, so that refresh is enough. The fetch is network time, not CPU. A normal request does not fetch.
4. Require `iss` of `https://hbzr.cloudflareaccess.com`, `type` of `app`, and `aud` equal to the `ACCESS_AUD` secret (string or one entry in an array). `exp` and `nbf` allow 60 seconds of clock skew.
5. Take `email`, trim it, and compare it case-insensitively to `users.email`. The row has to exist and be active. Section access comes from the hub Worker, described below. The JWT does not choose it. `users.role` is not used unless `PERMISSIONS_ROLE_FALLBACK=1`.

If the email is missing from `users`, or the row is inactive, the API returns that fact and the page says: **Your account isn't set up in Timesheet. Ask Robin.**

Log out sends the browser to `https://hbzr.cloudflareaccess.com/cdn-cgi/access/logout`, which ends the Access session for the other apps too.

Static files are not checked again inside the Worker. Access already gates the hostname, and the API re-checks the JWT before it returns data. That keeps asset requests off the CPU budget.

### ACCESS_AUD

In the Cloudflare dashboard: **Zero Trust → Access controls → Applications →** the one Access application for `hbzr.us` **→ Additional settings → Application Audience (AUD) tag**. Timesheet does not have its own Access app. The tag does not change unless that application is deleted.

```bash
printf '%s' "$ACCESS_AUD" | npx wrangler secret put ACCESS_AUD
```

Do not commit the value. `wrangler deploy` refuses to continue when `ACCESS_AUD` or `DATABASE_URL` is missing. `AUTH_SECRET` is no longer used for a session cookie. An old secret left on the Worker is unused. There is no permissions token.

### Local bypass

`ACCESS_DEV_BYPASS` is off unless it is exactly `1`. When it is `1`, it applies only if the request hostname is `localhost`, `127.0.0.1`, `::1`, or `[::1]`. The user is the `X-Dev-User-Email` header, or `ACCESS_DEV_EMAIL` when the header is absent. A request that includes `Cf-Access-Jwt-Assertion` is still verified; a bad token does not fall through to the bypass.

Do not set the flag on the deployed Worker. `wrangler dev` reads it from `.dev.vars`. `npm run dev` reads it from `.env`. Put a placeholder in `ACCESS_AUD` for local dev; the bypass does not check it. Use the real tag when you send a real Access JWT.

## Section permissions

Timesheet does not decide who can see a section. The hub Worker `hbzr-app` does, through its `Hub` entrypoint. After the Access email matches an active `users` row, this Worker calls that binding with the verified email and enforces the answer on every API route. The browser only hides tabs and turns forms read-only; it is not the check.

The binding in `wrangler.jsonc` is the same as:

```toml
[[services]]
binding = "HUB"
service = "hbzr-app"
entrypoint = "Hub"
```

The call is `env.HUB.fetch(new Request("https://hbzr.us/internal/permissions?email=" + encodeURIComponent(email)))`. There is no `PERMISSIONS_API_TOKEN` and no `Authorization` header. The email is the one from the Access JWT, not a value from the browser.

Sections:

| Key | What it covers |
| --- | --- |
| `timesheet.own` | Add and edit your own unpaid hours, and read your own entries and the rate that applies to them |
| `timesheet.team` | Read other people’s hours. Edit can change and delete those entries |
| `timesheet.payroll` | Pay rates and the pay report. Edit can add or delete rates and mark entries paid |
| `timesheet.admin` | The team list and settings. Edit can add people and change their profile, role, or active flag |

Each section is `none`, `view`, or `edit`. A missing key, or any other word, is `none`. View can read. Edit can read and change. `isOwner: true` is edit on every section, including when `active` is false. A person who is not an owner is refused when `active` is false.

```json
{
  "email": "person@example.com",
  "active": true,
  "isOwner": false,
  "sections": {
    "timesheet.own": "edit",
    "timesheet.team": "view",
    "timesheet.payroll": "none",
    "timesheet.admin": "none"
  }
}
```

A 400 body is `{"error":"Pass an email"}`. Any other path on that binding is a 404. Both are errors. A missing binding, a non-JSON body, or any failed call is no access. The result is kept in the isolate for 30 seconds per email. A failure is not cached, so the next request tries again. The `email` in the JSON must match the email that was asked for, ignoring case.

If every section is `none`, or the lookup fails, the page says **Ask Robin for access.** That is different from a missing or inactive Timesheet user, which still says **Your account isn't set up in Timesheet. Ask Robin.**

### Role fallback

`PERMISSIONS_ROLE_FALLBACK` is off unless it is exactly `1`. When it is `1`, the Worker does not call the hub. An active `users.role` of `admin` is edit on every section. Any other active role is edit on `timesheet.own` only. Use that for local development, where the `HUB` binding is not the deployed hub. Do not set it on the deployed Worker. The column stays in the database either way.

## Local development

```bash
npm install
createdb timesheet   # or any local database
psql "$DATABASE_URL" -f db/schema.sql
cp .dev.vars.example .dev.vars
# Edit .dev.vars: local DATABASE_URL, a placeholder ACCESS_AUD,
# ACCESS_DEV_BYPASS=1, ACCESS_DEV_EMAIL set to a user in the database,
# and PERMISSIONS_ROLE_FALLBACK=1.
npm run cf:dev
```

`npm run cf:dev` builds the Vite client into `dist/` and starts `wrangler dev` (default http://127.0.0.1:8787). The app is mounted at `/timesheet/`. `.dev.vars` is gitignored. If that file exists, Wrangler does not also load `.env`.

With the bypass on, open `http://127.0.0.1:8787/timesheet/` as `ACCESS_DEV_EMAIL`. `GET /timesheet/api/me` returns that user. There is no password form. `POST` requests need an `Origin` header equal to the page origin. `npm run dev` serves the same path at `http://127.0.0.1:5173/timesheet/`.

`npm test` resets the local `timesheet_test`, `timesheet_source`, and `timesheet_cf` databases. It checks Access JWT verification against a mocked JWKS, email-to-user mapping, client IP selection, and the API.

## Deploy the Worker

The only route is `hbzr.us/timesheet*`. Do not add a custom domain, and do not add a route for `hbzr.us`, `hbzr.us/*`, or `www.hbzr.us`. The apex stays on `hbzr-app`. Deploy publishes the path route; it does not take the hostname.

```bash
npx wrangler login
printf '%s' "$DATABASE_URL" | npx wrangler secret put DATABASE_URL
printf '%s' "$ACCESS_AUD" | npx wrangler secret put ACCESS_AUD
npm run cf:deploy
```

Use the pooled Neon URL for `DATABASE_URL`. `ACCESS_AUD` is the AUD tag of the single Access application in front of `hbzr.us`. Do not set `ACCESS_DEV_BYPASS` or `PERMISSIONS_ROLE_FALLBACK` here.

`wrangler deploy` refuses to continue when `DATABASE_URL` or `ACCESS_AUD` is missing on the Worker. `npm run cf:deploy` is `npm run build && wrangler deploy`.

Open `https://hbzr.us/timesheet`. Access should ask for Google or an email code, not a Timesheet password. `https://hbzr.us/` is the hub, not this Worker. The `workers.dev` URL is not behind Access unless you put an Access application on it too.

Workers Logs and traces are enabled at full sample rate. This is a small staff app. Lower `observability.logs.head_sampling_rate` and `observability.traces.head_sampling_rate` in `wrangler.jsonc` if the volume grows. The top-level `observability.enabled` flag turns on logs; traces are enabled on their own.

## Where this Worker is mounted

`hbzr.us` is already the hub’s hostname. This Worker does not replace that DNS record and does not get a certificate of its own for the apex.

The route in `wrangler.jsonc` is:

```jsonc
"routes": [
  { "pattern": "hbzr.us/timesheet*", "zone_name": "hbzr.us" }
]
```

That pattern is the whole public surface. Requests to `https://hbzr.us/timesheet` and `https://hbzr.us/timesheet/api/…` hit this Worker. The Worker strips the `/timesheet` prefix before it serves the API or the static files, so the client is built with Vite `base` `/timesheet/`. A request for the apex, if it ever reached this Worker, is a 404.

To roll the path back, delete that route from the Worker. Leave the apex DNS on the hub. Database rows are shared. Password hashes are still stored and are not used.

## Commands

| Command | What it does |
| --- | --- |
| `npm run cf:dev` | Production client build, then `wrangler dev` |
| `npm run cf:deploy` | Production client build, then `wrangler deploy` |
| `npx wrangler secret put DATABASE_URL` | Store the pooled Neon URL on the Worker |
| `npx wrangler secret put ACCESS_AUD` | Store the Access application AUD tag |
| `npx wrangler secret list` | Show secret names (not values) |
