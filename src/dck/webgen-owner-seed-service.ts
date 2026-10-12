import { AgentServerClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import type { WebgenOwnerSeedInput } from "#/components/features/dck/webgen-owner-seed-fields";

const BASE_PATH = "/api/webgen-provisioning/projects";

export interface WebgenOwnerSeedStageResponse {
  status: "staged";
  expires_at: number;
  /** Ed25519 SubjectPublicKeyInfo DER, base64 encoded; public, not secret. */
  verification_key: string;
}

export interface WebgenOwnerSeedDeployResponse {
  status: "authorized" | "already_provisioned";
  expires_at?: number;
}

export class WebgenOwnerSeedServiceError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super(
      status === 410
        ? "Owner credentials need to be entered again before deployment."
        : "Secure owner provisioning could not be prepared. Please try again.",
    );
    this.name = "WebgenOwnerSeedServiceError";
    this.status = status;
  }
}

function projectPath(projectSlug: string, conversationId: string): string {
  return `${BASE_PATH}/${encodeURIComponent(projectSlug)}/conversations/${encodeURIComponent(conversationId)}`;
}

function statusFromError(error: unknown): number | null {
  for (const status of [400, 401, 403, 404, 409, 410, 413, 429, 500, 503]) {
    if (isSdkHttpStatusError(error, status)) return status;
  }
  return null;
}

function getClient(conversationId: string, workingDir: string) {
  return new AgentServerClient(
    getAgentServerClientOptions({
      conversationId,
      workingDir,
      timeout: 15_000,
    }),
  );
}

export async function stageWebgenOwnerSeed(
  projectSlug: string,
  conversationId: string,
  workingDir: string,
  seed: WebgenOwnerSeedInput,
): Promise<WebgenOwnerSeedStageResponse> {
  const client = getClient(conversationId, workingDir);
  try {
    return await client.post<WebgenOwnerSeedStageResponse>(
      `${projectPath(projectSlug, conversationId)}/seed`,
      {
        email: seed.email,
        username: seed.username || null,
        password: seed.password,
      },
    );
  } catch (error) {
    throw new WebgenOwnerSeedServiceError(statusFromError(error));
  } finally {
    client.close();
  }
}

export async function authorizeWebgenOwnerSeedDeploy(
  projectSlug: string,
  conversationId: string,
  workingDir: string,
): Promise<WebgenOwnerSeedDeployResponse> {
  const client = getClient(conversationId, workingDir);
  try {
    return await client.post<WebgenOwnerSeedDeployResponse>(
      `${projectPath(projectSlug, conversationId)}/authorize-deploy`,
      {},
    );
  } catch (error) {
    throw new WebgenOwnerSeedServiceError(statusFromError(error));
  } finally {
    client.close();
  }
}

export function isOwnerSeedReentryRequired(error: unknown): boolean {
  return error instanceof WebgenOwnerSeedServiceError && error.status === 410;
}
