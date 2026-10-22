import { useState } from "react";
import { Alert, Field, PageHeader } from "../components/ui.jsx";
import { api } from "../lib/api.js";

export function AccountPage({ user, onUser }) {
  const [name, setName] = useState(user.name || "");
  const [profileMessage, setProfileMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveName(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setProfileMessage("");
    try {
      const data = await api("/api/me", { method: "PATCH", body: { name } });
      onUser(data.user);
      setProfileMessage("Name updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack narrow">
      <PageHeader
        title="Account"
        lede="Update the name shown in the header. Sign-in is Cloudflare Access, using the email below."
      />
      <Alert>{error}</Alert>
      <section className="card stack">
        <h2>Profile</h2>
        <p className="quiet">
          {user.email} · {user.role === "admin" ? "Admin" : "Employee"}
        </p>
        <form className="stack" onSubmit={saveName}>
          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Save name
          </button>
          <Alert kind="success">{profileMessage}</Alert>
        </form>
      </section>
    </div>
  );
}
