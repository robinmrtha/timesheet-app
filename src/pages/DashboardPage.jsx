import { useEffect, useMemo, useState } from "react";
import { DateFilters } from "../components/DateFilters.jsx";
import { EntryList } from "../components/EntryList.jsx";
import { Alert, EmptyState, LoadingBlock, PageHeader, StatCard } from "../components/ui.jsx";
import { api, withQuery } from "../lib/api.js";
import { hoursText, money } from "../lib/format.js";
import { summarize, summarizeByEmployee } from "../lib/totals.js";

export function DashboardPage({ user, filters }) {
  const isAdmin = user.role === "admin";
  const [status, setStatus] = useState("all");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${filters.from}|${filters.to}|${status}|${reloadKey}`;
  const [seenKey, setSeenKey] = useState(requestKey);
  if (seenKey !== requestKey) {
    setSeenKey(requestKey);
    setLoading(true);
    setError("");
  }

  useEffect(() => {
    let cancelled = false;
    api(withQuery("/api/entries", { from: filters.from, to: filters.to, status }))
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
  }, [filters.from, filters.to, status, reloadKey]);

  const totals = useMemo(() => summarize(entries), [entries]);
  const byEmployee = useMemo(
    () => (isAdmin ? summarizeByEmployee(entries) : []),
    [entries, isAdmin],
  );
  const firstLoad = loading && entries.length === 0 && !error;

  return (
    <div className="stack">
      <PageHeader
        eyebrow={isAdmin ? "Admin" : "Your timesheet"}
        title={isAdmin ? "Payroll overview" : `Hello, ${(user.name || user.email).split(" ")[0]}`}
        lede="Totals follow the dates and status you pick below. Amounts use the rate saved on each entry."
      >
        <button
          className="btn btn-quiet"
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </PageHeader>

      <section className="card">
        <DateFilters filters={filters} status={status} onStatus={setStatus} />
      </section>

      <section className="stats" aria-label="Totals">
        <StatCard
          tone="unpaid"
          label="Unpaid"
          value={hoursText(totals.unpaidHours)}
          money={money(totals.unpaidPay)}
          detail={`${totals.unpaidCount} ${totals.unpaidCount === 1 ? "entry" : "entries"}`}
        />
        <StatCard
          tone="paid"
          label="Paid"
          value={hoursText(totals.paidHours)}
          money={money(totals.paidPay)}
          detail={`${totals.paidCount} ${totals.paidCount === 1 ? "entry" : "entries"}`}
        />
        <StatCard
          tone="total"
          label="Total"
          value={hoursText(totals.totalHours)}
          money={money(totals.totalPay)}
          detail={`${totals.totalCount} ${totals.totalCount === 1 ? "entry" : "entries"}`}
        />
      </section>

      {isAdmin ? (
        <section className="card">
          <div className="section-head">
            <h2>By employee</h2>
            <p className="quiet">Sorted by unpaid pay. Inactive people stay in the report.</p>
          </div>
          {firstLoad ? (
            <LoadingBlock label="Loading entries…" />
          ) : byEmployee.length === 0 ? (
            <EmptyState title="Nothing in this view">Try a wider date range, or show all statuses.</EmptyState>
          ) : (
            <EmployeeRollup rows={byEmployee} />
          )}
        </section>
      ) : null}

      <section className="card">
        <div className="section-head">
          <h2>Entries</h2>
          <p className="quiet">Amount is hours times the rate stored on that entry.</p>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {firstLoad ? (
          <LoadingBlock label="Loading entries…" />
        ) : !error && entries.length === 0 ? (
          <EmptyState title="No entries yet">
            {isAdmin
              ? "Nobody has hours in this date range."
              : "Submit hours from the Add hours tab. You can add more than one entry on the same day."}
          </EmptyState>
        ) : !error ? (
          <EntryList entries={entries} isAdmin={isAdmin} onChanged={() => setReloadKey((value) => value + 1)} />
        ) : null}
      </section>
    </div>
  );
}

function EmployeeRollup({ rows }) {
  return (
    <>
      <div className="only-mobile entry-cards">
        {rows.map((row) => (
          <article key={row.userId} className="entry-card">
            <div className="entry-card-top">
              <strong>{row.name}</strong>
              {row.active ? null : <span className="badge badge-muted">Inactive</span>}
            </div>
            <p className="entry-amount">{money(row.unpaidPay)}</p>
            <p className="entry-meta">Unpaid · {hoursText(row.unpaidHours)}</p>
            <p className="quiet">
              Paid {money(row.paidPay)} · Total {money(row.totalPay)} ({hoursText(row.totalHours)})
            </p>
          </article>
        ))}
      </div>
      <div className="only-desktop table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Unpaid hrs</th>
              <th>Unpaid</th>
              <th>Paid hrs</th>
              <th>Paid</th>
              <th>Total hrs</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <td>
                  {row.name}
                  {row.active ? null : <span className="quiet"> · inactive</span>}
                </td>
                <td className="num">{row.unpaidHours.toFixed(2)}</td>
                <td className="num">{money(row.unpaidPay)}</td>
                <td className="num">{row.paidHours.toFixed(2)}</td>
                <td className="num">{money(row.paidPay)}</td>
                <td className="num">{row.totalHours.toFixed(2)}</td>
                <td className="num">{money(row.totalPay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
