import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Globe,
  LayoutDashboard,
  LineChart,
  Search,
} from "lucide-react";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";

export type DckModuleKind = "projects" | "extensions" | "conversations";

export interface DckModule {
  id: string;
  name: string;
  workspacePath: string;
  skillName: string;
  kind: DckModuleKind;
  icon: LucideIcon;
  description: string;
}

export const DCK_MODULES: DckModule[] = [
  {
    id: "webgen",
    name: "Web Generator",
    workspacePath: "/projects/webgen",
    skillName: "web-generator",
    kind: "projects",
    icon: Globe,
    description: "Autonomous full-stack Next.js application scaffolding",
  },
  {
    id: "dashboards",
    name: "Dashboards",
    workspacePath: "/projects/dashboards",
    skillName: "dashboard-generator",
    kind: "extensions",
    icon: LayoutDashboard,
    description: "Embedded analytics pages served inside the portal",
  },
  {
    id: "research",
    name: "Research",
    workspacePath: "/projects/research",
    skillName: "social-trends-researcher",
    kind: "conversations",
    icon: Search,
    description: "Deep literature synthesis with cited reports",
  },
  {
    id: "powerbi",
    name: "Power BI",
    workspacePath: "/projects/powerbi",
    skillName: "power-bi-assistant",
    kind: "conversations",
    icon: BarChart3,
    description: "DAX optimization and semantic model pipelines",
  },
  {
    id: "analytics",
    name: "Analytics",
    workspacePath: "/projects/analytics",
    skillName: "data-analytics",
    kind: "conversations",
    icon: LineChart,
    description: "SQL exploration with charts and insights",
  },
];

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
