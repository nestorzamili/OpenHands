import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionStatus } from "#/types/agent-server/core";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import {
  DCK_MODULES,
  DCK_STATUS_LABEL_KEYS,
  conversationsForBase,
  deriveProjectStatus,
  findDckModuleById,
  flattenConversationPages,
  formatDckModuleCount,
  getDckModules,
  getDckWorkspaceRoot,
  isBuiltinModuleId,
  latestConversationForPath,
  mergeDckModules,
  normalizeModulePath,
  projectLastTouched,
  relatedConversationCount,
  resolveModuleIcon,
  workingDirMatchesBase,
} from "#/dck/modules";
import type { DckCustomModule } from "#/dck/module-config";

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

  it("declares the four built-in DCK modules with slugs, workspace paths, and skills", () => {
    vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
    const modules = getDckModules();
    expect(modules.map((module) => module.id)).toEqual([
      "webgen",
      "research",
      "analytics",
      "content",
    ]);
    expect(
      modules.every(
        (module) =>
          module.workspacePath === `/projects/${module.slug}` &&
          module.skillName &&
          module.source === "builtin",
      ),
    ).toBe(true);
  });

  it("resolves a Lucide component for each built-in icon name, with a fallback", () => {
    for (const module of getDckModules()) {
      expect(typeof resolveModuleIcon(module.iconName)).toBe("object");
    }
    // Unknown icon name falls back to the default rather than undefined.
    expect(resolveModuleIcon("not-a-real-icon")).toBe(
      resolveModuleIcon("blocks"),
    );
  });

  it("recognizes built-in module ids", () => {
    expect(isBuiltinModuleId("webgen")).toBe(true);
    expect(isBuiltinModuleId("custom-abc")).toBe(false);
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
    research: ["riset", "tren", "trending", "social media", "research"],
    analytics: ["analytics", "sql", "postgres", "chart"],
    content: ["content", "marketing", "seo", "blog", "social"],
  };

  it("seeds every built-in module prompt with a skill trigger keyword", () => {
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

  it("merges custom conversation modules after the built-ins", () => {
    vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
    const custom: DckCustomModule[] = [
      {
        id: "custom-1",
        name: "Email Campaigns",
        slug: "email",
        iconName: "mail",
        description: "Drip sequences",
        promptTemplate: "Draft an email campaign.",
        skillName: "",
        order: 0,
      },
    ];
    const merged = mergeDckModules(custom);
    expect(merged.map((module) => module.id)).toEqual([
      "webgen",
      "research",
      "analytics",
      "content",
      "custom-1",
    ]);
    const customModule = merged.find((module) => module.id === "custom-1");
    expect(customModule?.source).toBe("custom");
    expect(customModule?.kind).toBe("conversations");
    expect(customModule?.workspacePath).toBe("/projects/email");
    expect(findDckModuleById(merged, "custom-1")?.name).toBe("Email Campaigns");
  });

  it("applies built-in edits while keeping its id, kind, and workspace path stable", () => {
    vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
    const merged = mergeDckModules(
      [],
      [{ id: "research", name: "Field Research", iconName: "sparkles" }],
    );
    const research = merged.find((module) => module.id === "research");

    expect(research).toMatchObject({
      id: "research",
      name: "Field Research",
      slug: "research",
      workspacePath: "/projects/research",
      kind: "conversations",
      source: "builtin",
      iconName: "sparkles",
    });
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
      latestConversationForPath(conversations, "/projects/content"),
    ).toBeNull();
  });
});

describe("flattenConversationPages", () => {
  it("returns an empty list without pages", () => {
    expect(flattenConversationPages(undefined)).toEqual([]);
  });
});

describe("formatDckModuleCount", () => {
  it.each([
    [0, "projects", "0 projects"],
    [1, "projects", "1 project"],
    [3, "projects", "3 projects"],
    [0, "conversations", "0 conversations"],
    [1, "conversations", "1 conversation"],
    [3, "conversations", "3 conversations"],
  ] as const)("formats %i %s as %s", (count, kind, expected) => {
    expect(formatDckModuleCount(count, kind)).toBe(expected);
  });
});

describe("deriveProjectStatus", () => {
  const meta = {
    name: "shop",
    port: 3000,
    stack: "nextjs",
    url: null,
    previewPath: null,
    subdomain: null,
    lastStatus: null,
    lastCheckedAt: null,
  };

  it("prefers the agent-verified app runtime status from .dck.json", () => {
    expect(deriveProjectStatus({ ...meta, lastStatus: "running" }, null)).toBe(
      "running",
    );
    expect(deriveProjectStatus({ ...meta, lastStatus: "stopped" }, null)).toBe(
      "stopped",
    );
    expect(deriveProjectStatus({ ...meta, lastStatus: "error" }, null)).toBe(
      "error",
    );
  });

  it("shows 'working' over a verified 'running' while the agent is executing", () => {
    const conversation = makeConversation({
      id: "c",
      execution_status: ExecutionStatus.RUNNING,
    });
    expect(
      deriveProjectStatus({ ...meta, lastStatus: "running" }, conversation),
    ).toBe("working");
  });

  it.each([
    // No verified app status → fall back to the agent execution status.
    [ExecutionStatus.RUNNING, "working"],
    [ExecutionStatus.IDLE, "working"],
    [ExecutionStatus.WAITING_FOR_CONFIRMATION, "working"],
    [ExecutionStatus.PAUSED, "paused"],
    [ExecutionStatus.ERROR, "error"],
    [ExecutionStatus.STUCK, "error"],
    // FINISHED is not activity → configured (metadata exists).
    [ExecutionStatus.FINISHED, "configured"],
  ])(
    "maps conversation status %s to %s when unverified",
    (status, expected) => {
      const conversation = makeConversation({
        id: "c",
        execution_status: status,
      });
      expect(deriveProjectStatus(meta, conversation)).toBe(expected);
    },
  );

  it("falls back to configured when meta exists without a conversation", () => {
    expect(deriveProjectStatus(meta, null)).toBe("configured");
  });

  it("is unknown without meta or conversation", () => {
    expect(deriveProjectStatus(null, null)).toBe("unknown");
  });

  it("has a label key for every status", () => {
    for (const status of [
      "running",
      "stopped",
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
    expect(relatedConversationCount(conversations, "/projects/content")).toBe(
      0,
    );
  });

  it("returns the newest related conversation's updated_at", () => {
    expect(projectLastTouched(conversations, "/projects/webgen/shop")).toBe(
      "2026-09-29T10:00:00.000Z",
    );
    expect(projectLastTouched(conversations, "/projects/content")).toBeNull();
  });
});
