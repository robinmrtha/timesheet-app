import { findUserByEmail, requireUser } from "./auth.js";
import { httpError } from "./http.js";
import { currentHub } from "./request-context.js";
import {
  PERMISSION_SECTIONS,
  allows,
  emptyPermissions,
  emptySections,
  hasAnyAccess,
} from "../shared/permissions.js";

export { allows, hasAnyAccess };

// Service binding to hbzr-app's Hub entrypoint. The host is the binding's
// internal name, not a public origin, and there is no shared secret.
// createHubPermissionsSource is the fetch adapter. An RPC method on the same
// entrypoint can replace it later: (email) => hub.getPermissions(email).
export const HUB_PERMISSIONS_URL = "https://hub/internal/permissions";
const CACHE_MS = 30 * 1000;
const MAX_BODY_CHARS = 20_000;
const LEVELS = new Set(["none", "view", "edit"]);

let cache = new Map();
let lastFailureLog = 0;

export function resetPermissionsCache() {
  cache = new Map();
  lastFailureLog = 0;
}

export function roleFallbackEnabled() {
  return process.env.PERMISSIONS_ROLE_FALLBACK === "1";
}

function logFailure(status) {
  const now = Date.now();
  if (now - lastFailureLog < 60_000) return;
  lastFailureLog = now;
  console.error(JSON.stringify({ message: "permissions lookup failed", status: status || "error" }));
}

// Hub JSON. Owners are admitted with edit on every section even when active
// is false. Everyone else is refused when active is not true.
export function normalizePermissions(body, expectedEmail) {
  const expected = String(expectedEmail || "").trim().toLowerCase();
  if (!body || typeof body !== "object" || Array.isArray(body)) return emptyPermissions(expected);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email !== expected) return emptyPermissions(expected);
  const isOwner = body.isOwner === true;
  if (body.active !== true && !isOwner) return emptyPermissions(email);

  const sections = emptySections();
  const provided = body.sections && typeof body.sections === "object" ? body.sections : {};
  for (const section of PERMISSION_SECTIONS) {
    const level = provided[section];
    sections[section] = LEVELS.has(level) ? level : "none";
  }
  if (isOwner) {
    for (const section of PERMISSION_SECTIONS) sections[section] = "edit";
  }
  return { email, active: true, isOwner, sections };
}

export function permissionsUrl(email) {
  return `${HUB_PERMISSIONS_URL}?email=${encodeURIComponent(email)}`;
}

export function createHubPermissionsSource(hub) {
  return async function hubPermissions(email) {
    if (!hub || typeof hub.fetch !== "function") {
      const error = new Error("missing hub");
      error.status = "missing-hub";
      throw error;
    }
    const url = permissionsUrl(email);
    let response;
    try {
      response = await hub.fetch(url);
    } catch {
      const error = new Error("network");
      error.status = "network";
      throw error;
    }
    if (!response.ok) {
      const error = new Error("status");
      error.status = response.status;
      throw error;
    }
    const type = response.headers.get("content-type") || "";
    if (type && !type.includes("application/json") && !type.includes("text/plain")) {
      const error = new Error("not-json");
      error.status = "not-json";
      throw error;
    }
    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) {
      const error = new Error("too-large");
      error.status = "too-large";
      throw error;
    }
    try {
      return normalizePermissions(JSON.parse(text), email);
    } catch (error) {
      if (error.status) throw error;
      const parseError = new Error("bad-json");
      parseError.status = "bad-json";
      throw parseError;
    }
  };
}

export function createRolePermissionsSource(findUser = findUserByEmail) {
  return async function rolePermissions(email) {
    const user = await findUser(email);
    if (!user || !user.active) return emptyPermissions(email);
    const sections = emptySections();
    if (user.role === "admin") {
      for (const section of PERMISSION_SECTIONS) sections[section] = "edit";
    } else {
      sections["timesheet.own"] = "edit";
    }
    return {
      email: user.email,
      active: true,
      isOwner: false,
      sections,
    };
  };
}

const roleSource = createRolePermissionsSource();

export async function loadPermissions(email, now = Date.now()) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return emptyPermissions("");
  const mode = roleFallbackEnabled() ? "role" : "hub";
  const cacheKey = `${mode}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.value;

  try {
    const value = mode === "role" ? await roleSource(key) : await createHubPermissionsSource(currentHub())(key);
    const permissions = normalizePermissions(value, key);
    cache.set(cacheKey, { expiresAt: now + CACHE_MS, value: permissions });
    return permissions;
  } catch (error) {
    logFailure(error.status);
    return emptyPermissions(key);
  }
}

export async function requireActor(request) {
  const user = await requireUser(request);
  const permissions = await loadPermissions(user.email);
  return { user, permissions };
}

export function assertCan(permissions, section, level = "view") {
  if (!allows(permissions, section, level)) {
    throw httpError(403, "You do not have access to that");
  }
}

export function assertAny(permissions, checks) {
  if (!checks.some(([section, level]) => allows(permissions, section, level))) {
    throw httpError(403, "You do not have access to that");
  }
}
