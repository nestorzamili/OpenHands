import { createServer, request } from "node:http";
import { pathToFileURL } from "node:url";

export function createWebgenInternalProxy(upstream) {
  const target = new URL(upstream);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1") {
    throw new Error("Internal upstream must use IPv4 loopback HTTP");
  }
  return createServer((req, res) => {
    const path = req.url ?? "";
    if (
      req.method !== "GET" ||
      !/^\/api\/(?:workspaces|settings\/secrets(?:\/[A-Za-z][A-Za-z0-9_]{0,63})?)$/.test(
        path,
      )
    ) {
      res.writeHead(404).end();
      return;
    }
    const key = req.headers["x-session-api-key"];
    if (typeof key !== "string" || !key) {
      res.writeHead(401).end();
      return;
    }
    const outgoing = request(
      new URL(path, target),
      {
        method: "GET",
        headers: { "X-Session-API-Key": key },
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume();
          res.writeHead(502).end();
          return;
        }
        res.writeHead(response.statusCode ?? 502, {
          "Content-Type":
            response.headers["content-type"] ?? "application/json",
          "Cache-Control": "no-store",
        });
        response.on("error", () => res.destroy());
        response.pipe(res);
      },
    );
    outgoing.setTimeout(5000, () => outgoing.destroy());
    outgoing.on("error", () => {
      if (!res.headersSent) res.writeHead(503);
      res.end();
    });
    res.on("close", () => outgoing.destroy());
    outgoing.end();
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createWebgenInternalProxy(process.env.AGENT_SERVER_URL);
  server.listen(18002, "0.0.0.0");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close());
}
