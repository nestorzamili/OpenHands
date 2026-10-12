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
    expect(cmd).toContain("webgen/shop/.dck.json");
    expect(cmd).toContain('"lastStatus" to "running"');
    expect(cmd).toContain("lastCheckedAt");
  });

  it("rebuild does a clean restart: down then up -d --build", () => {
    const cmd = buildWebgenLifecycleCommand("rebuild", ctx);
    expect(cmd).toContain("cd webgen/shop");
    expect(cmd).toContain(
      "docker compose down --remove-orphans && docker compose up -d --build",
    );
    expect(cmd).toContain("curl -s http://localhost:3100/");
    expect(cmd).toContain('"lastStatus" to "running"');
  });

  it("starts without rebuilding after stop has removed the containers", () => {
    const cmd = buildWebgenLifecycleCommand("start", ctx);
    expect(cmd).toContain("docker compose up -d");
    expect(cmd).not.toContain("--build");
  });

  it("restarts without rebuilding and removes orphan containers first", () => {
    const cmd = buildWebgenLifecycleCommand("restart", ctx);
    expect(cmd).toContain(
      "docker compose down --remove-orphans && docker compose up -d",
    );
    expect(cmd).not.toContain("--build");
  });

  it("stop removes containers and orphans but keeps volumes and images", () => {
    const cmd = buildWebgenLifecycleCommand("stop", ctx);
    expect(cmd).toContain("cd webgen/shop");
    expect(cmd).toContain("docker compose down --remove-orphans");
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
