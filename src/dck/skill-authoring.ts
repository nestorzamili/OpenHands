import { I18nKey } from "#/i18n/declaration";

export const SKILLS_DIR_SEGMENT = ".agents/skills";
export const SKILL_FILE_NAME = "SKILL.md";

export const SKILL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SLUG_MAX_LENGTH = 64;
const NAME_MAX_LENGTH = 64;

export interface SkillMarkdownFields {
  name: string;
  description: string;
  triggers: string[];
  body: string;
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

/**
 * Agent command that removes a project skill's folder. The frontend FileClient
 * cannot delete files, so folder removal runs as a shell command inside a
 * conversation — the same pattern used for webgen apps and DCK modules.
 */
export function buildSkillFolderDeleteCommand(
  skillName: string,
  dirPath: string,
): string {
  return [
    `Delete the "${skillName}" DCK project skill folder and everything inside it. This is destructive and irreversible.`,
    `Run: rm -rf ${dirPath}`,
    `Confirm the path is correct (${dirPath}) before running, then report what was removed.`,
  ].join("\n");
}
