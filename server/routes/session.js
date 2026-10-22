import { findUserByEmail, publicUser, requireUser } from "../auth.js";
import { resolveAccessIdentity } from "../access.js";
import { NOT_SETUP_MESSAGE } from "../../shared/access.js";
import { NO_ACCESS_MESSAGE, hasAnyAccess } from "../../shared/permissions.js";
import { loadPermissions } from "../permissions.js";
import { query } from "../db.js";
import { httpError, json, parseName, readJson } from "../http.js";

export async function session(request) {
  const identity = await resolveAccessIdentity(request);
  if (!identity) return json({ user: null, reason: "unauthenticated" });
  if (!identity.email) {
    return json({ user: null, reason: "not_setup", message: NOT_SETUP_MESSAGE });
  }
  const user = await findUserByEmail(identity.email);
  if (!user || !user.active) {
    return json({
      user: null,
      reason: "not_setup",
      email: identity.email,
      message: NOT_SETUP_MESSAGE,
    });
  }
  const permissions = await loadPermissions(user.email);
  if (!hasAnyAccess(permissions)) {
    return json({
      user: null,
      reason: "no_access",
      email: identity.email,
      message: NO_ACCESS_MESSAGE,
    });
  }
  return json({ user: publicUser(user), permissions });
}

async function requireMember(request) {
  const user = await requireUser(request);
  const permissions = await loadPermissions(user.email);
  if (!hasAnyAccess(permissions)) throw httpError(403, NO_ACCESS_MESSAGE);
  return { user, permissions };
}

export async function getMe(request) {
  const { user, permissions } = await requireMember(request);
  return json({ user: publicUser(user), permissions });
}

export async function patchMe(request) {
  const { user } = await requireMember(request);
  const body = await readJson(request);
  if ("role" in body || "active" in body || "email" in body || "hourlyRate" in body) {
    throw httpError(403, "You can only update your own name");
  }
  const name = parseName(body.name);
  const { rows } = await query(
    `UPDATE users SET name = $1, updated_at = now() WHERE id = $2
     RETURNING id, email, name, role, active`,
    [name, user.id],
  );
  return json({ user: publicUser(rows[0]) });
}
