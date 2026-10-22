import { stripAppBase } from "../server/http.js";
import { runWithHub } from "../server/request-context.js";
import { handle } from "../server/router.js";

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isTimesheetPath(pathname) {
  return pathname === "/timesheet" || pathname.startsWith("/timesheet/");
}

// hbzr.us itself belongs to the hub Worker. This Worker only serves hbzr.us/timesheet*.
function outsideTimesheetRoute(url) {
  if (url.hostname === "www.hbzr.us") return true;
  return url.hostname === "hbzr.us" && !isTimesheetPath(url.pathname);
}

function rewriteBase(request) {
  const url = new URL(request.url);
  const stripped = stripAppBase(url.pathname);
  if (stripped === url.pathname) return request;
  url.pathname = stripped;
  return new Request(url, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (outsideTimesheetRoute(url)) return new Response("Not found", { status: 404 });

    const routed = rewriteBase(request);
    const routedUrl = new URL(routed.url);
    return runWithHub(env?.HUB, async () => {
      if (isApiPath(routedUrl.pathname)) {
        console.log(
          JSON.stringify({
            message: "api request",
            method: request.method,
            path: routedUrl.pathname,
          }),
        );
        return handle(routed);
      }
      if (!env?.ASSETS) {
        console.error(JSON.stringify({ message: "ASSETS binding is missing" }));
        return new Response("Static assets are not configured", { status: 500 });
      }
      return env.ASSETS.fetch(routed);
    });
  },
};
