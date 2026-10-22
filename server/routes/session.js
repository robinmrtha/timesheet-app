import {
  assertIpAllowed,
  assertNotLocked,
  clearFailedLogins,
  clearSessionCookie,
  compareUnknownPassword,
  currentUser,
  findUserByEmail,
  hashPassword,
  issueSession,
  passwordsMatch,
  publicUser,
  recordFailedLogin,
  recordLoginAttempt,
  requireUser,
  sessionCookie,
} from "../auth.js";
import { query } from "../db.js";
import { clientIp, httpError, json, parseEmail, parseName, parsePassword, readJson } from "../http.js";

export async function login(request) {
  const body = await readJson(request);
  const email = parseEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) throw httpError(400, "Password is required");

  const ip = clientIp(request);
  await assertIpAllowed(ip);
  await recordLoginAttempt(ip, email);

  const user = await findUserByEmail(email);
  if (!user) {
    await compareUnknownPassword(password);
    throw httpError(401, "Invalid email or password");
  }

  assertNotLocked(user);
  const match = await passwordsMatch(password, user.password_hash);
  if (!match) {
    await recordFailedLogin(user.id);
    throw httpError(401, "Invalid email or password");
  }
  if (!user.active) {
    throw httpError(403, "This account is inactive. Ask an admin if you still need access.");
  }

  await clearFailedLogins(user.id);
  const response = json({ user: publicUser(user) });
  response.headers.append("set-cookie", sessionCookie(issueSession(user.id), request));
  return response;
}

export async function logout(request) {
  const response = json({ ok: true });
  response.headers.append("set-cookie", clearSessionCookie(request));
  return response;
}

export async function session(request) {
  const user = await currentUser(request);
  if (!user || !user.active) {
    const response = json({ user: null });
    if (user && !user.active) {
      response.headers.append("set-cookie", clearSessionCookie(request));
    }
    return response;
  }
  return json({ user: publicUser(user) });
}

export async function changePassword(request) {
  const user = await requireUser(request);
  const body = await readJson(request);
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const nextPassword = parsePassword(body.newPassword, "New password");
  if (!currentPassword) throw httpError(400, "Current password is required");
  if (!(await passwordsMatch(currentPassword, user.password_hash))) {
    throw httpError(400, "Current password is incorrect");
  }
  if (currentPassword === nextPassword) {
    throw httpError(400, "Choose a password that is different from the current one");
  }
  const passwordHash = await hashPassword(nextPassword);
  await query(
    `UPDATE users SET password_hash = $1, updated_at = now(), failed_login_count = 0, locked_until = NULL
     WHERE id = $2`,
    [passwordHash, user.id],
  );
  return json({ ok: true });
}

export async function getMe(request) {
  const user = await requireUser(request);
  return json({ user: publicUser(user) });
}

export async function patchMe(request) {
  const user = await requireUser(request);
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
