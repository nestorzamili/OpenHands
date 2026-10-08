import { request as httpRequest } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { lstat, opendir, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const DCK_MONITORING_PATH = "/__dck/monitoring";
const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";
const MAX_WEBGEN_APPS = 100;
const DOCKER_REQUEST_TIMEOUT_MS = 4000;
const MAX_DOCKER_RESPONSE_BYTES = 5 * 1024 * 1024;
const SNAPSHOT_CACHE_TTL_MS = 5_000;
const MAX_SNAPSHOT_CACHE_ENTRIES = 4;
const CONTAINER_DETAIL_CACHE_TTL_MS = 60_000;
const MAX_CONTAINER_CACHE_ENTRIES = 512;
const MAX_CUSTOM_MODULES = 50;
const MAX_WORKSPACE_SCAN_ENTRIES = 100;
const MAX_RECENT_ARTIFACTS = 8;
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";
const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
const COMPOSE_WORKING_DIR_LABEL = "com.docker.compose.project.working_dir";
const BUILTIN_WORKSPACE_MODULES = [
  { id: "research", name: "Research", slug: "research" },
  { id: "analytics", name: "Analytics", slug: "analytics" },
  { id: "content", name: "Content", slug: "content" },
];
const CORE_DCK_SERVICES = [
  {
    id: "canvas",
    name: "Canvas / Agent Server / Automation",
    containerName: "dck-agentic-canvas",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    containerName: "dck-agentic-postgres",
  },
  {
    id: "beszel",
    name: "Beszel Hub",
    containerName: "dck-agentic-beszel",
  },
];

const containerInspectCache = new Map();
const inFlightContainerInspects = new Map();
const containerStatsCache = new Map();
const inFlightContainerStats = new Map();

export function isValidSessionApiKey(configuredKey, suppliedKey) {
  return (
    typeof configuredKey === "string" &&
    configuredKey.length > 0 &&
    typeof suppliedKey === "string" &&
    Buffer.byteLength(configuredKey) === Buffer.byteLength(suppliedKey) &&
    timingSafeEqual(Buffer.from(configuredKey), Buffer.from(suppliedKey))
  );
}

function dockerJson(socketPath, requestPath) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath,
        path: requestPath,
        method: "GET",
        headers: { Accept: "application/json" },
        timeout: DOCKER_REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (Buffer.byteLength(body, "utf8") > MAX_DOCKER_RESPONSE_BYTES) {
            req.destroy(new Error("Docker response exceeded the size limit"));
          }
        });
        res.on("end", () => {
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            reject(new Error(`Docker Engine returned HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Docker Engine returned invalid JSON"));
          }
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("Docker Engine request timed out")),
    );
    req.on("error", reject);
    req.end();
  });
}

async function cachedDockerJson(cache, inFlight, key, loader) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = Promise.resolve().then(loader);
  inFlight.set(key, request);
  try {
    const value = await request;
    cache.set(key, {
      value,
      expiresAt: Date.now() + CONTAINER_DETAIL_CACHE_TTL_MS,
    });
    if (cache.size > MAX_CONTAINER_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    return value;
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
}

function normalizeAppName(value, fallback) {
  if (typeof value !== "string") return fallback;
  const name = value.trim();
  return name.length > 0 ? name : fallback;
}

function readPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

async function readWebgenApps(webgenRoot) {
  let entries;
  try {
    entries = await readdir(webgenRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const apps = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || apps.length >= MAX_WEBGEN_APPS) continue;
    const projectDir = path.resolve(webgenRoot, entry.name);
    try {
      const [rawMeta, composeStat] = await Promise.all([
        readFile(path.join(projectDir, ".dck.json"), "utf8"),
        readFile(path.join(projectDir, "docker-compose.yml"), "utf8"),
      ]);
      // Requiring both files limits discovery to generated Webgen compose apps.
      if (!composeStat.trim()) continue;
      const meta = JSON.parse(rawMeta);
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) continue;
      apps.push({
        id: entry.name,
        name: normalizeAppName(meta.name, entry.name),
        port: readPort(meta.port),
        expectedStatus: ["running", "stopped", "error"].includes(
          meta.lastStatus,
        )
          ? meta.lastStatus
          : null,
        projectDir,
      });
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return apps.sort((left, right) => left.name.localeCompare(right.name));
}

async function readCustomWorkspaceModules(workspaceRoot) {
  const configPath = path.join(workspaceRoot, ".dck", "modules.json");
  try {
    const info = await lstat(configPath);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 256 * 1024) {
      return [];
    }
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.modules)
        ? parsed.modules
        : [];
    const reservedSlugs = new Set(
      BUILTIN_WORKSPACE_MODULES.map((module) => module.slug),
    );
    const seenSlugs = new Set(reservedSlugs);
    const modules = [];
    for (const entry of list) {
      if (modules.length >= MAX_CUSTOM_MODULES) break;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const { id, name, slug } = entry;
      if (
        typeof id !== "string" ||
        typeof name !== "string" ||
        typeof slug !== "string"
      ) {
        continue;
      }
      const normalizedSlug = slug.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalizedSlug)) continue;
      if (seenSlugs.has(normalizedSlug)) continue;
      const normalizedName = name.trim().slice(0, 64);
      if (!normalizedName) continue;
      seenSlugs.add(normalizedSlug);
      modules.push({
        id: id.trim().slice(0, 128) || normalizedSlug,
        name: normalizedName,
        slug: normalizedSlug,
      });
    }
    return modules;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return [];
    return [];
  }
}

async function readDirectoryBounded(directory, limit) {
  const handle = await opendir(directory);
  const entries = [];
  let truncated = false;
  for await (const entry of handle) {
    if (entries.length >= limit) {
      truncated = true;
      break;
    }
    entries.push(entry);
  }
  return { entries, truncated };
}

async function scanWorkspaceModule(workspaceRoot, module) {
  const root = path.resolve(workspaceRoot);
  const moduleRoot = path.resolve(root, module.slug);
  const moduleRelativePath = path.relative(root, moduleRoot);
  if (
    !moduleRelativePath ||
    moduleRelativePath.startsWith("..") ||
    path.isAbsolute(moduleRelativePath)
  ) {
    return {
      ...module,
      artifactCount: 0,
      latestArtifactAt: null,
      recentArtifacts: [],
      truncated: false,
      scanError: true,
    };
  }

  try {
    const info = await lstat(moduleRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return {
        ...module,
        artifactCount: 0,
        latestArtifactAt: null,
        recentArtifacts: [],
        truncated: false,
        scanError: true,
      };
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ...module,
        artifactCount: 0,
        latestArtifactAt: null,
        recentArtifacts: [],
        truncated: false,
        scanError: false,
      };
    }
    return {
      ...module,
      artifactCount: 0,
      latestArtifactAt: null,
      recentArtifacts: [],
      truncated: false,
      scanError: true,
    };
  }

  const pendingDirectories = [{ directory: moduleRoot, depth: 0 }];
  const artifacts = [];
  let scannedEntries = 0;
  let truncated = false;

  try {
    while (pendingDirectories.length > 0) {
      if (scannedEntries >= MAX_WORKSPACE_SCAN_ENTRIES) {
        truncated = true;
        break;
      }
      const current = pendingDirectories.shift();
      const remaining = MAX_WORKSPACE_SCAN_ENTRIES - scannedEntries;
      const result = await readDirectoryBounded(
        current.directory,
        remaining + 1,
      );
      const entries = result.entries.slice(0, remaining);
      if (result.truncated || result.entries.length > remaining)
        truncated = true;

      for (const entry of entries) {
        scannedEntries += 1;
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const filePath = path.resolve(current.directory, entry.name);
        const relativeToRoot = path.relative(root, filePath);
        if (
          !relativeToRoot ||
          relativeToRoot.startsWith("..") ||
          path.isAbsolute(relativeToRoot)
        ) {
          continue;
        }
        if (entry.isDirectory()) {
          if (current.depth === 0) {
            pendingDirectories.push({ directory: filePath, depth: 1 });
          } else {
            truncated = true;
          }
          continue;
        }
        if (!entry.isFile()) continue;

        try {
          const fileInfo = await lstat(filePath);
          if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) continue;
          artifacts.push({
            path: path.relative(moduleRoot, filePath),
            modifiedAt: fileInfo.mtime.toISOString(),
            sizeBytes: fileInfo.size,
          });
        } catch {
          // A file may be removed while the bounded metadata scan is running.
        }
      }
      if (result.truncated || result.entries.length > remaining) break;
    }
  } catch {
    return {
      ...module,
      artifactCount: artifacts.length,
      latestArtifactAt: null,
      recentArtifacts: [],
      truncated,
      scanError: true,
    };
  }

  artifacts.sort(
    (left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt),
  );
  return {
    ...module,
    artifactCount: artifacts.length,
    latestArtifactAt: artifacts[0]?.modifiedAt ?? null,
    recentArtifacts: artifacts.slice(0, MAX_RECENT_ARTIFACTS),
    truncated,
    scanError: false,
  };
}

async function readWorkspaceModules(workspaceRoot) {
  let root;
  try {
    root = path.resolve(workspaceRoot);
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return [];
  } catch {
    return [];
  }

  const customModules = await readCustomWorkspaceModules(root);
  const modules = [...BUILTIN_WORKSPACE_MODULES, ...customModules];
  return mapWithConcurrency(modules, 4, (module) =>
    scanWorkspaceModule(root, module),
  );
}

function normalizedComposeProjectName(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function containerBelongsToApp(container, app) {
  const labels = container.Labels ?? {};
  if (labels[COMPOSE_SERVICE_LABEL] !== "app") return false;
  const workingDir = labels[COMPOSE_WORKING_DIR_LABEL];
  if (
    typeof workingDir === "string" &&
    path.resolve(workingDir) === app.projectDir
  ) {
    return true;
  }
  return (
    normalizedComposeProjectName(labels[COMPOSE_PROJECT_LABEL]) ===
    normalizedComposeProjectName(app.id)
  );
}

function toBytes(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function calculateCpuPercent(stats) {
  const cpu = stats?.cpu_stats;
  const previous = stats?.precpu_stats;
  const cpuDelta =
    cpu?.cpu_usage?.total_usage - previous?.cpu_usage?.total_usage;
  const systemDelta = cpu?.system_cpu_usage - previous?.system_cpu_usage;
  const cpuCount =
    cpu?.online_cpus ?? cpu?.cpu_usage?.percpu_usage?.length ?? 0;
  if (
    !Number.isFinite(cpuDelta) ||
    !Number.isFinite(systemDelta) ||
    cpuDelta <= 0 ||
    systemDelta <= 0 ||
    cpuCount <= 0
  ) {
    return null;
  }
  return Math.round((cpuDelta / systemDelta) * cpuCount * 1000) / 10;
}

function calculateMemory(stats) {
  const usage = stats?.memory_stats?.usage;
  const limit = stats?.memory_stats?.limit;
  if (!Number.isFinite(usage) || !Number.isFinite(limit) || limit <= 0) {
    return { usageBytes: null, limitBytes: null };
  }
  const cache =
    stats?.memory_stats?.stats?.cache ??
    stats?.memory_stats?.stats?.inactive_file ??
    0;
  return {
    usageBytes: toBytes(
      Math.max(0, usage - (Number.isFinite(cache) ? cache : 0)),
    ),
    limitBytes: toBytes(limit),
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function statusWithoutContainer(app) {
  if (app.expectedStatus === "running") return "missing";
  if (app.expectedStatus === "error") return "error";
  if (app.expectedStatus === "stopped") return "stopped";
  return "not_deployed";
}

async function summarizeContainer(socketPath, apiVersion, app, container) {
  const shortId = container.Id?.slice(0, 12) ?? null;
  const routePrefix = `/v${apiVersion}/containers/${encodeURIComponent(container.Id)}`;
  const cacheKey = `${socketPath}\0${container.Id}`;
  let inspect = null;
  try {
    inspect = await cachedDockerJson(
      containerInspectCache,
      inFlightContainerInspects,
      cacheKey,
      () => dockerJson(socketPath, `${routePrefix}/json`),
    );
  } catch {
    // List state remains useful if inspect or a healthcheck is temporarily unavailable.
  }
  const state = container.State ?? inspect?.State?.Status ?? "unknown";
  const healthFromList =
    typeof container.Status === "string"
      ? (container.Status.match(
          /\((healthy|unhealthy|starting)\)/i,
        )?.[1]?.toLowerCase() ?? null)
      : null;
  const health = healthFromList ?? inspect?.State?.Health?.Status ?? null;
  const status =
    state === "running"
      ? "running"
      : state === "restarting"
        ? "restarting"
        : state === "exited" || state === "dead"
          ? app.expectedStatus === "error"
            ? "error"
            : "stopped"
          : state === "paused"
            ? "stopped"
            : state === "created"
              ? "starting"
              : "error";

  let cpuPercent = null;
  let memoryUsageBytes = null;
  let memoryLimitBytes = null;
  if (state === "running") {
    try {
      const stats = await cachedDockerJson(
        containerStatsCache,
        inFlightContainerStats,
        cacheKey,
        () =>
          dockerJson(
            socketPath,
            `${routePrefix}/stats?stream=false&one-shot=true`,
          ),
      );
      cpuPercent = calculateCpuPercent(stats);
      const memory = calculateMemory(stats);
      memoryUsageBytes = memory.usageBytes;
      memoryLimitBytes = memory.limitBytes;
    } catch {
      // A brief stats failure should not hide container status or health.
    }
  }

  return {
    id: shortId,
    status,
    health,
    startedAt: inspect?.State?.StartedAt ?? null,
    restartCount: Number.isInteger(inspect?.RestartCount)
      ? inspect.RestartCount
      : null,
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
  };
}

async function collectDckMonitoringSnapshot({
  socketPath = DEFAULT_DOCKER_SOCKET,
  webgenRoot = "/projects/webgen",
  workspaceRoot = path.dirname(webgenRoot),
  now = () => new Date(),
} = {}) {
  const [applications, workspaceModules] = await Promise.all([
    readWebgenApps(webgenRoot).catch(() => []),
    readWorkspaceModules(workspaceRoot),
  ]);
  let docker = { available: false, version: null, apiVersion: null };
  let services = CORE_DCK_SERVICES.map((service) => ({
    ...service,
    status: "unknown",
    health: null,
    container: null,
  }));
  let summaries = applications.map((app) => ({
    id: app.id,
    name: app.name,
    port: app.port,
    expectedStatus: app.expectedStatus,
    status: "unknown",
    health: null,
    container: null,
  }));

  try {
    const version = await dockerJson(socketPath, "/version");
    const apiVersion =
      typeof version.ApiVersion === "string" &&
      /^\d+\.\d+$/.test(version.ApiVersion)
        ? version.ApiVersion
        : "1.41";
    const appsPath = `/v${apiVersion}/containers/json?all=1&filters=${encodeURIComponent(
      JSON.stringify({ label: [`${COMPOSE_SERVICE_LABEL}=app`] }),
    )}`;
    const servicesPath = `/v${apiVersion}/containers/json?all=1&filters=${encodeURIComponent(
      JSON.stringify({
        name: CORE_DCK_SERVICES.map((service) => service.containerName),
      }),
    )}`;
    const [appContainers, coreContainers] = await Promise.all([
      dockerJson(socketPath, appsPath),
      dockerJson(socketPath, servicesPath),
    ]);
    if (!Array.isArray(appContainers) || !Array.isArray(coreContainers)) {
      throw new Error("Docker Engine returned an invalid container list");
    }

    const [appSummaries, serviceSummaries] = await Promise.all([
      mapWithConcurrency(applications, 8, async (app) => {
        const container = appContainers.find((candidate) =>
          containerBelongsToApp(candidate, app),
        );
        if (!container) {
          return {
            id: app.id,
            name: app.name,
            port: app.port,
            expectedStatus: app.expectedStatus,
            status: statusWithoutContainer(app),
            health: null,
            container: null,
          };
        }
        const containerSummary = await summarizeContainer(
          socketPath,
          apiVersion,
          app,
          container,
        );
        return {
          id: app.id,
          name: app.name,
          port: app.port,
          expectedStatus: app.expectedStatus,
          status: containerSummary.status,
          health: containerSummary.health,
          container: containerSummary,
        };
      }),
      mapWithConcurrency(CORE_DCK_SERVICES, 2, async (service) => {
        const container = coreContainers.find((candidate) =>
          (candidate.Names ?? []).some(
            (name) => name.replace(/^\/+/, "") === service.containerName,
          ),
        );
        if (!container) {
          return {
            ...service,
            status: "missing",
            health: null,
            container: null,
          };
        }
        const containerSummary = await summarizeContainer(
          socketPath,
          apiVersion,
          { id: service.id, name: service.name, expectedStatus: "running" },
          container,
        );
        return {
          ...service,
          status: containerSummary.status,
          health: containerSummary.health,
          container: containerSummary,
        };
      }),
    ]);
    summaries = appSummaries;
    services = serviceSummaries;
    docker = {
      available: true,
      version: typeof version.Version === "string" ? version.Version : null,
      apiVersion,
    };
  } catch {
    // Preserve workspace and conversation monitoring when the daemon is down.
  }

  return {
    serverTime: now().toISOString(),
    docker,
    services,
    workspaceModules,
    applications: summaries,
  };
}

const snapshotCache = new Map();
const inFlightSnapshots = new Map();

export async function getDckMonitoringSnapshot(options = {}) {
  const socketPath = options.socketPath ?? DEFAULT_DOCKER_SOCKET;
  const webgenRoot = options.webgenRoot ?? "/projects/webgen";
  const workspaceRoot = options.workspaceRoot ?? path.dirname(webgenRoot);
  const cacheKey = JSON.stringify([socketPath, webgenRoot, workspaceRoot]);
  const cached = snapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const inFlight = inFlightSnapshots.get(cacheKey);
  if (inFlight) return inFlight;

  const snapshotPromise = collectDckMonitoringSnapshot({
    ...options,
    socketPath,
    webgenRoot,
    workspaceRoot,
  });
  inFlightSnapshots.set(cacheKey, snapshotPromise);
  try {
    const snapshot = await snapshotPromise;
    snapshotCache.set(cacheKey, {
      expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS,
      snapshot,
    });
    if (snapshotCache.size > MAX_SNAPSHOT_CACHE_ENTRIES) {
      const oldestKey = snapshotCache.keys().next().value;
      if (oldestKey !== undefined) snapshotCache.delete(oldestKey);
    }
    return snapshot;
  } finally {
    if (inFlightSnapshots.get(cacheKey) === snapshotPromise) {
      inFlightSnapshots.delete(cacheKey);
    }
  }
}

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

export async function handleDckMonitoringRequest(req, res, options = {}) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  try {
    const snapshot = await getDckMonitoringSnapshot(options);
    sendJson(res, 200, snapshot);
  } catch {
    sendJson(res, 503, { error: "Docker monitoring is unavailable" });
  }
}

export function resolveDefaultWebgenRoot(
  cwd = process.cwd(),
  env = process.env,
) {
  const configured = env.DCK_WEBGEN_ROOT?.trim();
  if (configured) return path.resolve(configured);
  const localWorkspace = path.resolve(cwd, "workspace", "webgen");
  return existsSync(localWorkspace) ? localWorkspace : "/projects/webgen";
}

export function resolveDefaultWorkspaceRoot(
  cwd = process.cwd(),
  env = process.env,
) {
  const configured = env.DCK_WORKSPACE_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return path.dirname(resolveDefaultWebgenRoot(cwd, env));
}
