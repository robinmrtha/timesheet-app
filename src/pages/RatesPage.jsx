import { useEffect, useState } from "react";
import { Alert, EmptyState, Field, LoadingBlock, Modal, PageHeader } from "../components/ui.jsx";
import { api, withQuery } from "../lib/api.js";
import { formatDate, formatWhen, money, optionLabel } from "../lib/format.js";

export function RatesPage() {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState("");
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/users")
      .then((data) => {
        if (cancelled) return;
        setUsers(data.users);
        setUserId((current) => current || data.users[0]?.id || "");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setLoading(true);
    api(withQuery("/api/rates", { userId }))
      .then((data) => {
        if (!cancelled) {
          setRates(data.rates);
          setError("");
        }
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
  }, [userId, message]);

  async function addRate(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/rates", {
        method: "POST",
        body: { userId, hourlyRate: Number(hourlyRate), effectiveFrom },
      });
      setMessage("Rate added.");
      setEffectiveFrom("");
      setHourlyRate("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteRate() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/rates/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      setMessage("Rate deleted.");
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
        title="Hourly rates"
        lede="Add a new row for each raise. Older entries keep the rate they were saved with."
      />
      <section className="card stack">
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
        <form className="form-row" onSubmit={addRate}>
          <Field label="Effective from">
            <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required />
          </Field>
          <Field label="Hourly rate">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="25.00"
              value={hourlyRate}
              onChange={(event) => setHourlyRate(event.target.value)}
              required
            />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy || !userId}>
            {busy ? "Saving…" : "Add rate"}
          </button>
        </form>
        <Alert kind="success">{message}</Alert>
        <Alert>{error}</Alert>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Rate history</h2>
          <p className="quiet">Most recent first. The newest rate on or before a work date is the one that gets saved.</p>
        </div>
        {loading ? <LoadingBlock label="Loading rates…" /> : null}
        {!loading && rates.length === 0 ? (
          <EmptyState title="No rates yet">
            Hours submitted before a rate exists are stored at $0.00 per hour.
          </EmptyState>
        ) : null}
        {!loading && rates.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Effective from</th>
                  <th>Hourly rate</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id}>
                    <td>{formatDate(rate.effectiveFrom)}</td>
                    <td className="num">{money(rate.hourlyRate)}</td>
                    <td>{formatWhen(rate.createdAt)}</td>
                    <td>
                      <button className="btn btn-danger btn-small" type="button" onClick={() => setRemoving(rate)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {removing ? (
        <Modal title="Delete this rate?" onClose={() => (busy ? null : setRemoving(null))}>
          <p>
            {formatDate(removing.effectiveFrom)} · {money(removing.hourlyRate)} per hour. Entries already saved keep
            their own rate.
          </p>
          <div className="row-actions">
            <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button className="btn btn-danger" type="button" disabled={busy} onClick={deleteRate}>
              {busy ? "Deleting…" : "Delete rate"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
