/**
 * App runtime status the agent writes into `.dck.json` after a lifecycle
 * action (deploy/rebuild/stop) verifies the container with `docker compose ps`
 * + a health check. The frontend cannot talk to the Docker daemon, so this
 * agent-written snapshot — not the browser — is the source of truth for
 * whether the app is actually up. `null` means never verified yet.
 */
export type DckAppRuntimeStatus = "running" | "stopped" | "error";

export interface DckProjectMeta {
  name: string | null;
  port: number | null;
  stack: string | null;
  url: string | null;
  previewPath: string | null;
  subdomain: string | null;
  lastStatus: DckAppRuntimeStatus | null;
  lastCheckedAt: string | null;
}

const RUNTIME_STATUSES: readonly DckAppRuntimeStatus[] = [
  "running",
  "stopped",
  "error",
];

function coerceRuntimeStatus(value: unknown): DckAppRuntimeStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (RUNTIME_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as DckAppRuntimeStatus)
    : null;
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function coercePort(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function projectUrlForPort(port: number | null): string | null {
  return port === null ? null : `http://localhost:${port}`;
}

function normalizePreviewPath(previewPath: string | null): string | null {
  if (previewPath === null) return null;
  const trimmed = previewPath.trim();
  if (trimmed.length === 0) return null;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

function normalizeOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const trimmed = origin.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

export function buildPreviewUrl(
  previewPath: string | null,
  origin: string | null,
): string | null {
  const path = normalizePreviewPath(previewPath);
  const base = normalizeOrigin(origin);
  if (!path || !base) return null;
  return `${base}${path}`;
}

export function buildPublishedUrl(subdomain: string | null): string | null {
  if (subdomain === null) return null;
  const trimmed = subdomain.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  return `https://${trimmed}/`;
}

export function parseDckProjectMeta(raw: string | null): DckProjectMeta | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const name = coerceString(record.name);
  const port = coercePort(record.port);
  const stack = coerceString(record.stack);
  const previewPath = coerceString(record.previewPath);
  const subdomain = coerceString(record.subdomain);
  const lastStatus = coerceRuntimeStatus(record.lastStatus);
  const lastCheckedAt = coerceString(record.lastCheckedAt);

  return {
    name,
    port,
    stack,
    url: projectUrlForPort(port),
    previewPath,
    subdomain,
    lastStatus,
    lastCheckedAt,
  };
}
