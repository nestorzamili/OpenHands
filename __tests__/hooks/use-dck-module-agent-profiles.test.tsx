import { describe, expect, it } from "vitest";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";
import {
  getDckModuleAgentProfileIdForLaunch,
  isDckModuleAgentProfileSelectionBlocked,
  resolveDckModuleAgentProfileSelection,
} from "#/hooks/use-dck-module-agent-profiles";

const profiles = [
  { id: "active-profile", name: "Default" },
  { id: "profile-two", name: "Two" },
] as AgentProfileSummary[];

describe("DCK module Agent Profile selection", () => {
  it("blocks launch until a profile is explicitly saved", () => {
    const unassigned = resolveDckModuleAgentProfileSelection(
      "research",
      {},
      profiles,
      false,
    );

    expect(unassigned).toEqual({ status: "unassigned" });
    expect(getDckModuleAgentProfileIdForLaunch(unassigned)).toBeUndefined();
    expect(isDckModuleAgentProfileSelectionBlocked(unassigned)).toBe(true);
  });

  it("uses an explicitly assigned profile when that profile still exists", () => {
    const selected = resolveDckModuleAgentProfileSelection(
      "research",
      { research: "profile-two" },
      profiles,
      false,
    );

    expect(selected).toEqual({ status: "selected", profileId: "profile-two" });
    expect(getDckModuleAgentProfileIdForLaunch(selected)).toBe("profile-two");
    expect(isDckModuleAgentProfileSelectionBlocked(selected)).toBe(false);
  });

  it("blocks a missing or deleted saved profile instead of falling back", () => {
    const stale = resolveDckModuleAgentProfileSelection(
      "research",
      { research: "deleted-profile" },
      profiles,
      false,
    );

    expect(stale).toEqual({
      status: "unavailable",
      profileId: "deleted-profile",
    });
    expect(getDckModuleAgentProfileIdForLaunch(stale)).toBeUndefined();
    expect(isDckModuleAgentProfileSelectionBlocked(stale)).toBe(true);
  });

  it("keeps a stale assignment in checking state while profiles are loading", () => {
    const checking = resolveDckModuleAgentProfileSelection(
      "research",
      { research: "deleted-profile" },
      [],
      true,
    );

    expect(checking).toEqual({
      status: "checking",
      profileId: "deleted-profile",
    });
    expect(isDckModuleAgentProfileSelectionBlocked(checking)).toBe(true);
  });

  it("treats an explicit empty marker as unassigned and blocked", () => {
    const unassigned = resolveDckModuleAgentProfileSelection(
      "research",
      { research: null },
      profiles,
      false,
    );

    expect(unassigned).toEqual({ status: "unassigned" });
    expect(isDckModuleAgentProfileSelectionBlocked(unassigned)).toBe(true);
  });
});
