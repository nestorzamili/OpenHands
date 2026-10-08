// @vitest-environment node

import { createServer, request, type Server } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getDckMonitoringSnapshot,
  handleDckMonitoringRequest,
} from "../../scripts/dck-monitoring.mjs";

const CONTAINER_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CORE_CONTAINER_IDS = {
  canvas: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  postgres: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  beszel: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

function sendJson(res: import("node:http").ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("DCK Agentic monitoring", () => {
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

  function makeApp(
    root: string,
    id: string,
    lastStatus: string | null = "running",
  ) {
    const appDir = path.join(root, id);
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      path.join(appDir, ".dck.json"),
      JSON.stringify({ name: "Storefront", port: 3005, lastStatus }),
    );
    writeFileSync(
      path.join(appDir, "docker-compose.yml"),
      "services:\n  app:\n",
    );
    return appDir;
  }

  async function startDockerMock(
    root: string,
    options: {
      health?: string;
      includeContainer?: boolean;
      requestCounts?: Map<string, number>;
    } = {},
  ) {
    const appDir = makeApp(root, "storefront", "running");
    const coreContainers = [
      {
        Id: CORE_CONTAINER_IDS.canvas,
        Names: ["/dck-agentic-canvas"],
        State: "running",
        Status: "Up 10 hours (healthy)",
      },
      {
        Id: CORE_CONTAINER_IDS.postgres,
        Names: ["/dck-agentic-postgres"],
        State: "running",
        Status: "Up 10 hours (healthy)",
      },
      {
        Id: CORE_CONTAINER_IDS.beszel,
        Names: ["/dck-agentic-beszel"],
        State: "running",
        Status: "Up 10 hours (healthy)",
      },
    ];
    const server = createServer((req, res) => {
      const requestPath = req.url ?? "/";
      if (options.requestCounts) {
        options.requestCounts.set(
          requestPath,
          (options.requestCounts.get(requestPath) ?? 0) + 1,
        );
      }
      const url = new URL(requestPath, "http://docker.local");
      if (url.pathname === "/version") {
        sendJson(res, { ApiVersion: "1.45", Version: "27.0.3" });
        return;
      }
      if (url.pathname === "/v1.45/containers/json") {
        const filters = JSON.parse(url.searchParams.get("filters") ?? "{}");
        if (filters.name) {
          sendJson(
            res,
            coreContainers.filter((container) =>
              filters.name.includes(container.Names[0].replace(/^\//, "")),
            ),
          );
          return;
        }
        sendJson(
          res,
          options.includeContainer === false
            ? []
            : [
                {
                  Id: CONTAINER_ID,
                  State: "running",
                  Labels: {
                    "com.docker.compose.service": "app",
                    "com.docker.compose.project": "storefront",
                    "com.docker.compose.project.working_dir": appDir,
                  },
                },
              ],
        );
        return;
      }
      const coreId = Object.values(CORE_CONTAINER_IDS).find((id) =>
        url.pathname.startsWith(`/v1.45/containers/${id}/`),
      );
      if (coreId && url.pathname.endsWith("/json")) {
        sendJson(res, {
          State: {
            Status: "running",
            StartedAt: "2026-10-07T10:00:00Z",
            Health: { Status: "healthy" },
          },
          RestartCount: 0,
        });
        return;
      }
      if (coreId && url.pathname.endsWith("/stats")) {
        sendJson(res, {
          cpu_stats: {
            online_cpus: 2,
            cpu_usage: { total_usage: 150 },
            system_cpu_usage: 1000,
          },
          precpu_stats: {
            cpu_usage: { total_usage: 50 },
            system_cpu_usage: 500,
          },
          memory_stats: {
            usage: 10 * 1024 * 1024,
            limit: 50 * 1024 * 1024,
            stats: { cache: 1024 * 1024 },
          },
        });
        return;
      }
      if (url.pathname === `/v1.45/containers/${CONTAINER_ID}/json`) {
        sendJson(res, {
          State: {
            Status: "running",
            StartedAt: "2026-10-07T10:00:00Z",
            Health: { Status: options.health ?? "healthy" },
          },
          RestartCount: 2,
        });
        return;
      }
      if (url.pathname === `/v1.45/containers/${CONTAINER_ID}/stats`) {
        sendJson(res, {
          cpu_stats: {
            online_cpus: 2,
            cpu_usage: { total_usage: 150 },
            system_cpu_usage: 1000,
          },
          precpu_stats: {
            cpu_usage: { total_usage: 50 },
            system_cpu_usage: 500,
          },
          memory_stats: {
            usage: 10 * 1024 * 1024,
            limit: 50 * 1024 * 1024,
            stats: { cache: 1024 * 1024 },
          },
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const socketPath = path.join(root, "docker.sock");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    servers.push(server);
    return { socketPath, appDir };
  }

  it("coalesces concurrent snapshot requests into one Docker collection", async () => {
    const root = mkdtempSync(
      path.join(tmpdir(), "dck-monitoring-singleflight-"),
    );
    tempDirs.push(root);
    const webgenRoot = path.join(root, "webgen");
    mkdirSync(webgenRoot);
    const requestCounts = new Map<string, number>();
    const { socketPath } = await startDockerMock(webgenRoot, { requestCounts });

    const [first, second] = await Promise.all([
      getDckMonitoringSnapshot({ socketPath, webgenRoot }),
      getDckMonitoringSnapshot({ socketPath, webgenRoot }),
    ]);

    expect(first).toEqual(second);
    expect(requestCounts.get("/version")).toBe(1);
    expect(
      [...requestCounts.entries()]
        .filter(([requestPath]) => requestPath.includes("/containers/"))
        .reduce((total, [, count]) => total + count, 0),
    ).toBe(10);
  });

  it("reports live state and bounded CPU/memory metrics for core services and generated apps", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dck-monitoring-"));
    tempDirs.push(root);
    const webgenRoot = path.join(root, "webgen");
    mkdirSync(webgenRoot);
    const { socketPath } = await startDockerMock(webgenRoot);

    const snapshot = await getDckMonitoringSnapshot({
      socketPath,
      webgenRoot,
      now: () => new Date("2026-10-07T20:00:00Z"),
    });

    expect(snapshot.docker).toEqual({
      available: true,
      version: "27.0.3",
      apiVersion: "1.45",
    });
    expect(snapshot.serverTime).toBe("2026-10-07T20:00:00.000Z");
    expect(snapshot.services).toMatchObject([
      {
        id: "canvas",
        status: "running",
        health: "healthy",
        container: { cpuPercent: 40 },
      },
      {
        id: "postgres",
        status: "running",
        health: "healthy",
        container: { cpuPercent: 40 },
      },
      {
        id: "beszel",
        status: "running",
        health: "healthy",
        container: { cpuPercent: 40 },
      },
    ]);
    expect(snapshot.applications).toEqual([
      {
        id: "storefront",
        name: "Storefront",
        port: 3005,
        expectedStatus: "running",
        status: "running",
        health: "healthy",
        container: {
          id: CONTAINER_ID.slice(0, 12),
          status: "running",
          health: "healthy",
          startedAt: "2026-10-07T10:00:00Z",
          restartCount: 2,
          cpuPercent: 40,
          memoryUsageBytes: 9 * 1024 * 1024,
          memoryLimitBytes: 50 * 1024 * 1024,
        },
      },
    ]);
  });

  it("discovers custom modules and returns bounded file metadata without reading contents", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dck-monitoring-workspace-"));
    tempDirs.push(root);
    const webgenRoot = path.join(root, "webgen");
    mkdirSync(webgenRoot);
    mkdirSync(path.join(root, "research", "reports"), { recursive: true });
    mkdirSync(path.join(root, "custom-work", "exports"), { recursive: true });
    mkdirSync(path.join(root, ".dck"), { recursive: true });
    writeFileSync(
      path.join(root, "research", "reports", "brief.md"),
      "sensitive research body must not enter the snapshot",
    );
    writeFileSync(
      path.join(root, "custom-work", "exports", "summary.json"),
      "sensitive custom module body must not enter the snapshot",
    );
    writeFileSync(
      path.join(root, ".dck", "modules.json"),
      JSON.stringify({
        modules: [
          { id: "custom", name: "Custom Reports", slug: "custom-work" },
        ],
      }),
    );
    const { socketPath } = await startDockerMock(webgenRoot);

    const snapshot = await getDckMonitoringSnapshot({
      socketPath,
      webgenRoot,
      workspaceRoot: root,
    });

    expect(snapshot.workspaceModules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "research",
          slug: "research",
          artifactCount: 1,
          recentArtifacts: [
            expect.objectContaining({ path: "reports/brief.md" }),
          ],
        }),
        expect.objectContaining({
          id: "custom",
          slug: "custom-work",
          name: "Custom Reports",
          artifactCount: 1,
          recentArtifacts: [
            expect.objectContaining({ path: "exports/summary.json" }),
          ],
        }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain("sensitive research body");
    expect(JSON.stringify(snapshot)).not.toContain(
      "sensitive custom module body",
    );
  });

  it("caps workspace file scans and flags truncated module inventories", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dck-monitoring-bounded-"));
    tempDirs.push(root);
    const webgenRoot = path.join(root, "webgen");
    mkdirSync(webgenRoot);
    const analyticsRoot = path.join(root, "analytics");
    mkdirSync(analyticsRoot);
    for (let index = 0; index < 110; index += 1) {
      writeFileSync(path.join(analyticsRoot, `output-${index}.txt`), "x");
    }
    const { socketPath } = await startDockerMock(webgenRoot);

    const snapshot = await getDckMonitoringSnapshot({
      socketPath,
      webgenRoot,
      workspaceRoot: root,
    });

    const analytics = snapshot.workspaceModules.find(
      (module: { slug: string }) => module.slug === "analytics",
    );
    expect(analytics?.artifactCount).toBe(100);
    expect(analytics?.truncated).toBe(true);
  });

  it("keeps core/workspace monitoring available when Docker cannot be reached", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dck-monitoring-offline-"));
    tempDirs.push(root);
    const webgenRoot = path.join(root, "webgen");
    mkdirSync(webgenRoot);
    makeApp(webgenRoot, "storefront", "running");
    mkdirSync(path.join(root, "research"), { recursive: true });
    writeFileSync(path.join(root, "research", "brief.md"), "metadata only");

    const snapshot = await getDckMonitoringSnapshot({
      socketPath: path.join(root, "missing-docker.sock"),
      webgenRoot,
      workspaceRoot: root,
    });

    expect(snapshot.docker.available).toBe(false);
    expect(
      snapshot.services.every(
        (service: { status: string }) => service.status === "unknown",
      ),
    ).toBe(true);
    expect(snapshot.applications[0]).toMatchObject({ status: "unknown" });
    expect(
      snapshot.workspaceModules.find(
        (module: { slug: string; artifactCount: number }) =>
          module.slug === "research",
      )?.artifactCount,
    ).toBe(1);
  });

  it("surfaces an unhealthy Docker health check without losing its live process state", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dck-monitoring-health-"));
    tempDirs.push(root);
    const webgenRoot = path.join(root, "webgen");
    mkdirSync(webgenRoot);
    const { socketPath } = await startDockerMock(webgenRoot, {
      health: "unhealthy",
    });

    const snapshot = await getDckMonitoringSnapshot({ socketPath, webgenRoot });

    expect(snapshot.applications[0]).toMatchObject({
      status: "running",
      health: "unhealthy",
    });
  });

  it("marks an expected-running app missing when its Compose container is absent", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dck-monitoring-missing-"));
    tempDirs.push(root);
    const webgenRoot = path.join(root, "webgen");
    mkdirSync(webgenRoot);
    const { socketPath } = await startDockerMock(webgenRoot, {
      includeContainer: false,
    });

    const snapshot = await getDckMonitoringSnapshot({ socketPath, webgenRoot });

    expect(snapshot.applications[0]).toMatchObject({
      id: "storefront",
      status: "missing",
      container: null,
    });
  });

  it("returns an empty app list when the Webgen folder has not been created", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "dck-monitoring-empty-"));
    tempDirs.push(root);
    const socketPath = path.join(root, "docker.sock");
    const server = createServer((req, res) => {
      if (req.url === "/version") {
        sendJson(res, { ApiVersion: "1.45", Version: "27.0.3" });
        return;
      }
      sendJson(res, []);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    servers.push(server);

    const snapshot = await getDckMonitoringSnapshot({
      socketPath,
      webgenRoot: path.join(root, "not-created"),
    });

    expect(snapshot.applications).toEqual([]);
  });

  it("rejects non-GET methods before touching the Docker socket", async () => {
    const req = { method: "POST" } as import("node:http").IncomingMessage;
    const headers: Record<string, string> = {};
    let status = 0;
    let body = "";
    const res = {
      writeHead(code: number, values: Record<string, string>) {
        status = code;
        Object.assign(headers, values);
        return this;
      },
      setHeader(name: string, value: string) {
        headers[name] = value;
        return this;
      },
      end(value?: string | Buffer) {
        body = value?.toString() ?? "";
      },
    } as unknown as import("node:http").ServerResponse;

    await handleDckMonitoringRequest(req, res, {
      socketPath: "/path/that/does/not/exist/docker.sock",
      webgenRoot: "/path/that/does/not/exist/webgen",
    });

    expect(status).toBe(405);
    expect(headers.Allow).toBe("GET");
    expect(body).toContain("Method not allowed");
  });

  it("ships the monitoring module in the production runtime image", () => {
    const dockerfile = readFileSync(
      path.resolve(process.cwd(), "docker/Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toContain(
      "COPY scripts/dck-monitoring.mjs /opt/agent-canvas/dck-monitoring.mjs",
    );
  });
});
