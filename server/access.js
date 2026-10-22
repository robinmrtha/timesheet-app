import { httpError } from "./http.js";
import { ACCESS_CERTS_URL, ACCESS_ISSUER, NOT_SETUP_MESSAGE } from "../shared/access.js";

export { NOT_SETUP_MESSAGE };

// Public signing keys only. Not request data. One isolate reuses them so a
// typical API call does not fetch the JWKS or import RSA keys again.
const KEY_CACHE_MS = 60 * 60 * 1000;
const KEY_REFRESH_MIN_MS = 60 * 1000;
const CLOCK_SKEW_SEC = 60;
const MAX_TOKEN_CHARS = 20_000;
const MAX_JWKS_CHARS = 100_000;
const MAX_KEYS = 5;
const MAX_MODULUS_CHARS = 1024;

let keyCache = { expiresAt: 0, byKid: new Map() };
let lastMissRefresh = 0;

export function resetAccessKeyCache() {
  keyCache = { expiresAt: 0, byKid: new Map() };
  lastMissRefresh = 0;
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function audienceMatches(claim, expected) {
  if (typeof claim === "string") return claim === expected;
  if (!Array.isArray(claim)) return false;
  return claim.some((item) => item === expected);
}

function accessAudience(options) {
  const aud = (options.aud ?? process.env.ACCESS_AUD ?? "").trim();
  if (!aud) throw httpError(500, "ACCESS_AUD is not configured");
  return aud;
}

async function importRsaKey(jwk) {
  if (!jwk || jwk.kty !== "RSA") return null;
  if (jwk.alg && jwk.alg !== "RS256") return null;
  if (typeof jwk.kid !== "string" || !jwk.kid) return null;
  if (typeof jwk.n !== "string" || typeof jwk.e !== "string") return null;
  if (jwk.n.length > MAX_MODULUS_CHARS || jwk.e.length > 32) return null;
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true, kid: jwk.kid },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function loadKeys(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(ACCESS_CERTS_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    console.error(JSON.stringify({ message: "access certs fetch failed", reason: "network" }));
    throw httpError(503, "Could not verify Cloudflare Access sign-in");
  }
  if (!response.ok) {
    console.error(JSON.stringify({ message: "access certs fetch failed", status: response.status }));
    throw httpError(503, "Could not verify Cloudflare Access sign-in");
  }
  const text = await response.text();
  if (text.length > MAX_JWKS_CHARS) {
    console.error(JSON.stringify({ message: "access certs response too large" }));
    throw httpError(503, "Could not verify Cloudflare Access sign-in");
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw httpError(503, "Could not verify Cloudflare Access sign-in");
  }
  const listed = Array.isArray(body?.keys) ? body.keys.slice(0, MAX_KEYS) : [];
  const byKid = new Map();
  for (const jwk of listed) {
    try {
      const key = await importRsaKey(jwk);
      if (key) byKid.set(jwk.kid, key);
    } catch {
      // Skip a key this runtime cannot import. Another kid may still verify.
    }
  }
  if (byKid.size === 0) {
    console.error(JSON.stringify({ message: "access certs had no usable keys" }));
    throw httpError(503, "Could not verify Cloudflare Access sign-in");
  }
  return byKid;
}

async function getProductionKeys({ force = false, fetchImpl = globalThis.fetch } = {}) {
  const fresh = keyCache.byKid.size > 0 && Date.now() < keyCache.expiresAt;
  if (!force && fresh) return keyCache.byKid;
  const byKid = await loadKeys(fetchImpl);
  keyCache = { expiresAt: Date.now() + KEY_CACHE_MS, byKid };
  return byKid;
}

async function productionKey(kid) {
  const keys = await getProductionKeys();
  if (keys.has(kid)) return keys.get(kid);
  // Unknown kid: refresh once, then ignore further misses for a minute so a
  // bad kid cannot fetch the JWKS on every request. Real rotation still works
  // because Access keeps the previous key for 7 days.
  if (Date.now() - lastMissRefresh < KEY_REFRESH_MIN_MS) return null;
  const refreshed = await getProductionKeys({ force: true });
  lastMissRefresh = Date.now();
  return refreshed.get(kid) || null;
}

function localHostname(request) {
  try {
    return new URL(request.url).hostname;
  } catch {
    return "";
  }
}

export function devBypassAllowed(request) {
  if (process.env.ACCESS_DEV_BYPASS !== "1") return false;
  const host = localHostname(request);
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

// Returns { ok: true, email } or { ok: false, reason }. email is null when the
// token is valid but has no usable email (a service token, for example).
export async function verifyAccessJwt(token, options = {}) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, reason: "malformed" };
  }
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [headerPart, bodyPart, signaturePart] = parts;
  if (!headerPart || !bodyPart) return { ok: false, reason: "malformed" };

  let header;
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    return { ok: false, reason: "alg" };
  }
  if (!signaturePart) return { ok: false, reason: "malformed" };

  const aud = accessAudience(options);
  const issuer = options.issuer ?? ACCESS_ISSUER;

  let cryptoKey = null;
  if (options.getKeys) {
    const keys = await options.getKeys();
    cryptoKey = keys.get(header.kid) || null;
    if (!cryptoKey && options.refreshKeys) {
      const refreshed = await options.refreshKeys();
      cryptoKey = refreshed.get(header.kid) || null;
    }
  } else {
    cryptoKey = await productionKey(header.kid);
  }
  if (!cryptoKey) return { ok: false, reason: "kid" };

  const data = new TextEncoder().encode(`${headerPart}.${bodyPart}`);
  const signature = Buffer.from(signaturePart, "base64url");
  let valid = false;
  try {
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, data);
  } catch {
    return { ok: false, reason: "signature" };
  }
  if (!valid) return { ok: false, reason: "signature" };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(bodyPart, "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || typeof payload !== "object") return { ok: false, reason: "malformed" };
  if (payload.iss !== issuer) return { ok: false, reason: "issuer" };
  if (payload.type !== "app") return { ok: false, reason: "type" };
  if (!audienceMatches(payload.aud, aud)) return { ok: false, reason: "audience" };

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now > payload.exp + CLOCK_SKEW_SEC) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && now < payload.nbf - CLOCK_SKEW_SEC) {
    return { ok: false, reason: "not-before" };
  }

  return { ok: true, email: normalizeEmail(payload.email) };
}

// A verified Access identity, or null when the request is not signed in.
// { email: null } means the token verified but there is no email to map.
export async function resolveAccessIdentity(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  const token = typeof header === "string" ? header.trim() : "";
  if (token) {
    const verified = await verifyAccessJwt(token);
    if (!verified.ok) {
      console.log(JSON.stringify({ message: "access jwt rejected", reason: verified.reason }));
      return null;
    }
    return { email: verified.email };
  }

  if (process.env.ACCESS_DEV_BYPASS !== "1") return null;
  if (!devBypassAllowed(request)) {
    console.log(JSON.stringify({ message: "access dev bypass ignored" }));
    return null;
  }
  const fromHeader = request.headers.get("x-dev-user-email");
  const raw = (typeof fromHeader === "string" && fromHeader.trim()) || process.env.ACCESS_DEV_EMAIL || "";
  const email = normalizeEmail(raw);
  if (!email) return null;
  console.log(JSON.stringify({ message: "access dev bypass" }));
  return { email };
}
