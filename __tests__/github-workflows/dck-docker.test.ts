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
    const dockerfile = read("docker/Dockerfile");

    expect(workflow).toContain("file: docker/Dockerfile");
    expect(workflow).toContain("push: true");
    expect(workflow).toContain(
      "AGENT_CANVAS_VERSION=${{ steps.config.outputs.agent_canvas_version }}",
    );
    expect(workflow).toContain("VITE_DEFAULT_BACKEND_NAME=Production");
    expect(dockerfile).toContain('ARG VITE_DEFAULT_BACKEND_NAME=""');
    expect(dockerfile).toContain(
      "ENV VITE_DEFAULT_BACKEND_NAME=${VITE_DEFAULT_BACKEND_NAME}",
    );
    expect(workflow).toContain("AGENT_CANVAS_VERSION");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("keeps the WebGen master key outside the writable Canvas config mount", () => {
    const compose = read("docker-compose.yml");
    const service = read("services/webgen-control/webgen-control.service");
    const deploy = read("scripts/dck-deploy.sh");

    expect(compose).toContain("./config:/home/openhands/.openhands");
    expect(compose).not.toContain("webgen-control.key");
    expect(service).toContain(
      "WEBGEN_CONTROL_KEY=/var/lib/dck-webgen-control/webgen-control.key",
    );
    expect(service).toContain("RuntimeDirectory=dck-webgen-control");
    expect(service).not.toContain("/opt/dck-agentic/config");
    expect(deploy).toContain('LEGACY_WEBGEN_KEY="$TARGET_DIR/config/webgen-control.key"');
    expect(deploy).toContain('cmp -s "$KEY_TMP" "$LEGACY_WEBGEN_KEY"');
    expect(deploy).toContain('chmod 600 "$WEBGEN_KEY"');
  });
});
