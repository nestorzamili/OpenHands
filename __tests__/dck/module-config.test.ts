import { describe, expect, it } from "vitest";
import {
  buildDckModulePrompt,
  buildModuleFolderDeleteCommand,
  composePromptWithSkillTrigger,
  getDckModuleAgentProfileScopeKey,
  parseDckModuleAgentProfileAssignments,
  parseDckBuiltinModuleOverrides,
  parseDckModulesConfig,
  serializeDckModulesConfig,
  validateCustomModuleDraft,
  type CustomModuleDraft,
  type DckCustomModule,
} from "#/dck/module-config";
import { I18nKey } from "#/i18n/declaration";

function module(overrides: Partial<DckCustomModule>): DckCustomModule {
  return {
    id: "custom-1",
    name: "Email",
    slug: "email",
    iconName: "mail",
    description: "",
    promptTemplate: "Draft an email.",
    skillNames: [],
    order: 0,
    ...overrides,
  };
}

describe("parseDckModulesConfig", () => {
  it("parses a modules array wrapped in an object", () => {
    const raw = JSON.stringify({ modules: [module({})] });
    const result = parseDckModulesConfig(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "custom-1",
      slug: "email",
      order: 0,
    });
  });

  it("parses a bare array too", () => {
    const result = parseDckModulesConfig(JSON.stringify([module({})]));
    expect(result).toHaveLength(1);
  });

  it("drops entries missing required fields", () => {
    const raw = JSON.stringify({
      modules: [
        { id: "a", name: "A", slug: "a" }, // no promptTemplate
        module({ id: "b", slug: "b" }),
      ],
    });
    const result = parseDckModulesConfig(raw);
    expect(result.map((m) => m.id)).toEqual(["b"]);
  });

  it("drops entries whose id or slug collides with a reserved built-in", () => {
    const raw = JSON.stringify({
      modules: [
        module({ id: "webgen", slug: "webgen" }),
        module({ id: "ok", slug: "ok" }),
      ],
    });
    const result = parseDckModulesConfig(raw, {
      reservedIds: ["webgen", "research"],
    });
    expect(result.map((m) => m.id)).toEqual(["ok"]);
  });

  it("drops duplicate ids and slugs, keeping the first", () => {
    const raw = JSON.stringify({
      modules: [
        module({ id: "a", slug: "x" }),
        module({ id: "a", slug: "y" }),
        module({ id: "b", slug: "x" }),
      ],
    });
    const result = parseDckModulesConfig(raw);
    expect(result.map((m) => m.id)).toEqual(["a"]);
  });

  it("rejects slugs that break the folder-name rule", () => {
    const raw = JSON.stringify({ modules: [module({ slug: "Bad Slug" })] });
    expect(parseDckModulesConfig(raw)).toEqual([]);
  });

  it("sorts by order and re-normalizes to a dense sequence", () => {
    const raw = JSON.stringify({
      modules: [
        module({ id: "a", slug: "a", order: 5 }),
        module({ id: "b", slug: "b", order: 2 }),
      ],
    });
    const result = parseDckModulesConfig(raw);
    expect(result.map((m) => [m.id, m.order])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });

  it("returns empty for malformed, empty, or non-array input", () => {
    expect(parseDckModulesConfig("{ broken")).toEqual([]);
    expect(parseDckModulesConfig("")).toEqual([]);
    expect(parseDckModulesConfig(null)).toEqual([]);
    expect(parseDckModulesConfig(JSON.stringify({ modules: "nope" }))).toEqual(
      [],
    );
  });

  it("reads valid and stale assignments for one-time migration from the module config", () => {
    const raw = JSON.stringify({
      modules: [],
      agentProfileAssignments: {
        research: "deleted-profile",
        analytics: "  profile-two  ",
        content: null,
        invalid: "   ",
      },
    });

    expect(parseDckModuleAgentProfileAssignments(raw)).toEqual({
      research: "deleted-profile",
      analytics: "profile-two",
      content: null,
    });
  });
});

describe("serializeDckModulesConfig", () => {
  it("round-trips through the parser and re-indexes order", () => {
    const input = [
      module({ id: "a", slug: "a", order: 9 }),
      module({ id: "b", slug: "b", order: 3 }),
    ];
    const text = serializeDckModulesConfig(input);
    const parsed = parseDckModulesConfig(text);
    expect(parsed.map((m) => [m.id, m.order])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("round-trips sparse built-in overrides without altering custom modules", () => {
    const override = {
      id: "research",
      name: "Desk Research",
      description: "",
      skillNames: ["research-brief", "seo-audit"],
    };
    const text = serializeDckModulesConfig([module({})], [override]);

    expect(parseDckModulesConfig(text)).toHaveLength(1);
    expect(
      parseDckBuiltinModuleOverrides(text, ["research", "webgen"]),
    ).toEqual([override]);
  });

  it("does not write profile assignments into the module config anymore", () => {
    const text = serializeDckModulesConfig([module({})]);

    expect(JSON.parse(text)).not.toHaveProperty("agentProfileAssignments");
    expect(parseDckModuleAgentProfileAssignments(text)).toEqual({});
  });

  it("keeps un-migrated legacy assignments until server-side persistence succeeds", () => {
    const legacy = { research: "deleted-profile", content: null };
    const text = serializeDckModulesConfig([module({})], [], legacy);

    expect(parseDckModuleAgentProfileAssignments(text)).toEqual(legacy);
  });

  it("keys assignments by organization and normalized stable workspace root", () => {
    expect(
      getDckModuleAgentProfileScopeKey("org-1", "\\projects\\team///"),
    ).toBe('["org-1","/projects/team"]');
    expect(getDckModuleAgentProfileScopeKey(null, "/projects")).toBe(
      '[null,"/projects"]',
    );
  });

  it("drops duplicate, unknown, and invalid built-in override entries", () => {
    const raw = JSON.stringify({
      modules: [],
      builtinOverrides: [
        { id: "research", name: "Desk Research" },
        { id: "research", name: "Duplicate" },
        { id: "missing", name: "Unknown" },
        { id: "webgen", name: "  " },
      ],
    });

    expect(parseDckBuiltinModuleOverrides(raw, ["research", "webgen"])).toEqual(
      [{ id: "research", name: "Desk Research" }],
    );
  });

  it("migrates legacy Skill fields and ignores Persona data without losing links", () => {
    const legacy = JSON.stringify({
      modules: [
        {
          ...module({ skillNames: ["research-brief", "seo-audit"] }),
          skillName: "analytics",
          personaId: "writer",
        },
      ],
      builtinOverrides: [{ id: "research", skillName: "research-brief" }],
      personas: [
        {
          id: "writer",
          name: "Writer",
          roleInstructions: "Write clearly.",
          requiredSkills: ["research-brief"],
          optionalSkills: ["persona-optional"],
        },
      ],
    });
    const parsedModules = parseDckModulesConfig(legacy);
    const parsedOverrides = parseDckBuiltinModuleOverrides(legacy, [
      "research",
    ]);
    const serialized = JSON.parse(
      serializeDckModulesConfig(parsedModules, parsedOverrides),
    );

    expect(parsedModules[0].skillNames).toEqual([
      "research-brief",
      "seo-audit",
      "analytics",
      "persona-optional",
    ]);
    expect(parsedModules[0]).not.toHaveProperty("personaId");
    expect(parsedOverrides[0].skillNames).toEqual(["research-brief"]);
    expect(serialized.modules[0].skillNames).toEqual([
      "research-brief",
      "seo-audit",
      "analytics",
      "persona-optional",
    ]);
    expect(serialized.modules[0]).not.toHaveProperty("skillName");
    expect(serialized.builtinOverrides[0].skillNames).toEqual([
      "research-brief",
    ]);
    expect(serialized.builtinOverrides[0]).not.toHaveProperty("skillName");
    expect(serialized.modules[0]).not.toHaveProperty("personaId");
    expect(serialized).not.toHaveProperty("personas");
  });
});

describe("validateCustomModuleDraft", () => {
  const base: CustomModuleDraft = {
    name: "Email",
    slug: "email",
    iconName: "mail",
    description: "",
    promptTemplate: "Draft an email.",
    skillNames: [],
  };

  it("accepts a valid draft", () => {
    expect(validateCustomModuleDraft(base).valid).toBe(true);
  });

  it("requires a name", () => {
    const result = validateCustomModuleDraft({ ...base, name: "  " });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBe(I18nKey.DCK$MODULE_NAME_REQUIRED);
  });

  it("requires a prompt", () => {
    const result = validateCustomModuleDraft({ ...base, promptTemplate: "" });
    expect(result.errors.promptTemplate).toBe(
      I18nKey.DCK$MODULE_PROMPT_REQUIRED,
    );
  });

  it("rejects an invalid slug", () => {
    const result = validateCustomModuleDraft({ ...base, slug: "Bad Slug" });
    expect(result.errors.slug).toBe(I18nKey.DCK$MODULE_SLUG_INVALID);
  });

  it("rejects a slug reserved by a built-in", () => {
    const result = validateCustomModuleDraft(
      { ...base, slug: "webgen" },
      { reservedSlugs: ["webgen"] },
    );
    expect(result.errors.slug).toBe(I18nKey.DCK$MODULE_SLUG_TAKEN);
  });

  it("rejects a slug already used by another custom module", () => {
    const result = validateCustomModuleDraft(
      { ...base, slug: "taken" },
      { existingSlugs: ["taken"] },
    );
    expect(result.errors.slug).toBe(I18nKey.DCK$MODULE_SLUG_TAKEN);
  });
});

describe("buildModuleFolderDeleteCommand", () => {
  it("includes the target path and an rm -rf instruction", () => {
    const command = buildModuleFolderDeleteCommand("Email", "/projects/email");
    expect(command).toContain("rm -rf /projects/email");
    expect(command).toContain("Email");
    expect(command).toContain("irreversible");
  });
});

describe("composePromptWithSkillTrigger", () => {
  it("appends the first trigger when the prompt lacks any", () => {
    const result = composePromptWithSkillTrigger("Write a report.", [
      "analytics",
      "sql",
    ]);
    expect(result).toBe("Write a report.\n\nUse the analytics skill for this.");
  });

  it("leaves the prompt unchanged when a trigger is already present", () => {
    const result = composePromptWithSkillTrigger(
      "Run an analytics pass on the data.",
      ["analytics"],
    );
    expect(result).toBe("Run an analytics pass on the data.");
  });

  it("matches triggers case-insensitively", () => {
    const result = composePromptWithSkillTrigger("Do some ANALYTICS now.", [
      "analytics",
    ]);
    expect(result).toBe("Do some ANALYTICS now.");
  });

  it("returns the prompt unchanged when there are no triggers", () => {
    expect(composePromptWithSkillTrigger("Hello.", [])).toBe("Hello.");
  });
});

describe("buildDckModulePrompt", () => {
  it("activates every selected catalog Skill and leaves the task unchanged when none is linked", () => {
    const triggers = new Map([
      ["email-writing", ["email writing"]],
      ["seo-audit", ["SEO audit"]],
    ]);

    expect(
      buildDckModulePrompt(
        "Draft a launch email.",
        ["email-writing", "seo-audit"],
        triggers,
      ),
    ).toBe(
      "Draft a launch email.\n\nUse the email writing skill for this.\n\nUse the SEO audit skill for this.",
    );
    expect(buildDckModulePrompt("Draft a launch email.", [], triggers)).toBe(
      "Draft a launch email.",
    );
  });
});
