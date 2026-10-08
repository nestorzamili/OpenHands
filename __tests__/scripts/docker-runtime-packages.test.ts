// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const dockerfilePath = path.join(repoRoot, "docker/Dockerfile");

function readDockerfile(): string {
  return readFileSync(dockerfilePath, "utf-8");
}

describe("Docker runtime package metadata", () => {
  it("keeps the Canvas snapshot at least as new as its agent-server base", () => {
    const match = readDockerfile().match(
      /^ARG DEBIAN_SNAPSHOT=(\d{8}T\d{6}Z)$/m,
    );

    expect(match?.[1]).toBeTruthy();
    expect(match?.[1].localeCompare("20260920T000000Z")).toBeGreaterThanOrEqual(
      0,
    );
  });

  it("applies security upgrades before installing automation", () => {
    const dockerfile = readDockerfile();
    const securityUpgrade = dockerfile.indexOf("apt-get upgrade");
    const automationInstall = dockerfile.indexOf('"openhands-automation==');

    expect(securityUpgrade).toBeGreaterThanOrEqual(0);
    expect(automationInstall).toBeGreaterThan(securityUpgrade);
  });

  it("does not retain PostgreSQL development packages at runtime", () => {
    const dockerfile = readDockerfile();

    expect(dockerfile).not.toMatch(/apt-get install[^;]*libpq(?:-dev|5)/s);
    expect(dockerfile).toContain('"pg8000==1.31.5"');
  });
});
