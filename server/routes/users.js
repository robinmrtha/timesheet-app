import { publicUser, requireAdmin } from "../auth.js";
import { query } from "../db.js";
import {
  httpError,
  json,
  parseEmail,
  parseName,
  parseRole,
  readJson,
  requireUuid,
} from "../http.js";

// password_hash is NOT NULL and is not checked. Sign-in is Cloudflare Access.
const UNUSED_PASSWORD_HASH = "not-used";

const USER_COLUMNS = `id, email, name, role, active`;

async function activeAdminCount(exceptId) {
  const { rows } = await query(
    `SELECT count(*)::int AS count
     FROM users
     WHERE role = 'admin' AND active = true AND id <> $1`,
    [exceptId],
  );
  return rows[0].count;
}

export async function listUsers(request) {
  await requireAdmin(request);
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}
     FROM users
     ORDER BY active DESC, lower(coalesce(name, email))`,
  );
  return json({ users: rows.map(publicUser) });
}

export async function createUser(request) {
  await requireAdmin(request);
  const body = await readJson(request);
  const email = parseEmail(body.email);
  const name = parseName(body.name);
  const role = body.role == null || body.role === "" ? "employee" : parseRole(body.role);
  try {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, name, role, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, now(), now())
       RETURNING ${USER_COLUMNS}`,
      [email, UNUSED_PASSWORD_HASH, name, role],
    );
    return json({ user: publicUser(rows[0]) }, 201);
  } catch (error) {
    if (error.code === "23505") throw httpError(409, "That email is already in use");
    throw error;
  }
}

export async function patchUser(request, id) {
  const admin = await requireAdmin(request);
  const userId = requireUuid(id, "User id");
  const body = await readJson(request);
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  const existing = rows[0];
  if (!existing) throw httpError(404, "User not found");

  if ("active" in body && typeof body.active !== "boolean") {
    throw httpError(400, "Active must be true or false");
  }
  const next = {
    name: "name" in body ? parseName(body.name) : existing.name,
    email: "email" in body ? parseEmail(body.email) : existing.email,
    role: "role" in body ? parseRole(body.role) : existing.role,
    active: "active" in body ? body.active : existing.active,
  };

  const demotingSelf =
    admin.id === existing.id && (next.role !== "admin" || next.active === false);
  const removingLastAdmin =
    existing.role === "admin" &&
    existing.active &&
    (next.role !== "admin" || next.active === false) &&
    (await activeAdminCount(existing.id)) === 0;
  if (demotingSelf) throw httpError(400, "You cannot remove your own admin access");
  if (removingLastAdmin) throw httpError(400, "Keep at least one active admin");

  try {
    const updated = await query(
      `UPDATE users
       SET name = $1, email = $2, role = $3, active = $4, updated_at = now()
       WHERE id = $5
       RETURNING ${USER_COLUMNS}`,
      [next.name, next.email, next.role, next.active, userId],
    );
    return json({ user: publicUser(updated.rows[0]) });
  } catch (error) {
    if (error.code === "23505") throw httpError(409, "That email is already in use");
    throw error;
  }
}
