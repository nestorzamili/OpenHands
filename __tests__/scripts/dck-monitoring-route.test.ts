// @vitest-environment node

import { request, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startStaticServer } from "../../scripts/static-server.mjs";

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

describe("static-server Docker monitoring endpoint", () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];

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

  async function startServer() {
    const dir = mkdtempSync(path.join(tmpdir(), "dck-monitoring-route-"));
    tempDirs.push(dir);
    writeFileSync(
      path.join(dir, "index.html"),
      "<!doctype html><title>Canvas</title>",
    );
    const server = await startStaticServer({
      port: 0,
      host: "127.0.0.1",
      dir,
      routes: {},
      sessionApiKey: "test-monitoring-session-key",
      dckMonitoring: {
        socketPath: path.join(dir, "docker.sock"),
        webgenRoot: path.join(dir, "webgen"),
      },
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Static server did not bind to a TCP port");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  function makeRequest(
    url: string,
    method = "GET",
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const req = request(url, { method, headers }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("requires the existing session key and returns a read-only partial snapshot when Docker is unavailable", async () => {
    const base = await startServer();

    const anonymous = await makeRequest(`${base}/__dck/monitoring`);
    const authenticated = await makeRequest(`${base}/__dck/monitoring`, "GET", {
      "X-Session-API-Key": "test-monitoring-session-key",
    });
    const writeAttempt = await makeRequest(`${base}/__dck/monitoring`, "POST", {
      "X-Session-API-Key": "test-monitoring-session-key",
    });

    expect(anonymous.status).toBe(401);
    expect(authenticated.status).toBe(200);
    expect(authenticated.headers["content-type"]).toContain("application/json");
    const snapshot = JSON.parse(authenticated.body);
    expect(snapshot.docker.available).toBe(false);
    expect(snapshot.services).toHaveLength(3);
    expect(snapshot.workspaceModules).toHaveLength(3);
    expect(snapshot.applications).toEqual([]);
    expect(writeAttempt.status).toBe(405);
    expect(writeAttempt.headers.allow).toBe("GET");
  });
});
