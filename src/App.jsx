import { useEffect } from "react";
import { Layout, LoadingScreen } from "./components/Layout.jsx";
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
  if (!session.user) return <AccessGate reason={session.reason} email={session.email} />;

  return (
    <Workspace
      user={session.user}
      onLogout={session.logout}
      onUser={session.setUser}
    />
  );
}

function Workspace({ user, onLogout, onUser }) {
  const isAdmin = user.role === "admin";
  const page = useHashPage(isAdmin);
  const filters = useDateFilters();

  useEffect(() => {
    document.title = `${TITLES[page.id] || "Timesheets"} · Himalayan Bazaar`;
  }, [page.id]);

  return (
    <Layout user={user} page={page.id} onNavigate={page.setPage} onLogout={onLogout}>
      {page.id === "dashboard" ? <DashboardPage user={user} filters={filters} /> : null}
      {page.id === "add" ? <AddHoursPage onDone={() => page.setPage("dashboard")} /> : null}
      {page.id === "pay" && isAdmin ? <PayPage filters={filters} /> : null}
      {page.id === "rates" && isAdmin ? <RatesPage /> : null}
      {page.id === "team" && isAdmin ? <TeamPage currentUserId={user.id} /> : null}
      {page.id === "account" ? <AccountPage user={user} onUser={onUser} /> : null}
    </Layout>
  );
}
