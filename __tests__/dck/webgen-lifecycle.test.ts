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
  });

  it("rebuild does a clean restart: down then up -d --build", () => {
    const cmd = buildWebgenLifecycleCommand("rebuild", ctx);
    expect(cmd).toContain("cd webgen/shop");
    expect(cmd).toContain(
      "docker compose down && docker compose up -d --build",
    );
    expect(cmd).toContain("curl -s http://localhost:3100/");
  });

  it("stop builds docker compose down (no volumes)", () => {
    const cmd = buildWebgenLifecycleCommand("stop", ctx);
    expect(cmd).toContain("cd webgen/shop");
    expect(cmd).toContain("docker compose down");
    expect(cmd).not.toContain("-v");
    expect(cmd).not.toContain("--rmi");
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
