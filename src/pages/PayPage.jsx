import { useEffect, useMemo, useState } from "react";
import { DateFilters } from "../components/DateFilters.jsx";
import { Alert, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui.jsx";
import { api, withQuery } from "../lib/api.js";
import { hoursText, money, optionLabel, personName, rangeLabel } from "../lib/format.js";
import { summarize } from "../lib/totals.js";

export function PayPage({ filters, canEdit = false }) {
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState("");
  const [userId, setUserId] = useState("");
  const [reference, setReference] = useState("");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api("/api/users")
      .then((data) => {
        if (cancelled) return;
        setUsers(data.users);
        setUserId((current) => current || data.users.find((user) => user.role !== "admin")?.id || data.users[0]?.id || "");
      })
      .catch((err) => {
        if (!cancelled) setUsersError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    api(withQuery("/api/entries", { userId, from: filters.from, to: filters.to, status: "unpaid" }))
      .then((data) => {
        if (!cancelled) setEntries(data.entries);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, filters.from, filters.to, message]);

  const totals = useMemo(() => summarize(entries), [entries]);
  const selected = users.find((user) => user.id === userId);

  async function markPaid() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/admin/pay", {
        method: "POST",
        body: {
          userId,
          from: filters.from,
          to: filters.to,
          reference,
        },
      });
      setMessage(
        result.updated
          ? `Marked ${result.updated} ${result.updated === 1 ? "entry" : "entries"} paid (${money(result.pay)}).`
          : "Nothing unpaid was in that range.",
      );
      setReference("");
      setConfirming(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Admin"
        title="Pay employees"
        lede="Preview unpaid hours for one person and a date range, then mark those entries paid."
      />
      <section className="card stack">
        {usersError ? <Alert>{usersError}</Alert> : null}
        {users.length === 0 && !usersError ? <LoadingBlock label="Loading team…" /> : null}
        {users.length > 0 ? (
          <>
            <div className="split">
              <Field label="Employee">
                <select
                  value={userId}
                  onChange={(event) => {
                    setUserId(event.target.value);
                    setMessage("");
                  }}
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {optionLabel(user)}
                    </option>
                  ))}
                </select>
              </Field>
              {canEdit ? (
                <Field label="Payment reference" hint="Optional. Check number, Zelle, Venmo.">
                  <input
                    value={reference}
                    maxLength={200}
                    placeholder="Zelle, check #, Venmo"
                    onChange={(event) => setReference(event.target.value)}
                  />
                </Field>
              ) : (
                <p className="quiet">You can review unpaid hours. Marking them paid needs edit access.</p>
              )}
            </div>
            <DateFilters filters={filters} />
            <div className="pay-preview">
              <div>
                <p className="stat-label">Unpaid in range</p>
                <p className="stat-value">{loading ? "…" : hoursText(totals.unpaidHours)}</p>
                <p className="stat-money">{loading ? "" : money(totals.unpaidPay)}</p>
                <p className="quiet">
                  {rangeLabel(filters)} · {totals.unpaidCount} {totals.unpaidCount === 1 ? "entry" : "entries"}
                </p>
              </div>
              {canEdit ? (
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy || loading || !userId || totals.unpaidCount === 0}
                  onClick={() => setConfirming(true)}
                >
                  Mark unpaid as paid
                </button>
              ) : null}
            </div>
            <Alert kind="success">{message}</Alert>
            <Alert>{error}</Alert>
          </>
        ) : null}
      </section>
      {confirming && selected ? (
        <Modal title="Mark these entries paid?" onClose={() => (busy ? null : setConfirming(false))}>
          <p>
            {personName(selected)} · {totals.unpaidCount} {totals.unpaidCount === 1 ? "entry" : "entries"} ·{" "}
            {hoursText(totals.unpaidHours)} · {money(totals.unpaidPay)}
          </p>
          <p className="quiet">Date range: {rangeLabel(filters)}</p>
          {reference.trim() ? <p className="quiet">Reference: {reference.trim()}</p> : null}
          <div className="row-actions">
            <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={markPaid}>
              {busy ? "Updating…" : "Confirm payment"}
            </button>
          </div>
        </Modal>
      ) : null}
      {!loading && userId && totals.unpaidCount === 0 && !error ? (
        <EmptyState title="Nothing to pay">There are no unpaid entries for this person in the selected dates.</EmptyState>
      ) : null}
    </div>
  );
}
