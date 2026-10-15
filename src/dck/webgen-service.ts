import { AgentServerClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import i18n from "#/i18n";
import { I18nKey } from "#/i18n/declaration";
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
  has_deployment?: boolean;
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

export interface WebgenRuntimeSecret {
  name: string;
  configured: true;
}

export interface WebgenLegacySecretCandidate {
  source_name: string;
  runtime_name: string;
  ambiguous: boolean;
  pending?: boolean;
}

export interface WebgenPendingSecretMigration {
  name: string;
  source_name: string;
}

export interface WebgenRuntimeSecretMigrationResponse {
  name: string;
  configured: boolean;
  source_removed: boolean;
  pending?: boolean;
}

export interface WebgenRuntimeSecretsResponse {
  project_id: string;
  secrets: WebgenRuntimeSecret[];
  pending_migrations: WebgenPendingSecretMigration[];
  migration_available: boolean;
  migration_candidates: WebgenLegacySecretCandidate[];
}

export class WebgenServiceError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(status: number | null, code: string | null = null) {
    super(
      code === "readiness_timeout" || code === "application_exited"
        ? i18n.t(I18nKey.DCK$WEBGEN_READINESS_FAILED)
        : code === "environment_manual_review_required"
          ? i18n.t(I18nKey.DCK$WEBGEN_ENVIRONMENT_REVIEW_REQUIRED)
          : code === "delete_recovery_required" ||
              code === "database_cleanup_failed"
            ? i18n.t(I18nKey.DCK$WEBGEN_DELETE_RECOVERY_REQUIRED)
            : code === "rollback_failed"
              ? i18n.t(I18nKey.DCK$WEBGEN_RECOVERY_FAILED)
              : status === 410
                ? "Owner credentials need to be entered again before deployment."
                : status === 409
                  ? "This WebGen project is busy or its publish configuration conflicts."
                  : status === 422
                    ? "Check Settings → Secrets and add the required credentials for this app before deploying."
                    : "The WebGen operation could not be completed. Please try again.",
    );
    this.name = "WebgenServiceError";
    this.status = status;
    this.code = code;
  }
}

function codeFromError(error: unknown): string | null {
  if (!(error instanceof Error) || !("response" in error)) return null;
  const body = error.response;
  return body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
    ? body.error
    : null;
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
    throw new WebgenServiceError(statusFromError(error), codeFromError(error));
  } finally {
    client.close();
  }
}

export async function runWebgenLifecycleAction(
  projectSlug: string,
  request: WebgenLifecycleRequest,
): Promise<WebgenLifecycleResponse> {
  const client = getClient(45 * 60 * 1000);
  try {
    return await client.post<WebgenLifecycleResponse>(
      `/api/webgen/projects/${encodeURIComponent(projectSlug)}/actions`,
      request,
    );
  } catch (error) {
    throw new WebgenServiceError(statusFromError(error), codeFromError(error));
  } finally {
    client.close();
  }
}

export async function fetchWebgenRuntimeSecrets(
  projectSlug: string,
): Promise<WebgenRuntimeSecretsResponse> {
  const client = getClient();
  try {
    return await client.get<WebgenRuntimeSecretsResponse>(
      `/api/webgen/projects/${encodeURIComponent(projectSlug)}/runtime-secrets`,
    );
  } catch (error) {
    throw new WebgenServiceError(statusFromError(error), codeFromError(error));
  } finally {
    client.close();
  }
}

export async function saveWebgenRuntimeSecret(
  projectSlug: string,
  name: string,
  value: string,
): Promise<void> {
  const client = getClient();
  try {
    await client.put(
      `/api/webgen/projects/${encodeURIComponent(projectSlug)}/runtime-secrets`,
      { name, value },
    );
  } catch (error) {
    throw new WebgenServiceError(statusFromError(error), codeFromError(error));
  } finally {
    client.close();
  }
}

export async function deleteWebgenRuntimeSecret(
  projectSlug: string,
  name: string,
): Promise<void> {
  const client = getClient();
  try {
    await client.delete(
      `/api/webgen/projects/${encodeURIComponent(projectSlug)}/runtime-secrets/${encodeURIComponent(name)}`,
    );
  } catch (error) {
    throw new WebgenServiceError(statusFromError(error), codeFromError(error));
  } finally {
    client.close();
  }
}

export async function migrateWebgenRuntimeSecret(
  projectSlug: string,
  sourceName: string,
  confirmAmbiguous = false,
): Promise<WebgenRuntimeSecretMigrationResponse> {
  const client = getClient();
  try {
    return await client.post<WebgenRuntimeSecretMigrationResponse>(
      `/api/webgen/projects/${encodeURIComponent(projectSlug)}/runtime-secrets/migrations`,
      { source_name: sourceName, confirm_ambiguous: confirmAmbiguous },
    );
  } catch (error) {
    throw new WebgenServiceError(statusFromError(error), codeFromError(error));
  } finally {
    client.close();
  }
}

export function isWebgenOwnerSeedReentryRequired(error: unknown): boolean {
  return error instanceof WebgenServiceError && error.status === 410;
}
