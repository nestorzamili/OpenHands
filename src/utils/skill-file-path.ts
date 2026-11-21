const AGENTS_DIR_NAME = ".agents";
const OPENHANDS_DIR_NAME = ".openhands";
const SKILLS_SUBDIR_NAME = "skills";
const MICROAGENTS_SUBDIR_NAME = "microagents";
const SKILL_FILE_NAME = "SKILL.md";
const MARKDOWN_FILE_EXTENSION = ".md";

export const SKILLS_DIR_SEGMENT = `${AGENTS_DIR_NAME}/${SKILLS_SUBDIR_NAME}`;

export interface SkillFilePathParts {
  directory: string;
  fileName: string;
}

/** Return path parts only for supported native skill and legacy microagent sources. */
export function getSkillFilePathParts(path: string): SkillFilePathParts | null {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const isSkillMarkdown = (index: number, directoryName: string) =>
    segments[index + 1] === directoryName &&
    Boolean(segments[index + 2]) &&
    segments[index + 3]?.toLowerCase() === SKILL_FILE_NAME.toLowerCase() &&
    index + 4 === segments.length;
  const isLegacyMicroagent = (index: number) =>
    segments[index + 1] === MICROAGENTS_SUBDIR_NAME &&
    segments.length === index + 3 &&
    segments[index + 2]?.toLowerCase().endsWith(MARKDOWN_FILE_EXTENSION);

  const supported = segments.some(
    (segment, index) =>
      (segment === AGENTS_DIR_NAME &&
        isSkillMarkdown(index, SKILLS_SUBDIR_NAME)) ||
      (segment === OPENHANDS_DIR_NAME &&
        (isSkillMarkdown(index, SKILLS_SUBDIR_NAME) ||
          isLegacyMicroagent(index))),
  );
  if (!supported) return null;

  const separatorIndex = normalized.lastIndexOf("/");
  return {
    directory: separatorIndex < 0 ? "." : normalized.slice(0, separatorIndex),
    fileName: normalized.slice(separatorIndex + 1),
  };
}
