// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf-8");
}

describe("package and DCK Docker configuration", () => {
  it("uses the canonical GitHub repository in release metadata", () => {
    const packageJson = JSON.parse(read("package.json"));
    const dockerfile = read("docker/Dockerfile");

    expect(packageJson.repository.url).toBe(
      "https://github.com/OpenHands/OpenHands",
    );
    expect(packageJson.homepage).toBe(
      "https://github.com/OpenHands/OpenHands#readme",
    );
    expect(packageJson.bugs.url).toBe(
      "https://github.com/OpenHands/OpenHands/issues",
    );
    expect(dockerfile).toContain(
      'LABEL org.opencontainers.image.source="https://github.com/OpenHands/OpenHands"',
    );
  });

  it("does not let electron-builder auto-publish during desktop builds", () => {
    const packageJson = JSON.parse(read("package.json"));

    expect(packageJson.scripts["build:desktop"]).toContain("--publish never");
    expect(packageJson.scripts["build:desktop:universal"]).toContain(
      "--publish never",
    );
  });

  it("builds and publishes the DCK image with the version from package metadata", () => {
    const packageJson = JSON.parse(read("package.json"));
    const workflow = read(".github/workflows/dck-docker.yml");

    expect(workflow).toContain("file: docker/Dockerfile");
    expect(workflow).toContain("push: true");
    expect(workflow).toContain(
      "AGENT_CANVAS_VERSION=${{ steps.config.outputs.agent_canvas_version }}",
    );
    expect(workflow).toContain("AGENT_CANVAS_VERSION");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
