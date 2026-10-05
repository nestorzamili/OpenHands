import { I18nKey } from "#/i18n/declaration";

export const DCK_MODULES_CONFIG_FILENAME = ".dck/modules.json";

export interface DckCustomModule {
  id: string;
  name: string;
  slug: string;
  iconName: string;
  description: string;
  promptTemplate: string;
  /** Optional project/public skill linked to this module. */
  skillName: string;
  order: number;
}

export const DCK_MODULE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SLUG_MAX_LENGTH = 64;
const NAME_MAX_LENGTH = 64;

function coerceString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function coerceOrder(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export interface ParseDckModulesOptions {
  /** Module ids reserved by built-ins; custom entries using them are dropped. */
  reservedIds?: readonly string[];
}

/**
 * Parse the `.dck/modules.json` registry into a sorted list of custom modules.
 *
 * Defensive by design: the file is user- and agent-writable, so malformed
 * entries, blank required fields, ids that collide with a built-in, and
 * duplicate ids/slugs are dropped rather than trusted. The surviving entries
 * are returned sorted by `order` (then by id for stability), and their `order`
 * is re-normalized to a dense 0-based sequence so writers never have to.
 */
export function parseDckModulesConfig(
  raw: string | null,
  options: ParseDckModulesOptions = {},
): DckCustomModule[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { modules?: unknown }).modules)
      ? (parsed as { modules: unknown[] }).modules
      : null;

  if (!list) return [];

  const reservedIds = new Set(options.reservedIds ?? []);
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  const valid: DckCustomModule[] = [];

  list.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const record = entry as Record<string, unknown>;

    const id = coerceString(record.id);
    const name = coerceString(record.name);
    const slug = coerceString(record.slug);
    const promptTemplate = coerceString(record.promptTemplate);
    if (!id || !name || !slug || !promptTemplate) return;

    const loweredSlug = slug.toLowerCase();
    if (!DCK_MODULE_SLUG_PATTERN.test(loweredSlug)) return;
    if (slug.length > SLUG_MAX_LENGTH || name.length > NAME_MAX_LENGTH) return;

    if (reservedIds.has(id) || reservedIds.has(loweredSlug)) return;
    if (seenIds.has(id) || seenSlugs.has(loweredSlug)) return;

    seenIds.add(id);
    seenSlugs.add(loweredSlug);

    valid.push({
      id,
      name,
      slug: loweredSlug,
      iconName: coerceString(record.iconName) ?? "",
      description: coerceString(record.description) ?? "",
      promptTemplate,
      skillName: coerceString(record.skillName) ?? "",
      order: coerceOrder(record.order) ?? index,
    });
  });

  return valid
    .sort((a, b) =>
      a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order,
    )
    .map((module, index) => ({ ...module, order: index }));
}

export function serializeDckModulesConfig(modules: DckCustomModule[]): string {
  const normalized = modules.map((module, index) => ({
    id: module.id,
    name: module.name,
    slug: module.slug,
    iconName: module.iconName,
    description: module.description,
    promptTemplate: module.promptTemplate,
    skillName: module.skillName,
    order: index,
  }));
  return `${JSON.stringify({ modules: normalized }, null, 2)}\n`;
}

export interface CustomModuleDraft {
  name: string;
  slug: string;
  iconName: string;
  description: string;
  promptTemplate: string;
  skillName: string;
}

export interface ValidateCustomModuleOptions {
  reservedIds?: readonly string[];
  reservedSlugs?: readonly string[];
  /** Slugs already taken by other custom modules (exclude the one being edited). */
  existingSlugs?: readonly string[];
}

export interface CustomModuleValidation {
  valid: boolean;
  errors: {
    name: I18nKey | null;
    slug: I18nKey | null;
    promptTemplate: I18nKey | null;
  };
}

export function validateCustomModuleDraft(
  draft: CustomModuleDraft,
  options: ValidateCustomModuleOptions = {},
): CustomModuleValidation {
  const name = draft.name.trim();
  const slug = draft.slug.trim().toLowerCase();
  const promptTemplate = draft.promptTemplate.trim();

  const reservedSlugs = new Set([
    ...(options.reservedSlugs ?? []),
    ...(options.reservedIds ?? []),
  ]);
  const existingSlugs = new Set(options.existingSlugs ?? []);

  let nameError: I18nKey | null = null;
  if (name.length === 0) {
    nameError = I18nKey.DCK$MODULE_NAME_REQUIRED;
  } else if (name.length > NAME_MAX_LENGTH) {
    nameError = I18nKey.DCK$MODULE_NAME_INVALID;
  }

  let slugError: I18nKey | null = null;
  if (slug.length === 0) {
    slugError = I18nKey.DCK$MODULE_SLUG_REQUIRED;
  } else if (
    slug.length > SLUG_MAX_LENGTH ||
    !DCK_MODULE_SLUG_PATTERN.test(slug)
  ) {
    slugError = I18nKey.DCK$MODULE_SLUG_INVALID;
  } else if (reservedSlugs.has(slug) || existingSlugs.has(slug)) {
    slugError = I18nKey.DCK$MODULE_SLUG_TAKEN;
  }

  let promptError: I18nKey | null = null;
  if (promptTemplate.length === 0) {
    promptError = I18nKey.DCK$MODULE_PROMPT_REQUIRED;
  }

  return {
    valid: !nameError && !slugError && !promptError,
    errors: { name: nameError, slug: slugError, promptTemplate: promptError },
  };
}

export function makeCustomModuleId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `custom-${Date.now().toString(36)}-${random}`;
}

/**
 * Ensure a module's opening prompt will auto-activate its linked skill: if the
 * prompt does not already contain one of the skill's triggers (case-insensitive),
 * append a short sentence naming the first trigger. Skills activate from trigger
 * keywords in the first message, so this is what wires a module to its skill.
 */
export function composePromptWithSkillTrigger(
  promptTemplate: string,
  triggers: readonly string[],
): string {
  const prompt = promptTemplate.trim();
  const usableTriggers = triggers
    .map((trigger) => trigger.trim())
    .filter((trigger) => trigger.length > 0);
  if (usableTriggers.length === 0) return prompt;

  const lowered = prompt.toLowerCase();
  const alreadyPresent = usableTriggers.some((trigger) =>
    lowered.includes(trigger.toLowerCase()),
  );
  if (alreadyPresent) return prompt;

  const trigger = usableTriggers[0];
  const suffix = `Use the ${trigger} skill for this.`;
  return prompt.length > 0 ? `${prompt}\n\n${suffix}` : suffix;
}

/**
 * Agent command that removes a module's workspace folder. The frontend
 * FileClient cannot delete files, so folder removal runs as a shell command
 * inside a conversation — mirroring the webgen "delete" lifecycle. The path is
 * confirmed in the prose so the agent can sanity-check before running.
 */
export function buildModuleFolderDeleteCommand(
  moduleName: string,
  workspacePath: string,
): string {
  return [
    `Delete the "${moduleName}" DCK module folder and everything inside it. This is destructive and irreversible.`,
    `Run: rm -rf ${workspacePath}`,
    `Confirm the path is correct (${workspacePath}) before running, then report what was removed.`,
  ].join("\n");
}
