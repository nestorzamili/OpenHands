// @vitest-environment node

// Verifies the portal-auth gate wired into scripts/ingress.mjs: with
// --portal-auth enabled, unauthenticated HTTP is redirected / 401'd and
// WebSocket upgrades are rejected, while the login/setup endpoints and an
// authenticated session pass through to the routed backend.

import { request, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startIngress } from "../../scripts/ingress.mjs";

describe("ingress portal auth", () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];
  let nextPort = 42000;

  function startPortalIngress() {
    const dir = mkdtempSync(path.join(tmpdir(), "ingress-portal-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "portal-auth-store.json");
    const port = nextPort++;
    const server = startIngress({
      port,
      host: "127.0.0.1",
      routes: {},
      defaultBackend: "http://127.0.0.1:9", // unused: gate blocks before routing
      portalAuth: storePath,
    });
    servers.push(server);
    const ready = new Promise<void>((resolve) => {
      if (server.listening) resolve();
      else server.once("listening", () => resolve());
    });
    return ready.then(() => ({ base: `http://127.0.0.1:${port}`, storePath }));
  }

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function rawRequest(
    base: string,
    pathName: string,
    method = "GET",
    { body, cookie }: { body?: unknown; cookie?: string } = {},
  ) {
    return new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      text: string;
    }>((resolve, reject) => {
      const req = request(
        `${base}${pathName}`,
        {
          method,
          agent: false,
          headers: {
            ...(cookie ? { Cookie: `openhands_portal_session=${cookie}` } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              text: data,
            }),
          );
        },
      );
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  function rawUpgrade(
    base: string,
    cookie?: string,
  ): Promise<{ status: number }> {
    const url = new URL(base);
    return new Promise((resolve) => {
      const req = request({
        host: url.hostname,
        port: Number(url.port),
        path: "/sockets/events/conv-1",
        method: "GET",
        agent: false,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          ...(cookie ? { Cookie: `openhands_portal_session=${cookie}` } : {}),
        },
      });
      let settled = false;
      const settle = (status: number) => {
        if (settled) return;
        settled = true;
        resolve({ status });
      };
      req.on("upgrade", (res, socket) => {
        socket.destroy();
        settle(res.statusCode ?? 101);
      });
      req.on("response", (res) => {
        res.resume();
        settle(res.statusCode ?? 0);
      });
      req.on("error", () => settle(0));
      req.on("close", () => settle(0));
      req.end();
    });
  }

  function extractCookie(
    headers: Record<string, string | string[] | undefined>,
  ): string | undefined {
    const setCookie = headers["set-cookie"];
    if (!setCookie) return undefined;
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const match = raw.match(/openhands_portal_session=([^;]+)/);
    return match ? match[1] : undefined;
  }

  it("redirects unauthenticated navigation and 401s the API", async () => {
    const { base } = await startPortalIngress();
    await rawRequest(base, "/api/portal-auth/setup", "POST", {
      body: { username: "dev", password: "devpassword1" },
    });

    const nav = await rawRequest(base, "/");
    expect(nav.status).toBe(302);
    expect(nav.headers.location).toMatch(/^\/login/);

    const api = await rawRequest(base, "/api/conversations");
    expect(api.status).toBe(401);
  });

  it("rejects unauthenticated WebSocket upgrades", async () => {
    const { base } = await startPortalIngress();
    await rawRequest(base, "/api/portal-auth/setup", "POST", {
      body: { username: "dev", password: "devpassword1" },
    });

    const result = await rawUpgrade(base);
    expect(result.status).not.toBe(101);
  });

  it("serves the login page and sets a session on valid login", async () => {
    const { base } = await startPortalIngress();
    await rawRequest(base, "/api/portal-auth/setup", "POST", {
      body: { username: "dev", password: "devpassword1" },
    });

    const login = await rawRequest(base, "/login");
    expect(login.status).toBe(200);
    expect(login.text).toContain("Sign in");

    const auth = await rawRequest(base, "/api/portal-auth/login", "POST", {
      body: { username: "dev", password: "devpassword1" },
    });
    expect(auth.status).toBe(200);
    expect(extractCookie(auth.headers)).toBeTruthy();
  });
});
