import { handle } from "../server/router.js";

function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      console.log(
        JSON.stringify({
          message: "api request",
          method: request.method,
          path: url.pathname,
        }),
      );
      return handle(request);
    }
    if (!env.ASSETS) {
      console.error(JSON.stringify({ message: "ASSETS binding is missing" }));
      return new Response("Static assets are not configured", { status: 500 });
    }
    return env.ASSETS.fetch(request);
  },
};
