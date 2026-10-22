export async function fromNodeRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const host = req.headers.host || "127.0.0.1";
  const method = req.method || "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  const init = { method, headers };
  if (!headers.has("x-forwarded-for") && req.socket?.remoteAddress) {
    headers.set("x-forwarded-for", req.socket.remoteAddress);
  }
  if (method !== "GET" && method !== "HEAD") {
    init.body = body;
    init.duplex = "half";
  }
  return new Request(`http://${host}${req.url}`, init);
}

export async function writeNodeResponse(res, response) {
  res.statusCode = response.status;
  const cookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });
  if (cookies.length) res.setHeader("set-cookie", cookies);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}
