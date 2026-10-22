import { createServer } from "node:http";
import { fromNodeRequest, writeNodeResponse } from "./node-adapter.js";
import { handle } from "./router.js";

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const request = await fromNodeRequest(req);
      const response = await handle(request);
      await writeNodeResponse(res, response);
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Something went wrong" }));
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}
