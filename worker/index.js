import { stripAppBase } from "../server/http.js";
import { runWithHub } from "../server/request-context.js";
import { handle } from "../server/router.js";

function isTimesheetPath(pathname) {
  return pathname === "/timesheet" || pathname.startsWith("/timesheet/");
}

function isTimesheetApi(pathname) {
  return pathname === "/timesheet/api" || pathname.startsWith("/timesheet/api/");
}

function hasFileExtension(pathname) {
  return /\/[^/]+\.[a-z0-9]+$/i.test(pathname);
}

// The hub Worker owns hbzr.us/. This Worker only answers /timesheet and /timesheet/*.
function outsideTimesheet(url) {
  if (url.hostname === "www.hbzr.us") return true;
  return !isTimesheetPath(url.pathname);
}

function rewriteBase(request) {
  const url = new URL(request.url);
  const stripped = stripAppBase(url.pathname);
  if (stripped === url.pathname) return request;
  url.pathname = stripped;
  return new Request(url, request);
}

async function serveSpa(request, env) {
  if (!env?.ASSETS) {
    console.error(JSON.stringify({ message: "ASSETS binding is missing" }));
    return new Response("Static assets are not configured", { status: 500 });
  }
  const routed = rewriteBase(request);
  const routedUrl = new URL(routed.url);
  const assetUrl = new URL(routed.url);
  assetUrl.pathname = routedUrl.pathname === "/" ? "/index.html" : routedUrl.pathname;
  const asset = await env.ASSETS.fetch(new Request(assetUrl, routed));
  if (asset.status !== 404 || hasFileExtension(urlPath(request))) return asset;
  const indexUrl = new URL(routed.url);
  indexUrl.pathname = "/index.html";
  return env.ASSETS.fetch(new Request(indexUrl, { method: "GET" }));
}

function urlPath(request) {
  return new URL(request.url).pathname;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (outsideTimesheet(url)) return new Response("Not found", { status: 404 });

    const routed = rewriteBase(request);
    return runWithHub(env?.HUB, async () => {
      if (isTimesheetApi(url.pathname)) {
        const routedUrl = new URL(routed.url);
        console.log(
          JSON.stringify({
            message: "api request",
            method: request.method,
            path: routedUrl.pathname,
          }),
        );
        return handle(routed);
      }
      return serveSpa(request, env);
    });
  },
};
