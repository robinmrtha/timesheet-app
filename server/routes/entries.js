import { requireAdmin, requireUser } from "../auth.js";
import { query } from "../db.js";
import {
  blankToNull,
  httpError,
  json,
  optionalDate,
  parseDate,
  parseHours,
  readJson,
  requireUuid,
} from "../http.js";

function entryJson(row) {
  return {
    id: row.id,
    userId: row.user_id,
    workDate: row.work_date,
    hours: Number(row.hours),
    notes: row.notes || "",
    status: row.status,
    unpaidReason: row.unpaid_reason,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    paidAt: row.paid_at,
    paidBy: row.paid_by,
    paidReference: row.paid_reference,
    createdAt: row.created_at,
    hourlyRate: row.hourly_rate == null ? 0 : Number(row.hourly_rate),
    employeeName: row.employee_name || "",
    employeeEmail: row.employee_email || "",
    employeeActive: row.employee_active !== false,
  };
}

const ENTRY_SELECT = `
  SELECT e.id, e.user_id, e.work_date, e.hours, e.notes, e.status, e.unpaid_reason,
         e.approved_at, e.approved_by, e.paid_at, e.paid_by, e.paid_reference,
         e.created_at, e.hourly_rate,
         u.name AS employee_name, u.email AS employee_email, u.active AS employee_active
  FROM time_entries e
  JOIN users u ON u.id = e.user_id
`;

export async function rateFor(userId, workDate) {
  const { rows } = await query(
    `SELECT hourly_rate
     FROM employee_rates
     WHERE user_id = $1 AND effective_from <= $2::date
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [userId, workDate],
  );
  return rows[0] ? Number(rows[0].hourly_rate) : 0;
}

async function loadEntry(id) {
  const { rows } = await query(`${ENTRY_SELECT} WHERE e.id = $1`, [id]);
  return rows[0] || null;
}

export async function listEntries(request, url) {
  const user = await requireUser(request);
  const isAdmin = user.role === "admin";
  let userId = null;
  if (isAdmin) {
    const requested = url.searchParams.get("userId");
    if (requested) userId = requireUuid(requested, "User id");
  } else {
    userId = user.id;
  }
  const from = optionalDate(url.searchParams.get("from"), "From");
  const to = optionalDate(url.searchParams.get("to"), "To");
  if (from && to && from > to) throw httpError(400, "From date must be on or before to date");
  const status = url.searchParams.get("status") || "all";
  if (!["all", "paid", "unpaid"].includes(status)) {
    throw httpError(400, "Status must be all, paid, or unpaid");
  }

  const { rows } = await query(
    `${ENTRY_SELECT}
     WHERE ($1::uuid IS NULL OR e.user_id = $1)
       AND ($2::date IS NULL OR e.work_date >= $2)
       AND ($3::date IS NULL OR e.work_date <= $3)
       AND (
         $4::text = 'all'
         OR ($4 = 'paid' AND e.status = 'paid')
         OR ($4 = 'unpaid' AND e.status <> 'paid')
       )
     ORDER BY e.work_date DESC, e.created_at DESC`,
    [userId, from, to, status],
  );
  return json({ entries: rows.map(entryJson) });
}

export async function createEntry(request) {
  const user = await requireUser(request);
  const body = await readJson(request);
  const workDate = parseDate(body.workDate, "Work date");
  const hours = parseHours(body.hours);
  const notes = blankToNull(body.notes, 2000, "Notes");
  const hourlyRate = await rateFor(user.id, workDate);
  const { rows } = await query(
    `INSERT INTO time_entries (user_id, work_date, hours, notes, status, hourly_rate)
     VALUES ($1, $2, $3, $4, 'submitted', $5)
     RETURNING id`,
    [user.id, workDate, hours, notes, hourlyRate],
  );
  const entry = await loadEntry(rows[0].id);
  return json({ entry: entryJson(entry), rateFound: hourlyRate > 0 }, 201);
}

export async function patchEntry(request, id) {
  const user = await requireUser(request);
  const entryId = requireUuid(id, "Entry id");
  const existing = await loadEntry(entryId);
  if (!existing) throw httpError(404, "Entry not found");
  const isAdmin = user.role === "admin";
  if (!isAdmin && existing.user_id !== user.id) throw httpError(404, "Entry not found");
  if (!isAdmin && existing.status === "paid") {
    throw httpError(403, "Paid entries cannot be edited");
  }

  const body = await readJson(request);
  if ("status" in body || "userId" in body || "hourlyRate" in body) {
    throw httpError(400, "Only the work date, hours, and notes can be edited");
  }
  const workDate = "workDate" in body ? parseDate(body.workDate, "Work date") : existing.work_date;
  const hours = "hours" in body ? parseHours(body.hours) : Number(existing.hours);
  const notes = "notes" in body ? blankToNull(body.notes, 2000, "Notes") : existing.notes;
  let hourlyRate = existing.hourly_rate == null ? 0 : Number(existing.hourly_rate);
  if (workDate !== existing.work_date) {
    hourlyRate = await rateFor(existing.user_id, workDate);
  }
  await query(
    `UPDATE time_entries
     SET work_date = $1, hours = $2, notes = $3, hourly_rate = $4
     WHERE id = $5`,
    [workDate, hours, notes, hourlyRate, entryId],
  );
  const updated = await loadEntry(entryId);
  return json({ entry: entryJson(updated) });
}

export async function deleteEntry(request, id) {
  await requireAdmin(request);
  const entryId = requireUuid(id, "Entry id");
  const { rowCount } = await query(`DELETE FROM time_entries WHERE id = $1`, [entryId]);
  if (!rowCount) throw httpError(404, "Entry not found");
  return json({ ok: true });
}
