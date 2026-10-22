import { allows } from "../../shared/permissions.js";
import { LoadingBlock } from "./ui.jsx";

const NAV = [
  {
    id: "dashboard",
    label: "Overview",
    visible: (permissions) =>
      allows(permissions, "timesheet.own", "view") ||
      allows(permissions, "timesheet.team", "view") ||
      allows(permissions, "timesheet.payroll", "view"),
  },
  { id: "add", label: "Add hours", visible: (permissions) => allows(permissions, "timesheet.own", "edit") },
  { id: "pay", label: "Pay", visible: (permissions) => allows(permissions, "timesheet.payroll", "view") },
  { id: "rates", label: "Rates", visible: (permissions) => allows(permissions, "timesheet.payroll", "view") },
  { id: "team", label: "Team", visible: (permissions) => allows(permissions, "timesheet.admin", "view") },
  { id: "account", label: "Account", visible: () => true },
];

function accessLabel(permissions) {
  if (permissions?.isOwner) return "Owner";
  if (allows(permissions, "timesheet.admin", "view")) return "Admin";
  return "Employee";
}

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#1f6f5b" />
      <path d="M5.5 23.5 L12.5 12 L16.5 17.5 L19.5 13.5 L26.5 23.5 Z" fill="#f6e7cf" />
      <circle cx="22.5" cy="9.5" r="2.1" fill="#e7a15a" />
    </svg>
  );
}

export function LoadingScreen({ message, error, onRetry }) {
  return (
    <div className="login-screen">
      <div className="card login-card">
        {error ? (
          <>
            <h1>Couldn’t load the app</h1>
            <p className="lede">{message}</p>
            <button className="btn btn-primary btn-block" type="button" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          <LoadingBlock label={message || "Loading your timesheet…"} />
        )}
      </div>
    </div>
  );
}

export function Layout({ user, permissions, page, onNavigate, onLogout, children }) {
  const label = accessLabel(permissions);
  const items = NAV.filter((item) => item.visible(permissions));
  const display = user.name?.trim() || user.email;

  return (
    <div className="app">
      <header className="top">
        <div className="top-inner">
          <div className="brand">
            <Mark />
            <div>
              <p className="brand-name">Himalayan Bazaar</p>
              <p className="brand-sub">Timesheets</p>
            </div>
          </div>
          <div className="session">
            <div className="who">
              <strong>{display}</strong>
              <span className={`role-chip ${label === "Employee" ? "" : "role-admin"}`}>{label}</span>
            </div>
            <a className="btn btn-quiet" href="/">
              Home
            </a>
            <button className="btn btn-quiet" type="button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="tab"
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
