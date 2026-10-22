import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { query } from "./db.js";
import { httpError, isSecureRequest } from "./http.js";
import { isLocalDatabaseHost, onWorkers } from "./runtime.js";

const COOKIE = "hb_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 14;
const LOCK_AFTER = 5;
const IP_LIMIT = 60;

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw httpError(500, "AUTH_SECRET is not configured");
  }
  return secret;
}

function sign(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verify(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, bodyPart, signature] = parts;
  let header;
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
  } catch {
    return null;
  }
  if (!header || header.alg !== "HS256") return null;
  const expected = createHmac("sha256", secret).update(`${headerPart}.${bodyPart}`).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bodyPart, "base64url").toString());
  } catch {
    return null;
  }
  if (!payload || typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return payload;
}

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token, request) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(request) {
  const parts = [`${COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || "",
    role: row.role,
    active: Boolean(row.active),
  };
}

export async function currentUser(request) {
  const token = readCookie(request);
  if (!token) return null;
  const payload = verify(token, authSecret());
  if (!payload) return null;
  const { rows } = await query(
    `SELECT id, email, name, role, active, hourly_rate, password_hash
     FROM users WHERE id = $1`,
    [payload.sub],
  );
  return rows[0] || null;
}

export async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) throw httpError(401, "Sign in required");
  if (!user.active) {
    const error = httpError(401, "This account is inactive");
    error.clearCookie = true;
    throw error;
  }
  return user;
}

export async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== "admin") throw httpError(403, "Admin access required");
  return user;
}

export function issueSession(userId) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, iat: now, exp: now + MAX_AGE_SEC }, authSecret());
}

// Precomputed cost-10 bcrypt of a fixed string. Unknown emails are checked
// against this so we never call bcrypt.hash() inside a Worker (that alone is
// over the free-plan CPU limit). Not a user password.
const DUMMY_BCRYPT = "$2a$10$OE2RZm8pANoFpog7nhrqkuacgevw//3G7HE.4Qlsx0p.oyDOkx3ai";

function passwordBackend() {
  const forced = process.env.PASSWORD_BACKEND;
  if (forced === "pgcrypto" || forced === "bcryptjs") return forced;
  return onWorkers() ? "pgcrypto" : "bcryptjs";
}

function isBcryptHash(hash) {
  return typeof hash === "string" && /^\$2[aby]\$\d{2}\$/.test(hash);
}

// pgcrypto crypt() verifies $2a$ and returns false for $2b$/$2y$ without error.
// Those prefixes are the same algorithm for hashes produced by bcryptjs; only
// the label differs. The stored hash is not rewritten.
function pgcryptoBcryptHash(hash) {
  if (!isBcryptHash(hash)) return null;
  if (hash.startsWith("$2a$")) return hash;
  return `$2a$${hash.slice(4)}`;
}

function cleanPasswordError(error) {
  if (error.code === "42883") {
    const wrapped = new Error(
      "Enable the pgcrypto extension before Workers can verify passwords",
    );
    wrapped.status = 500;
    wrapped.code = "42883";
    return wrapped;
  }
  const wrapped = new Error("Password check failed");
  wrapped.status = 500;
  wrapped.code = error.code;
  return wrapped;
}

async function matchWithPgcrypto(password, hash) {
  const stored = pgcryptoBcryptHash(hash);
  if (!stored) return false;
  try {
    const { rows } = await query(`SELECT crypt($1, $2) = $2 AS ok`, [password, stored]);
    return rows[0]?.ok === true;
  } catch (error) {
    throw cleanPasswordError(error);
  }
}

async function hashWithPgcrypto(password) {
  try {
    const { rows } = await query(`SELECT crypt($1, gen_salt('bf', 10)) AS hash`, [password]);
    const hash = rows[0]?.hash;
    if (!isBcryptHash(hash)) throw httpError(500, "Could not hash password");
    return hash;
  } catch (error) {
    if (error.status) throw error;
    throw cleanPasswordError(error);
  }
}

function canUseLocalBcryptFallback(error) {
  return error.code === "42883" && isLocalDatabaseHost(process.env.DATABASE_URL || "");
}

export async function passwordsMatch(password, hash) {
  const backend = passwordBackend();
  console.log(JSON.stringify({ message: "password check", backend }));
  try {
    if (!isBcryptHash(hash)) return false;
    if (backend === "pgcrypto") return await matchWithPgcrypto(password, hash);
    return await bcrypt.compare(password, hash);
  } catch (error) {
    if (canUseLocalBcryptFallback(error)) {
      console.warn(
        JSON.stringify({ message: "pgcrypto missing on local database; using bcryptjs" }),
      );
      try {
        return await bcrypt.compare(password, hash);
      } catch (compareError) {
        console.error(
          JSON.stringify({ message: "password compare failed", code: compareError.code || "unknown" }),
        );
        return false;
      }
    }
    if (error.status) throw error;
    console.error(
      JSON.stringify({ message: "password compare failed", code: error.code || "unknown" }),
    );
    return false;
  }
}

export async function hashPassword(password) {
  const backend = passwordBackend();
  console.log(JSON.stringify({ message: "password hash", backend }));
  if (backend !== "pgcrypto") return bcrypt.hash(password, 10);
  try {
    return await hashWithPgcrypto(password);
  } catch (error) {
    if (canUseLocalBcryptFallback(error)) {
      console.warn(
        JSON.stringify({ message: "pgcrypto missing on local database; using bcryptjs" }),
      );
      return bcrypt.hash(password, 10);
    }
    throw error;
  }
}

export async function assertIpAllowed(ip) {
  const { rows } = await query(
    `SELECT count(*)::int AS attempts
     FROM login_attempts
     WHERE ip = $1 AND created_at > now() - interval '15 minutes'`,
    [ip],
  );
  if (rows[0].attempts >= IP_LIMIT) {
    throw httpError(429, "Too many login attempts. Try again in a few minutes.");
  }
}

export async function recordLoginAttempt(ip, email) {
  await query(`INSERT INTO login_attempts (ip, email) VALUES ($1, $2)`, [ip, email]);
  await query(`DELETE FROM login_attempts WHERE created_at < now() - interval '2 days'`);
}

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, name, role, active, password_hash, failed_login_count, locked_until
     FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] || null;
}

export function assertNotLocked(user) {
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw httpError(429, "Too many login attempts. Try again in a few minutes.");
  }
}

export async function recordFailedLogin(userId) {
  await query(
    `UPDATE users
     SET failed_login_count = CASE
           WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
           ELSE failed_login_count + 1
         END,
         locked_until = CASE
           WHEN locked_until IS NOT NULL AND locked_until <= now() THEN NULL
           WHEN failed_login_count + 1 >= $2 THEN now() + interval '15 minutes'
           ELSE locked_until
         END,
         updated_at = now()
     WHERE id = $1`,
    [userId, LOCK_AFTER],
  );
}

export async function clearFailedLogins(userId) {
  await query(
    `UPDATE users
     SET failed_login_count = 0, locked_until = NULL, updated_at = now()
     WHERE id = $1`,
    [userId],
  );
}

export async function compareUnknownPassword(password) {
  await passwordsMatch(password, DUMMY_BCRYPT);
}
