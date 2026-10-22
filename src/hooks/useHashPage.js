import { useEffect, useState } from "react";

const PAGES = new Set(["dashboard", "add", "pay", "rates", "team", "account"]);

function hashFor(id) {
  return id === "dashboard" ? "#/" : `#/${id}`;
}

function sanitize(id, allowed) {
  if (PAGES.has(id) && allowed.has(id)) return id;
  if (allowed.has("dashboard")) return "dashboard";
  return allowed.values().next().value || "account";
}

function readHash() {
  return window.location.hash.replace(/^#\/?/, "").split("?")[0] || "dashboard";
}

function allowedSet(allowedKey) {
  return new Set(String(allowedKey || "").split(",").filter(Boolean));
}

export function useHashPage(allowedKey) {
  const [page, setPageState] = useState(() => sanitize(readHash(), allowedSet(allowedKey)));

  useEffect(() => {
    const allowed = allowedSet(allowedKey);
    function sync() {
      const raw = readHash();
      const next = sanitize(raw, allowed);
      setPageState(next);
      if (raw !== next) window.history.replaceState(null, "", hashFor(next));
    }
    window.addEventListener("hashchange", sync);
    sync();
    return () => window.removeEventListener("hashchange", sync);
  }, [allowedKey]);

  function setPage(id) {
    const next = sanitize(id, allowedSet(allowedKey));
    const hash = hashFor(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    setPageState(next);
  }

  return { id: page, setPage };
}
