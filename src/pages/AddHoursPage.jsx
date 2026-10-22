import { useEffect, useState } from "react";
import { Alert, Field, PageHeader } from "../components/ui.jsx";
import { api, withQuery } from "../lib/api.js";
import { money } from "../lib/format.js";

export function AddHoursPage({ onDone }) {
  const [workDate, setWorkDate] = useState("");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [rate, setRate] = useState(null);
  const [rateError, setRateError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!workDate) {
      setRate(null);
      setRateError("");
      return;
    }
    let cancelled = false;
    api(withQuery("/api/rates/applicable", { date: workDate }))
      .then((data) => {
        if (!cancelled) {
          setRate(data);
          setRateError("");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRate(null);
          setRateError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workDate]);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api("/api/entries", {
        method: "POST",
        body: { workDate, hours: Number(hours), notes },
      });
      const used = money(data.entry.hourlyRate);
      setMessage(
        data.rateFound
          ? `Saved. This entry uses ${used} per hour.`
          : "Saved. No rate was on file for that date, so it was stored at $0.00 per hour.",
      );
      setWorkDate("");
      setHours("");
      setNotes("");
      setRate(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const preview =
    rate && hours
      ? money((Number(hours) || 0) * rate.hourlyRate)
      : null;

  return (
    <div className="stack narrow">
      <PageHeader
        title="Add hours"
        lede="Enter the date and how long you worked. Split shifts are separate entries on the same day."
      />
      <section className="card">
        <form className="stack" onSubmit={onSubmit}>
          <Field label="Work date">
            <input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} required />
          </Field>
          <Field label="Hours" hint="Use decimals, for example 7.5">
            <input
              type="number"
              inputMode="decimal"
              min="0.25"
              max="24"
              step="0.25"
              placeholder="7.5"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              required
            />
          </Field>
          <Field label="Notes" hint="Optional">
            <textarea
              value={notes}
              maxLength={2000}
              placeholder="What did you work on?"
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>

          {workDate && rate ? (
            <div className={`rate-note ${rate.rateFound ? "" : "rate-note-warn"}`}>
              <strong>{rate.rateFound ? `${money(rate.hourlyRate)} per hour` : "No rate on file"}</strong>
              <span>
                {rate.rateFound
                  ? "This rate is saved on the entry, so later raises do not change it."
                  : "An admin needs to add a rate that starts on or before this date. The entry will be stored at $0.00."}
              </span>
              {preview && rate.rateFound ? <span>Estimated pay {preview}</span> : null}
            </div>
          ) : null}
          {rateError ? <Alert>{rateError}</Alert> : null}

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Submit hours"}
          </button>
          <Alert kind="success">{message}</Alert>
          <Alert>{error}</Alert>
          {message ? (
            <button className="btn btn-quiet btn-block" type="button" onClick={onDone}>
              View timesheet
            </button>
          ) : null}
        </form>
      </section>
    </div>
  );
}
