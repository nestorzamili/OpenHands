import { AgentServerClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import type { WebgenLifecycleAction } from "#/dck/webgen-lifecycle";

export type WebgenRuntimeStatus =
  | "running"
  | "stopped"
  | "error"
  | "starting"
  | "unknown";

export interface WebgenContainerStatus {
  id: string;
  name: string;
  state: string;
  health: string | null;
  exit_code: number | null;
}

export interface WebgenProjectStatus {
  slug: string;
  path: string;
  name: string | null;
  port: number | null;
  stack: string | null;
  auth_provider: string | null;
  preview_path: string | null;
  subdomain: string | null;
  status: WebgenRuntimeStatus;
  last_checked_at: string | null;
  containers: WebgenContainerStatus[];
}

export interface WebgenProjectsResponse {
  projects: WebgenProjectStatus[];
}

export interface WebgenLifecycleRequest {
  action: WebgenLifecycleAction;
  subdomain?: string;
  conversation_id?: string;
}

export interface WebgenLifecycleResponse {
  project: WebgenProjectStatus;
}

export class WebgenServiceError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super(
      status === 410
        ? "Owner credentials need to be entered again before deployment."
        : status === 409
          ? "This WebGen project is busy or its publish configuration conflicts."
          : status === 422
            ? "Check Settings → Secrets and add the required credentials for this app before deploying."
            : "The WebGen operation could not be completed. Please try again.",
    );
    this.name = "WebgenServiceError";
    this.status = status;
  }
}

function statusFromError(error: unknown): number | null {
  for (const status of [400, 401, 403, 404, 409, 410, 422, 429, 500, 503]) {
    if (isSdkHttpStatusError(error, status)) return status;
  }
  return null;
}

function getClient(timeout = 60_000) {
  return new AgentServerClient(getAgentServerClientOptions({ timeout }));
}

export async function fetchWebgenProjects(): Promise<WebgenProjectsResponse> {
  const client = getClient();
  try {
    return await client.get<WebgenProjectsResponse>("/api/webgen/projects");
  } catch (error) {
    throw new WebgenServiceError(statusFromError(error));
  } finally {
    client.close();
  }
}

export async function runWebgenLifecycleAction(
  projectSlug: string,
  request: WebgenLifecycleRequest,
): Promise<WebgenLifecycleResponse> {
  const client = getClient(16 * 60 * 1000);
  try {
    return await client.post<WebgenLifecycleResponse>(
      `/api/webgen/projects/${encodeURIComponent(projectSlug)}/actions`,
      request,
    );
  } catch (error) {
    throw new WebgenServiceError(statusFromError(error));
  } finally {
    client.close();
  }
}

export function isWebgenOwnerSeedReentryRequired(error: unknown): boolean {
  return error instanceof WebgenServiceError && error.status === 410;
}
