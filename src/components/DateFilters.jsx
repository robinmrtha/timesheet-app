import { Field } from "./ui.jsx";

export function DateFilters({ filters, status, onStatus }) {
  return (
    <div className={`filters ${onStatus ? "filters-status" : ""}`}>
      <label className="switch">
        <input
          type="checkbox"
          checked={filters.allTime}
          onChange={(event) => filters.setAllTime(event.target.checked)}
        />
        <span className="switch-ui" aria-hidden="true" />
        <span>All time</span>
      </label>
      <Field label="From">
        <input
          type="date"
          value={filters.from}
          disabled={filters.allTime}
          onChange={(event) => filters.setFrom(event.target.value)}
        />
      </Field>
      <Field label="To">
        <input
          type="date"
          value={filters.to}
          disabled={filters.allTime}
          onChange={(event) => filters.setTo(event.target.value)}
        />
      </Field>
      {onStatus ? (
        <Field label="Status">
          <select value={status} onChange={(event) => onStatus(event.target.value)}>
            <option value="all">All</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </select>
        </Field>
      ) : null}
    </div>
  );
}
