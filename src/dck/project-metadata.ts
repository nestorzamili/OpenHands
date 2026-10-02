export interface DckProjectMeta {
  name: string | null;
  port: number | null;
  stack: string | null;
  url: string | null;
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

  return {
    name,
    port,
    stack,
    url: projectUrlForPort(port),
  };
}
