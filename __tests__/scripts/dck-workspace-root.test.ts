// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getLocalDckWorkspaceRoot } from "../../scripts/dck-workspace-root.mjs";
import { buildFrontendEnv } from "../../scripts/static-build.mjs";

const directories: string[] = [];
function packageRoot() {
  const root = mkdtempSync(join(tmpdir(), "dck-workspace-root-"));
  directories.push(root);
  return root;
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local DCK workspace root", () => {
  it("uses the source checkout's existing tracked workspace for build and runtime", () => {
    const canvasPath = packageRoot();
    const workspace = join(canvasPath, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "AGENTS.md"), "# Local workspace\n");
    const config = { canvasPath, viteWorkingDir: "/user/workspaces" };

    expect(getLocalDckWorkspaceRoot(config, {})).toBe(workspace);
    expect(buildFrontendEnv(config, {}).VITE_DCK_WORKSPACE_ROOT).toBe(
      workspace,
    );
  });

  it("reuses the Agent Server workspace when npm did not ship workspace assets", () => {
    const config = {
      canvasPath: packageRoot(),
      viteWorkingDir: "/user/workspaces",
    };

    expect(getLocalDckWorkspaceRoot(config, {})).toBe(config.viteWorkingDir);
    expect(buildFrontendEnv(config, {}).VITE_DCK_WORKSPACE_ROOT).toBe(
      config.viteWorkingDir,
    );
  });

  it("falls back to the backend state directory rather than the package directory", () => {
    const config = {
      canvasPath: packageRoot(),
      stateDir: "/user/canvas-state",
    };
    expect(getLocalDckWorkspaceRoot(config, {})).toBe(
      join(config.stateDir, "workspaces"),
    );
  });

  it("preserves an explicit backend-visible root, including Docker and filesystem root", () => {
    const config = {
      canvasPath: packageRoot(),
      viteWorkingDir: "/user/workspaces",
    };
    for (const root of ["/projects", "/"]) {
      expect(
        getLocalDckWorkspaceRoot(config, {
          VITE_DCK_WORKSPACE_ROOT: ` ${root} `,
        }),
      ).toBe(root);
    }
  });
});
