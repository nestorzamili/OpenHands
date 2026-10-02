import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionStatus } from "#/types/agent-server/core";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import {
  DCK_MODULES,
  DCK_STATUS_LABEL_KEYS,
  conversationsForBase,
  deriveProjectStatus,
  flattenConversationPages,
  formatProjectCount,
  getDckModules,
  getDckWorkspaceRoot,
  latestConversationForPath,
  normalizeModulePath,
  projectLastTouched,
  relatedConversationCount,
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("declares the five DCK modules with slugs, workspace paths, and skills", () => {
    vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
    const modules = getDckModules();
    expect(modules.map((module) => module.id)).toEqual([
      "webgen",
      "dashboards",
      "research",
      "powerbi",
      "analytics",
    ]);
    expect(
      modules.every(
        (module) =>
          module.workspacePath === `/projects/${module.slug}` &&
          module.skillName,
      ),
    ).toBe(true);
  });

  it("defaults the workspace root to /projects for the Docker mount", () => {
    vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
    expect(getDckWorkspaceRoot()).toBe("/projects");
  });

  it("resolves module paths under VITE_DCK_WORKSPACE_ROOT when set (dev host)", () => {
    vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "/home/me/OpenHands/workspace/");
    expect(getDckWorkspaceRoot()).toBe("/home/me/OpenHands/workspace");
    const webgen = getDckModules().find((m) => m.id === "webgen");
    expect(webgen?.workspacePath).toBe("/home/me/OpenHands/workspace/webgen");
  });

  const MODULE_SKILL_TRIGGERS: Record<string, string[]> = {
    webgen: ["nextjs", "next.js", "fullstack", "scaffold", "app"],
    dashboards: ["dashboard", "analytics dashboard", "canvas app"],
    research: ["riset", "tren", "trending", "social media", "research"],
    powerbi: ["power bi", "dax", "power query"],
    analytics: ["analytics", "sql", "postgres", "chart"],
  };

  it("seeds every module prompt with a skill trigger keyword", () => {
    for (const module of DCK_MODULES) {
      const triggers = MODULE_SKILL_TRIGGERS[module.id];
      expect(triggers, `missing triggers for ${module.id}`).toBeDefined();
      const prompt = module.promptTemplate.toLowerCase();
      expect(module.promptTemplate.length).toBeGreaterThan(0);
      expect(
        triggers.some((trigger) => prompt.includes(trigger)),
        `prompt for ${module.id} contains no skill trigger (${triggers.join(", ")})`,
      ).toBe(true);
    }
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

describe("deriveProjectStatus", () => {
  const meta = { name: "shop", port: 3000, stack: "nextjs", url: null };

  it.each([
    [ExecutionStatus.RUNNING, "running"],
    [ExecutionStatus.IDLE, "working"],
    [ExecutionStatus.WAITING_FOR_CONFIRMATION, "working"],
    [ExecutionStatus.PAUSED, "paused"],
    [ExecutionStatus.ERROR, "error"],
    [ExecutionStatus.STUCK, "error"],
    [ExecutionStatus.FINISHED, "idle"],
  ])("maps conversation status %s to %s", (status, expected) => {
    const conversation = makeConversation({
      id: "c",
      execution_status: status,
    });
    expect(deriveProjectStatus(meta, conversation)).toBe(expected);
  });

  it("falls back to configured when meta exists without a conversation", () => {
    expect(deriveProjectStatus(meta, null)).toBe("configured");
  });

  it("is unknown without meta or conversation", () => {
    expect(deriveProjectStatus(null, null)).toBe("unknown");
  });

  it("has a label key for every status", () => {
    for (const status of [
      "running",
      "working",
      "idle",
      "paused",
      "error",
      "configured",
      "unknown",
    ] as const) {
      expect(DCK_STATUS_LABEL_KEYS[status]).toMatch(/^DCK\$STATUS_/);
    }
  });
});

describe("relatedConversationCount and projectLastTouched", () => {
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

  it("counts conversations under the project base", () => {
    expect(
      relatedConversationCount(conversations, "/projects/webgen/shop"),
    ).toBe(2);
    expect(relatedConversationCount(conversations, "/projects/powerbi")).toBe(
      0,
    );
  });

  it("returns the newest related conversation's updated_at", () => {
    expect(projectLastTouched(conversations, "/projects/webgen/shop")).toBe(
      "2026-09-29T10:00:00.000Z",
    );
    expect(projectLastTouched(conversations, "/projects/powerbi")).toBeNull();
  });
});
