import { I18nKey } from "#/i18n/declaration";

const AGENTS_DIR_NAME = ".agents";
const OPENHANDS_DIR_NAME = ".openhands";
const SKILLS_SUBDIR_NAME = "skills";
const MICROAGENTS_SUBDIR_NAME = "microagents";
export const SKILLS_DIR_SEGMENT = `${AGENTS_DIR_NAME}/${SKILLS_SUBDIR_NAME}`;
export const SKILL_FILE_NAME = "SKILL.md";
const MARKDOWN_FILE_EXTENSION = ".md";

export const SKILL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SLUG_MAX_LENGTH = 64;
const NAME_MAX_LENGTH = 64;

export interface SkillMarkdownFields {
  name: string;
  description: string;
  triggers: string[];
  body: string;
}

export interface SkillFilePathParts {
  directory: string;
  fileName: string;
}

/**
 * Return the directory and filename only for files in a supported skills
 * location. Keeping this allow-list at the write boundary prevents a skill's
 * `source` value from becoming an arbitrary filesystem write target.
 */
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

/** Remove YAML frontmatter for the live Markdown preview, preserving body text. */
export function extractSkillMarkdownBody(raw: string): string {
  const frontmatter = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return frontmatter ? raw.slice(frontmatter[0].length) : raw;
}

function escapeYamlScalar(value: string): string {
  const needsQuote = /^[\s"'#:>|*&!%@`{}[\],]|[:#]\s|\s$/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : inner;
  }
  return trimmed;
}

/**
 * Parse a SKILL.md file into its frontmatter fields and Markdown body.
 *
 * Only the fields the DCK editor owns are extracted (`name`, `description`,
 * `triggers`); any other frontmatter keys are ignored on read (and dropped on
 * the next serialize, which is acceptable for editor-authored skills). A file
 * without frontmatter yields empty fields and the whole text as the body, so
 * the editor still opens rather than erroring.
 */
export function parseSkillMarkdown(raw: string | null): SkillMarkdownFields {
  const empty: SkillMarkdownFields = {
    name: "",
    description: "",
    triggers: [],
    body: "",
  };
  if (!raw) return empty;

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { ...empty, body: raw.trim() };
  }

  const [, frontmatter, body] = match;
  const lines = frontmatter.split(/\r?\n/);

  let name = "";
  let description = "";
  const triggers: string[] = [];
  let inTriggers = false;

  for (const line of lines) {
    const triggerItem = line.match(/^\s*-\s+(.*)$/);
    if (inTriggers && triggerItem) {
      const value = unquoteYamlScalar(triggerItem[1]);
      if (value.length > 0) triggers.push(value);
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyValue) continue;
    const [, key, rest] = keyValue;
    inTriggers = false;

    if (key === "name") {
      name = unquoteYamlScalar(rest);
    } else if (key === "description") {
      description = unquoteYamlScalar(rest);
    } else if (key === "triggers") {
      inTriggers = true;
      // Inline list form: `triggers: [a, b]`
      const inline = rest.trim();
      if (inline.startsWith("[") && inline.endsWith("]")) {
        inline
          .slice(1, -1)
          .split(",")
          .map((item) => unquoteYamlScalar(item))
          .filter((item) => item.length > 0)
          .forEach((item) => triggers.push(item));
        inTriggers = false;
      }
    }
  }

  return {
    name,
    description,
    triggers,
    body: body.trim(),
  };
}

/**
 * Serialize editor fields back into a SKILL.md document: a YAML frontmatter
 * block (name, description, and a triggers list when non-empty) followed by the
 * Markdown body. Deterministic output so re-saving an unchanged skill produces
 * no spurious diff.
 */
export function serializeSkillMarkdown(fields: SkillMarkdownFields): string {
  const name = fields.name.trim();
  const description = fields.description.trim();
  const triggers = fields.triggers
    .map((trigger) => trigger.trim())
    .filter((trigger) => trigger.length > 0);
  const body = fields.body.trim();

  const lines: string[] = ["---", `name: ${escapeYamlScalar(name)}`];
  if (description.length > 0) {
    lines.push(`description: ${escapeYamlScalar(description)}`);
  }
  if (triggers.length > 0) {
    lines.push("triggers:");
    triggers.forEach((trigger) => {
      lines.push(`  - ${escapeYamlScalar(trigger)}`);
    });
  }
  lines.push("---", "");
  return `${lines.join("\n")}\n${body}\n`;
}

export interface SkillDraft {
  name: string;
  slug: string;
  description: string;
  triggers: string[];
  body: string;
}

export interface ValidateSkillDraftOptions {
  /** Slugs already taken by other project skills (exclude the one being edited). */
  existingSlugs?: readonly string[];
  /** Names reserved by public/built-in skills, to avoid shadowing confusion. */
  reservedNames?: readonly string[];
}

export interface SkillDraftValidation {
  valid: boolean;
  errors: {
    name: I18nKey | null;
    slug: I18nKey | null;
    body: I18nKey | null;
  };
}

export function validateSkillDraft(
  draft: SkillDraft,
  options: ValidateSkillDraftOptions = {},
): SkillDraftValidation {
  const name = draft.name.trim();
  const slug = draft.slug.trim().toLowerCase();
  const body = draft.body.trim();

  const existingSlugs = new Set(options.existingSlugs ?? []);
  const reservedNames = new Set(
    (options.reservedNames ?? []).map((entry) => entry.toLowerCase()),
  );

  let nameError: I18nKey | null = null;
  if (name.length === 0) {
    nameError = I18nKey.DCK$SKILL_NAME_REQUIRED;
  } else if (name.length > NAME_MAX_LENGTH) {
    nameError = I18nKey.DCK$SKILL_NAME_INVALID;
  } else if (reservedNames.has(name.toLowerCase())) {
    nameError = I18nKey.DCK$SKILL_NAME_TAKEN;
  }

  let slugError: I18nKey | null = null;
  if (slug.length === 0) {
    slugError = I18nKey.DCK$SKILL_SLUG_REQUIRED;
  } else if (slug.length > SLUG_MAX_LENGTH || !SKILL_SLUG_PATTERN.test(slug)) {
    slugError = I18nKey.DCK$SKILL_SLUG_INVALID;
  } else if (existingSlugs.has(slug)) {
    slugError = I18nKey.DCK$SKILL_SLUG_TAKEN;
  }

  let bodyError: I18nKey | null = null;
  if (body.length === 0) {
    bodyError = I18nKey.DCK$SKILL_BODY_REQUIRED;
  }

  return {
    valid: !nameError && !slugError && !bodyError,
    errors: { name: nameError, slug: slugError, body: bodyError },
  };
}

export function skillDirPath(workspaceRoot: string, slug: string): string {
  return `${workspaceRoot.replace(/\/+$/, "")}/${SKILLS_DIR_SEGMENT}/${slug}`;
}

export function skillFilePath(workspaceRoot: string, slug: string): string {
  return `${skillDirPath(workspaceRoot, slug)}/${SKILL_FILE_NAME}`;
}

export interface SkillDeleteTarget {
  kind: "directory" | "file";
  path: string;
}

/** Resolve only supported skill files to the exact file/folder removed on delete. */
export function getSkillDeleteTarget(
  filePath: string,
): SkillDeleteTarget | null {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = getSkillFilePathParts(normalized);
  if (!parts) return null;

  if (parts.fileName.toLowerCase() === SKILL_FILE_NAME.toLowerCase()) {
    return { kind: "directory", path: parts.directory };
  }

  const segments = normalized.split("/").filter(Boolean);
  const microagentsIndex = segments.findIndex(
    (segment, index) =>
      segment === OPENHANDS_DIR_NAME &&
      segments[index + 1] === MICROAGENTS_SUBDIR_NAME,
  );
  if (
    microagentsIndex !== -1 &&
    segments.length === microagentsIndex + 3 &&
    parts.fileName.toLowerCase().endsWith(MARKDOWN_FILE_EXTENSION)
  ) {
    return { kind: "file", path: normalized };
  }

  return null;
}

/** Build a shell-safe delete command for a previously confirmed skill target. */
export function buildSkillDeleteCommand(filePath: string): string {
  const target = getSkillDeleteTarget(filePath);
  if (!target) throw new Error("Unsupported skill delete target");

  const quotedPath = `'${target.path.replace(/'/g, "'\\''")}'`;
  const command = target.kind === "directory" ? "rm -rf --" : "rm -f --";
  return `${command} ${quotedPath}`;
}
