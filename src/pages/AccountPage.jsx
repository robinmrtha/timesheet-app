import { useState } from "react";
import { Alert, Field, PageHeader } from "../components/ui.jsx";
import { api } from "../lib/api.js";

export function AccountPage({ user, onUser }) {
  const [name, setName] = useState(user.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
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

  async function savePassword(event) {
    event.preventDefault();
    setError("");
    setPasswordMessage("");
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setPasswordMessage("Password updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack narrow">
      <PageHeader title="Account" lede="Update the name shown in the header, or change your password." />
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
      <section className="card stack">
        <h2>Password</h2>
        <form className="stack" onSubmit={savePassword}>
          <Field label="Current password">
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="New password">
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
          <Alert kind="success">{passwordMessage}</Alert>
        </form>
        <p className="footnote">If you forget this password, an admin can set a new one from the team page.</p>
      </section>
    </div>
  );
}
