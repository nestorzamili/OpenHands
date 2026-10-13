export type DckAppRuntimeStatus = "running" | "stopped" | "error";

export interface DckProjectMeta {
  name: string | null;
  port: number | null;
  stack: string | null;
  authProvider?: string | null;
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

function normalizeOrigin(origin: string | null): URL | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

export function buildPreviewUrl(
  previewPath: string | null,
  origin: string | null,
): string | null {
  const path = previewPath?.trim().replace(/^\/?/, "/").replace(/\/$/, "");
  const base = normalizeOrigin(origin);
  if (!path || !base || !/^\/preview\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path))
    return null;
  return `${base.origin}${path}`;
}

export function buildPublishedUrl(subdomain: string | null): string | null {
  const host = subdomain?.trim().toLowerCase().replace(/\/$/, "");
  if (
    !host ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.dckautoposting\.com$/.test(host)
  )
    return null;
  return `https://${host}/`;
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
  const authProvider = coerceString(record.authProvider)?.toLowerCase() ?? null;
  const previewPath = coerceString(record.previewPath);
  const subdomain = coerceString(record.subdomain);
  const lastStatus = coerceRuntimeStatus(record.lastStatus);
  const lastCheckedAt = coerceString(record.lastCheckedAt);

  return {
    name,
    port,
    stack,
    authProvider,
    previewPath,
    subdomain,
    lastStatus,
    lastCheckedAt,
  };
}
