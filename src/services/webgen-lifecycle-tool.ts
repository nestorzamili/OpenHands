import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import {
  getActiveBackend,
  isNoBackend,
} from "#/api/backend-registry/active-store";
import {
  fetchWebgenProjects,
  runWebgenLifecycleAction,
  WebgenServiceError,
  type WebgenProjectStatus,
} from "#/dck/webgen-service";
import type { WebgenLifecycleAction } from "#/dck/webgen-lifecycle";
import { getDckWorkspaceRoot } from "#/dck/modules";
import { postClientToolResult } from "#/services/client-tool-result";
import { claimClientToolCall } from "#/utils/claim-client-tool-call";

const ACTIONS = new Set([
  "status",
  "run",
  "deploy",
  "start",
  "rebuild",
  "restart",
  "stop",
  "publish",
  "unpublish",
]);
const SAFE_ERROR =
  "The WebGen controller is unavailable or could not complete this operation.";
type Request = { action: string; subdomain?: string };
function requestFrom(value: unknown): Request | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    Object.keys(value).some(
      (key) => !["action", "subdomain", "kind"].includes(key),
    )
  )
    return null;
  if ("kind" in value && value.kind !== "ClientAction_webgen_lifecycle")
    return null;
  const { action, subdomain } = value as {
    action?: unknown;
    subdomain?: unknown;
  };
  if (typeof action !== "string" || !ACTIONS.has(action)) return null;
  if (
    subdomain !== undefined &&
    (typeof subdomain !== "string" ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain))
  )
    return null;
  if (
    (action === "publish" && !subdomain) ||
    (subdomain && action !== "publish")
  )
    return null;
  return { action, ...(subdomain ? { subdomain } : {}) };
}
function slugForWorkingDir(workingDir: string): string | null {
  const root = `${getDckWorkspaceRoot().replace(/\/+$/, "")}/webgen`;
  const normalized = workingDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized.startsWith(`${root}/`)) return null;
  const slug = normalized.slice(root.length + 1);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 64
    ? slug
    : null;
}
function safeMetadata(project: WebgenProjectStatus) {
  return {
    status: project.status,
    has_deployment: project.has_deployment ?? false,
    subdomain: project.subdomain ?? null,
    port: project.port ?? null,
    preview_path:
      project.status === "running" &&
      project.has_deployment &&
      !project.subdomain
        ? `/preview/${project.slug}`
        : null,
  };
}
export async function performWebgenLifecycle(
  conversationId: string,
  rawAction: unknown,
) {
  const request = requestFrom(rawAction);
  if (!request)
    return { ok: false, error: "Unsupported or invalid lifecycle request." };
  const { backend } = getActiveBackend();
  if (backend.kind !== "local" || isNoBackend(backend))
    return {
      ok: false,
      error: "WebGen lifecycle requires a connected local DCK backend.",
    };
  const clientBackend = {
    host: backend.host,
    apiKey: backend.apiKey ?? "",
    workingDir: getDckWorkspaceRoot(),
  };
  const unchanged = () => {
    const current = getActiveBackend().backend;
    return (
      current.id === backend.id &&
      current.kind === backend.kind &&
      current.host === backend.host &&
      (current.apiKey ?? "") === clientBackend.apiKey
    );
  };
  try {
    const workingDir =
      await AgentServerConversationService.resolveConversationWorkingDir(
        conversationId,
      );
    if (!unchanged())
      return {
        ok: false,
        error: "Backend changed; no lifecycle action was submitted.",
      };
    const slug = slugForWorkingDir(workingDir);
    if (!slug)
      return {
        ok: false,
        error: "This conversation is not associated with a WebGen project.",
      };
    const { projects } = await fetchWebgenProjects(clientBackend);
    if (!unchanged())
      return {
        ok: false,
        error: "Backend changed; no lifecycle action was submitted.",
      };
    const project = projects.find(
      (item) => item.slug === slug && item.path === `/projects/webgen/${slug}`,
    );
    if (!project)
      return {
        ok: false,
        error:
          "The current WebGen project is not registered with the controller.",
      };
    let action: WebgenLifecycleAction | null =
      request.action as WebgenLifecycleAction;
    if (request.action === "status")
      return { ok: true, project: safeMetadata(project) };
    if (request.action === "run") {
      if (
        project.has_deployment &&
        project.status !== "running" &&
        project.status !== "stopped"
      )
        return {
          ok: false,
          error:
            "The deployment is not ready; inspect status before choosing an explicit recovery action.",
          project: safeMetadata(project),
        };
      action = !project.has_deployment
        ? "deploy"
        : project.status === "stopped"
          ? "start"
          : null;
    }
    if (!action) return { ok: true, project: safeMetadata(project) };
    const result = await runWebgenLifecycleAction(
      slug,
      {
        action,
        ...(request.subdomain ? { subdomain: request.subdomain } : {}),
        conversation_id: conversationId,
      },
      clientBackend,
    );
    return { ok: true, project: safeMetadata(result.project), action };
  } catch (error) {
    if (error instanceof WebgenServiceError) {
      if (error.status === 401 || error.status === 403)
        return {
          ok: false,
          error:
            "WebGen controller authentication is unavailable. Restore the authenticated Canvas session.",
        };
      if (error.status === 404 || error.status === 503)
        return {
          ok: false,
          error:
            "The WebGen controller or its authenticated proxy route is unavailable in this runtime.",
        };
      if (error.status === 410)
        return {
          ok: false,
          error:
            "The project's temporary owner seed expired; enter it through the project's owner setup flow.",
        };
      if (error.status === 422)
        return {
          ok: false,
          error:
            "Project configuration or Environment requires review; no secrets were read by the agent.",
        };
    }
    return { ok: false, error: SAFE_ERROR };
  }
}
export async function handleWebgenLifecycleAction(
  rawAction: unknown,
  conversationId: string,
  toolCallId: string,
): Promise<void> {
  const selectedBackend = getActiveBackend().backend;
  const backendId = selectedBackend.id;
  if (
    !claimClientToolCall(
      `openhands-webgen-lifecycle:${backendId}:${conversationId}`,
      toolCallId,
    )
  )
    return;
  const result = await performWebgenLifecycle(conversationId, rawAction);
  const currentBackend = getActiveBackend().backend;
  if (
    currentBackend.id !== selectedBackend.id ||
    currentBackend.kind !== selectedBackend.kind ||
    currentBackend.host !== selectedBackend.host ||
    (currentBackend.apiKey ?? "") !== (selectedBackend.apiKey ?? "")
  )
    return;
  try {
    await postClientToolResult(
      conversationId,
      "WebGen lifecycle result: ",
      result,
    );
  } catch {
    // Do not expose controller details in logs or transcripts.
  }
}
