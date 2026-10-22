import { createSign, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { ACCESS_LOGOUT_URL, NOT_SETUP_MESSAGE } from "../shared/access.js";
import { resetAccessKeyCache, verifyAccessJwt } from "../server/access.js";
import { closePool } from "../server/db.js";

const DATABASE_URL = "postgres://timesheet:timesheet@127.0.0.1:5432/timesheet_cf";
const AUD = "test-aud-tag-0123456789abcdef";
const ISSUER = "https://hbzr.cloudflareaccess.com";
const NOW = Math.floor(Date.now() / 1000);
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const WORKER_ID = "22222222-2222-4222-8222-222222222222";
const FORMER_ID = "33333333-3333-4333-8333-333333333333";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const primary = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });

function publicJwk(publicKey, kid) {
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  return jwk;
}

const primaryJwk = publicJwk(primary.publicKey, "test-key");
const rotatedJwk = publicJwk(rotated.publicKey, "rotated-key");

async function keyMap(...jwks) {
  const map = new Map();
  for (const jwk of jwks) {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true, kid: jwk.kid },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    map.set(jwk.kid, key);
  }
  return map;
}

function signJwt(payload, { kid = "test-key", alg = "RS256", key = primary.privateKey } = {}) {
  const header = Buffer.from(JSON.stringify({ alg, kid, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  if (alg !== "RS256") return `${data}.not-a-signature`;
  const signature = createSign("RSA-SHA256").update(data).sign(key).toString("base64url");
  return `${data}.${signature}`;
}

function claims(extra = {}) {
  return {
    aud: [AUD],
    email: "worker@example.com",
    exp: NOW + 3600,
    iat: NOW,
    nbf: NOW,
    iss: ISSUER,
    type: "app",
    sub: "access-user",
    ...extra,
  };
}

async function verify(token, extra = {}) {
  const keys = await keyMap(primaryJwk);
  return verifyAccessJwt(token, {
    aud: AUD,
    now: NOW,
    getKeys: async () => keys,
    ...extra,
  });
}

async function jwtTests() {
  check(
    NOT_SETUP_MESSAGE === "Your account isn't set up in Timesheet. Ask Robin.",
    "not-setup copy",
  );
  check(
    ACCESS_LOGOUT_URL === "https://hbzr.cloudflareaccess.com/cdn-cgi/access/logout",
    "logout url",
  );

  const keys = await keyMap(primaryJwk);
  let keyReads = 0;
  const blockingKeys = async () => {
    keyReads += 1;
    return keys;
  };

  const noneToken = signJwt(claims(), { alg: "none" });
  const noneResult = await verifyAccessJwt(noneToken, { aud: AUD, now: NOW, getKeys: blockingKeys });
  check(!noneResult.ok && noneResult.reason === "alg", "alg none is rejected");
  check(keyReads === 0, "alg none does not touch the JWKS");

  const hsToken = signJwt(claims(), { alg: "HS256" });
  const hsResult = await verifyAccessJwt(hsToken, { aud: AUD, now: NOW, getKeys: blockingKeys });
  check(!hsResult.ok && hsResult.reason === "alg", "HS256 is rejected");
  check(keyReads === 0, "wrong alg does not touch the JWKS");

  const good = await verify(signJwt(claims({ email: "  Worker@Example.COM " })));
  check(good.ok && good.email === "worker@example.com", "email is trimmed and lowercased");

  const audString = await verify(signJwt(claims({ aud: AUD })));
  check(audString.ok, "aud may be a string");

  const badSig = await verify(signJwt(claims(), { key: rotated.privateKey }));
  check(!badSig.ok && badSig.reason === "signature", "wrong key is rejected");

  const badAud = await verify(signJwt(claims({ aud: ["someone-elses-app"] })));
  check(!badAud.ok && badAud.reason === "audience", "wrong aud is rejected");

  const badIss = await verify(signJwt(claims({ iss: "https://example.cloudflareaccess.com" })));
  check(!badIss.ok && badIss.reason === "issuer", "wrong issuer is rejected");

  const slash = await verify(signJwt(claims({ iss: `${ISSUER}/` })));
  check(!slash.ok && slash.reason === "issuer", "issuer must not have a trailing slash");

  const org = await verify(signJwt(claims({ type: "org" })));
  check(!org.ok && org.reason === "type", "org tokens are not application sessions");

  const withinSkew = await verify(signJwt(claims({ exp: NOW - 60 })));
  check(withinSkew.ok, "60 seconds of expiry skew is accepted");
  const expired = await verify(signJwt(claims({ exp: NOW - 61 })));
  check(!expired.ok && expired.reason === "expired", "older tokens are rejected");

  const early = await verify(signJwt(claims({ nbf: NOW + 60 })));
  check(early.ok, "60 seconds of not-before skew is accepted");
  const tooEarly = await verify(signJwt(claims({ nbf: NOW + 61 })));
  check(!tooEarly.ok && tooEarly.reason === "not-before", "tokens used too early are rejected");

  const noEmailPayload = claims();
  delete noEmailPayload.email;
  const noEmail = await verify(signJwt(noEmailPayload));
  check(noEmail.ok && noEmail.email === null, "a verified token without email has no address");

  let threw = false;
  try {
    await verifyAccessJwt(signJwt(claims()), {
      now: NOW,
      getKeys: async () => keys,
    });
  } catch (error) {
    threw = error.status === 500 && error.message === "ACCESS_AUD is not configured";
  }
  check(threw, "missing ACCESS_AUD is a server error");
}

async function cacheTests() {
  resetAccessKeyCache();
  process.env.ACCESS_AUD = AUD;
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  let published = [primaryJwk];
  globalThis.fetch = async (url) => {
    fetches += 1;
    check(
      String(url) === "https://hbzr.cloudflareaccess.com/cdn-cgi/access/certs",
      `unexpected fetch ${url}`,
    );
    return new Response(JSON.stringify({ keys: published }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const token = signJwt(claims());
    const first = await verifyAccessJwt(token, { now: NOW });
    const second = await verifyAccessJwt(token, { now: NOW });
    check(first.ok && second.ok && second.email === "worker@example.com", "cached key verifies");
    check(fetches === 1, `JWKS should be fetched once, got ${fetches}`);

    published = [primaryJwk, rotatedJwk];
    const next = signJwt(claims({ email: "Admin@Example.com" }), {
      kid: "rotated-key",
      key: rotated.privateKey,
    });
    const rotatedResult = await verifyAccessJwt(next, { now: NOW });
    check(rotatedResult.ok && rotatedResult.email === "admin@example.com", "unknown kid refreshes JWKS");
    check(fetches === 2, "rotation causes one extra fetch");

    const missing = await verifyAccessJwt(signJwt(claims(), { kid: "missing-key" }), { now: NOW });
    check(!missing.ok && missing.reason === "kid", "kid missing after refresh is rejected");
    check(fetches === 2, "another unknown kid does not fetch again inside the minute");
  } finally {
    globalThis.fetch = originalFetch;
    resetAccessKeyCache();
  }
}

function psql(args) {
  const result = spawnSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
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

async function mappingTests() {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.ACCESS_AUD = AUD;
  delete process.env.ACCESS_DEV_BYPASS;
  delete process.env.ACCESS_DEV_EMAIL;

  psql(["-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"]);
  psql(["-f", "db/schema.sql"]);
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, name, role, active) VALUES
         ($1, 'admin@example.com', 'stored-bcrypt-hash', 'Mira Admin', 'admin', true),
         ($2, 'worker@example.com', 'stored-bcrypt-hash', 'Pemba Worker', 'employee', true),
         ($3, 'former@example.com', 'stored-bcrypt-hash', 'Former Staff', 'employee', false)`,
      [ADMIN_ID, WORKER_ID, FORMER_ID],
    );
  });

  resetAccessKeyCache();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(JSON.stringify({ keys: [primaryJwk, rotatedJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const { handle } = await import("../server/router.js");

  async function request(path, { method = "GET", jwt, email, url = "http://127.0.0.1", cookie } = {}) {
    const headers = new Headers({ origin: url });
    if (jwt) headers.set("cf-access-jwt-assertion", jwt);
    if (email) headers.set("x-dev-user-email", email);
    if (cookie) headers.set("cookie", cookie);
    const response = await handle(new Request(`${url}${path}`, { method, headers }));
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }

  try {
    const workerToken = signJwt(claims({ email: "Worker@Example.com" }));
    const worker = await request("/api/auth/session", { jwt: workerToken });
    check(worker.status === 200 && worker.data.user.email === "worker@example.com", "mixed-case email maps to the user");
    check(worker.data.user.role === "employee", "role comes from the user row");
    check(!JSON.stringify(worker.data).includes("password"), "session does not return a password hash");
    check(fetches === 1, "session verifies with one JWKS fetch");

    const again = await request("/api/me", { jwt: workerToken });
    check(again.status === 200 && again.data.user.id === WORKER_ID, "later requests reuse the cached key");
    check(fetches === 1, "cached JWKS is not fetched again");

    const adminToken = signJwt(claims({ email: "ADMIN@example.com" }));
    const admin = await request("/api/me", { jwt: adminToken });
    check(admin.status === 200 && admin.data.user.role === "admin", "admin email maps to the admin role");
    const team = await request("/api/users", { jwt: adminToken });
    check(team.status === 200 && team.data.users.length === 3, "admin can list the team");
    const forbidden = await request("/api/users", { jwt: workerToken });
    check(forbidden.status === 403, "employee role cannot list the team");

    const former = await request("/api/auth/session", {
      jwt: signJwt(claims({ email: "Former@Example.com" })),
    });
    check(former.status === 200 && former.data.user === null, "inactive user has no session");
    check(former.data.reason === "not_setup" && former.data.email === "former@example.com", "inactive email is reported");
    check(former.data.message === NOT_SETUP_MESSAGE, "inactive user gets the not-setup message");
    const formerMe = await request("/api/me", {
      jwt: signJwt(claims({ email: "former@example.com" })),
    });
    check(formerMe.status === 403 && formerMe.data.error === NOT_SETUP_MESSAGE, "inactive API calls are rejected");

    const unknown = await request("/api/auth/session", {
      jwt: signJwt(claims({ email: "Nobody@Example.com" })),
    });
    check(unknown.data.reason === "not_setup" && unknown.data.email === "nobody@example.com", "unknown email is not set up");

    const servicePayload = claims();
    delete servicePayload.email;
    const service = await request("/api/auth/session", { jwt: signJwt(servicePayload) });
    check(service.data.reason === "not_setup" && !service.data.email, "token without email is not a user");

    const anonymous = await request("/api/auth/session", {
      cookie: "hb_session=forged",
      email: "admin@example.com",
    });
    check(anonymous.data.user === null && anonymous.data.reason === "unauthenticated", "bypass is off by default");

    process.env.ACCESS_DEV_EMAIL = "admin@example.com";
    const stillOff = await request("/api/auth/session");
    check(stillOff.data.reason === "unauthenticated", "ACCESS_DEV_EMAIL does nothing unless the flag is 1");
    process.env.ACCESS_DEV_BYPASS = "true";
    const notOne = await request("/api/auth/session", { email: "admin@example.com" });
    check(notOne.data.reason === "unauthenticated", "only ACCESS_DEV_BYPASS=1 enables the bypass");

    process.env.ACCESS_DEV_BYPASS = "1";
    const headerUser = await request("/api/auth/session", { email: "Worker@Example.com" });
    check(headerUser.data.user.role === "employee", "local header selects the user when bypass is on");
    delete process.env.ACCESS_DEV_EMAIL;
    const fromEnv = await request("/api/auth/session");
    check(fromEnv.data.reason === "unauthenticated", "bypass without an email is signed out");
    process.env.ACCESS_DEV_EMAIL = "admin@example.com";
    const envUser = await request("/api/me");
    check(envUser.data.user.role === "admin", "ACCESS_DEV_EMAIL is the local user");

    const remote = await request("/api/auth/session", {
      url: "https://hbzr.us",
      email: "admin@example.com",
    });
    check(remote.data.reason === "unauthenticated", "bypass ignores non-local hosts");

    const loopback = await request("/api/auth/session", { url: "http://[::1]" });
    check(loopback.data.user.email === "admin@example.com", "bypass allows ::1");

    const badToken = signJwt(claims({ email: "admin@example.com" }), { key: rotated.privateKey, kid: "test-key" });
    const noFallback = await request("/api/auth/session", { jwt: badToken, email: "admin@example.com" });
    check(noFallback.data.reason === "unauthenticated", "a bad Access token does not fall through to the bypass");

    delete process.env.ACCESS_AUD;
    const missingAud = await request("/api/auth/session", { jwt: signJwt(claims()) });
    check(missingAud.status === 500, "a token with no ACCESS_AUD is a server error");
    process.env.ACCESS_AUD = AUD;

    await withClient(async (client) => {
      const row = await client.query(`SELECT password_hash FROM users WHERE id = $1`, [WORKER_ID]);
      check(row.rows[0].password_hash === "stored-bcrypt-hash", "sign-in does not rewrite password_hash");
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ACCESS_DEV_BYPASS;
    delete process.env.ACCESS_DEV_EMAIL;
    resetAccessKeyCache();
    await closePool();
  }
}

async function main() {
  const savedAud = process.env.ACCESS_AUD;
  delete process.env.ACCESS_AUD;
  try {
    await jwtTests();
    await cacheTests();
    await mappingTests();
  } finally {
    if (savedAud === undefined) delete process.env.ACCESS_AUD;
    else process.env.ACCESS_AUD = savedAud;
    resetAccessKeyCache();
  }
  console.log("Access JWT and email mapping checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
