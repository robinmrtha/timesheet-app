import { spawnSync } from "node:child_process";
import pg from "pg";
import { NO_ACCESS_MESSAGE, hasAnyAccess } from "../shared/permissions.js";
import { closePool } from "../server/db.js";
import {
  createHubPermissionsSource,
  loadPermissions,
  normalizePermissions,
  resetPermissionsCache,
} from "../server/permissions.js";
import { runWithHub } from "../server/request-context.js";

const DATABASE_URL = "postgres://timesheet:timesheet@127.0.0.1:5432/timesheet_perm";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const WORKER_ID = "22222222-2222-4222-8222-222222222222";
const SECTIONS = ["timesheet.own", "timesheet.team", "timesheet.payroll", "timesheet.admin"];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function sections(overrides = {}) {
  return {
    "timesheet.own": "none",
    "timesheet.team": "none",
    "timesheet.payroll": "none",
    "timesheet.admin": "none",
    ...overrides,
  };
}

function record(email, overrides = {}, extra = {}) {
  return {
    email,
    active: extra.active !== false,
    isOwner: extra.isOwner === true,
    sections: sections(overrides),
  };
}

function shapeTests() {
  const owner = normalizePermissions(
    { email: "Owner@Example.com", active: true, isOwner: true, sections: {} },
    "owner@example.com",
  );
  check(owner.isOwner && owner.active, "owner stays active");
  check(SECTIONS.every((section) => owner.sections[section] === "edit"), "owner gets edit on every section");

  const inactiveOwner = normalizePermissions(
    { email: "owner@example.com", active: false, isOwner: true, sections: {} },
    "owner@example.com",
  );
  check(inactiveOwner.isOwner && inactiveOwner.active, "an inactive owner is still admitted");
  check(SECTIONS.every((section) => inactiveOwner.sections[section] === "edit"), "an inactive owner gets edit on every section");

  const refused = normalizePermissions(
    { email: "a@example.com", active: false, isOwner: false, sections: sections({ "timesheet.own": "edit" }) },
    "a@example.com",
  );
  check(refused.active === false && !hasAnyAccess(refused), "inactive non-owner is refused");

  const partial = normalizePermissions(
    { email: "a@example.com", active: true, isOwner: false, sections: { "timesheet.own": "view", "timesheet.team": "bogus" } },
    "a@example.com",
  );
  check(partial.sections["timesheet.own"] === "view", "known level is kept");
  check(partial.sections["timesheet.team"] === "none", "unknown level is none");
  check(partial.sections["timesheet.payroll"] === "none", "missing section is none");
  check(partial.sections["timesheet.admin"] === "none", "admin section defaults to none");

  const mismatch = normalizePermissions(record("other@example.com", { "timesheet.admin": "edit" }), "a@example.com");
  check(mismatch.active === false, "email mismatch is no access");

  const junk = normalizePermissions("nope", "a@example.com");
  check(junk.active === false && junk.sections["timesheet.own"] === "none", "non-object body is no access");
}

async function hubSourceTests() {
  let calls = 0;
  const source = createHubPermissionsSource({
    fetch: async (request) => {
      calls += 1;
      check(request.url === "https://hbzr.us/internal/permissions?email=mira%40example.com", "hub permissions URL");
      check(request.headers.get("authorization") == null, "hub call does not send a shared secret");
      return Response.json(record("mira@example.com", { "timesheet.payroll": "edit" }));
    },
  });
  const loaded = await source("mira@example.com");
  check(calls === 1, "hub source fetches once");
  check(loaded.sections["timesheet.payroll"] === "edit", "hub source reads the section");
  check(loaded.sections["timesheet.own"] === "none", "hub source denies sections that were not granted");

  const encoded = [];
  const plus = createHubPermissionsSource({
    fetch: async (request) => {
      encoded.push(request.url);
      return Response.json(record("a+b@example.com", { "timesheet.own": "view" }));
    },
  });
  await plus("a+b@example.com");
  check(encoded[0] === "https://hbzr.us/internal/permissions?email=a%2Bb%40example.com", "email is encodeURIComponent");

  const missing = createHubPermissionsSource(null);
  let threw = false;
  try {
    await missing("mira@example.com");
  } catch (error) {
    threw = error.status === "missing-hub";
  }
  check(threw, "a missing HUB binding fails closed");

  const denied = createHubPermissionsSource({
    fetch: async () => Response.json({ error: "Pass an email" }, { status: 400 }),
  });
  let status = "";
  try {
    await denied("mira@example.com");
  } catch (error) {
    status = String(error.status);
  }
  check(status === "400", "Pass an email is an error, not a grant");

  const html = createHubPermissionsSource({
    fetch: async () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }),
  });
  let htmlStatus = "";
  try {
    await html("mira@example.com");
  } catch (error) {
    htmlStatus = error.status;
  }
  check(htmlStatus === "not-json", "an HTML login page is not permissions");
}

async function cacheTests() {
  delete process.env.PERMISSIONS_ROLE_FALLBACK;
  delete process.env.PERMISSIONS_API_TOKEN;
  resetPermissionsCache();
  let calls = 0;
  let mode = "ok";
  const hub = {
    fetch(request) {
      calls += 1;
      const email = new URL(request.url).searchParams.get("email");
      check(request.url === `https://hbzr.us/internal/permissions?email=${encodeURIComponent(email)}`, "cached loader uses the hub");
      check(request.headers.get("authorization") == null, "cached loader sends no token");
      if (mode === "down") return new Response("down", { status: 500 });
      if (mode === "none") return Response.json(record(email));
      return Response.json(record(email, { "timesheet.own": "edit" }));
    },
  };
  const load = (email, now) => runWithHub(hub, () => loadPermissions(email, now));
  const first = await load("Cache@Example.com", 1_000);
  const second = await load("cache@example.com", 1_000 + 10_000);
  check(first.sections["timesheet.own"] === "edit" && second.sections["timesheet.own"] === "edit", "cache returns the grant");
  check(calls === 1, "a second lookup inside 30 seconds does not fetch");

  mode = "none";
  const stale = await load("cache@example.com", 1_000 + 29_000);
  check(stale.sections["timesheet.own"] === "edit" && calls === 1, "cache lasts 30 seconds");
  const fresh = await load("cache@example.com", 1_000 + 30_000);
  check(fresh.sections["timesheet.own"] === "none" && calls === 2, "cache expires at 30 seconds");

  mode = "down";
  const failed = await load("cache@example.com", 1_000 + 60_000);
  check(failed.active === false && calls === 3, "a lookup error is no access");
  mode = "ok";
  const recovered = await load("cache@example.com", 1_000 + 60_000);
  check(recovered.sections["timesheet.own"] === "edit" && calls === 4, "an error is not cached");
  resetPermissionsCache();
}

function psql(args) {
  const result = spawnSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "psql failed");
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function routeTests() {
  spawnSync("psql", ["postgres://timesheet:timesheet@127.0.0.1:5432/postgres", "-c", "DROP DATABASE IF EXISTS timesheet_perm"], {
    encoding: "utf8",
  });
  const created = spawnSync(
    "psql",
    ["postgres://timesheet:timesheet@127.0.0.1:5432/postgres", "-c", "CREATE DATABASE timesheet_perm OWNER timesheet"],
    { encoding: "utf8" },
  );
  if (created.status !== 0) throw new Error(created.stderr || created.stdout || "create database failed");

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.ACCESS_DEV_BYPASS = "1";
  process.env.ACCESS_AUD = "unused";
  delete process.env.PERMISSIONS_API_TOKEN;
  delete process.env.PERMISSIONS_ROLE_FALLBACK;
  delete process.env.ACCESS_DEV_EMAIL;
  resetPermissionsCache();

  psql(["-f", "db/schema.sql"]);
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, name, role, active) VALUES
         ($1, 'admin@example.com', 'stored-bcrypt-hash', 'Mira Admin', 'admin', true),
         ($2, 'worker@example.com', 'stored-bcrypt-hash', 'Pemba Worker', 'employee', true)`,
      [ADMIN_ID, WORKER_ID],
    );
    await client.query(
      `INSERT INTO time_entries (user_id, work_date, hours, notes, status, hourly_rate)
       VALUES ($1, '2026-10-02', 4, 'stock', 'submitted', 20)`,
      [WORKER_ID],
    );
  });

  const { handle } = await import("../server/router.js");
  let calls = 0;
  let bodyFor = () => record("admin@example.com");
  const hub = {
    fetch(request) {
      calls += 1;
      const parsed = new URL(request.url);
      const email = parsed.searchParams.get("email");
      check(email, "route lookup sends an email");
      check(request.url === `https://hbzr.us/internal/permissions?email=${encodeURIComponent(email)}`, "route lookup uses the hub url");
      check(request.headers.get("authorization") == null, "route lookup sends no token");
      const payload = bodyFor(email);
      if (payload === "down") return new Response("down", { status: 500 });
      if (payload === "missing") return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
      if (payload === "need-email") return Response.json({ error: "Pass an email" }, { status: 400 });
      return Response.json(payload);
    },
  };

  async function request(path, { method = "GET", email = "admin@example.com", body } = {}) {
    const headers = new Headers({ origin: "http://127.0.0.1" });
    headers.set("x-dev-user-email", email);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await runWithHub(hub, () =>
      handle(
        new Request(`http://127.0.0.1${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      ),
    );
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }

  try {
    bodyFor = () => record("admin@example.com", { "timesheet.own": "view" });
    const viewOnly = await request("/api/auth/session");
    check(viewOnly.data.user.role === "admin", "the user row is still returned");
    check(viewOnly.data.permissions.sections["timesheet.own"] === "view", "session returns section levels");
    check(viewOnly.data.permissions.sections["timesheet.admin"] === "none", "admin role is not a grant when the flag is off");
    const blockedUsers = await request("/api/users");
    check(blockedUsers.status === 403, "own view cannot list users");
    const blockedCreate = await request("/api/entries", {
      method: "POST",
      body: { workDate: "2026-10-03", hours: 2, notes: "" },
    });
    check(blockedCreate.status === 403, "view cannot add hours");
    const ownList = await request("/api/entries");
    check(ownList.status === 200 && ownList.data.entries.length === 0, "own view lists only that person's hours");
    const otherList = await request(`/api/entries?userId=${WORKER_ID}`);
    check(otherList.status === 403, "own view cannot read someone else's hours");

    resetPermissionsCache();
    bodyFor = (email) =>
      record(email, email === "admin@example.com" ? { "timesheet.team": "view" } : { "timesheet.own": "edit" });
    const team = await request("/api/entries");
    check(team.status === 200 && team.data.entries.length === 1, "team view lists other people's hours");
    check(team.data.entries[0].hourlyRate === null, "team view does not include pay rates");
    const cannotDelete = await request(`/api/entries/${team.data.entries[0].id}`, { method: "DELETE" });
    check(cannotDelete.status === 403, "team view cannot delete");

    resetPermissionsCache();
    bodyFor = (email) => record(email, { "timesheet.team": "edit", "timesheet.own": "edit" });
    const teamEdit = await request("/api/entries");
    const removed = await request(`/api/entries/${teamEdit.data.entries[0].id}`, { method: "DELETE" });
    check(removed.status === 200, "team edit can delete an entry");

    await withClient(async (client) => {
      await client.query(
        `INSERT INTO time_entries (user_id, work_date, hours, notes, status, hourly_rate)
         VALUES ($1, '2026-10-04', 3, 'floor', 'submitted', 18)`,
        [WORKER_ID],
      );
    });

    resetPermissionsCache();
    bodyFor = (email) => record(email, { "timesheet.payroll": "view" });
    const payrollView = await request("/api/entries");
    check(payrollView.data.entries[0].hourlyRate === 18, "payroll view includes rates");
    const rates = await request(`/api/rates?userId=${WORKER_ID}`);
    check(rates.status === 200, "payroll view can read rates");
    const users = await request("/api/users");
    check(users.status === 200, "payroll view can list people for the report");
    const noPay = await request("/api/admin/pay", {
      method: "POST",
      body: { userId: WORKER_ID },
    });
    check(noPay.status === 403, "payroll view cannot mark paid");
    const noRate = await request("/api/rates", {
      method: "POST",
      body: { userId: WORKER_ID, hourlyRate: 22, effectiveFrom: "2026-10-01" },
    });
    check(noRate.status === 403, "payroll view cannot change rates");
    const noTeam = await request("/api/users", {
      method: "POST",
      body: { name: "New Person", email: "new@example.com" },
    });
    check(noTeam.status === 403, "payroll view cannot add users");

    resetPermissionsCache();
    bodyFor = (email) => record(email, { "timesheet.payroll": "edit" });
    const paid = await request("/api/admin/pay", {
      method: "POST",
      body: { userId: WORKER_ID, reference: "zelle" },
    });
    check(paid.status === 200 && paid.data.updated === 1, "payroll edit can mark paid");
    const addedRate = await request("/api/rates", {
      method: "POST",
      body: { userId: WORKER_ID, hourlyRate: 22, effectiveFrom: "2026-10-01" },
    });
    check(addedRate.status === 201, "payroll edit can add a rate");

    resetPermissionsCache();
    bodyFor = (email) => record(email, { "timesheet.admin": "view" });
    const adminView = await request("/api/users");
    check(adminView.status === 200, "admin view can list users");
    const cannotAdd = await request("/api/users", {
      method: "POST",
      body: { name: "New Person", email: "new@example.com" },
    });
    check(cannotAdd.status === 403, "admin view cannot add users");

    resetPermissionsCache();
    bodyFor = (email) => record(email, { "timesheet.admin": "edit" });
    const added = await request("/api/users", {
      method: "POST",
      body: { name: "New Person", email: "new@example.com" },
    });
    check(added.status === 201 && added.data.user.email === "new@example.com", "admin edit can add a user");

    resetPermissionsCache();
    bodyFor = (email) => record(email, {}, { isOwner: true });
    const owner = await request("/api/users");
    check(owner.status === 200 && owner.data && owner.status === 200, "owner can open admin routes");
    const ownerSession = await request("/api/auth/session");
    check(ownerSession.data.permissions.isOwner === true, "owner flag is returned");
    check(SECTIONS.every((section) => ownerSession.data.permissions.sections[section] === "edit"), "owner session is full edit");

    resetPermissionsCache();
    bodyFor = () => record("admin@example.com", { "timesheet.own": "edit" }, { active: false });
    const inactive = await request("/api/auth/session");
    check(inactive.data.reason === "no_access" && inactive.data.user === null, "inactive permissions have no session");
    check(inactive.data.message === NO_ACCESS_MESSAGE, "inactive permissions use the ask-Robin message");

    resetPermissionsCache();
    bodyFor = () => "down";
    const down = await request("/api/auth/session");
    check(down.data.reason === "no_access", "permissions API failure is no access");
    const downEntries = await request("/api/entries");
    check(downEntries.status === 403, "API routes deny when the permissions API fails");

    resetPermissionsCache();
    bodyFor = () => "missing";
    const missing = await request("/api/auth/session");
    check(missing.data.reason === "no_access", "an unknown email at the company app has no access");

    resetPermissionsCache();
    bodyFor = () => ({ email: "someone-else@example.com", active: true, isOwner: true, sections: sections({ "timesheet.admin": "edit" }) });
    const swapped = await request("/api/auth/session");
    check(swapped.data.reason === "no_access", "a response for a different email is no access");

    resetPermissionsCache();
    const callsBefore = calls;
    process.env.PERMISSIONS_ROLE_FALLBACK = "1";
    const fallback = await request("/api/users");
    check(fallback.status === 200, "role fallback lets the admin row list users");
    check(calls === callsBefore, "role fallback does not call the company app");
    const workerBlocked = await request("/api/users", { email: "worker@example.com" });
    check(workerBlocked.status === 403, "role fallback still blocks an employee from the team");
    delete process.env.PERMISSIONS_ROLE_FALLBACK;
    resetPermissionsCache();
    bodyFor = () => record("admin@example.com", { "timesheet.own": "edit" });
    const ignoredRole = await request("/api/users");
    check(ignoredRole.status === 403, "with the flag off, an admin role does not grant team access");

    resetPermissionsCache();
    bodyFor = (email) => record(email, { "timesheet.own": "edit" });
    const createdEntry = await request("/api/entries", {
      method: "POST",
      email: "worker@example.com",
      body: { workDate: "2026-10-05", hours: 5, notes: "counter" },
    });
    check(createdEntry.status === 201, "own edit can add hours");
    const workerSees = await request("/api/entries", { email: "worker@example.com" });
    check(workerSees.data.entries.every((entry) => entry.userId === WORKER_ID), "own edit cannot see other people");

    resetPermissionsCache();
    bodyFor = () => record("admin@example.com", {}, { active: false, isOwner: true });
    const inactiveOwner = await request("/api/users");
    check(inactiveOwner.status === 200, "an owner is admitted when active is false");

    resetPermissionsCache();
    bodyFor = () => "need-email";
    const needEmail = await request("/api/auth/session");
    check(needEmail.data.reason === "no_access", "a 400 from the hub is no access");

    resetPermissionsCache();
    const prefixed = await request("/timesheet/api/auth/session");
    check(prefixed.status === 200 && prefixed.data.reason === "no_access", "the /timesheet prefix still reaches the API");

    const { default: worker } = await import("../worker/index.js");
    let assetPath = "";
    const env = {
      HUB: hub,
      ASSETS: {
        async fetch(assetRequest) {
          assetPath = new URL(assetRequest.url).pathname;
          return new Response(assetPath, { headers: { "content-type": "text/plain" } });
        },
      },
    };
    const apex = await worker.fetch(new Request("https://hbzr.us/"), env);
    check(apex.status === 404, "the apex is not served by this worker");
    const apexApi = await worker.fetch(new Request("https://hbzr.us/api/auth/session"), env);
    check(apexApi.status === 404, "apex /api is not served by this worker");
    const www = await worker.fetch(new Request("https://www.hbzr.us/timesheet"), env);
    check(www.status === 404, "www is not a route for this worker");
    const asset = await worker.fetch(new Request("https://hbzr.us/timesheet/assets/app.js"), env);
    check(asset.status === 200 && (await asset.text()) === "/assets/app.js", "timesheet asset paths drop the /timesheet prefix");

    resetPermissionsCache();
    bodyFor = (email) => record(email, { "timesheet.own": "edit", "timesheet.admin": "edit" });
    const callsBeforeWorker = calls;
    const mounted = await worker.fetch(
      new Request("http://localhost/timesheet/api/auth/session", {
        headers: { "x-dev-user-email": "admin@example.com" },
      }),
      env,
    );
    const mountedData = await mounted.json();
    check(mounted.status === 200 && mountedData.user.email === "admin@example.com", "localhost /timesheet/api uses the hub binding");
    check(calls === callsBeforeWorker + 1, "the worker calls env.HUB.fetch once");
    check(assetPath === "/assets/app.js", "asset rewrite kept the file path");
  } finally {
    delete process.env.ACCESS_DEV_BYPASS;
    delete process.env.PERMISSIONS_ROLE_FALLBACK;
    resetPermissionsCache();
    await closePool();
  }
}

async function main() {
  shapeTests();
  await hubSourceTests();
  await cacheTests();
  await routeTests();
  console.log("Permissions adapter and route checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
