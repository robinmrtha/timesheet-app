import { clearSessionCookie } from "./auth.js";
import { assertSameOrigin, json, resolveApiRequest } from "./http.js";
import { markPaid } from "./routes/pay.js";
import {
  applicableRate,
  createRate,
  deleteRate,
  listRates,
  patchRate,
} from "./routes/rates.js";
import {
  createEntry,
  deleteEntry,
  listEntries,
  patchEntry,
} from "./routes/entries.js";
import { changePassword, getMe, login, logout, patchMe, session } from "./routes/session.js";
import { createUser, listUsers, patchUser, resetPassword } from "./routes/users.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function handle(request) {
  const method = request.method.toUpperCase();
  const { path, url } = resolveApiRequest(request);

  try {
    if (method === "OPTIONS") return new Response(null, { status: 204 });
    if (MUTATING.has(method)) assertSameOrigin(request);

    if (path === "/api/auth/login" && method === "POST") return await login(request);
    if (path === "/api/auth/logout" && method === "POST") return await logout(request);
    if (path === "/api/auth/session" && method === "GET") return await session(request);
    if (path === "/api/auth/password" && method === "POST") return await changePassword(request);
    if (path === "/api/me" && method === "GET") return await getMe(request);
    if (path === "/api/me" && method === "PATCH") return await patchMe(request);
    if (path === "/api/users" && method === "GET") return await listUsers(request);
    if (path === "/api/users" && method === "POST") return await createUser(request);
    if (path === "/api/entries" && method === "GET") return await listEntries(request, url);
    if (path === "/api/entries" && method === "POST") return await createEntry(request);
    if (path === "/api/rates/applicable" && method === "GET") return await applicableRate(request, url);
    if (path === "/api/rates" && method === "GET") return await listRates(request, url);
    if (path === "/api/rates" && method === "POST") return await createRate(request);
    if (path === "/api/admin/pay" && method === "POST") return await markPaid(request);

    const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && method === "PATCH") return await patchUser(request, decodeURIComponent(userMatch[1]));
    const passwordMatch = path.match(/^\/api\/users\/([^/]+)\/password$/);
    if (passwordMatch && method === "POST") {
      return await resetPassword(request, decodeURIComponent(passwordMatch[1]));
    }
    const entryMatch = path.match(/^\/api\/entries\/([^/]+)$/);
    if (entryMatch && method === "PATCH") return await patchEntry(request, decodeURIComponent(entryMatch[1]));
    if (entryMatch && method === "DELETE") return await deleteEntry(request, decodeURIComponent(entryMatch[1]));
    const rateMatch = path.match(/^\/api\/rates\/([^/]+)$/);
    if (rateMatch && method === "PATCH") return await patchRate(request, decodeURIComponent(rateMatch[1]));
    if (rateMatch && method === "DELETE") return await deleteRate(request, decodeURIComponent(rateMatch[1]));

    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error.code === "23505") return json({ error: "That record already exists" }, 409);
    if (error.code === "23503") {
      return json({ error: "That record refers to someone who does not exist" }, 400);
    }
    const status = error.status || 500;
    if (status >= 500) console.error("api error", method, path, error);
    const response = json(
      { error: status >= 500 ? "Something went wrong" : error.message || "Request failed" },
      status,
    );
    if (error.clearCookie) {
      response.headers.append("set-cookie", clearSessionCookie(request));
    }
    return response;
  }
}
