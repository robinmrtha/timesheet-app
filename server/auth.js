import { query } from "./db.js";
import { httpError } from "./http.js";
import { NOT_SETUP_MESSAGE, resolveAccessIdentity } from "./access.js";

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || "",
    role: row.role,
    active: Boolean(row.active),
  };
}

// Emails are stored lowercase. lower() on both sides still matches if a token
// or a row differs only by case.
export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, name, role, active
     FROM users
     WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows[0] || null;
}

export async function requireUser(request) {
  const identity = await resolveAccessIdentity(request);
  if (!identity) throw httpError(401, "Sign in required");
  if (!identity.email) throw httpError(403, NOT_SETUP_MESSAGE);
  const user = await findUserByEmail(identity.email);
  if (!user || !user.active) throw httpError(403, NOT_SETUP_MESSAGE);
  return user;
}

export async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== "admin") throw httpError(403, "Admin access required");
  return user;
}
