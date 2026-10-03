import { I18nKey } from "#/i18n/declaration";

/** The spec collected from the New Project dialog before any conversation
 * exists. `name` is required; the rest shape the scaffold prompt. */
export interface WebgenNewProjectSpec {
  name: string;
  description: string;
  needsDatabase: boolean;
  needsAuth: boolean;
}

/** App-name rule: a lowercase slug the agent can use verbatim as the
 * `webgen/<name>/` directory and the compose/service name. Starts with a
 * letter or digit, then letters/digits/hyphens, max 64 chars. */
const APP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const APP_NAME_MAX_LENGTH = 64;

export interface WebgenAppNameValidation {
  valid: boolean;
  /** i18n key for the inline error, or null when valid. */
  errorKey: I18nKey | null;
}

/**
 * Validate a webgen app name against the slug rule and the set of names that
 * already exist under `webgen/`. Collision is case-insensitive because the
 * directory and the Docker Compose project name must be unique regardless of
 * case. Returns a stable i18n key rather than a message so the dialog owns the
 * copy.
 */
export function validateWebgenAppName(
  name: string,
  existingNames: readonly string[],
): WebgenAppNameValidation {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, errorKey: I18nKey.DCK$NEW_PROJECT_NAME_REQUIRED };
  }
  if (trimmed.length > APP_NAME_MAX_LENGTH || !APP_NAME_PATTERN.test(trimmed)) {
    return { valid: false, errorKey: I18nKey.DCK$NEW_PROJECT_NAME_INVALID };
  }
  const lowered = trimmed.toLowerCase();
  const collides = existingNames.some(
    (existing) => existing.trim().toLowerCase() === lowered,
  );
  if (collides) {
    return { valid: false, errorKey: I18nKey.DCK$NEW_PROJECT_NAME_TAKEN };
  }
  return { valid: true, errorKey: null };
}

/**
 * Build the initial scaffold prompt from the dialog spec. The whole point of
 * collecting the spec up front is that the agent must NOT turn around and ask
 * for name/DB/auth again — so the prompt states them explicitly and tells the
 * agent to start immediately. A one-line description (when given) rides along
 * so the auto-generated conversation title differs per project.
 */
export function buildWebgenScaffoldPrompt(spec: WebgenNewProjectSpec): string {
  const name = spec.name.trim();
  const description = spec.description.trim();
  const lines: string[] = [
    `Scaffold a new containerized Next.js fullstack app named "${name}" under webgen/, following the web-generator standard. Do not ask me for the app name, database, or auth again — they are specified below. Start scaffolding now.`,
    "",
    `- App name: ${name}`,
    `- Database: ${spec.needsDatabase ? "yes — provision a database per the web-generator standard" : "no"}`,
    `- Auth / login: ${spec.needsAuth ? "yes — include authentication" : "no"}`,
  ];
  if (description.length > 0) {
    lines.push(`- Purpose: ${description}`);
  }
  lines.push(
    "",
    "Pick the first free port ≥ 3000, write .dck.json and .env.example, and apply the antislop skills to all UI, layout, copy, and motion. Verify the deploy with docker compose ps, logs, and an endpoint health check.",
  );
  return lines.join("\n");
}
