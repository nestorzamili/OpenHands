import { describe, expect, it } from "vitest";
import {
  buildSkillFolderDeleteCommand,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  skillDirPath,
  skillFilePath,
  validateSkillDraft,
  type SkillDraft,
} from "#/dck/skill-authoring";
import { I18nKey } from "#/i18n/declaration";

describe("parseSkillMarkdown", () => {
  it("parses name, description, a triggers list, and the body", () => {
    const raw = [
      "---",
      "name: web-generator",
      "description: Scaffolds apps",
      "triggers:",
      "  - scaffold",
      "  - nextjs",
      "---",
      "",
      "# Web Generator",
      "",
      "Body text.",
    ].join("\n");
    const result = parseSkillMarkdown(raw);
    expect(result.name).toBe("web-generator");
    expect(result.description).toBe("Scaffolds apps");
    expect(result.triggers).toEqual(["scaffold", "nextjs"]);
    expect(result.body).toBe("# Web Generator\n\nBody text.");
  });

  it("parses an inline triggers list", () => {
    const raw = ["---", "name: s", "triggers: [a, b, c]", "---", "body"].join(
      "\n",
    );
    expect(parseSkillMarkdown(raw).triggers).toEqual(["a", "b", "c"]);
  });

  it("treats a file without frontmatter as all body", () => {
    const result = parseSkillMarkdown("Just some notes");
    expect(result.name).toBe("");
    expect(result.triggers).toEqual([]);
    expect(result.body).toBe("Just some notes");
  });

  it("returns empty fields for empty input", () => {
    expect(parseSkillMarkdown("")).toEqual({
      name: "",
      description: "",
      triggers: [],
      body: "",
    });
  });
});

describe("serializeSkillMarkdown", () => {
  it("round-trips through the parser", () => {
    const fields = {
      name: "my-skill",
      description: "Does things",
      triggers: ["foo", "bar"],
      body: "# Title\n\nContent.",
    };
    const parsed = parseSkillMarkdown(serializeSkillMarkdown(fields));
    expect(parsed).toEqual(fields);
  });

  it("omits the triggers block when there are none", () => {
    const text = serializeSkillMarkdown({
      name: "s",
      description: "",
      triggers: [],
      body: "x",
    });
    expect(text).not.toContain("triggers:");
    expect(text).not.toContain("description:");
  });
});

describe("validateSkillDraft", () => {
  const base: SkillDraft = {
    name: "My Skill",
    slug: "my-skill",
    description: "",
    triggers: [],
    body: "Do the thing.",
  };

  it("accepts a valid draft", () => {
    expect(validateSkillDraft(base).valid).toBe(true);
  });

  it("requires a name, slug, and body", () => {
    const result = validateSkillDraft({
      ...base,
      name: "",
      slug: "",
      body: "",
    });
    expect(result.errors.name).toBe(I18nKey.DCK$SKILL_NAME_REQUIRED);
    expect(result.errors.slug).toBe(I18nKey.DCK$SKILL_SLUG_REQUIRED);
    expect(result.errors.body).toBe(I18nKey.DCK$SKILL_BODY_REQUIRED);
  });

  it("rejects an invalid slug", () => {
    expect(validateSkillDraft({ ...base, slug: "Bad Slug" }).errors.slug).toBe(
      I18nKey.DCK$SKILL_SLUG_INVALID,
    );
  });

  it("rejects a slug already used by another project skill", () => {
    const result = validateSkillDraft(
      { ...base, slug: "taken" },
      { existingSlugs: ["taken"] },
    );
    expect(result.errors.slug).toBe(I18nKey.DCK$SKILL_SLUG_TAKEN);
  });

  it("rejects a name that shadows a public skill", () => {
    const result = validateSkillDraft(
      { ...base, name: "docker" },
      { reservedNames: ["docker"] },
    );
    expect(result.errors.name).toBe(I18nKey.DCK$SKILL_NAME_TAKEN);
  });
});

describe("skill path helpers", () => {
  it("builds the dir and file paths under .agents/skills", () => {
    expect(skillDirPath("/projects", "my-skill")).toBe(
      "/projects/.agents/skills/my-skill",
    );
    expect(skillFilePath("/projects", "my-skill")).toBe(
      "/projects/.agents/skills/my-skill/SKILL.md",
    );
  });

  it("builds a destructive delete command naming the path", () => {
    const command = buildSkillFolderDeleteCommand(
      "my-skill",
      "/projects/.agents/skills/my-skill",
    );
    expect(command).toContain("rm -rf /projects/.agents/skills/my-skill");
    expect(command).toContain("irreversible");
  });
});
