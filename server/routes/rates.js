import { query } from "../db.js";
import { allows, assertCan, requireActor } from "../permissions.js";
import { httpError, json, parseDate, parseRate, readJson, requireUuid } from "../http.js";
import { rateFor } from "./entries.js";

function rateJson(row) {
  return {
    id: row.id,
    userId: row.user_id,
    hourlyRate: Number(row.hourly_rate),
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function applicableRate(request, url) {
  const { user, permissions } = await requireActor(request);
  assertCan(permissions, "timesheet.own", "view");
  const workDate = parseDate(url.searchParams.get("date"), "Date");
  const hourlyRate = await rateFor(user.id, workDate);
  return json({ hourlyRate, rateFound: hourlyRate > 0, workDate });
}

export async function listRates(request, url) {
  const { user, permissions } = await requireActor(request);
  const payroll = allows(permissions, "timesheet.payroll", "view");
  const own = allows(permissions, "timesheet.own", "view");
  if (!payroll && !own) throw httpError(403, "You do not have access to that");
  let userId = user.id;
  const requested = url.searchParams.get("userId");
  if (payroll) {
    if (requested) userId = requireUuid(requested, "User id");
  } else if (requested && requested !== user.id) {
    throw httpError(403, "You can only view your own rates");
  }

  const { rows } = await query(
    `SELECT id, user_id, hourly_rate, effective_from, created_at, created_by
     FROM employee_rates
     WHERE user_id = $1
     ORDER BY effective_from DESC, created_at DESC`,
    [userId],
  );
  return json({ rates: rows.map(rateJson) });
}

export async function createRate(request) {
  const { user: admin, permissions } = await requireActor(request);
  assertCan(permissions, "timesheet.payroll", "edit");
  const body = await readJson(request);
  const userId = requireUuid(body.userId, "User id");
  const hourlyRate = parseRate(body.hourlyRate);
  const effectiveFrom = parseDate(body.effectiveFrom, "Effective date");
  const owner = await query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!owner.rows[0]) throw httpError(404, "User not found");
  const { rows } = await query(
    `INSERT INTO employee_rates (user_id, hourly_rate, effective_from, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, hourly_rate, effective_from, created_at, created_by`,
    [userId, hourlyRate, effectiveFrom, admin.id],
  );
  return json({ rate: rateJson(rows[0]) }, 201);
}

export async function patchRate(request, id) {
  const { permissions } = await requireActor(request);
  assertCan(permissions, "timesheet.payroll", "edit");
  const rateId = requireUuid(id, "Rate id");
  const body = await readJson(request);
  const existing = await query(
    `SELECT id, user_id, hourly_rate, effective_from, created_at, created_by
     FROM employee_rates WHERE id = $1`,
    [rateId],
  );
  if (!existing.rows[0]) throw httpError(404, "Rate not found");
  const current = existing.rows[0];
  const hourlyRate = "hourlyRate" in body ? parseRate(body.hourlyRate) : Number(current.hourly_rate);
  const effectiveFrom =
    "effectiveFrom" in body ? parseDate(body.effectiveFrom, "Effective date") : current.effective_from;
  const { rows } = await query(
    `UPDATE employee_rates
     SET hourly_rate = $1, effective_from = $2
     WHERE id = $3
     RETURNING id, user_id, hourly_rate, effective_from, created_at, created_by`,
    [hourlyRate, effectiveFrom, rateId],
  );
  return json({ rate: rateJson(rows[0]) });
}

export async function deleteRate(request, id) {
  const { permissions } = await requireActor(request);
  assertCan(permissions, "timesheet.payroll", "edit");
  const rateId = requireUuid(id, "Rate id");
  const { rowCount } = await query(`DELETE FROM employee_rates WHERE id = $1`, [rateId]);
  if (!rowCount) throw httpError(404, "Rate not found");
  return json({ ok: true });
}
