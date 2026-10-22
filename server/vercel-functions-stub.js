// Wrangler aliases @vercel/functions to this file. The real package is Vercel-only
// and is still imported when Node (including Vercel) loads server/db.js.
export function attachDatabasePool() {
  throw new Error("attachDatabasePool is only used on Vercel");
}
