import { useEffect } from "react";
import { Layout, LoadingScreen } from "./components/Layout.jsx";
import { allows, hasAnyAccess } from "../shared/permissions.js";
import { useDateFilters } from "./hooks/useDateFilters.js";
import { useHashPage } from "./hooks/useHashPage.js";
import { useSession } from "./hooks/useSession.js";
import { AccountPage } from "./pages/AccountPage.jsx";
import { AddHoursPage } from "./pages/AddHoursPage.jsx";
import { DashboardPage } from "./pages/DashboardPage.jsx";
import { AccessGate } from "./pages/AccessGate.jsx";
import { PayPage } from "./pages/PayPage.jsx";
import { RatesPage } from "./pages/RatesPage.jsx";
import { TeamPage } from "./pages/TeamPage.jsx";

const TITLES = {
  dashboard: "Overview",
  add: "Add hours",
  pay: "Pay",
  rates: "Rates",
  team: "Team",
  account: "Account",
};

export default function App() {
  const session = useSession();

  if (session.loading) return <LoadingScreen message="Loading your timesheet…" />;
  if (session.error && !session.user) {
    return <LoadingScreen error message={session.error} onRetry={() => window.location.reload()} />;
  }
  if (!session.user || !hasAnyAccess(session.permissions)) {
    return <AccessGate reason={session.user ? "no_access" : session.reason} email={session.email || session.user?.email} />;
  }

  return (
    <Workspace
      user={session.user}
      permissions={session.permissions}
      onLogout={session.logout}
      onUser={session.setUser}
    />
  );
}

function allowedPages(permissions) {
  const pages = [];
  if (
    allows(permissions, "timesheet.own", "view") ||
    allows(permissions, "timesheet.team", "view") ||
    allows(permissions, "timesheet.payroll", "view")
  ) {
    pages.push("dashboard");
  }
  if (allows(permissions, "timesheet.own", "edit")) pages.push("add");
  if (allows(permissions, "timesheet.payroll", "view")) pages.push("pay", "rates");
  if (allows(permissions, "timesheet.admin", "view")) pages.push("team");
  pages.push("account");
  return pages.join(",");
}

function Workspace({ user, permissions, onLogout, onUser }) {
  const page = useHashPage(allowedPages(permissions));
  const filters = useDateFilters();
  const payrollView = allows(permissions, "timesheet.payroll", "view");
  const payrollEdit = allows(permissions, "timesheet.payroll", "edit");
  const adminView = allows(permissions, "timesheet.admin", "view");
  const adminEdit = allows(permissions, "timesheet.admin", "edit");

  useEffect(() => {
    document.title = `${TITLES[page.id] || "Timesheets"} · Himalayan Bazaar`;
  }, [page.id]);

  return (
    <Layout user={user} permissions={permissions} page={page.id} onNavigate={page.setPage} onLogout={onLogout}>
      {page.id === "dashboard" ? <DashboardPage user={user} permissions={permissions} filters={filters} /> : null}
      {page.id === "add" ? <AddHoursPage onDone={() => page.setPage("dashboard")} /> : null}
      {page.id === "pay" && payrollView ? <PayPage filters={filters} canEdit={payrollEdit} /> : null}
      {page.id === "rates" && payrollView ? <RatesPage canEdit={payrollEdit} /> : null}
      {page.id === "team" && adminView ? <TeamPage currentUserId={user.id} canEdit={adminEdit} /> : null}
      {page.id === "account" ? <AccountPage user={user} onUser={onUser} /> : null}
    </Layout>
  );
}
