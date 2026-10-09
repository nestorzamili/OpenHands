import {
  getAgentServerBaseUrl,
  getAgentServerSessionApiKey,
  getCookieAuthCloudHost,
  getLockedCloudHost,
  isServerManagedBackend,
} from "../agent-server-config";
import type { Backend } from "./types";

/**
 * Stable id for the default local backend. In ordinary mode it is seeded when
 * the launcher provides a host and API key, then behaves like a normal
 * registered entry. Server-managed deployments keep this id pinned to the
 * Production backend configured by the server.
 */
export const SEEDED_DEFAULT_BACKEND_ID = "default-local";

export const DEFAULT_LOCAL_BACKEND_NAME = "Local";
const DEFAULT_SERVER_MANAGED_BACKEND_NAME = "Production";
export const LOCKED_CLOUD_BACKEND_ID = "locked-cloud";
export const LOCKED_CLOUD_BACKEND_NAME = "OpenHands Cloud";

export function makeLockedCloudBackend(): Backend | null {
  if (!getLockedCloudHost()) return null;

  const host = getCookieAuthCloudHost();
  if (!host) return null;

  return {
    id: LOCKED_CLOUD_BACKEND_ID,
    name: LOCKED_CLOUD_BACKEND_NAME,
    host,
    apiKey: "",
    kind: "cloud",
    authMode: "cookie",
  };
}

/**
 * Construct the default local backend from environment/runtime config.
 * Ordinary mode requires a backend location and API key; server-managed mode
 * uses the same-origin proxy and keeps the key outside the browser.
 *
 * Used as the seed entry written to `openhands-backends` on first load;
 * if it returns null, onboarding is responsible for collecting backend
 * connection details from the user.
 *
 * Returns null when the deployment is locked to a single OpenHands Cloud
 * host (`VITE_LOCK_TO_CLOUD` / `--lock-to-cloud`). In locked mode the user
 * can only authenticate against the configured Cloud URL, so seeding a
 * Local backend from a baked/injected session key would short-circuit the
 * first-run onboarding gate and strand the user on the Manage Backends
 * recovery modal with a disconnected Local entry.
 */
export function makeDefaultLocalBackend(): Backend | null {
  // Locked-to-Cloud deployments must never auto-seed a Local backend —
  // see the docblock above.
  if (getLockedCloudHost()) return null;

  const host = getAgentServerBaseUrl();
  if (host && isServerManagedBackend()) {
    const configuredName = import.meta.env.VITE_DEFAULT_BACKEND_NAME?.trim();
    return {
      id: SEEDED_DEFAULT_BACKEND_ID,
      name: configuredName || DEFAULT_SERVER_MANAGED_BACKEND_NAME,
      host,
      apiKey: "",
      kind: "local",
    };
  }

  const apiKey = getAgentServerSessionApiKey();

  if (!host || !apiKey) return null;

  const configuredName = import.meta.env.VITE_DEFAULT_BACKEND_NAME?.trim();

  return {
    id: SEEDED_DEFAULT_BACKEND_ID,
    name: configuredName || DEFAULT_LOCAL_BACKEND_NAME,
    host,
    apiKey,
    kind: "local",
  };
}
