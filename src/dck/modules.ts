import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Globe,
  LayoutDashboard,
  LineChart,
  Search,
} from "lucide-react";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import { ExecutionStatus } from "#/types/agent-server/core/base/common";
import type { DckProjectMeta } from "#/dck/project-metadata";

export type DckModuleKind = "projects" | "extensions" | "conversations";

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
    description: "Autonomous full-stack Next.js application scaffolding",
    promptTemplate:
      "Scaffold a new containerized Next.js fullstack app under webgen/ following the web-generator standard. Ask me for the app name and whether it needs a database or auth before scaffolding.",
  },
  {
    id: "dashboards",
    name: "Dashboards",
    slug: "dashboards",
    skillName: "dashboard-generator",
    kind: "extensions",
    icon: LayoutDashboard,
    description: "Embedded analytics pages served inside the portal",
    promptTemplate:
      "Build an embedded analytics dashboard as a Canvas Extension under dashboards/ following the dashboard-generator standard. Ask me what metrics and data source it should visualize before starting.",
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
    id: "powerbi",
    name: "Power BI",
    slug: "powerbi",
    skillName: "power-bi-assistant",
    kind: "conversations",
    icon: BarChart3,
    description: "DAX optimization and semantic model pipelines",
    promptTemplate:
      "Help me with Power BI modeling: star schema design, optimized DAX measures, and Power Query (M) transformations, saving outputs under powerbi/. Ask me about the model and tables first.",
  },
  {
    id: "analytics",
    name: "Analytics",
    slug: "analytics",
    skillName: "data-analytics",
    kind: "conversations",
    icon: LineChart,
    description: "SQL exploration with charts and insights",
    promptTemplate:
      "Run an exploratory data analysis: query the host PostgreSQL database with SQL, produce charts, and write insights under analytics/. Ask me which dataset or question to analyze first.",
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
  noExtensions: "No dashboards installed",
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

export interface ExtensionPageLike {
  path: string;
}

export function extensionEntryPath(
  name: string,
  pages: ExtensionPageLike[] | null | undefined,
): string {
  const first = pages?.[0]?.path ?? null;
  return first ? `/extensions/${name}/${first}` : "/apps";
}

export type DckProjectStatus =
  | "running"
  | "working"
  | "idle"
  | "paused"
  | "error"
  | "configured"
  | "unknown";

export function deriveProjectStatus(
  meta: DckProjectMeta | null | undefined,
  latestConversation: AppConversation | null | undefined,
): DckProjectStatus {
  if (latestConversation) {
    switch (latestConversation.execution_status) {
      case ExecutionStatus.RUNNING:
        return "running";
      case ExecutionStatus.IDLE:
      case ExecutionStatus.WAITING_FOR_CONFIRMATION:
        return "working";
      case ExecutionStatus.PAUSED:
        return "paused";
      case ExecutionStatus.ERROR:
      case ExecutionStatus.STUCK:
        return "error";
      case ExecutionStatus.FINISHED:
        return "idle";
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
  working: "DCK$STATUS_WORKING",
  idle: "DCK$STATUS_IDLE",
  paused: "DCK$STATUS_PAUSED",
  error: "DCK$STATUS_ERROR",
  configured: "DCK$STATUS_CONFIGURED",
  unknown: "DCK$STATUS_UNKNOWN",
};
