import { describe, expect, it } from "vitest";
import { buildWebgenLifecycleCommand } from "#/dck/webgen-lifecycle";

const ctx = { appName: "shop", port: 3100 };

describe("buildWebgenLifecycleCommand", () => {
  it("deploy builds up -d --build with verification at the port", () => {
    const cmd = buildWebgenLifecycleCommand("deploy", ctx);
    expect(cmd).toContain("cd webgen/shop");
    expect(cmd).toContain("docker compose up -d --build");
    expect(cmd).toContain("docker compose ps");
    expect(cmd).toContain("docker compose logs -n 50 app");
    expect(cmd).toContain("curl -s http://localhost:3100/");
    // Instructs the agent to record the verified status for the portal badge.
    expect(cmd).toContain("webgen/shop/.dck.json");
    expect(cmd).toContain('"lastStatus" to "running"');
    expect(cmd).toContain("lastCheckedAt");
  });

  it("rebuild does a clean restart: down then up -d --build", () => {
    const cmd = buildWebgenLifecycleCommand("rebuild", ctx);
    expect(cmd).toContain("cd webgen/shop");
    expect(cmd).toContain(
      "docker compose down && docker compose up -d --build",
    );
    expect(cmd).toContain("curl -s http://localhost:3100/");
    expect(cmd).toContain('"lastStatus" to "running"');
  });

  it("stop builds docker compose down (no volumes) and records stopped status", () => {
    const cmd = buildWebgenLifecycleCommand("stop", ctx);
    expect(cmd).toContain("cd webgen/shop");
    expect(cmd).toContain("docker compose down");
    expect(cmd).not.toContain("-v");
    expect(cmd).not.toContain("--rmi");
    expect(cmd).toContain('"lastStatus" to "stopped"');
  });

  it("delete builds the destructive down -v --rmi local with a warning", () => {
    const cmd = buildWebgenLifecycleCommand("delete", ctx);
    expect(cmd).toContain("docker compose down -v --rmi local");
    expect(cmd.toLowerCase()).toContain("destructive");
  });

  it("falls back to a port placeholder when port is null", () => {
    const cmd = buildWebgenLifecycleCommand("deploy", {
      appName: "shop",
      port: null,
    });
    expect(cmd).toContain("http://localhost:<port>/");
  });
});
