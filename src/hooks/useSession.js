import { useCallback, useEffect, useState } from "react";
import { ACCESS_LOGOUT_URL } from "../../shared/access.js";
import { api, setNotSetupHandler, setUnauthorizedHandler } from "../lib/api.js";

export function useSession() {
  const [user, setUser] = useState(null);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const apply = useCallback((data) => {
    setUser(data.user || null);
    setEmail(data.email || "");
    setReason(data.user ? "" : data.reason || "unauthenticated");
    setError("");
    return data.user;
  }, []);

  const refresh = useCallback(async () => {
    const data = await api("/api/auth/session");
    return apply(data);
  }, [apply]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setReason("unauthenticated");
    });
    setNotSetupHandler(() => {
      setUser(null);
      setReason("not_setup");
    });
    let cancelled = false;
    api("/api/auth/session")
      .then((data) => {
        if (!cancelled) apply(data);
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
  }, [apply]);

  const logout = useCallback(() => {
    window.location.assign(ACCESS_LOGOUT_URL);
  }, []);

  return { user, reason, email, loading, error, refresh, logout, setUser };
}
