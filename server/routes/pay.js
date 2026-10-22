import { query } from "../db.js";
import { assertCan, requireActor } from "../permissions.js";
import { blankToNull, httpError, json, optionalDate, readJson, requireUuid } from "../http.js";

export async function markPaid(request) {
  const { user: admin, permissions } = await requireActor(request);
  assertCan(permissions, "timesheet.payroll", "edit");
  const body = await readJson(request);
  const userId = requireUuid(body.userId, "User id");
  const from = optionalDate(body.from, "From");
  const to = optionalDate(body.to, "To");
  if (from && to && from > to) throw httpError(400, "From date must be on or before to date");
  const reference = blankToNull(body.reference, 200, "Payment reference");

  const owner = await query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!owner.rows[0]) throw httpError(404, "User not found");

  const { rows } = await query(
    `WITH updated AS (
       UPDATE time_entries
       SET status = 'paid',
           paid_at = now(),
           paid_by = $4,
           paid_reference = $5
       WHERE user_id = $1
         AND status <> 'paid'
         AND ($2::date IS NULL OR work_date >= $2)
         AND ($3::date IS NULL OR work_date <= $3)
       RETURNING hours, hourly_rate
     )
     SELECT count(*)::int AS updated,
            coalesce(sum(hours), 0) AS hours,
            coalesce(sum(hours * coalesce(hourly_rate, 0)), 0) AS pay
     FROM updated`,
    [userId, from, to, admin.id, reference],
  );
  const result = rows[0];
  return json({
    updated: result.updated,
    hours: Number(result.hours),
    pay: Number(result.pay),
  });
}
