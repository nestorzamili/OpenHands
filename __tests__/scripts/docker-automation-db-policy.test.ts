// @vitest-environment node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const entrypoint = readFileSync(
  path.join(repoRoot, "docker/entrypoint.sh"),
  "utf-8",
);
const blockStart = "# >>> docker-automation-db-policy";
const blockEnd = "# <<< docker-automation-db-policy";

function automationDbPolicyBlock(): string {
  const start = entrypoint.indexOf(blockStart);
  const end = entrypoint.indexOf(blockEnd);
  if (start === -1 || end === -1) {
    throw new Error("Docker automation-db policy markers are missing");
  }
  return entrypoint.slice(start, end);
}

function runPolicyBlock(automationDbUrl: string | undefined): {
  status: number | null;
  stderr: string;
} {
  const script = [
    "set -uo pipefail",
    "log() { printf '%s\\n' \"$*\" >&2; }",
    "log_error() { printf '%s\\n' \"$*\" >&2; }",
    automationDbPolicyBlock(),
    "exit 0",
  ].join("\n");
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (automationDbUrl !== undefined) {
    env.AUTOMATION_DB_URL = automationDbUrl;
  }
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf-8",
    env,
  });
  return { status: result.status, stderr: result.stderr };
}

describe("Docker automation-db policy", () => {
  it("has no SQLite fallback left in the entrypoint", () => {
    expect(entrypoint).not.toContain("sqlite");
    expect(entrypoint).not.toContain("aiosqlite");
  });

  it("exits non-zero with guidance when AUTOMATION_DB_URL is unset", () => {
    const { status, stderr } = runPolicyBlock(undefined);
    expect(status).toBe(1);
    expect(stderr).toContain("AUTOMATION_DB_URL");
    expect(stderr).toContain("postgresql+asyncpg://");
  });

  it("rejects non-PostgreSQL drivers", () => {
    const { status } = runPolicyBlock("sqlite+aiosqlite:///tmp/automations.db");
    expect(status).toBe(1);
  });

  it("accepts postgresql+asyncpg URLs", () => {
    const { status } = runPolicyBlock(
      "postgresql+asyncpg://user:pass@localhost:5432/dck_agentic",
    );
    expect(status).toBe(0);
  });
});
