import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Alert, Field } from "../components/ui.jsx";

export function LoginPage({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Sign in · Himalayan Bazaar";
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      onSignedIn(data.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card card">
        <p className="eyebrow">Himalayan Bazaar</p>
        <h1>Sign in</h1>
        <p className="lede">Log hours, or review payroll if you are an admin.</p>
        <form className="stack" onSubmit={onSubmit}>
          <Field label="Email">
            <input
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <Alert>{error}</Alert>
        </form>
        <p className="footnote">Forgot your password? Ask an admin to set a new one.</p>
      </div>
    </div>
  );
}
