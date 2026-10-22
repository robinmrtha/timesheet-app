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
5. Take `email`, trim it, and compare it case-insensitively to `users.email`. The row’s `role` (`admin` or `employee`) and `active` flag are the app permissions. The JWT does not choose the role.

If the email is missing from `users`, or the row is inactive, the API returns that fact and the page says: **Your account isn't set up in Timesheet. Ask Robin.**

Log out sends the browser to `https://hbzr.cloudflareaccess.com/cdn-cgi/access/logout`, which ends the Access session for the other apps too.

Static files are not checked again inside the Worker. Access already gates the hostname, and the API re-checks the JWT before it returns data. That keeps asset requests off the CPU budget.

### ACCESS_AUD

In the Cloudflare dashboard: **Zero Trust → Access controls → Applications →** the application that protects `hbzr.us` **→ Additional settings → Application Audience (AUD) tag**. The tag does not change unless that Access application is deleted.

```bash
printf '%s' "$ACCESS_AUD" | npx wrangler secret put ACCESS_AUD
```

Do not commit the value. `wrangler deploy` refuses to continue when `ACCESS_AUD` or `DATABASE_URL` is missing. `AUTH_SECRET` is no longer used for a session cookie. An old secret left on the Worker is unused.

### Local bypass

`ACCESS_DEV_BYPASS` is off unless it is exactly `1`. When it is `1`, it applies only if the request hostname is `localhost`, `127.0.0.1`, `::1`, or `[::1]`. The user is the `X-Dev-User-Email` header, or `ACCESS_DEV_EMAIL` when the header is absent. A request that includes `Cf-Access-Jwt-Assertion` is still verified; a bad token does not fall through to the bypass.

Do not set the flag on the deployed Worker. `wrangler dev` reads it from `.dev.vars`. `npm run dev` reads it from `.env`. Put a placeholder in `ACCESS_AUD` for local dev; the bypass does not check it. Use the real tag when you send a real Access JWT.

## Local development

```bash
npm install
createdb timesheet   # or any local database
psql "$DATABASE_URL" -f db/schema.sql
cp .dev.vars.example .dev.vars
# Edit .dev.vars: local DATABASE_URL, a placeholder ACCESS_AUD,
# ACCESS_DEV_BYPASS=1, and ACCESS_DEV_EMAIL set to a user in the database.
npm run cf:dev
```

`npm run cf:dev` builds the Vite client into `dist/` and starts `wrangler dev` (default http://127.0.0.1:8787). `.dev.vars` is gitignored. If that file exists, Wrangler does not also load `.env`.

With the bypass on, open the app as `ACCESS_DEV_EMAIL`. `GET /api/me` returns that user. There is no password form. `POST` requests need an `Origin` header equal to the page origin.

`npm test` resets the local `timesheet_test`, `timesheet_source`, and `timesheet_cf` databases. It checks Access JWT verification against a mocked JWKS, email-to-user mapping, client IP selection, and the API.

## Deploy the Worker (no custom domain yet)

This does not attach `hbzr.us` and does not change Vercel.

```bash
npx wrangler login
printf '%s' "$DATABASE_URL" | npx wrangler secret put DATABASE_URL
printf '%s' "$ACCESS_AUD" | npx wrangler secret put ACCESS_AUD
npm run cf:deploy
```

Use the pooled Neon URL for `DATABASE_URL`. `ACCESS_AUD` is the AUD tag of the Access application in front of this hostname. Do not set `ACCESS_DEV_BYPASS` here.

`wrangler deploy` refuses to continue when `DATABASE_URL` or `ACCESS_AUD` is missing on the Worker. `npm run cf:deploy` is `npm run build && wrangler deploy`.

The `workers.dev` URL is not behind Access unless you put an Access application on it too. On `https://hbzr.us`, sign in with Google or an email code. An admin and an employee whose Access email matches `users.email` should land in the app with the right role. An unknown or inactive email should see the “Ask Robin” page. A new entry should show up on refresh. Log out should land on `https://hbzr.cloudflareaccess.com/cdn-cgi/access/logout`.

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
4. Open `https://hbzr.us`. Access should ask for Google or an email code, not a Timesheet password. Confirm hours and rates for an admin and an employee. Confirm someone who is not in `users` sees “Your account isn't set up in Timesheet. Ask Robin.”
5. Leave the Vercel project in place until that check is done. Then remove `hbzr.us` from the Vercel project so it does not try to claim the name. The Vercel app can stay deployed on its `vercel.app` hostname. That hostname does not share the Access login unless you put Access in front of it too.

To roll back, remove the custom domain from the Worker and point the DNS record back at Vercel. Database rows are shared. Password hashes are still stored and are not used by either copy of this code.

## Commands

| Command | What it does |
| --- | --- |
| `npm run cf:dev` | Production client build, then `wrangler dev` |
| `npm run cf:deploy` | Production client build, then `wrangler deploy` |
| `npx wrangler secret put DATABASE_URL` | Store the pooled Neon URL on the Worker |
| `npx wrangler secret put ACCESS_AUD` | Store the Access application AUD tag |
| `npx wrangler secret list` | Show secret names (not values) |
