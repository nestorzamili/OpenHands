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
  /** Last agent-verified container state, or null if never deployed/checked. */
  lastStatus: DckAppRuntimeStatus | null;
  /** ISO timestamp of that verification, or null. */
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
  const lastStatus = coerceRuntimeStatus(record.lastStatus);
  const lastCheckedAt = coerceString(record.lastCheckedAt);

  return {
    name,
    port,
    stack,
    url: projectUrlForPort(port),
    lastStatus,
    lastCheckedAt,
  };
}
