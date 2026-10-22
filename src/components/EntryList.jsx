import { useState } from "react";
import { api } from "../lib/api.js";
import { entryAmount, formatDate, formatWhen, money, personName } from "../lib/format.js";
import { Alert, Field, Modal, StatusBadge } from "./ui.jsx";

export function EntryList({ entries, userId, showPeople, showMoney, editOwn, editTeam, canDelete, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  function canEdit(entry) {
    if (entry.status === "paid") return false;
    if (entry.userId === userId) return editOwn || editTeam;
    return editTeam;
  }

  return (
    <>
      <div className="only-mobile entry-cards">
        {entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            showPeople={showPeople}
            showMoney={showMoney}
            canEdit={canEdit(entry)}
            canDelete={canDelete}
            onEdit={() => setEditing(entry)}
            onDelete={() => setRemoving(entry)}
          />
        ))}
      </div>
      <div className="only-desktop table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Hours</th>
              {showMoney ? <th>Rate</th> : null}
              {showMoney ? <th>Amount</th> : null}
              <th>Status</th>
              <th>Notes</th>
              {showPeople ? <th>Employee</th> : null}
              {showPeople ? <th>Paid</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDate(entry.workDate)}</td>
                  <td className="num">{Number(entry.hours).toFixed(2)}</td>
                  {showMoney ? <td className="num">{money(entry.hourlyRate)}</td> : null}
                  {showMoney ? <td className="num">{money(entryAmount(entry))}</td> : null}
                  <td>
                    <StatusBadge status={entry.status} />
                  </td>
                  <td>{entry.notes}</td>
                  {showPeople ? (
                    <td>
                      {personName({ name: entry.employeeName, email: entry.employeeEmail })}
                      {entry.employeeActive === false ? <span className="quiet"> · inactive</span> : null}
                    </td>
                  ) : null}
                  {showPeople ? (
                    <td>
                      {entry.paidAt ? formatWhen(entry.paidAt) : "—"}
                      {entry.paidReference ? <div className="quiet">{entry.paidReference}</div> : null}
                    </td>
                  ) : null}
                  <td className="row-actions">
                    {canEdit(entry) ? (
                      <button className="btn btn-quiet btn-small" type="button" onClick={() => setEditing(entry)}>
                        Edit
                      </button>
                    ) : entry.status === "paid" ? (
                      <span className="quiet">Locked</span>
                    ) : null}
                    {canDelete ? (
                      <button className="btn btn-danger btn-small" type="button" onClick={() => setRemoving(entry)}>
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <EditDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
      {removing ? (
        <DeleteDialog
          entry={removing}
          onClose={() => setRemoving(null)}
          onDeleted={() => {
            setRemoving(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function EntryCard({ entry, showPeople, showMoney, canEdit, canDelete, onEdit, onDelete }) {
  return (
    <article className="entry-card">
      <div className="entry-card-top">
        <div>
          <p className="entry-date">{formatDate(entry.workDate)}</p>
          {showPeople ? (
            <p className="quiet">
              {personName({ name: entry.employeeName, email: entry.employeeEmail })}
              {entry.employeeActive === false ? " · inactive" : ""}
            </p>
          ) : null}
        </div>
        <StatusBadge status={entry.status} />
      </div>
      {showMoney ? <p className="entry-amount">{money(entryAmount(entry))}</p> : null}
      <p className="entry-meta">
        {Number(entry.hours).toFixed(2)} hrs
        {showMoney ? ` · ${money(entry.hourlyRate)}/hr` : ""}
      </p>
      {entry.notes ? <p className="entry-notes">{entry.notes}</p> : null}
      {showPeople && (entry.paidAt || entry.paidReference) ? (
        <p className="quiet">
          {entry.paidAt ? `Paid ${formatWhen(entry.paidAt)}` : ""}
          {entry.paidReference ? ` · ${entry.paidReference}` : ""}
        </p>
      ) : null}
      <div className="row-actions">
        {canEdit ? (
          <button className="btn btn-quiet btn-small" type="button" onClick={onEdit}>
            Edit
          </button>
        ) : entry.status === "paid" ? (
          <span className="quiet">Paid entries are locked</span>
        ) : null}
        {canDelete ? (
          <button className="btn btn-danger btn-small" type="button" onClick={onDelete}>
            Delete
          </button>
        ) : null}
      </div>
    </article>
  );
}

function EditDialog({ entry, onClose, onSaved }) {
  const [workDate, setWorkDate] = useState(entry.workDate);
  const [hours, setHours] = useState(String(entry.hours));
  const [notes, setNotes] = useState(entry.notes || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/entries/${entry.id}`, {
        method: "PATCH",
        body: { workDate, hours: Number(hours), notes },
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit entry" onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label="Work date">
          <input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} required />
        </Field>
        <Field label="Hours">
          <input
            type="number"
            inputMode="decimal"
            min="0.25"
            max="24"
            step="0.25"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            required
          />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} />
        </Field>
        <Alert>{error}</Alert>
        <div className="row-actions">
          <button className="btn btn-quiet" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ entry, onClose, onDeleted }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/entries/${entry.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Delete this entry?" onClose={onClose}>
      <p>
        {formatDate(entry.workDate)} · {Number(entry.hours).toFixed(2)} hrs · {money(entryAmount(entry))}
      </p>
      <Alert>{error}</Alert>
      <div className="row-actions">
        <button className="btn btn-quiet" type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-danger" type="button" onClick={remove} disabled={busy}>
          {busy ? "Deleting…" : "Delete entry"}
        </button>
      </div>
    </Modal>
  );
}
