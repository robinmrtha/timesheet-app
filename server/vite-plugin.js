export function apiDevPlugin() {
  return {
    name: "timesheet-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if ((url === "/" || url.startsWith("/?")) && req.method === "GET") {
          res.statusCode = 302;
          res.setHeader("location", "/timesheet/");
          res.end();
          return;
        }
        if (url === "/timesheet/api" || url.startsWith("/timesheet/api/") || url.startsWith("/timesheet/api?")) {
          req.url = url.slice("/timesheet".length);
        } else if (!url.startsWith("/api")) {
          return next();
        }
        try {
          const { handle } = await import("./router.js");
          const { fromNodeRequest, writeNodeResponse } = await import("./node-adapter.js");
          const request = await fromNodeRequest(req);
          const response = await handle(request);
          await writeNodeResponse(res, response);
        } catch (error) {
          console.error(error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: "Something went wrong" }));
          }
        }
      });
    },
  };
}
