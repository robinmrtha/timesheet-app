export function onWorkers() {
  const nav = globalThis.navigator;
  return Boolean(nav && nav.userAgent === "Cloudflare-Workers");
}

export function isLocalDatabaseHost(connectionString) {
  if (!connectionString) return false;
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}
