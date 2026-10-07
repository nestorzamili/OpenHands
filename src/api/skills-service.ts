import { SkillsClient } from "@openhands/typescript-client/clients";
import {
  SKILLS_CATALOG,
  type SkillCatalogEntry,
} from "@openhands/extensions/skills";
import { SkillInfo } from "#/types/settings";
import { getAgentServerWorkingDir } from "./agent-server-config";
import { getDckWorkspaceRoot } from "#/dck/modules";
import {
  getSkillFilePathParts,
  SKILLS_DIR_SEGMENT,
} from "#/dck/skill-authoring";
import { resolveAbsoluteAgentServerPath } from "./agent-server-home";
import { getActiveBackend } from "./backend-registry/active-store";
import {
  fetchCloudConversationSkills,
  fetchCloudSkills,
} from "./cloud/skills-service.api";
import { getAgentServerClientOptions } from "./agent-server-client-options";
import { getSkillScope, isBuiltinSkill } from "#/utils/skill-scope";

const OPENHANDS_DIR_PREFIX = ".openhands/";

async function resolveProjectSkillSource(
  skill: SkillInfo,
  projectDir: string,
): Promise<SkillInfo> {
  const source = skill.source?.trim().replace(/\\/g, "/");
  if (
    !source ||
    !(
      source.startsWith(`${SKILLS_DIR_SEGMENT}/`) ||
      source.startsWith(OPENHANDS_DIR_PREFIX)
    ) ||
    !getSkillFilePathParts(source)
  ) {
    return skill;
  }

  const root = await resolveAbsoluteAgentServerPath(projectDir);
  return {
    ...skill,
    source: `${root.replace(/\/+$/, "")}/${source}`,
  };
}

function settingsSkillIdentity(skill: SkillInfo, projectDir: string): string {
  if (isBuiltinSkill(skill)) return JSON.stringify(["builtin", skill.name]);

  const source = skill.source?.trim() ?? "";
  if (/[\\/]|:\/\//.test(source)) {
    return JSON.stringify(["source", source.replace(/\\/g, "/"), skill.name]);
  }

  const scope = getSkillScope(skill, projectDir);
  return JSON.stringify([
    scope,
    scope === "personal" ? "" : projectDir,
    source,
    skill.name,
  ]);
}

function catalogEntryToSkillInfo(entry: SkillCatalogEntry): SkillInfo {
  return {
    name: entry.name,
    type: "knowledge",
    source: "public",
    description: entry.description,
    triggers: entry.triggers,
    category: entry.category,
    content: entry.content,
    license: entry.license ?? null,
    compatibility: entry.compatibility ?? null,
  };
}

/**
 * Public skills loaded from the `@openhands/extensions` npm package.
 *
 * This is an **immutable build-time snapshot**: the catalog is baked into the
 * bundle at `npm run build` / `vite build` time and does not change at
 * runtime. Updating the catalog requires bumping the `@openhands/extensions`
 * dependency and rebuilding.
 */
const PUBLIC_SKILLS: SkillInfo[] = SKILLS_CATALOG.map(catalogEntryToSkillInfo);

class SkillsService {
  static async getSkills(projectDir?: string): Promise<SkillInfo[]> {
    if (getActiveBackend().backend.kind === "cloud") {
      return fetchCloudSkills();
    }

    // Public skills come from the bundled @openhands/extensions npm package —
    // no agent-server round-trip or GitHub fetch needed. Only ask the agent-
    // server for user and project skills so local .agents/skills/ content is
    // still picked up.
    let localSkills: SkillInfo[] = [];
    try {
      const response = await new SkillsClient(
        getAgentServerClientOptions(),
      ).getSkills({
        load_public: false,
        load_user: true,
        load_project: true,
        load_org: false,
        project_dir: projectDir ?? getAgentServerWorkingDir(),
      });
      localSkills = (response.skills ?? []) as SkillInfo[];
    } catch {
      // Agent-server may not support the skills endpoint or may be
      // unreachable; fall back to the bundled public catalog alone.
    }

    return [...localSkills, ...PUBLIC_SKILLS];
  }

  /**
   * Inventory for Settings: show skills loaded from both the active project
   * directory and the DCK workspace root, while deduplicating shared personal
   * and built-in skills.
   */
  static async getSettingsSkills(): Promise<SkillInfo[]> {
    if (getActiveBackend().backend.kind === "cloud") {
      return this.getSkills();
    }

    const projectDirs = [
      ...new Set([getAgentServerWorkingDir(), getDckWorkspaceRoot()]),
    ];
    const inventories = await Promise.all(
      projectDirs.map(async (projectDir) => {
        const skills = await this.getSkills(projectDir);
        return Promise.all(
          skills.map((skill) => resolveProjectSkillSource(skill, projectDir)),
        );
      }),
    );
    const merged = new Map<string, SkillInfo>();

    inventories.forEach((skills, index) => {
      const projectDir = projectDirs[index];
      if (!projectDir) return;
      skills.forEach((skill) => {
        const identity = settingsSkillIdentity(skill, projectDir);
        if (!merged.has(identity)) merged.set(identity, skill);
      });
    });

    return [...merged.values()];
  }

  /**
   * Skills loaded into a running cloud conversation (see
   * `fetchCloudConversationSkills`). Cloud-only: local conversations keep
   * using `getSkills(projectDir)`, whose agent-server call already scopes to
   * the conversation's workspace.
   */
  static getConversationSkills(conversationId: string): Promise<SkillInfo[]> {
    return fetchCloudConversationSkills(conversationId);
  }
}

export default SkillsService;
