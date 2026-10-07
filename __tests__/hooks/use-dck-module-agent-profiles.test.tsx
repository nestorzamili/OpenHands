import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";
import {
  getDckModuleAgentProfileIdForLaunch,
  getDckModuleAgentProfilesStorageKey,
  isDckModuleAgentProfileSelectionBlocked,
  resolveDckModuleAgentProfileSelection,
  useDckModuleAgentProfiles,
} from "#/hooks/use-dck-module-agent-profiles";

const mockActiveBackend = vi.hoisted(() => vi.fn());
vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => mockActiveBackend(),
}));

const profiles = [
  { id: "profile-one", name: "One" },
  { id: "profile-two", name: "Two" },
] as AgentProfileSummary[];

beforeEach(() => {
  window.localStorage.clear();
  mockActiveBackend.mockReturnValue({
    backend: { id: "local-one", kind: "local" },
    orgId: null,
  });
});

describe("DCK module Agent Profile preferences", () => {
  it("scopes profile assignments to the active backend and organization", () => {
    expect(getDckModuleAgentProfilesStorageKey("local-one", null)).not.toBe(
      getDckModuleAgentProfilesStorageKey("local-two", null),
    );
    expect(getDckModuleAgentProfilesStorageKey("cloud-one", "org-a")).not.toBe(
      getDckModuleAgentProfilesStorageKey("cloud-one", "org-b"),
    );
  });

  it("blocks a stale profile ID until it is resolved", () => {
    const assignments = {
      research: "profile-two",
      content: "deleted-profile",
    };

    const selected = resolveDckModuleAgentProfileSelection(
      "research",
      assignments,
      profiles,
      false,
    );
    expect(selected).toEqual({ status: "selected", profileId: "profile-two" });
    expect(getDckModuleAgentProfileIdForLaunch(selected)).toBe("profile-two");
    expect(isDckModuleAgentProfileSelectionBlocked(selected)).toBe(false);

    const stale = resolveDckModuleAgentProfileSelection(
      "content",
      assignments,
      profiles,
      false,
    );
    expect(stale).toEqual({
      status: "unavailable",
      profileId: "deleted-profile",
    });
    expect(getDckModuleAgentProfileIdForLaunch(stale)).toBeUndefined();
    expect(isDckModuleAgentProfileSelectionBlocked(stale)).toBe(true);

    const checking = resolveDckModuleAgentProfileSelection(
      "content",
      assignments,
      [],
      true,
    );
    expect(checking).toEqual({
      status: "checking",
      profileId: "deleted-profile",
    });
    expect(isDckModuleAgentProfileSelectionBlocked(checking)).toBe(true);

    expect(
      resolveDckModuleAgentProfileSelection("content", {}, [], true),
    ).toEqual({ status: "follow-active" });
  });

  it("removes unavailable IDs after profile verification but keeps an explicit-choice marker", async () => {
    const storageKey = getDckModuleAgentProfilesStorageKey("local-one", null);
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ research: "profile-two", content: "deleted-profile" }),
    );

    const { result, rerender } = renderHook(
      ({ availableProfiles, verified }) =>
        useDckModuleAgentProfiles(availableProfiles, verified),
      {
        initialProps: {
          availableProfiles: [] as AgentProfileSummary[],
          verified: false,
        },
      },
    );
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      { research: "profile-two", content: "deleted-profile" },
    );

    rerender({ availableProfiles: profiles, verified: true });
    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"),
      ).toEqual({ research: "profile-two", content: null }),
    );
    expect(result.current.assignments).toEqual({
      research: "profile-two",
      content: null,
    });

    const requiresChoice = resolveDckModuleAgentProfileSelection(
      "content",
      result.current.assignments,
      profiles,
      false,
    );
    expect(requiresChoice).toEqual({ status: "unavailable" });
    expect(isDckModuleAgentProfileSelectionBlocked(requiresChoice)).toBe(true);
    expect(getDckModuleAgentProfileIdForLaunch(requiresChoice)).toBeUndefined();
  });

  it("persists a module choice and clears it to follow the active profile", () => {
    const { result, unmount } = renderHook(() => useDckModuleAgentProfiles());
    const storageKey = getDckModuleAgentProfilesStorageKey("local-one", null);

    act(() =>
      result.current.setAgentProfileForModule("research", "profile-two"),
    );
    expect(result.current.assignments).toEqual({ research: "profile-two" });
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      { research: "profile-two" },
    );

    unmount();
    const reopened = renderHook(() => useDckModuleAgentProfiles());
    expect(reopened.result.current.assignments).toEqual({
      research: "profile-two",
    });

    act(() =>
      reopened.result.current.setAgentProfileForModule("research", null),
    );
    expect(reopened.result.current.assignments).toEqual({});
  });
});
