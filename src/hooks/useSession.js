import { useCallback, useEffect, useState } from "react";
import { api, setUnauthorizedHandler } from "../lib/api.js";

export function useSession() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const data = await api("/api/auth/session");
    setUser(data.user);
    setError("");
    return data.user;
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    let cancelled = false;
    api("/api/auth/session")
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setUser(null);
        setError(err.message || "Could not reach the server");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return { user, loading, error, refresh, logout, setUser };
}
