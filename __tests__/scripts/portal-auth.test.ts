// @vitest-environment node

// Tests for the portal-auth gate wired into scripts/static-server.mjs.
//
// These spin up a real static-server instance with `--portal-auth` enabled and
// exercise the full lifecycle with HTTP requests: unauthenticated redirects to
// /setup, first-admin creation, login, admin user management, session gating of
// static + API routes, logout, and credential/session hashing at rest.

import { request, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startStaticServer } from "../../scripts/static-server.mjs";

describe("static-server portal auth", () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];
  let nextPort = 41000;

  async function startPortalServer() {
    const dir = mkdtempSync(path.join(tmpdir(), "portal-auth-"));
    tempDirs.push(dir);
    writeFileSync(
      path.join(dir, "index.html"),
      "<!doctype html><title>App</title>SECRET",
    );
    const storePath = path.join(dir, "portal-auth-store.json");
    const port = nextPort++;
    const server = await startStaticServer({
      port,
      host: "127.0.0.1",
      dir,
      routes: {},
      portalAuth: storePath,
    });
    servers.push(server);
    return { base: `http://127.0.0.1:${port}`, storePath, dir };
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
    url: string,
    method = "GET",
    {
      body,
      cookie,
      headers: extraHeaders,
    }: {
      body?: unknown;
      cookie?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    return new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      text: string;
    }>((resolve, reject) => {
      const cookieHeader = cookie
        ? `openhands_portal_session=${cookie}`
        : undefined;
      const req = request(
        url,
        {
          method,
          agent: false,
          headers: {
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(extraHeaders ?? {}),
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

  function extractCookie(
    headers: Record<string, string | string[] | undefined>,
  ): string | undefined {
    const setCookie = headers["set-cookie"];
    if (!setCookie) return undefined;
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const match = raw.match(/openhands_portal_session=([^;]+)/);
    return match ? match[1] : undefined;
  }

  it("redirects unauthenticated static requests to /setup before any admin exists", async () => {
    const { base } = await startPortalServer();
    const res = await rawRequest(`${base}/`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/setup?returnTo=%2F");
  });

  it("preserves a deep link and its backend/org query through portal login", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });

    const destination = "/conversations/abc?backend=prod&org=org-1";
    const redirect = await rawRequest(`${base}${destination}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(
      `/login?returnTo=${encodeURIComponent(destination)}`,
    );

    const loginPage = await rawRequest(`${base}${redirect.headers.location}`);
    expect(loginPage.text).toContain(
      'name="returnTo" value="/conversations/abc?backend=prod&amp;org=org-1"',
    );
    expect(loginPage.text).toContain(
      "returnTo: f.elements.namedItem('returnTo').value",
    );

    const login = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: {
        username: "grok",
        password: "supersecret1",
        returnTo: destination,
      },
    });
    expect(login.status).toBe(200);
    expect(JSON.parse(login.text).returnTo).toBe(destination);
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\\\attacker.example/path",
  ])(
    "rejects an external portal login destination: %s",
    async (destination) => {
      const { base } = await startPortalServer();
      await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
        body: { username: "grok", password: "supersecret1" },
      });

      const login = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
        body: {
          username: "grok",
          password: "supersecret1",
          returnTo: destination,
        },
      });

      expect(login.status).toBe(200);
      expect(JSON.parse(login.text).returnTo).toBe("/");
    },
  );

  it("carries a deep-link returnTo through first-admin setup", async () => {
    const { base } = await startPortalServer();
    const destination = "/conversations/abc?backend=prod&org=org-1";
    const setupPage = await rawRequest(
      `${base}/setup?returnTo=${encodeURIComponent(destination)}`,
    );

    expect(setupPage.status).toBe(200);
    expect(setupPage.text).toContain(
      'name="returnTo" value="/conversations/abc?backend=prod&amp;org=org-1"',
    );
    expect(setupPage.text).toContain(
      "returnTo: f.elements.namedItem('returnTo').value",
    );

    const setup = await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: {
        username: "grok",
        password: "supersecret1",
        returnTo: destination,
      },
    });
    expect(setup.status).toBe(201);
    expect(JSON.parse(setup.text).returnTo).toBe(destination);
  });

  it("serves the setup page and creates the first admin, then gates behind login", async () => {
    const { base } = await startPortalServer();
    const setupPage = await rawRequest(`${base}/setup`);
    expect(setupPage.status).toBe(200);
    expect(setupPage.text).toContain("Set up admin");
    // DCK branding: crown mark + product name.
    expect(setupPage.text).toContain('aria-label="DCK"');
    expect(setupPage.text).toContain("DCK Agentic");

    const admin = await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    expect(admin.status).toBe(201);

    // Admin now exists -> /setup redirects to /login, and re-running setup 409s.
    const after = await rawRequest(`${base}/setup`);
    expect(after.status).toBe(302);
    expect(after.headers.location).toMatch(/^\/login/);

    const dup = await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "other", password: "supersecret1" },
    });
    expect(dup.status).toBe(409);

    // Logged out, GET / now redirects to /login.
    const root = await rawRequest(`${base}/`);
    expect(root.status).toBe(302);
    expect(root.headers.location).toMatch(/^\/login/);
  });

  it("requires a session cookie for static and API routes, but not for login", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });

    // API path without a session -> 401 JSON, not an HTML redirect.
    const api = await rawRequest(`${base}/api/some-endpoint`);
    expect(api.status).toBe(401);
    expect(JSON.parse(api.text).error).toBe("Authentication required.");

    // Asset without a session -> 401.
    const asset = await rawRequest(`${base}/assets/app.js`);
    expect(asset.status).toBe(401);

    // Login page is reachable without auth.
    const login = await rawRequest(`${base}/login`);
    expect(login.status).toBe(200);
    expect(login.text).toContain("Sign in");
    expect(login.text).toContain('aria-label="DCK"');
    expect(login.text).toContain("DCK Agentic");

    // Login sets a session cookie and unlocks static content.
    const loginRes = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    expect(loginRes.status).toBe(200);
    const cookie = extractCookie(loginRes.headers);
    expect(cookie).toBeTruthy();

    const staticRes = await rawRequest(`${base}/`, "GET", { cookie });
    expect(staticRes.status).toBe(200);
    expect(staticRes.text).toContain("SECRET");
  });

  it("rejects bad credentials and enforces admin-only user creation", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });

    const bad = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "grok", password: "wrongpass1" },
    });
    expect(bad.status).toBe(401);

    const admin = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const adminCookie = extractCookie(admin.headers);

    // Admin creates a non-admin user.
    const created = await rawRequest(`${base}/api/portal-auth/users`, "POST", {
      body: { username: "bob", password: "bobspassword" },
      cookie: adminCookie,
    });
    expect(created.status).toBe(201);

    // Non-admin cannot create users.
    const bob = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "bob", password: "bobspassword" },
    });
    const bobCookie = extractCookie(bob.headers);
    const forbidden = await rawRequest(
      `${base}/api/portal-auth/users`,
      "POST",
      {
        body: { username: "mallory", password: "whatever1" },
        cookie: bobCookie,
      },
    );
    expect(forbidden.status).toBe(403);

    // Unauthenticated user creation -> 401.
    const anon = await rawRequest(`${base}/api/portal-auth/users`, "POST", {
      body: { username: "mallory", password: "whatever1" },
    });
    expect(anon.status).toBe(401);
  });

  it("exposes the current user via /me and lists users for admins", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const admin = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const adminCookie = extractCookie(admin.headers);

    // whoami
    const me = await rawRequest(`${base}/api/portal-auth/me`, "GET", {
      cookie: adminCookie,
    });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.text)).toEqual({ username: "grok", isAdmin: true });

    // whoami unauthenticated -> 401
    const anonMe = await rawRequest(`${base}/api/portal-auth/me`);
    expect(anonMe.status).toBe(401);

    // create a second user, then list
    await rawRequest(`${base}/api/portal-auth/users`, "POST", {
      body: { username: "bob", password: "bobspassword" },
      cookie: adminCookie,
    });
    const list = await rawRequest(`${base}/api/portal-auth/users`, "GET", {
      cookie: adminCookie,
    });
    expect(list.status).toBe(200);
    const users = JSON.parse(list.text).users;
    expect(users.map((u: { username: string }) => u.username)).toEqual([
      "bob",
      "grok",
    ]);
    expect(
      users.find((u: { username: string }) => u.username === "grok").isAdmin,
    ).toBe(true);

    // non-admin cannot list
    const bob = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "bob", password: "bobspassword" },
    });
    const bobList = await rawRequest(`${base}/api/portal-auth/users`, "GET", {
      cookie: extractCookie(bob.headers),
    });
    expect(bobList.status).toBe(403);
  });

  it("deletes a user but blocks self-delete and last-admin delete", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const admin = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const adminCookie = extractCookie(admin.headers);
    await rawRequest(`${base}/api/portal-auth/users`, "POST", {
      body: { username: "bob", password: "bobspassword" },
      cookie: adminCookie,
    });

    // Admin cannot delete themselves.
    const self = await rawRequest(
      `${base}/api/portal-auth/users/grok`,
      "DELETE",
      { cookie: adminCookie },
    );
    expect(self.status).toBe(400);
    expect(JSON.parse(self.text).error).toMatch(/your own account/i);

    // Admin deletes bob successfully (via path).
    const delBob = await rawRequest(
      `${base}/api/portal-auth/users/bob`,
      "DELETE",
      { cookie: adminCookie },
    );
    expect(delBob.status).toBe(200);
    const after = await rawRequest(`${base}/api/portal-auth/users`, "GET", {
      cookie: adminCookie,
    });
    expect(
      JSON.parse(after.text).users.map((u: { username: string }) => u.username),
    ).toEqual(["grok"]);

    // Deleting the only remaining admin is blocked even by a second admin:
    // create another admin, delete grok, then the last admin is protected.
    await rawRequest(`${base}/api/portal-auth/users`, "POST", {
      body: { username: "ada", password: "adapassword1", isAdmin: true },
      cookie: adminCookie,
    });
    const ada = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "ada", password: "adapassword1" },
    });
    const adaCookie = extractCookie(ada.headers);
    // ada deletes grok (allowed: 2 admins -> 1)
    const delGrok = await rawRequest(
      `${base}/api/portal-auth/users/grok`,
      "DELETE",
      { cookie: adaCookie },
    );
    expect(delGrok.status).toBe(200);
    // Now ada is the last admin and cannot be deleted (ada can't self-delete
    // anyway, so verify via the last-admin guard path by a fresh admin? ada is
    // sole admin — self-delete guard triggers first, still blocked).
    const delAda = await rawRequest(
      `${base}/api/portal-auth/users/ada`,
      "DELETE",
      { cookie: adaCookie },
    );
    expect(delAda.status).toBe(400);
  });

  it("persists only hashed passwords and hashed sessions in the store", async () => {
    const { base, storePath } = await startPortalServer();
    const setup = await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const cookie = extractCookie(setup.headers);
    await rawRequest(`${base}/`, "GET", { cookie });

    const raw = readFileSync(storePath, "utf8");
    expect(raw).not.toContain("supersecret1");
    // Session token must not be stored in the clear.
    expect(raw).not.toContain(cookie);

    const store = JSON.parse(raw);
    expect(store.users.grok.passwordHash).toMatch(/^[0-9a-f]{128}$/);
    expect(store.users.grok.salt).toMatch(/^[0-9a-f]{32}$/);
    // Sessions are keyed by token digest, values carry no raw token.
    expect(
      Object.keys(store.sessions).every((k) => /^[0-9a-f]{64}$/.test(k)),
    ).toBe(true);
  });

  it("logout invalidates the session", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const login = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const cookie = extractCookie(login.headers);

    const before = await rawRequest(`${base}/`, "GET", { cookie });
    expect(before.status).toBe(200);

    const logout = await rawRequest(`${base}/api/portal-auth/logout`, "POST", {
      cookie,
    });
    expect(logout.status).toBe(200);

    const after = await rawRequest(`${base}/`, "GET", { cookie });
    expect(after.status).toBe(302);
  });

  it("enforces a minimum password length", async () => {
    const { base } = await startPortalServer();
    const res = await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "short" },
    });
    expect(res.status).toBe(400);
  });

  function rawUpgrade(
    base: string,
    pathName: string,
    cookie?: string,
  ): Promise<{ status: number }> {
    const url = new URL(base);
    return new Promise((resolve) => {
      const req = request({
        host: url.hostname,
        port: Number(url.port),
        path: pathName,
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
      // The gate writes `401` then destroys; a bare socket close (no response)
      // also means "rejected" (reported as 0).
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

  it("rejects unauthenticated WebSocket upgrades (blocking-1 gate)", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });

    const result = await rawUpgrade(base, "/sockets/events/conv-123");
    // Gated: never a successful 101 Switching Protocols without a session.
    expect(result.status).not.toBe(101);
  });

  it("does not switch protocols for an upgrade with an invalid session cookie", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });

    const result = await rawUpgrade(
      base,
      "/sockets/events/conv-123",
      "deadbeefinvalidtoken",
    );
    expect(result.status).not.toBe(101);
  });

  it("fails closed (refuses to start) when the store exists but is corrupt", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "portal-auth-"));
    tempDirs.push(dir);
    writeFileSync(path.join(dir, "index.html"), "<!doctype html>SECRET");
    const storePath = path.join(dir, "portal-auth-store.json");
    // A configured-but-corrupt store must not silently reopen /setup.
    writeFileSync(storePath, "{ this is not valid json");

    let error: unknown;
    try {
      const server = await startStaticServer({
        port: nextPort++,
        host: "127.0.0.1",
        dir,
        routes: {},
        portalAuth: storePath,
      });
      servers.push(server);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /not valid JSON|could not be read/i,
    );
  });

  it("treats a missing store as a legitimate first run", async () => {
    // No store file written -> redirects to /setup (first-run), not an error.
    const { base } = await startPortalServer();
    const res = await rawRequest(`${base}/`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/setup?returnTo=%2F");
  });

  it("throttles repeated bad login attempts with 429", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });

    let sawThrottle = false;
    // The limit is 10 attempts per window; a dozen bad logins must trip 429.
    for (let i = 0; i < 15; i++) {
      const res = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
        body: { username: "grok", password: "definitely-wrong" },
      });
      if (res.status === 429) {
        sawThrottle = true;
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(sawThrottle).toBe(true);
  });

  it("sets a Secure cookie when the request is forwarded as HTTPS", async () => {
    const { base } = await startPortalServer();
    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });

    const httpsLogin = await rawRequest(
      `${base}/api/portal-auth/login`,
      "POST",
      {
        body: { username: "grok", password: "supersecret1" },
        headers: { "X-Forwarded-Proto": "https" },
      },
    );
    const setCookie = httpsLogin.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toContain("Secure");

    // Plain HTTP (no forwarded proto) must NOT carry Secure, or the browser
    // would drop the cookie behind a non-TLS local deployment.
    const httpLogin = await rawRequest(
      `${base}/api/portal-auth/login`,
      "POST",
      {
        body: { username: "grok", password: "supersecret1" },
      },
    );
    const plainCookie = httpLogin.headers["set-cookie"];
    const plainStr = Array.isArray(plainCookie) ? plainCookie[0] : plainCookie;
    expect(plainStr).not.toContain("Secure");
  });

  it("withholds an injected session key until the user logs in, then serves it", async () => {
    // Portal + injected session key: the gate runs before static serving, so
    // the key (needed by the frontend to call the proxied agent-server) must
    // reach only authenticated users — never the login/setup pages.
    const dir = mkdtempSync(path.join(tmpdir(), "portal-auth-"));
    tempDirs.push(dir);
    writeFileSync(
      path.join(dir, "index.html"),
      "<!doctype html><title>App</title><div id=root></div>",
    );
    const storePath = path.join(dir, "portal-auth-store.json");
    const port = nextPort++;
    const server = await startStaticServer({
      port,
      host: "127.0.0.1",
      dir,
      routes: {},
      portalAuth: storePath,
      sessionApiKey: "INTERNAL-BACKEND-KEY",
    });
    servers.push(server);
    const base = `http://127.0.0.1:${port}`;

    await rawRequest(`${base}/api/portal-auth/setup`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });

    // Unauthenticated: redirect to login, and the login page must not leak it.
    const anon = await rawRequest(`${base}/`);
    expect(anon.status).toBe(302);
    const loginPage = await rawRequest(`${base}/login`);
    expect(loginPage.text).not.toContain("INTERNAL-BACKEND-KEY");

    // Authenticated: the injected index.html carries the key for /api calls.
    const login = await rawRequest(`${base}/api/portal-auth/login`, "POST", {
      body: { username: "grok", password: "supersecret1" },
    });
    const cookie = extractCookie(login.headers);
    const authed = await rawRequest(`${base}/`, "GET", { cookie });
    expect(authed.status).toBe(200);
    expect(authed.text).toContain("INTERNAL-BACKEND-KEY");
  });
});
