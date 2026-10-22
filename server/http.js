export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  return new Response(JSON.stringify(data), { status, headers });
}

export async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 100_000) throw httpError(413, "Request is too large");
  const text = await request.text();
  if (text.length > 100_000) throw httpError(413, "Request is too large");
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw httpError(400, "Expected a JSON object");
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, "Invalid JSON");
  }
}

export function publicOrigin(request) {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    request.headers.get("host");
  if (proto && host) return `${proto}://${host}`;
  return url.origin;
}

export function isSecureRequest(request) {
  return publicOrigin(request).startsWith("https://");
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) throw httpError(403, "Origin header is required");
  if (origin !== publicOrigin(request)) throw httpError(403, "Cross-origin request blocked");
}

function normalizeIp(value) {
  const ip = value.trim();
  return (ip.startsWith("::ffff:") ? ip.slice(7) : ip).slice(0, 80);
}

export function clientIp(request) {
  // Cloudflare sets cf-connecting-ip and overwrites any client-supplied value.
  // request.cf is only present in the Workers runtime, so a browser hitting
  // Vercel cannot spoof it to skip the IP rate limit. Vercel keeps using
  // x-forwarded-for, which the platform sets.
  if (request.cf) {
    const cfIp = request.headers.get("cf-connecting-ip");
    if (cfIp) return normalizeIp(cfIp);
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return normalizeIp(forwarded.split(",")[0]);
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return normalizeIp(realIp);
  return "unknown";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value, label = "Id") {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw httpError(400, `${label} is not a valid id`);
  }
  return value;
}

export function parseDate(value, label = "Date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw httpError(400, `${label} must be YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw httpError(400, `${label} is not a real calendar date`);
  }
  return value;
}

export function optionalDate(value, label) {
  if (value == null || value === "") return null;
  return parseDate(value, label);
}

export function parseHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw httpError(400, "Hours must be greater than 0 and at most 24");
  }
  return Math.round(hours * 100) / 100;
}

export function parseRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 10_000) {
    throw httpError(400, "Hourly rate must be between 0 and 10000");
  }
  return Math.round(rate * 100) / 100;
}

export function parseEmail(value) {
  if (typeof value !== "string") throw httpError(400, "Email is required");
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(400, "Enter a valid email address");
  }
  return email;
}

export function parseName(value) {
  if (typeof value !== "string" || !value.trim()) throw httpError(400, "Name is required");
  const name = value.trim();
  if (name.length > 120) throw httpError(400, "Name must be 120 characters or less");
  return name;
}

export function parsePassword(value, label = "Password") {
  if (typeof value !== "string" || value.length < 8) {
    throw httpError(400, `${label} must be at least 8 characters`);
  }
  if (Buffer.byteLength(value) > 72) {
    throw httpError(400, `${label} must be 72 bytes or less`);
  }
  return value;
}

export function parseRole(value) {
  if (value !== "admin" && value !== "employee") {
    throw httpError(400, "Role must be admin or employee");
  }
  return value;
}

export function blankToNull(value, max, label) {
  if (value == null) return null;
  if (typeof value !== "string") throw httpError(400, `${label} must be text`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw httpError(400, `${label} must be ${max} characters or less`);
  return trimmed;
}

export const APP_BASE = "/timesheet";

export function stripAppBase(pathname) {
  if (pathname === APP_BASE || pathname === `${APP_BASE}/`) return "/";
  if (pathname.startsWith(`${APP_BASE}/`)) return pathname.slice(APP_BASE.length);
  return pathname;
}

export function normalizePath(pathname) {
  const stripped = stripAppBase(pathname);
  if (stripped.length > 1 && stripped.endsWith("/")) return stripped.slice(0, -1);
  return stripped || "/";
}

// Vercel serves every /api/* request from one function via a rewrite. Depending
// on the platform, request.url is either the original path or /api?__path=...
export function resolveApiRequest(request) {
  const url = new URL(request.url);
  let path = normalizePath(url.pathname);
  const rewritten = url.searchParams.get("__path");
  if ((path === "/api" || path === "/api/index") && rewritten) {
    path = normalizePath(`/api/${rewritten.replace(/^\/+/, "")}`);
    url.searchParams.delete("__path");
  }
  return { path, url };
}
