import { useEffect, useState } from "react";

const PAGES = new Set(["dashboard", "add", "pay", "rates", "team", "account"]);
const ADMIN_ONLY = new Set(["pay", "rates", "team"]);

function sanitize(id, isAdmin) {
  if (!PAGES.has(id)) return "dashboard";
  if (ADMIN_ONLY.has(id) && !isAdmin) return "dashboard";
  return id;
}

function readHash() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "dashboard";
}

export function useHashPage(isAdmin) {
  const [page, setPageState] = useState(() => sanitize(readHash(), isAdmin));

  useEffect(() => {
    function sync() {
      const raw = readHash();
      const next = sanitize(raw, isAdmin);
      setPageState(next);
      if (raw !== next) window.history.replaceState(null, "", "#/");
    }
    window.addEventListener("hashchange", sync);
    sync();
    return () => window.removeEventListener("hashchange", sync);
  }, [isAdmin]);

  function setPage(id) {
    const next = sanitize(id, isAdmin);
    const hash = next === "dashboard" ? "#/" : `#/${next}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    setPageState(next);
  }

  return { id: page, setPage };
}
