import { useEffect, useState } from "react";
import { ActiveBadge, Alert, Field, LoadingBlock, PageHeader } from "../components/ui.jsx";
import { api } from "../lib/api.js";
import { initials, personName } from "../lib/format.js";

const EMPTY_FORM = { name: "", email: "", role: "employee" };

export function TeamPage({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    return api("/api/users")
      .then((data) => {
        setUsers(data.users);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    api("/api/users")
      .then((data) => {
        if (!cancelled) setUsers(data.users);
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
  }, []);

  async function createUser(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/users", { method: "POST", body: form });
      setForm(EMPTY_FORM);
      setMessage("Employee added. They can open Timesheet after signing in with this email.");
      await load();
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
        title="Team"
        lede="Add someone by the email they use with Cloudflare Access, or mark them inactive. Inactive people cannot open Timesheet, and their hours stay in reports."
      />
      <Alert kind="success">{message}</Alert>
      <Alert>{error}</Alert>

      <section className="card">
        <h2>New employee</h2>
        <form className="stack" onSubmit={createUser}>
          <div className="split">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </Field>
            <Field label="Email" hint="The Cloudflare Access email">
              <input
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </Field>
          </div>
          <div className="split">
            <Field label="Role">
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
      </section>

      <section className="stack">
        {loading ? <LoadingBlock label="Loading team…" /> : null}
        {users.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            isSelf={person.id === currentUserId}
            onChanged={async (text) => {
              setMessage(text);
              await load();
            }}
            onError={setError}
          />
        ))}
      </section>
    </div>
  );
}

function PersonCard({ person, isSelf, onChanged, onError }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(person.name || "");
  const [email, setEmail] = useState(person.email);
  const [role, setRole] = useState(person.role);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(person.name || "");
    setEmail(person.email);
    setRole(person.role);
  }, [person.name, person.email, person.role]);

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(`/api/users/${person.id}`, { method: "PATCH", body: { name, email, role } });
      await onChanged("Profile updated.");
      setOpen(false);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    const next = !person.active;
    if (!next && !window.confirm(`${personName(person)} will not be able to open Timesheet. Their hours stay visible.`)) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/users/${person.id}`, { method: "PATCH", body: { active: next } });
      await onChanged(next ? "Account reactivated." : "Account marked inactive.");
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card person-card">
      <div className="person-row">
        <div className="avatar" aria-hidden="true">
          {initials(person)}
        </div>
        <div className="person-id">
          <strong>{personName(person)}</strong>
          <span className="quiet">{person.email}</span>
        </div>
        <div className="person-tags">
          <span className={`role-chip ${person.role === "admin" ? "role-admin" : ""}`}>{person.role}</span>
          <ActiveBadge active={person.active} />
        </div>
      </div>
      <div className="row-actions">
        <button className="btn btn-quiet btn-small" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "Edit"}
        </button>
        <button className="btn btn-quiet btn-small" type="button" onClick={toggleActive} disabled={busy || isSelf}>
          {person.active ? "Deactivate" : "Reactivate"}
        </button>
        {isSelf ? <span className="quiet">This is you</span> : null}
      </div>
      {open ? (
        <div className="stack person-edit">
          <form className="split" onSubmit={saveProfile}>
            <Field label="Name">
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field label="Email" hint="Must match the Cloudflare Access email">
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </Field>
            <Field label="Role">
              <select value={role} onChange={(event) => setRole(event.target.value)} disabled={isSelf}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Save profile
            </button>
          </form>
        </div>
      ) : null}
    </article>
  );
}
