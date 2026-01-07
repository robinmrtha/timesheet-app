import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

/* ---------- helpers ---------- */
function isoDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function getThisMonthDefaults() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: isoDate(start), to: isoDate(now) };
}
function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* ---------- routing: use ?reset=1 because Supabase uses hash for tokens ---------- */
function getRoute() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reset") === "1") return "reset";

  const h = window.location.hash || "";
  if (h.startsWith("#/forgot")) return "forgot";
  return "home";
}

/* ---------- APP ---------- */
export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    const onRoute = () => setRoute(getRoute());
    window.addEventListener("hashchange", onRoute);
    window.addEventListener("popstate", onRoute);
    return () => {
      window.removeEventListener("hashchange", onRoute);
      window.removeEventListener("popstate", onRoute);
    };
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div style={styles.appBg}>
      <GlobalStyles />
      <Shell>
        <Header
          right={
            session ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="pill pill-slate">{session.user.email}</span>
                <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>
                  Log out
                </button>
              </div>
            ) : (
              <span className="pill pill-indigo">
                <span className="dot" /> Secure
              </span>
            )
          }
        />

        {booting ? (
          <Card>
            <div className="muted">Loading…</div>
          </Card>
        ) : route === "forgot" ? (
          <ForgotPassword />
        ) : route === "reset" ? (
          <ResetPassword />
        ) : !session ? (
          <Login />
        ) : (
          <Dashboard session={session} />
        )}
      </Shell>
    </div>
  );
}

/* ---------- LOGIN ---------- */
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setMsg("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMsg(error.message);
  }

  return (
    <div style={{ display: "grid", placeItems: "center", padding: "24px 0 40px" }}>
      <div style={{ width: "min(520px, 100%)" }}>
        <Card>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div className="h2">Sign in</div>
              <div className="muted">Use your email + password.</div>
            </div>

            <form onSubmit={handleLogin} style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Email</label>
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Signing in…" : "Log in"}
              </button>

              <button type="button" className="btn btn-secondary" onClick={() => (window.location.hash = "#/forgot")}>
                Forgot password?
              </button>

              {msg && <div className="alert alert-red">{msg}</div>}
            </form>
          </div>
        </Card>

        <div style={{ marginTop: 12 }} className="muted">
          If reset links say “cannot find server”, fix Supabase: <strong>Auth → URL Configuration</strong> (Site URL +
          Redirect URLs).
        </div>
      </div>
    </div>
  );
}

/* ---------- FORGOT PASSWORD ---------- */
function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendReset(e) {
    e.preventDefault();
    setMsg("");
    setBusy(true);

    // IMPORTANT: do NOT use hash for reset redirect. Supabase uses hash for tokens.
    const redirectTo = `${window.location.origin}/?reset=1`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setBusy(false);

    if (error) setMsg(error.message);
    else setMsg("Reset email sent ✅ Check inbox (and spam).");
  }

  return (
    <div style={{ display: "grid", placeItems: "center", padding: "24px 0 40px" }}>
      <div style={{ width: "min(520px, 100%)" }}>
        <Card>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="h2">Forgot password</div>
              <div className="muted">We’ll email you a reset link.</div>
            </div>

            <form onSubmit={sendReset} style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Email</label>
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>

              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Sending…" : "Send reset email"}
              </button>

              <button type="button" className="btn btn-ghost" onClick={() => (window.location.hash = "")}>
                Back to login
              </button>

              {msg && <div className={cls("alert", msg.includes("✅") ? "alert-green" : "alert-red")}>{msg}</div>}
            </form>
          </div>
        </Card>

        <div style={{ marginTop: 12 }} className="muted">
          Supabase must allow redirects for your app URL (ex: <code>http://localhost:5173/*</code>).
        </div>
      </div>
    </div>
  );
}

/* ---------- RESET PASSWORD ---------- */
function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setMsg("");

      // Session should exist after clicking the recovery email link
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;
      setReady(true);

      if (error) {
        setMsg(error.message);
        return;
      }

      if (!data.session) {
        setMsg(
          "Reset link not active yet. Please click the reset email link again on this same browser. If it still fails, your Supabase Redirect URLs are not set correctly."
        );
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function updatePassword(e) {
    e.preventDefault();
    setMsg("");

    if (password.length < 8) return setMsg("Password must be at least 8 characters.");
    if (password !== confirm) return setMsg("Passwords do not match.");

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (error) {
      setMsg(error.message);
    } else {
      // Clear ?reset=1 from URL and go back to login cleanly
      setMsg("Password updated ✅ You can log in now.");
      window.history.replaceState({}, "", "/");
      window.location.reload();
    }
  }

  return (
    <div style={{ display: "grid", placeItems: "center", padding: "24px 0 40px" }}>
      <div style={{ width: "min(520px, 100%)" }}>
        <Card>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="h2">Reset password</div>
              <div className="muted">Enter a new password.</div>
            </div>

            {!ready ? (
              <div className="muted">Loading…</div>
            ) : (
              <form onSubmit={updatePassword} style={{ display: "grid", gap: 10 }}>
                <div className="field">
                  <label>New password</label>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>
                <div className="field">
                  <label>Confirm new password</label>
                  <input
                    className="input"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>

                <button className="btn btn-primary" disabled={busy}>
                  {busy ? "Updating…" : "Update password"}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    window.history.replaceState({}, "", "/");
                    window.location.reload();
                  }}
                >
                  Back to login
                </button>

                {msg && <div className={cls("alert", msg.includes("✅") ? "alert-green" : "alert-red")}>{msg}</div>}
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- DASHBOARD (your full app) ---------- */
function Dashboard({ session }) {
  // profile / role
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const isAdmin = profile?.role === "admin";

  // employees list (admin)
  const [employees, setEmployees] = useState([]); // [{id,name,email,role}]
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const usersById = useMemo(() => {
    const map = {};
    for (const e of employees) map[e.id] = { name: e.name || "", email: e.email || "", role: e.role || "" };
    return map;
  }, [employees]);

  // entries
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState("");

  // filters
  const defaults = useMemo(() => getThisMonthDefaults(), []);
  const [allTime, setAllTime] = useState(false);
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [payFilter, setPayFilter] = useState("all"); // all | unpaid | paid

  // pages
  const [page, setPage] = useState("dashboard"); // dashboard | add | pay | rates | account

  // add hours
  const [workDate, setWorkDate] = useState("");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // pay employee (admin)
  const [payUserId, setPayUserId] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payMsg, setPayMsg] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payPreview, setPayPreview] = useState({ unpaidHours: 0, unpaidPay: 0, unpaidCount: 0 });

  // rates (admin)
  const [rateUserId, setRateUserId] = useState("");
  const [rateList, setRateList] = useState([]);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateMsg, setRateMsg] = useState("");
  const [newRateEffectiveFrom, setNewRateEffectiveFrom] = useState("");
  const [newRateValue, setNewRateValue] = useState("");

  /* load my profile */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProfileLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("role,name,email")
        .eq("id", session.user.id)
        .single();

      if (cancelled) return;
      if (error || !data) setProfile({ role: "employee" });
      else setProfile(data);
      setProfileLoading(false);
    })();
    return () => (cancelled = true);
  }, [session.user.id]);

  /* all-time toggle */
  useEffect(() => {
    if (allTime) {
      setFromDate("");
      setToDate("");
    } else {
      const d = getThisMonthDefaults();
      setFromDate(d.from);
      setToDate(d.to);
    }
  }, [allTime]);

  /* admin load employees */
  useEffect(() => {
    if (!isAdmin) return;
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function loadEmployees() {
    setEmployeesLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id,name,email,role")
      .order("name", { ascending: true });

    if (!error && data) {
      const list = data.map((p) => ({ id: p.id, name: p.name || "", email: p.email || "", role: p.role || "" }));
      setEmployees(list);
      const firstId = list[0]?.id || "";
      if (!payUserId) setPayUserId(firstId);
      if (!rateUserId) setRateUserId(firstId);
    }
    setEmployeesLoading(false);
  }

  /* load entries when filters change */
  useEffect(() => {
    if (!profile) return;
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, fromDate, toDate, payFilter]);

  async function loadEntries() {
    setLoadingRows(true);
    setRowsError("");

    let q = supabase
      .from("time_entries")
      .select("id,user_id,work_date,hours,hourly_rate,status,notes,paid_at,paid_reference,created_at")
      .order("work_date", { ascending: false });

    if (!isAdmin) q = q.eq("user_id", session.user.id);
    if (fromDate) q = q.gte("work_date", fromDate);
    if (toDate) q = q.lte("work_date", toDate);
    if (payFilter === "paid") q = q.eq("status", "paid");
    if (payFilter === "unpaid") q = q.neq("status", "paid");

    const { data, error } = await q;

    if (error) {
      setRows([]);
      setRowsError(error.message);
      setLoadingRows(false);
      return;
    }

    setRows(data || []);
    setLoadingRows(false);
  }

  /* rate lookup (effective_from <= work_date) */
  async function getRateForWorkDate(userId, work_date) {
    const { data, error } = await supabase
      .from("employee_rates")
      .select("hourly_rate,effective_from")
      .eq("user_id", userId)
      .lte("effective_from", work_date)
      .order("effective_from", { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);
    return Number(data?.[0]?.hourly_rate) || 0;
  }

  async function addHours(e) {
    e.preventDefault();
    setAddMsg("");
    setAddBusy(true);

    try {
      const rate = await getRateForWorkDate(session.user.id, workDate);

      const { error } = await supabase.from("time_entries").insert({
        user_id: session.user.id,
        work_date: workDate,
        hours: Number(hours),
        notes,
        status: "submitted",
        hourly_rate: rate, // snapshot rate
      });

      if (error) {
        setAddMsg(error.message);
      } else {
        setAddMsg(rate > 0 ? `Submitted ✅ Rate used: ${money(rate)}/hr` : "Submitted ✅ (No rate found: $0/hr)");
        setWorkDate("");
        setHours("");
        setNotes("");
        await loadEntries();
        setPage("dashboard");
      }
    } catch (err) {
      setAddMsg(err?.message || "Could not find rate. Add a rate first.");
    }

    setAddBusy(false);
  }

  /* totals */
  const totals = useMemo(() => {
    const paid = rows.filter((r) => r.status === "paid");
    const unpaid = rows.filter((r) => r.status !== "paid");

    const sumHours = (arr) => arr.reduce((t, r) => t + (Number(r.hours) || 0), 0);
    const sumPay = (arr) =>
      arr.reduce((t, r) => t + (Number(r.hours) || 0) * (Number(r.hourly_rate) || 0), 0);

    return {
      unpaidCount: unpaid.length,
      paidCount: paid.length,
      unpaidHours: sumHours(unpaid),
      paidHours: sumHours(paid),
      unpaidPay: sumPay(unpaid),
      paidPay: sumPay(paid),
      totalHours: sumHours(rows),
      totalPay: sumPay(rows),
      totalCount: rows.length,
    };
  }, [rows]);

  const adminByEmployee = useMemo(() => {
    if (!isAdmin) return [];
    const map = new Map();

    for (const r of rows) {
      const uid = r.user_id || "unknown";
      if (!map.has(uid)) {
        map.set(uid, {
          user_id: uid,
          unpaidHours: 0,
          paidHours: 0,
          totalHours: 0,
          unpaidPay: 0,
          paidPay: 0,
          totalPay: 0,
        });
      }
      const agg = map.get(uid);
      const h = Number(r.hours) || 0;
      const rate = Number(r.hourly_rate) || 0;
      const pay = h * rate;

      agg.totalHours += h;
      agg.totalPay += pay;

      if (r.status === "paid") {
        agg.paidHours += h;
        agg.paidPay += pay;
      } else {
        agg.unpaidHours += h;
        agg.unpaidPay += pay;
      }
    }

    const arr = Array.from(map.values()).map((a) => {
      const p = usersById[a.user_id] || {};
      const display = (p.name && p.name.trim()) || (p.email && p.email.trim()) || a.user_id;
      return { ...a, display };
    });

    arr.sort((x, y) => y.unpaidPay - x.unpaidPay);
    return arr;
  }, [rows, isAdmin, usersById]);

  /* pay employee */
  async function previewUnpaid() {
    if (!isAdmin || !payUserId) return;
    setPayMsg("");
    setPayBusy(true);

    let q = supabase.from("time_entries").select("hours,hourly_rate").eq("user_id", payUserId).neq("status", "paid");
    if (fromDate) q = q.gte("work_date", fromDate);
    if (toDate) q = q.lte("work_date", toDate);

    const { data, error } = await q;
    if (error) {
      setPayMsg(error.message);
      setPayPreview({ unpaidHours: 0, unpaidPay: 0, unpaidCount: 0 });
      setPayBusy(false);
      return;
    }

    const list = data || [];
    const unpaidHours = list.reduce((t, r) => t + (Number(r.hours) || 0), 0);
    const unpaidPay = list.reduce((t, r) => t + (Number(r.hours) || 0) * (Number(r.hourly_rate) || 0), 0);

    setPayPreview({ unpaidHours, unpaidPay, unpaidCount: list.length });
    setPayBusy(false);
  }

  async function markAllUnpaidPaid() {
    if (!isAdmin || !payUserId) return;

    const p = usersById[payUserId] || {};
    const empName = (p.name && p.name.trim()) || (p.email && p.email.trim()) || payUserId;

    const ok = window.confirm(
      `Mark ALL unpaid entries as PAID?\n\nEmployee: ${empName}\nUnpaid: ${payPreview.unpaidCount} entries, ${payPreview.unpaidHours.toFixed(
        2
      )} hrs, ${money(payPreview.unpaidPay)}\nDate range: ${
        allTime ? "All time" : `${fromDate || "…"} → ${toDate || "…"}`
      }`
    );
    if (!ok) return;

    setPayMsg("");
    setPayBusy(true);

    let q = supabase
      .from("time_entries")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        paid_reference: payReference || null,
        paid_by: session.user.id,
      })
      .eq("user_id", payUserId)
      .neq("status", "paid");

    if (fromDate) q = q.gte("work_date", fromDate);
    if (toDate) q = q.lte("work_date", toDate);

    const { error } = await q;

    if (error) setPayMsg(error.message);
    else {
      setPayMsg("Paid ✅ Updated entries.");
      setPayReference("");
      await loadEntries();
      await previewUnpaid();
    }

    setPayBusy(false);
  }

  /* rates manager */
  useEffect(() => {
    if (!isAdmin) return;
    if (!rateUserId) return;
    loadRates(rateUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, rateUserId]);

  async function loadRates(userId) {
    setRateLoading(true);
    setRateMsg("");

    const { data, error } = await supabase
      .from("employee_rates")
      .select("id,user_id,hourly_rate,effective_from,created_at")
      .eq("user_id", userId)
      .order("effective_from", { ascending: false });

    if (error) {
      setRateList([]);
      setRateMsg(error.message);
    } else {
      setRateList(data || []);
    }

    setRateLoading(false);
  }

  async function addRate(e) {
    e.preventDefault();
    if (!isAdmin || !rateUserId) return;

    setRateMsg("");

    const eff = newRateEffectiveFrom;
    const val = Number(newRateValue);

    if (!eff) return setRateMsg("Effective date is required.");
    if (!Number.isFinite(val) || val < 0) return setRateMsg("Hourly rate must be a number >= 0.");

    const { error } = await supabase.from("employee_rates").insert({
      user_id: rateUserId,
      hourly_rate: val,
      effective_from: eff,
      created_by: session.user.id,
    });

    if (error) setRateMsg(error.message);
    else {
      setRateMsg("Rate added ✅");
      setNewRateEffectiveFrom("");
      setNewRateValue("");
      await loadRates(rateUserId);
    }
  }

  async function deleteRate(rateId) {
    if (!isAdmin) return;
    const ok = window.confirm("Delete this rate row? (Only if it was a mistake)");
    if (!ok) return;

    setRateMsg("");
    const { error } = await supabase.from("employee_rates").delete().eq("id", rateId);
    if (error) setRateMsg(error.message);
    else {
      setRateMsg("Rate deleted ✅");
      await loadRates(rateUserId);
    }
  }

  const tabs = [
    { id: "dashboard", label: "Dashboard", show: true },
    { id: "add", label: "Add Hours", show: true },
    { id: "pay", label: "Pay Employees", show: isAdmin },
    { id: "rates", label: "Rates", show: isAdmin },
    { id: "account", label: "Account", show: true },
  ].filter((t) => t.show);

  return (
    <>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={cls("tab", page === t.id && "tab-active")} onClick={() => setPage(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* PAGE: DASHBOARD */}
      {page === "dashboard" && (
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <div style={styles.cardHeaderRow}>
              <div>
                <div className="h2">Overview</div>
                <div className="muted">Totals reflect your current filters.</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className={cls("pill", isAdmin ? "pill-gold" : "pill-emerald")}>
                  <span className="dot" /> {profileLoading ? "Loading…" : isAdmin ? "Admin" : "Employee"}
                </span>

                <label className="switch">
                  <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} />
                  <span className="slider" />
                  <span className="switchLabel">All time</span>
                </label>

                <button className="btn btn-secondary" onClick={loadEntries} disabled={loadingRows}>
                  {loadingRows ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>

            <div className="grid3" style={{ marginTop: 10 }}>
              <div className="field">
                <label>From</label>
                <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={allTime} />
              </div>
              <div className="field">
                <label>To</label>
                <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={allTime} />
              </div>
              <div className="field">
                <label>Status</label>
                <select className="input" value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
                  <option value="all">All</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>
          </Card>

          <div className="gridCards">
            <StatCard title="Unpaid" value={`${totals.unpaidHours.toFixed(2)} hrs`} sub={`${totals.unpaidCount} entries • ${money(totals.unpaidPay)}`} accent="red" />
            <StatCard title="Paid" value={`${totals.paidHours.toFixed(2)} hrs`} sub={`${totals.paidCount} entries • ${money(totals.paidPay)}`} accent="green" />
            <StatCard title="Total" value={`${totals.totalHours.toFixed(2)} hrs`} sub={`${totals.totalCount} entries • ${money(totals.totalPay)}`} accent="indigo" />
          </div>

          {isAdmin && (
            <Card>
              <div style={styles.cardHeaderRow}>
                <div>
                  <div className="h2">By employee</div>
                  <div className="muted">Uses the rate saved on each entry (rate changes handled correctly).</div>
                </div>
                <span className="pill pill-indigo">
                  <span className="dot" /> Filtered view
                </span>
              </div>

              {adminByEmployee.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  No results for current filter.
                </div>
              ) : (
                <NiceTable
                  columns={[
                    { key: "employee", label: "Employee" },
                    { key: "unpaidHours", label: "Unpaid hrs" },
                    { key: "unpaidPay", label: "Unpaid $" },
                    { key: "paidHours", label: "Paid hrs" },
                    { key: "paidPay", label: "Paid $" },
                    { key: "totalHours", label: "Total hrs" },
                    { key: "totalPay", label: "Total $" },
                  ]}
                  rows={adminByEmployee.map((a) => ({
                    employee: a.display,
                    unpaidHours: a.unpaidHours.toFixed(2),
                    unpaidPay: money(a.unpaidPay),
                    paidHours: a.paidHours.toFixed(2),
                    paidPay: money(a.paidPay),
                    totalHours: a.totalHours.toFixed(2),
                    totalPay: money(a.totalPay),
                  }))}
                />
              )}
            </Card>
          )}

          <Card>
            <div style={styles.cardHeaderRow}>
              <div>
                <div className="h2">Timesheet entries</div>
                <div className="muted">Amount = Hours × Rate (for that entry)</div>
              </div>
              {rowsError ? <div className="alert alert-red">{rowsError}</div> : null}
            </div>

            {loadingRows ? (
              <div className="muted" style={{ marginTop: 10 }}>
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <div className="muted" style={{ marginTop: 10 }}>
                No entries found.
              </div>
            ) : (
              <NiceTable
                columns={[
                  { key: "work_date", label: "Date" },
                  { key: "hours", label: "Hours" },
                  { key: "rate", label: "Hourly Rate" },
                  { key: "amount", label: "Amount" },
                  { key: "paid", label: "Paid" },
                  { key: "notes", label: "Notes" },
                  ...(isAdmin ? [{ key: "employee", label: "Employee" }] : []),
                  ...(isAdmin ? [{ key: "paid_at", label: "Paid at" }] : []),
                  ...(isAdmin ? [{ key: "ref", label: "Reference" }] : []),
                ]}
                rows={rows.map((r) => {
                  const rate = Number(r.hourly_rate) || 0;
                  const amt = (Number(r.hours) || 0) * rate;
                  const p = usersById[r.user_id] || {};
                  const emp = (p.name && p.name.trim()) || (p.email && p.email.trim()) || r.user_id;

                  return {
                    work_date: r.work_date,
                    hours: Number(r.hours).toFixed(2),
                    rate: money(rate),
                    amount: money(amt),
                    paid: <StatusBadge status={r.status} />,
                    notes: r.notes || "",
                    ...(isAdmin ? { employee: emp } : {}),
                    ...(isAdmin ? { paid_at: r.paid_at ? new Date(r.paid_at).toLocaleString() : "" } : {}),
                    ...(isAdmin ? { ref: r.paid_reference || "" } : {}),
                  };
                })}
              />
            )}
          </Card>
        </div>
      )}

      {/* PAGE: ADD HOURS */}
      {page === "add" && (
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <div style={styles.cardHeaderRow}>
              <div>
                <div className="h2">Add hours</div>
                <div className="muted">Employees enter date + hours (no clock in/out).</div>
              </div>
              <span className="pill pill-emerald">
                <span className="dot" /> Uses rate history
              </span>
            </div>

            <form onSubmit={addHours} style={{ display: "grid", gap: 12, marginTop: 12, maxWidth: 520 }}>
              <div className="field">
                <label>Work date</label>
                <input className="input" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} required />
              </div>
              <div className="field">
                <label>Hours</label>
                <input className="input" type="number" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 7.5" required />
              </div>
              <div className="field">
                <label>Notes (optional)</label>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
              </div>

              <button className="btn btn-primary" disabled={addBusy}>
                {addBusy ? "Submitting…" : "Submit hours"}
              </button>

              {addMsg && <div className={cls("alert", addMsg.includes("✅") ? "alert-green" : "alert-red")}>{addMsg}</div>}
            </form>
          </Card>
        </div>
      )}

      {/* PAGE: PAY EMPLOYEES (ADMIN) */}
      {page === "pay" && isAdmin && (
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <div style={styles.cardHeaderRow}>
              <div>
                <div className="h2">Pay employees</div>
                <div className="muted">Preview unpaid totals, then mark as paid. Uses the current date filter.</div>
              </div>
              <span className="pill pill-gold">
                <span className="dot" /> Admin only
              </span>
            </div>

            {employeesLoading ? (
              <div className="muted" style={{ marginTop: 10 }}>
                Loading employees…
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12, marginTop: 12, maxWidth: 760 }}>
                <div className="grid2">
                  <div className="field">
                    <label>Employee</label>
                    <select
                      className="input"
                      value={payUserId}
                      onChange={(e) => {
                        setPayUserId(e.target.value);
                        setPayPreview({ unpaidHours: 0, unpaidPay: 0, unpaidCount: 0 });
                        setPayMsg("");
                      }}
                    >
                      <option value="">-- select --</option>
                      {employees.map((e) => {
                        const display = (e.name && e.name.trim()) || (e.email && e.email.trim()) || e.id;
                        return (
                          <option key={e.id} value={e.id}>
                            {display}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="field">
                    <label>Payment reference (optional)</label>
                    <input className="input" value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="Zelle / Check # / Venmo" />
                  </div>
                </div>

                <div className="muted">
                  Date range:{" "}
                  <span className="pill pill-indigo" style={{ display: "inline-flex", gap: 8 }}>
                    <span className="dot" /> {allTime ? "All time" : `${fromDate || "…"} → ${toDate || "…"}`}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn btn-secondary" onClick={previewUnpaid} disabled={payBusy || !payUserId}>
                    {payBusy ? "Working…" : "Preview unpaid"}
                  </button>

                  <span className="pill pill-slate">
                    Unpaid: <strong>{payPreview.unpaidCount}</strong> entries • <strong>{payPreview.unpaidHours.toFixed(2)}</strong> hrs •{" "}
                    <strong>{money(payPreview.unpaidPay)}</strong>
                  </span>
                </div>

                <button className="btn btn-primary" onClick={markAllUnpaidPaid} disabled={payBusy || !payUserId || payPreview.unpaidCount === 0}>
                  Mark all unpaid as PAID
                </button>

                {payMsg && <div className={cls("alert", payMsg.includes("✅") ? "alert-green" : "alert-red")}>{payMsg}</div>}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* PAGE: RATES (ADMIN) */}
      {page === "rates" && isAdmin && (
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <div style={styles.cardHeaderRow}>
              <div>
                <div className="h2">Rates</div>
                <div className="muted">Add a new row for each raise. Do not edit history.</div>
              </div>
              <span className="pill pill-indigo">
                <span className="dot" /> Effective-date rates
              </span>
            </div>

            {employeesLoading ? (
              <div className="muted" style={{ marginTop: 10 }}>
                Loading employees…
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12, marginTop: 12, maxWidth: 820 }}>
                <div className="field">
                  <label>Employee</label>
                  <select
                    className="input"
                    value={rateUserId}
                    onChange={(e) => {
                      setRateUserId(e.target.value);
                      setRateMsg("");
                    }}
                  >
                    <option value="">-- select --</option>
                    {employees.map((e) => {
                      const display = (e.name && e.name.trim()) || (e.email && e.email.trim()) || e.id;
                      return (
                        <option key={e.id} value={e.id}>
                          {display}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <form onSubmit={addRate} className="grid3" style={{ alignItems: "end" }}>
                  <div className="field">
                    <label>Effective from</label>
                    <input className="input" type="date" value={newRateEffectiveFrom} onChange={(e) => setNewRateEffectiveFrom(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Hourly rate</label>
                    <input className="input" type="number" step="0.01" value={newRateValue} onChange={(e) => setNewRateValue(e.target.value)} placeholder="e.g. 25" />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={!rateUserId}>
                    Add rate
                  </button>
                </form>

                {rateMsg && <div className={cls("alert", rateMsg.includes("✅") ? "alert-green" : "alert-red")}>{rateMsg}</div>}
              </div>
            )}
          </Card>

          <Card>
            <div style={styles.cardHeaderRow}>
              <div>
                <div className="h2">Rate history</div>
                <div className="muted">Most recent first.</div>
              </div>
              <button className="btn btn-secondary" onClick={() => rateUserId && loadRates(rateUserId)} disabled={!rateUserId || rateLoading}>
                {rateLoading ? "Loading…" : "Refresh"}
              </button>
            </div>

            {rateLoading ? (
              <div className="muted" style={{ marginTop: 10 }}>
                Loading rates…
              </div>
            ) : rateList.length === 0 ? (
              <div className="alert alert-red" style={{ marginTop: 10 }}>
                No rates found for this employee. They will submit timesheets at $0/hr until you add one.
              </div>
            ) : (
              <NiceTable
                columns={[
                  { key: "effective", label: "Effective from" },
                  { key: "rate", label: "Hourly rate" },
                  { key: "created", label: "Created" },
                  { key: "actions", label: "" },
                ]}
                rows={rateList.map((r) => ({
                  effective: r.effective_from,
                  rate: money(r.hourly_rate),
                  created: r.created_at ? new Date(r.created_at).toLocaleString() : "",
                  actions: (
                    <button className="btn btn-danger" onClick={() => deleteRate(r.id)}>
                      Delete
                    </button>
                  ),
                }))}
              />
            )}
          </Card>
        </div>
      )}

      {/* PAGE: ACCOUNT (CHANGE PASSWORD WHILE LOGGED IN) */}
      {page === "account" && (
        <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
          <Card>
            <div style={styles.cardHeaderRow}>
              <div>
                <div className="h2">Account</div>
                <div className="muted">Change password while logged in.</div>
              </div>
              <span className="pill pill-slate">
                <span className="dot" /> Logged in
              </span>
            </div>

            <div style={{ marginTop: 12 }}>
              <ChangePassword />
            </div>

            <div className="muted" style={{ marginTop: 12 }}>
              Forgot password is on the login screen (Log out → “Forgot password?”).
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/* ---------- Change password (logged in) ---------- */
function ChangePassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg("");

    if (password.length < 8) return setMsg("Password must be at least 8 characters.");
    if (password !== confirm) return setMsg("Passwords do not match.");

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (error) setMsg(error.message);
    else {
      setMsg("Password updated ✅");
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
      <div className="field">
        <label>New password</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      </div>
      <div className="field">
        <label>Confirm new password</label>
        <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>

      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </button>

      {msg && <div className={cls("alert", msg.includes("✅") ? "alert-green" : "alert-red")}>{msg}</div>}
    </form>
  );
}

/* ---------- PRESENTATION COMPONENTS ---------- */
function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={styles.shellGlow} />
      <div style={styles.shell}>{children}</div>
      <div style={{ height: 36 }} />
    </div>
  );
}

function Header({ right }) {
  return (
    <div style={styles.headerWrap}>
      <div style={styles.header}>
        <div>
          <div className="brand">Himalayan Bazaar</div>
          <div className="brandSub">Timesheets & Payroll</div>
        </div>
        <div style={{ justifySelf: "end" }}>{right}</div>
      </div>
    </div>
  );
}

function Card({ children }) {
  return <div className="card">{children}</div>;
}

function StatCard({ title, value, sub, accent }) {
  return (
    <div className={cls("stat", `stat-${accent}`)}>
      <div className="statTitle">{title}</div>
      <div className="statValue">{value}</div>
      <div className="statSub">{sub}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const paid = status === "paid";
  return <span className={cls("badge", paid ? "badge-green" : "badge-amber")}>{paid ? "PAID" : "UNPAID"}</span>;
}

function NiceTable({ columns, rows }) {
  return (
    <div className="tableWrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx}>
              {columns.map((c) => (
                <td key={c.key}>{r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- GLOBAL STYLES ---------- */
function GlobalStyles() {
  return (
    <style>{`
      :root{
        --card: rgba(255,255,255,.06);
        --card2: rgba(255,255,255,.08);
        --border: rgba(255,255,255,.10);
        --text: rgba(255,255,255,.92);
        --muted: rgba(255,255,255,.68);
        --shadow: 0 14px 35px rgba(0,0,0,.35);
        --radius: 16px;

        --indigo:#6D5EF7;
        --cyan:#00D3FF;
        --emerald:#2EE59D;
        --amber:#FFB020;
        --red:#FF4D6D;
        --gold:#E6C36A;
      }

      *{ box-sizing:border-box; }
      body{ margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:var(--text); }

      .muted{ color:var(--muted); }
      .h2{ font-size:18px; font-weight:800; letter-spacing:.2px; }
      .brand{ font-size:18px; font-weight:900; letter-spacing:.3px; }
      .brandSub{ font-size:12px; color:var(--muted); margin-top:2px; }

      .card{
        background: linear-gradient(180deg, var(--card2), var(--card));
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 16px;
      }

      .tabs{
        display:flex;
        gap:10px;
        flex-wrap:wrap;
        margin: 6px 0 16px;
      }
      .tab{
        border: 1px solid var(--border);
        background: rgba(255,255,255,.05);
        color: var(--text);
        padding: 10px 12px;
        border-radius: 999px;
        cursor:pointer;
        font-weight:700;
      }
      .tab:hover{ background: rgba(255,255,255,.08); }
      .tab-active{
        border-color: rgba(109,94,247,.55);
        background: linear-gradient(90deg, rgba(109,94,247,.22), rgba(0,211,255,.14));
        box-shadow: 0 10px 24px rgba(109,94,247,.18);
      }

      .grid3{
        display:grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .grid2{
        display:grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .gridCards{
        display:grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      @media (max-width: 900px){
        .grid3{ grid-template-columns: 1fr; }
        .grid2{ grid-template-columns: 1fr; }
        .gridCards{ grid-template-columns: 1fr; }
      }

      .field label{
        display:block;
        font-size:12px;
        color: var(--muted);
        margin-bottom: 6px;
        font-weight: 700;
      }
      .input{
        width:100%;
        padding: 12px 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: rgba(0,0,0,.25);
        color: var(--text);
        outline:none;
      }
      .input:focus{
        border-color: rgba(0,211,255,.55);
        box-shadow: 0 0 0 3px rgba(0,211,255,.16);
      }

      .btn{
        border-radius: 12px;
        border: 1px solid var(--border);
        padding: 11px 14px;
        font-weight: 800;
        cursor:pointer;
        color: var(--text);
        background: rgba(255,255,255,.05);
      }
      .btn:hover{ background: rgba(255,255,255,.08); }
      .btn-primary{
        border-color: rgba(109,94,247,.55);
        background: linear-gradient(90deg, rgba(109,94,247,.85), rgba(0,211,255,.65));
        box-shadow: 0 12px 26px rgba(109,94,247,.25);
      }
      .btn-secondary{
        border-color: rgba(46,229,157,.45);
        background: linear-gradient(90deg, rgba(46,229,157,.35), rgba(0,211,255,.12));
      }
      .btn-ghost{ background: rgba(255,255,255,.03); }
      .btn-danger{
        border-color: rgba(255,77,109,.45);
        background: rgba(255,77,109,.15);
      }
      .btn:disabled{ opacity:.55; cursor:not-allowed; }

      .pill{
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,.05);
        font-weight: 800;
        font-size: 12px;
        color: var(--text);
      }
      .pill-slate{ background: rgba(255,255,255,.05); }
      .pill-indigo{ border-color: rgba(109,94,247,.5); background: rgba(109,94,247,.12); }
      .pill-emerald{ border-color: rgba(46,229,157,.5); background: rgba(46,229,157,.12); }
      .pill-gold{ border-color: rgba(230,195,106,.55); background: rgba(230,195,106,.12); }

      .dot{
        width:8px; height:8px; border-radius:999px;
        background: var(--cyan);
        box-shadow: 0 0 0 3px rgba(0,211,255,.16);
      }

      .alert{
        border-radius: 12px;
        border: 1px solid var(--border);
        padding: 10px 12px;
        font-weight: 700;
      }
      .alert-red{ border-color: rgba(255,77,109,.45); background: rgba(255,77,109,.12); }
      .alert-green{ border-color: rgba(46,229,157,.45); background: rgba(46,229,157,.12); }

      .stat{
        border-radius: var(--radius);
        border: 1px solid var(--border);
        padding: 14px;
        background: rgba(255,255,255,.05);
        box-shadow: var(--shadow);
      }
      .statTitle{ font-size:12px; color: var(--muted); font-weight: 800; }
      .statValue{ font-size:22px; font-weight: 900; margin-top: 6px; }
      .statSub{ font-size:12px; color: var(--muted); margin-top: 6px; font-weight: 700; }

      .stat-red{ border-color: rgba(255,77,109,.35); background: linear-gradient(180deg, rgba(255,77,109,.18), rgba(255,255,255,.04)); }
      .stat-green{ border-color: rgba(46,229,157,.35); background: linear-gradient(180deg, rgba(46,229,157,.16), rgba(255,255,255,.04)); }
      .stat-indigo{ border-color: rgba(109,94,247,.35); background: linear-gradient(180deg, rgba(109,94,247,.16), rgba(255,255,255,.04)); }

      .badge{
        display:inline-flex;
        align-items:center;
        padding: 6px 10px;
        border-radius: 999px;
        font-weight: 900;
        letter-spacing: .4px;
        font-size: 11px;
      }
      .badge-green{ background: rgba(46,229,157,.18); border: 1px solid rgba(46,229,157,.35); }
      .badge-amber{ background: rgba(255,176,32,.18); border: 1px solid rgba(255,176,32,.35); }

      .tableWrap{
        margin-top: 12px;
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid var(--border);
        background: rgba(0,0,0,.18);
      }
      .table{ width:100%; border-collapse: collapse; }
      .table th{
        text-align:left;
        padding: 12px;
        font-size: 12px;
        color: rgba(255,255,255,.78);
        background: rgba(255,255,255,.06);
        border-bottom: 1px solid rgba(255,255,255,.10);
        white-space: nowrap;
      }
      .table td{
        padding: 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        vertical-align: top;
        font-weight: 650;
        color: rgba(255,255,255,.90);
      }
      .table tr:hover td{ background: rgba(255,255,255,.04); }

      .switch{ display:flex; align-items:center; gap:10px; user-select:none; }
      .switch input{ display:none; }
      .slider{
        width:42px; height:24px; border-radius:999px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,.06);
        position: relative;
        box-shadow: inset 0 0 0 1px rgba(0,0,0,.2);
      }
      .slider::after{
        content:"";
        position:absolute; top:3px; left:3px;
        width:18px; height:18px; border-radius:999px;
        background: rgba(255,255,255,.85);
        transition: transform .18s ease;
      }
      .switch input:checked + .slider{
        border-color: rgba(0,211,255,.55);
        background: rgba(0,211,255,.18);
      }
      .switch input:checked + .slider::after{
        transform: translateX(18px);
        background: rgba(0,211,255,.95);
      }
      .switchLabel{
        font-weight: 900;
        font-size: 12px;
        color: rgba(255,255,255,.86);
      }
    `}</style>
  );
}

/* ---------- styles ---------- */
const styles = {
  appBg: {
    background:
      "radial-gradient(1200px 700px at 20% 0%, rgba(109,94,247,.18), transparent 55%), radial-gradient(900px 500px at 80% 10%, rgba(0,211,255,.14), transparent 55%), linear-gradient(180deg, #050710, #070A12 50%, #050710)",
  },
  shellGlow: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    background:
      "radial-gradient(700px 450px at 30% 10%, rgba(46,229,157,.10), transparent 60%), radial-gradient(800px 500px at 70% 20%, rgba(255,176,32,.08), transparent 65%)",
    zIndex: 0,
  },
  shell: {
    position: "relative",
    zIndex: 1,
    maxWidth: 1200,
    margin: "0 auto",
    padding: "0 16px",
  },
  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    backdropFilter: "blur(10px)",
    background: "linear-gradient(180deg, rgba(5,7,16,.92), rgba(5,7,16,.70))",
    borderBottom: "1px solid rgba(255,255,255,.10)",
  },
  header: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "14px 16px",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 12,
    alignItems: "center",
  },
  container: {
    padding: "16px 0 24px",
  },
  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "start",
    flexWrap: "wrap",
  },
};
