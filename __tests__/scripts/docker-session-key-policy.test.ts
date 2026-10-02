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
const blockStart = "# >>> docker-session-key-policy";
const blockEnd = "# <<< docker-session-key-policy";

function sessionKeyPolicyBlock(): string {
  const start = entrypoint.indexOf(blockStart);
  const end = entrypoint.indexOf(blockEnd);
  if (start === -1 || end === -1) {
    throw new Error("Docker session-key policy markers are missing");
  }
  return entrypoint.slice(start, end);
}

function resolveStaticServerArgs(
  allowLanSessionKey: string | undefined,
  publicMode?: string,
  portalAuth?: string,
): {
  args: string[];
  authArgs: string[];
  portalArgs: string[];
  injectSessionKey: string;
  stderr: string;
} {
  const script = [
    "set -uo pipefail",
    "PORT=8000",
    "log() { printf '%s\\n' \"$*\" >&2; }",
    sessionKeyPolicyBlock(),
    'printf "ARGS:%s\\n" "${STATIC_SERVER_SESSION_KEY_ARGS[*]}"',
    'printf "AUTH:%s\\n" "${STATIC_SERVER_AUTH_ARGS[*]}"',
    'printf "PORTAL:%s\\n" "${PORTAL_AUTH_ARGS[*]}"',
    'printf "INJECT:%s\\n" "$INJECT_SESSION_KEY"',
  ].join("\n");
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (allowLanSessionKey !== undefined) {
    env.AGENT_CANVAS_ALLOW_LAN_SESSION_KEY = allowLanSessionKey;
  }
  if (publicMode !== undefined) {
    env.AGENT_CANVAS_PUBLIC = publicMode;
  }
  if (portalAuth !== undefined) {
    env.AGENT_CANVAS_PORTAL_AUTH = portalAuth;
  }
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf-8",
    env,
  });
  expect(result.status).toBe(0);
  const line = (prefix: string) =>
    result.stdout
      .split("\n")
      .find((l) => l.startsWith(prefix))
      ?.slice(prefix.length) ?? "";
  const argsStr = line("ARGS:");
  const authStr = line("AUTH:");
  const portalStr = line("PORTAL:");
  return {
    args: argsStr ? argsStr.split(" ") : [],
    authArgs: authStr ? authStr.split(" ") : [],
    portalArgs: portalStr ? portalStr.split(" ") : [],
    injectSessionKey: line("INJECT:"),
    stderr: result.stderr,
  };
}

describe("Docker session-key injection policy", () => {
  it("does not inject the key by default", () => {
    const r = resolveStaticServerArgs(undefined);
    expect(r.args).toEqual([]);
    expect(r.authArgs).toEqual([]);
    expect(r.injectSessionKey).toBe("true");
  });

  it("requires an explicit true value and warns when enabled", () => {
    expect(resolveStaticServerArgs("1").args).toEqual([]);

    const enabled = resolveStaticServerArgs("true");
    expect(enabled.args).toEqual(["--allow-lan-session-key"]);
    expect(enabled.stderr).toContain("WARNING");
    expect(enabled.stderr).toContain("host loopback only");
  });

  it("forces auth-required and skips key injection in public mode", () => {
    const pub = resolveStaticServerArgs(undefined, "true");
    expect(pub.authArgs).toEqual(["--auth-required"]);
    expect(pub.args).toEqual([]);
    expect(pub.injectSessionKey).toBe("false");
  });

  it("ignores allow-lan-session-key in public mode (never injects)", () => {
    const pub = resolveStaticServerArgs("true", "true");
    expect(pub.authArgs).toEqual(["--auth-required"]);
    expect(pub.args).toEqual([]);
    expect(pub.injectSessionKey).toBe("false");
    expect(pub.stderr).toContain("ignored in public mode");
  });

  it("enables portal auth and still injects the session key (gated by login)", () => {
    const portal = resolveStaticServerArgs(
      undefined,
      undefined,
      "/data/auth.json",
    );
    expect(portal.portalArgs).toEqual(["--portal-auth", "/data/auth.json"]);
    expect(portal.args).toEqual([]);
    // Portal replaces the API-key entry screen, so --auth-required is absent…
    expect(portal.authArgs).toEqual([]);
    // …but the key is injected: the login gate ensures only authenticated
    // users receive the HTML, and the frontend needs the key for /api calls.
    expect(portal.injectSessionKey).toBe("true");
  });

  it("portal auth takes precedence over public mode, with a warning", () => {
    const portal = resolveStaticServerArgs("true", "true", "/data/auth.json");
    expect(portal.portalArgs).toEqual(["--portal-auth", "/data/auth.json"]);
    expect(portal.authArgs).toEqual([]);
    expect(portal.args).toEqual([]);
    expect(portal.injectSessionKey).toBe("true");
    expect(portal.stderr).toContain("AGENT_CANVAS_PUBLIC is ignored");
  });
});
