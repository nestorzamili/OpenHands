import { describe, expect, it } from "vitest";
import { ExecutionStatus } from "#/types/agent-server/core";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import {
  DCK_MODULES,
  conversationsForBase,
  flattenConversationPages,
  formatProjectCount,
  latestConversationForPath,
  normalizeModulePath,
  workingDirMatchesBase,
} from "#/dck/modules";

function makeConversation(
  overrides: Partial<AppConversation> & { id: string },
): AppConversation {
  return {
    title: null,
    updated_at: "2026-09-29T10:00:00.000Z",
    execution_status: ExecutionStatus.IDLE,
    selected_workspace: null,
    workspace: null,
    ...overrides,
  } as AppConversation;
}

describe("DCK module registry", () => {
  it("declares the five DCK modules with workspace paths and skills", () => {
    expect(DCK_MODULES.map((module) => module.id)).toEqual([
      "webgen",
      "dashboards",
      "research",
      "powerbi",
      "analytics",
    ]);
    expect(
      DCK_MODULES.every(
        (module) =>
          module.workspacePath.startsWith("/projects/") && module.skillName,
      ),
    ).toBe(true);
  });
});

describe("normalizeModulePath", () => {
  it.each([
    ["/projects/webgen/", "/projects/webgen"],
    ["projects/webgen", "/projects/webgen"],
    ["", "/"],
    [null, "/"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeModulePath(input)).toBe(expected);
  });
});

describe("workingDirMatchesBase", () => {
  it("matches the base itself and anything beneath it", () => {
    expect(
      workingDirMatchesBase("/projects/webgen/shop", "/projects/webgen"),
    ).toBe(true);
    expect(workingDirMatchesBase("/projects/webgen", "/projects/webgen")).toBe(
      true,
    );
  });

  it("rejects siblings and unrelated paths", () => {
    expect(workingDirMatchesBase("/projects/webgen2", "/projects/webgen")).toBe(
      false,
    );
    expect(
      workingDirMatchesBase("/projects/research", "/projects/webgen"),
    ).toBe(false);
    expect(workingDirMatchesBase(null, "/projects/webgen")).toBe(false);
  });
});

describe("conversationsForBase", () => {
  const conversations = [
    makeConversation({
      id: "old",
      updated_at: "2026-09-28T10:00:00.000Z",
      workspace: { working_dir: "/projects/webgen/shop" },
    }),
    makeConversation({
      id: "new",
      updated_at: "2026-09-29T10:00:00.000Z",
      workspace: { working_dir: "/projects/webgen/shop" },
    }),
    makeConversation({
      id: "other",
      updated_at: "2026-09-29T11:00:00.000Z",
      workspace: { working_dir: "/projects/research" },
    }),
  ];

  it("returns matches newest first", () => {
    expect(
      conversationsForBase(conversations, "/projects/webgen").map((c) => c.id),
    ).toEqual(["new", "old"]);
  });

  it("resolves the latest conversation for a project path", () => {
    expect(
      latestConversationForPath(conversations, "/projects/webgen/shop")?.id,
    ).toBe("new");
    expect(
      latestConversationForPath(conversations, "/projects/powerbi"),
    ).toBeNull();
  });
});

describe("flattenConversationPages", () => {
  it("returns an empty list without pages", () => {
    expect(flattenConversationPages(undefined)).toEqual([]);
  });
});

describe("formatProjectCount", () => {
  it.each([
    [0, "0 projects"],
    [1, "1 project"],
    [3, "3 projects"],
  ])("formats %i as %s", (count, expected) => {
    expect(formatProjectCount(count)).toBe(expected);
  });
});
