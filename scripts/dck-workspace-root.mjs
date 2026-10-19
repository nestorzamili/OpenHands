import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve a local Agent Server-visible root, never a missing package asset. */
export function getLocalDckWorkspaceRoot(config, env = process.env) {
  const explicit = env.VITE_DCK_WORKSPACE_ROOT?.trim();
  if (explicit) return explicit;

  const checkoutWorkspace = join(config.canvasPath, "workspace");
  if (existsSync(join(checkoutWorkspace, "AGENTS.md"))) {
    return checkoutWorkspace;
  }

  // The npm package does not ship workspace/. Reuse the backend's writable
  // workspace instead of attempting writes inside a global npm installation.
  return (
    config.viteWorkingDir ||
    join(
      config.stateDir || join(homedir(), ".openhands", "agent-canvas"),
      "workspaces",
    )
  );
}
