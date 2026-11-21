import { describe, expect, it } from "vitest";
import { getSkillFilePathParts } from "#/utils/skill-file-path";

describe("getSkillFilePathParts", () => {
  it.each([
    [
      "/workspace/.agents/skills/guide/SKILL.md",
      "/workspace/.agents/skills/guide",
      "SKILL.md",
    ],
    [
      "/home/user/.openhands/microagents/guide.md",
      "/home/user/.openhands/microagents",
      "guide.md",
    ],
  ])("recognizes supported skill source files", (path, directory, fileName) => {
    expect(getSkillFilePathParts(path)).toEqual({ directory, fileName });
  });

  it.each([
    "/projects/.agents/skills/../../outside.md",
    "/projects/notes/README.md",
  ])("rejects paths outside supported skill files", (path) => {
    expect(getSkillFilePathParts(path)).toBeNull();
  });
});
