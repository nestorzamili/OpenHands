import type { LucideIcon } from "lucide-react";
import { Globe, LineChart, PenLine, Search } from "lucide-react";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import { ExecutionStatus } from "#/types/agent-server/core/base/common";
import type { DckProjectMeta } from "#/dck/project-metadata";

export type DckModuleKind = "projects" | "conversations";

/**
 * Root under which DCK module directories live, as seen by the active
 * agent-server. In Docker this is the mounted `/projects` (compose maps
 * `./workspace:/projects`); in local `npm run dev` the agent-server runs on the
 * host, where `/projects` does not exist, so point it at the repo's tracked
 * `workspace/` via `VITE_DCK_WORKSPACE_ROOT`.
 */
export function getDckWorkspaceRoot(): string {
  const configured = import.meta.env.VITE_DCK_WORKSPACE_ROOT?.trim();
  const root = configured && configured.length > 0 ? configured : "/projects";
  return root.replace(/\/+$/, "");
}

export interface DckModule {
  id: string;
  name: string;
  /** Directory name under the workspace root (e.g. `webgen`). */
  slug: string;
  /** Absolute path for the active backend: `<workspaceRoot>/<slug>`. */
  workspacePath: string;
  skillName: string;
  kind: DckModuleKind;
  icon: LucideIcon;
  description: string;
  promptTemplate: string;
}

interface DckModuleDef {
  id: string;
  name: string;
  slug: string;
  skillName: string;
  kind: DckModuleKind;
  icon: LucideIcon;
  description: string;
  promptTemplate: string;
}

const DCK_MODULE_DEFS: DckModuleDef[] = [
  {
    id: "webgen",
    name: "Web Generator",
    slug: "webgen",
    skillName: "web-generator",
    kind: "projects",
    icon: Globe,
    description: "",
    promptTemplate:
      "Scaffold a new containerized Next.js fullstack app under webgen/ following the web-generator standard. Ask me for the app name and whether it needs a database or auth before scaffolding.",
  },
  {
    id: "research",
    name: "Research",
    slug: "research",
    skillName: "social-trends-researcher",
    kind: "conversations",
    icon: Search,
    description: "Deep literature synthesis with cited reports",
    promptTemplate:
      "Run a social media and trending research brief, preferring the built-in research-brief and news-digest skills, and save the report under research/. Ask me for the topic and time window first.",
  },
  {
    id: "analytics",
    name: "Analytics",
    slug: "analytics",
    skillName: "data-analytics",
    kind: "conversations",
    icon: LineChart,
    description: "SQL exploration, charts, and Power BI / DAX modeling",
    promptTemplate:
      "Run an exploratory data analysis: query the host PostgreSQL database with SQL, produce charts, and write insights under analytics/. I may also ask for Power BI DAX measures or Power Query (M). Ask me which dataset or question to analyze first.",
  },
  {
    id: "content",
    name: "Content",
    slug: "content",
    skillName: "content-creator",
    kind: "conversations",
    icon: PenLine,
    description: "Marketing and social content, calendars, and SEO copy",
    promptTemplate:
      "Help me produce marketing content: social captions and scripts, a content calendar, or SEO blog copy, saving outputs under content/. Ask me about the brand, channel, and goal first.",
  },
];

/**
 * The module registry with `workspacePath` resolved against the active
 * workspace root. Exposed as a getter so a changed `VITE_DCK_WORKSPACE_ROOT`
 * (or test override) is reflected without recomputing at module load.
 */
export function getDckModules(): DckModule[] {
  const root = getDckWorkspaceRoot();
  return DCK_MODULE_DEFS.map((def) => ({
    ...def,
    workspacePath: `${root}/${def.slug}`,
  }));
}

export const DCK_MODULES: DckModule[] = getDckModules();

export function getDckModuleById(id: string | undefined): DckModule | null {
  if (!id) return null;
  return getDckModules().find((module) => module.id === id) ?? null;
}

export function dckModulePath(id: string): string {
  return `/modules/${id}`;
}

export const DCK_COPY = {
  modules: "Modules",
  recent: "Recent conversations",
  open: "Open",
  newProject: "New project",
  newConversation: "New conversation",
  viewAll: "View all",
  noProjects: "No projects yet",
  noConversations: "No conversations yet",
} as const;

export function normalizeModulePath(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "/";
  const withoutTrailing = trimmed.replace(/\/+$/, "");
  const withLeading =
    withoutTrailing.startsWith("/") || withoutTrailing === ""
      ? withoutTrailing
      : `/${withoutTrailing}`;
  return withLeading || "/";
}

export function workingDirMatchesBase(
  workingDir: string | null | undefined,
  base: string,
): boolean {
  const dir = normalizeModulePath(workingDir);
  const normalizedBase = normalizeModulePath(base);
  return dir === normalizedBase || dir.startsWith(`${normalizedBase}/`);
}

export function conversationWorkingDir(
  conversation: Pick<AppConversation, "selected_workspace"> & {
    workspace?: { working_dir: string | null } | null;
  },
): string | null {
  return (
    conversation.selected_workspace ??
    conversation.workspace?.working_dir ??
    null
  );
}

export function flattenConversationPages(
  pages: { items: AppConversation[] }[] | undefined,
): AppConversation[] {
  if (!pages) return [];
  return pages.flatMap((page) => page.items);
}

export function conversationsForBase(
  conversations: AppConversation[],
  base: string,
): AppConversation[] {
  return conversations
    .filter((conversation) =>
      workingDirMatchesBase(conversationWorkingDir(conversation), base),
    )
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export function latestConversationForPath(
  conversations: AppConversation[],
  path: string,
): AppConversation | null {
  const matches = conversationsForBase(conversations, path);
  return matches.length > 0 ? matches[0] : null;
}

export function formatProjectCount(count: number): string {
  return count === 1 ? "1 project" : `${count} projects`;
}

export type DckProjectStatus =
  | "running"
  | "stopped"
  | "working"
  | "idle"
  | "paused"
  | "error"
  | "configured"
  | "unknown";

/**
 * Resolve the status shown for a webgen project. Precedence reflects what the
 * frontend can honestly know:
 *
 *   1. The agent-verified app runtime status from `.dck.json`
 *      (`lastStatus`: running/stopped/error) — the only signal that reflects
 *      the actual container, written by the agent after a lifecycle action.
 *      `running` is still overridden to `working` while the agent is actively
 *      executing, so a live agent turn is visible.
 *   2. If the app was never verified, fall back to the conversation's agent
 *      execution status (working/paused/error) so an in-progress scaffold
 *      shows activity.
 *   3. Otherwise `configured` (has `.dck.json`) or `unknown` (no metadata).
 *
 * The frontend never claims an unverified "running": that status only comes
 * from the agent, which alone can reach the Docker daemon.
 */
export function deriveProjectStatus(
  meta: DckProjectMeta | null | undefined,
  latestConversation: AppConversation | null | undefined,
): DckProjectStatus {
  const agentExecuting =
    latestConversation?.execution_status === ExecutionStatus.RUNNING;

  if (meta?.lastStatus) {
    switch (meta.lastStatus) {
      case "running":
        // Surface a live agent turn over the last verified "running".
        return agentExecuting ? "working" : "running";
      case "stopped":
        return "stopped";
      case "error":
        return "error";
      default:
        break;
    }
  }

  if (latestConversation) {
    switch (latestConversation.execution_status) {
      case ExecutionStatus.RUNNING:
      case ExecutionStatus.IDLE:
      case ExecutionStatus.WAITING_FOR_CONFIRMATION:
        return "working";
      case ExecutionStatus.PAUSED:
        return "paused";
      case ExecutionStatus.ERROR:
      case ExecutionStatus.STUCK:
        return "error";
      default:
        break;
    }
  }

  return meta ? "configured" : "unknown";
}

export function relatedConversationCount(
  conversations: AppConversation[],
  path: string,
): number {
  return conversationsForBase(conversations, path).length;
}

export function projectLastTouched(
  conversations: AppConversation[],
  path: string,
): string | null {
  return latestConversationForPath(conversations, path)?.updated_at ?? null;
}

export const DCK_STATUS_LABEL_KEYS: Record<DckProjectStatus, string> = {
  running: "DCK$STATUS_RUNNING",
  stopped: "DCK$STATUS_STOPPED",
  working: "DCK$STATUS_WORKING",
  idle: "DCK$STATUS_IDLE",
  paused: "DCK$STATUS_PAUSED",
  error: "DCK$STATUS_ERROR",
  configured: "DCK$STATUS_CONFIGURED",
  unknown: "DCK$STATUS_UNKNOWN",
};
