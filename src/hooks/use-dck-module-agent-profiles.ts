import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";

export type DckModuleAgentProfileSelection =
  | { status: "unassigned" }
  | { status: "selected"; profileId: string }
  | { status: "checking"; profileId: string }
  | { status: "unavailable"; profileId?: string };

export function resolveDckModuleAgentProfileSelection(
  moduleId: string,
  assignments: Record<string, string | null>,
  profiles: readonly AgentProfileSummary[],
  isLoading: boolean,
): DckModuleAgentProfileSelection {
  const profileId = assignments[moduleId];
  if (profileId === undefined || profileId === null) {
    return { status: "unassigned" };
  }

  if (profiles.some((profile) => profile.id === profileId)) {
    return { status: "selected", profileId };
  }

  return isLoading
    ? { status: "checking", profileId }
    : { status: "unavailable", profileId };
}

export function isDckModuleAgentProfileSelectionBlocked(
  selection: DckModuleAgentProfileSelection,
): boolean {
  return selection.status !== "selected";
}

export function getDckModuleAgentProfileIdForLaunch(
  selection: DckModuleAgentProfileSelection,
): string | undefined {
  return selection.status === "selected" ? selection.profileId : undefined;
}
