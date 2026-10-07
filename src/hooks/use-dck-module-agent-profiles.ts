import { useCallback, useEffect, useMemo } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";

export const DCK_MODULE_AGENT_PROFILES_STORAGE_KEY =
  "oh:dck-module-agent-profiles";

export function getDckModuleAgentProfilesStorageKey(
  backendId: string,
  orgId: string | null,
): string {
  return `${DCK_MODULE_AGENT_PROFILES_STORAGE_KEY}:${backendId}:${orgId ?? "-"}`;
}

function sanitizeAssignments(value: unknown): Record<string, string | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([moduleId, profileId]) =>
        moduleId.trim().length > 0 &&
        (profileId === null ||
          (typeof profileId === "string" && profileId.trim().length > 0)),
    ),
  ) as Record<string, string | null>;
}

export type DckModuleAgentProfileSelection =
  | { status: "follow-active" }
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
  if (profileId === undefined) return { status: "follow-active" };
  if (profileId === null) return { status: "unavailable" };

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
  return selection.status === "checking" || selection.status === "unavailable";
}

export function getDckModuleAgentProfileIdForLaunch(
  selection: DckModuleAgentProfileSelection,
): string | undefined {
  return selection.status === "selected" ? selection.profileId : undefined;
}

/**
 * Module profile overrides are local UI preferences, scoped to the active
 * backend and organization. Unset modules follow the active profile; unresolved
 * overrides remain distinct so they cannot silently fall back.
 */
export function useDckModuleAgentProfiles(
  profiles: readonly AgentProfileSummary[] = [],
  profilesVerified = false,
) {
  const { backend, orgId } = useActiveBackend();
  const storageKey = getDckModuleAgentProfilesStorageKey(backend.id, orgId);
  const [storedAssignments, setStoredAssignments] = useLocalStorage<unknown>(
    storageKey,
    {},
  );
  const assignments = useMemo(
    () => sanitizeAssignments(storedAssignments),
    [storedAssignments],
  );
  const availableProfileIds = useMemo(
    () =>
      new Set(profiles.flatMap((profile) => (profile.id ? [profile.id] : []))),
    [profiles],
  );

  useEffect(() => {
    if (!profilesVerified) return;

    setStoredAssignments((current: unknown) => {
      const next = sanitizeAssignments(current);
      let removedUnavailableProfile = false;

      Object.entries(next).forEach(([moduleId, profileId]) => {
        if (
          typeof profileId === "string" &&
          !availableProfileIds.has(profileId)
        ) {
          // Remove the obsolete profile ID but retain an explicit-choice marker
          // so the module cannot silently start following the active profile.
          next[moduleId] = null;
          removedUnavailableProfile = true;
        }
      });

      return removedUnavailableProfile ? next : current;
    });
  }, [availableProfileIds, profilesVerified, setStoredAssignments]);

  const setAgentProfileForModule = useCallback(
    (moduleId: string, profileId: string | null) => {
      setStoredAssignments((current: unknown) => {
        const next = { ...sanitizeAssignments(current) };
        if (profileId?.trim()) {
          next[moduleId] = profileId;
        } else {
          // An explicit follow-active choice clears both an override and any
          // pending stale-profile confirmation marker.
          delete next[moduleId];
        }
        return next;
      });
    },
    [setStoredAssignments],
  );

  return { assignments, setAgentProfileForModule };
}
