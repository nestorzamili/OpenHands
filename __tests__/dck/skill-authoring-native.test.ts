import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  serializeSkillMarkdown,
  validateSkillDraft,
} from "#/dck/skill-authoring";

const container = process.env.OPENHANDS_NATIVE_SKILL_CONTAINER;
const nativeProbe = `
import json, sys, tempfile
from pathlib import Path
import frontmatter
from openhands.sdk.skills import Skill
from openhands.sdk.skills.utils import validate_skill_name

results = []
with tempfile.TemporaryDirectory(prefix="canvas-skill-contract-") as root:
    for index, case in enumerate(json.load(sys.stdin)):
        directory = Path(root) / str(index) / case["slug"]
        directory.mkdir(parents=True)
        path = directory / "SKILL.md"
        path.write_text(case["source"], encoding="utf-8")
        metadata = frontmatter.load(path).metadata
        result = {"errors": validate_skill_name(case["name"], case["slug"]), "metadata": metadata}
        try:
            skill = Skill.load(path, strict=True)
            result["loaded"] = {"name": skill.name, "description": skill.description, "content": skill.content}
        except Exception as error:
            result["error"] = str(error)
        results.append(result)
print(json.dumps(results))
`;

type NativeResult = {
  errors: string[];
  metadata: { name: unknown; description: unknown; triggers?: unknown[] };
  loaded?: { name: string; description: string; content: string };
  error?: string;
};

function loadNative(
  cases: { name: string; slug: string; source: string }[],
): NativeResult[] {
  return JSON.parse(
    execFileSync(
      "sudo",
      [
        "-n",
        "docker",
        "exec",
        "-i",
        "-e",
        "OPENHANDS_SUPPRESS_BANNER=1",
        container!,
        "python",
        "-c",
        nativeProbe,
      ],
      { input: JSON.stringify(cases), encoding: "utf8", timeout: 30000 },
    ),
  );
}

describe.skipIf(!container)("native SDK skill authoring contract", () => {
  it("agrees with native strict validation and loading on name/folder rules", () => {
    const names = [
      "seo-audit",
      "123",
      "yes",
      "SEO Audit",
      "SEO-AUDIT",
      "seo--audit",
      "seo-audit-",
      "-seo-audit",
      "seo_audit",
      "a".repeat(64),
      "a".repeat(65),
    ];
    const drafts = names.map((name) => ({
      name,
      slug: name,
      description: "Instructions",
      triggers: [],
      body: "Do the work.",
    }));
    drafts.push({ ...drafts[0], name: "other-name" });
    const results = loadNative(
      drafts.map((draft) => ({
        ...draft,
        source: serializeSkillMarkdown(draft),
      })),
    );
    for (const [index, draft] of drafts.entries()) {
      const native = results[index];
      expect(validateSkillDraft(draft).valid, JSON.stringify(draft)).toBe(
        native.errors.length === 0,
      );
      if (native.errors.length === 0)
        expect(native.loaded?.name, native.error).toBe(draft.name);
      else expect(native.error).toBeTruthy();
    }
  });

  it("preserves YAML-ambiguous values as strings through the real parser and loader", () => {
    const values = [
      "123",
      "yes",
      "no",
      "true",
      "null",
      "~",
      "1.5",
      "2026-10-21",
      "a: b",
      "line\nbreak",
      'a "quote" \\ path',
      "a, b",
    ];
    const cases = values.map((value, index) => ({
      name: index === 0 ? "123" : index === 1 ? "yes" : "guide",
      slug: index === 0 ? "123" : index === 1 ? "yes" : "guide",
      description: value,
      triggers: [value],
      body: "Instructions.",
    }));
    const results = loadNative(
      cases.map((fields) => ({
        ...fields,
        source: serializeSkillMarkdown(fields),
      })),
    );
    for (const [index, fields] of cases.entries()) {
      expect(results[index].metadata).toEqual({
        name: fields.name,
        description: fields.description,
        triggers: fields.triggers,
      });
      expect(results[index].loaded, results[index].error).toEqual({
        name: fields.name,
        description: fields.description,
        content: fields.body,
      });
    }
  });
});
