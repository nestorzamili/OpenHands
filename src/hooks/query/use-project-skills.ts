import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BashClient, FileClient } from "@openhands/typescript-client/clients";
import SkillsService from "#/api/skills-service";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import {
  getAgentServerHomeDir,
  resolveAbsoluteAgentServerPath,
} from "#/api/agent-server-home";
import { getAgentServerWorkingDir } from "#/api/agent-server-config";
import { getDckWorkspaceRoot } from "#/dck/modules";
import {
  getSkillFilePathParts,
  SKILL_FILE_NAME,
  SKILLS_DIR_SEGMENT,
  buildSkillDeleteCommand,
  getSkillDeleteTarget,
  serializeSkillMarkdown,
  skillDirPath,
  type SkillMarkdownFields,
} from "#/dck/skill-authoring";
import { useActiveBackend } from "#/contexts/active-backend-context";
import type { SkillInfo } from "#/types/settings";
import {
  getSkillScope,
  isBuiltinSkill,
  type SkillScope,
} from "#/utils/skill-scope";

const OPENHANDS_SKILLS_DIR_SEGMENT = ".openhands/skills";
const OPENHANDS_MICROAGENTS_DIR_SEGMENT = ".openhands/microagents";
const OPENHANDS_DIR_PREFIX = ".openhands/";
const LEGACY_MARKDOWN_FILE_EXTENSION = ".md";

export interface ProjectSkillSummary {
  name: string;
  description: string | null;
  content?: string | null;
  triggers: string[];
  source: string | null;
  scope: SkillScope;
  /** Origin and storage scope are deliberately independent. */
  builtin: boolean;
  /** True only when a supported source file path is known. */
  editable: boolean;
  /** True when this custom skill resolves to a supported file delete target. */
  deletable: boolean;
  filePath: string | null;
}

function getFileClient(): FileClient {
  return new FileClient(getAgentServerClientOptions());
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isAbsolutePath(path: string): boolean {
  return /^([/\\]|[a-zA-Z]:[/\\])/.test(path);
}

function joinPath(root: string, child: string): string {
  return `${root.replace(/[/\\]+$/, "")}/${child.replace(/^[/\\]+/, "")}`;
}

function isSinglePathSegment(value: string): boolean {
  return (
    Boolean(value) && value !== "." && value !== ".." && !/[\\/]/.test(value)
  );
}

function skillPathCandidates(root: string, name: string): string[] {
  return [
    joinPath(root, `${SKILLS_DIR_SEGMENT}/${name}/${SKILL_FILE_NAME}`),
    joinPath(
      root,
      `${OPENHANDS_SKILLS_DIR_SEGMENT}/${name}/${SKILL_FILE_NAME}`,
    ),
    joinPath(
      root,
      `${OPENHANDS_MICROAGENTS_DIR_SEGMENT}/${name}/${SKILL_FILE_NAME}`,
    ),
    joinPath(
      root,
      `${OPENHANDS_MICROAGENTS_DIR_SEGMENT}/${name}${LEGACY_MARKDOWN_FILE_EXTENSION}`,
    ),
  ];
}

async function resolvePathlessSkillSource(
  skill: SkillInfo,
  scope: SkillScope,
  fileClient: FileClient,
): Promise<string | null> {
  if (!isSinglePathSegment(skill.name) || scope === "public") return null;

  let roots: string[];
  if (scope === "personal") {
    try {
      roots = [await getAgentServerHomeDir()];
    } catch {
      return null;
    }
  } else {
    roots = [getDckWorkspaceRoot()];
    try {
      roots.push(
        await resolveAbsoluteAgentServerPath(getAgentServerWorkingDir()),
      );
    } catch {
      // The DCK workspace candidate is still useful if home lookup is unavailable.
    }
  }

  const candidates = [
    ...new Set(roots.flatMap((root) => skillPathCandidates(root, skill.name))),
  ];
  const existingPaths = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const content = await fileClient.downloadTextFile(candidate);
        return typeof content === "string" ? candidate : null;
      } catch {
        return null;
      }
    }),
  );
  const existing = [
    ...new Set(existingPaths.filter((path): path is string => path !== null)),
  ];
  // If duplicate copies exist in the same scope, do not guess which one the
  // server loaded. The skill remains visible, but not editable from this UI.
  return existing.length === 1 ? existing[0] : null;
}

async function resolveSkillFilePath(
  skill: SkillInfo,
  fileClient: FileClient,
): Promise<{ scope: SkillScope; filePath: string | null }> {
  const scope = getSkillScope(skill, getAgentServerWorkingDir());
  if (isBuiltinSkill(skill)) return { scope, filePath: null };

  const source = skill.source?.trim();
  if (source) {
    const normalizedSource = normalizePath(source);
    const sourceParts = getSkillFilePathParts(normalizedSource);
    if (sourceParts) {
      if (isAbsolutePath(normalizedSource)) {
        return { scope, filePath: normalizedSource };
      }
      if (scope === "personal") {
        return {
          scope,
          filePath: joinPath(await getAgentServerHomeDir(), normalizedSource),
        };
      }
      if (
        normalizedSource.startsWith(`${SKILLS_DIR_SEGMENT}/`) ||
        normalizedSource.startsWith(OPENHANDS_DIR_PREFIX)
      ) {
        const root = await resolveAbsoluteAgentServerPath(
          getAgentServerWorkingDir(),
        );
        return { scope, filePath: joinPath(root, normalizedSource) };
      }
      return {
        scope,
        filePath: await resolveAbsoluteAgentServerPath(normalizedSource),
      };
    }
    // Sources such as "user" and "project" are scope labels, not file paths.
    // Other path-like or URL values are not safe write targets.
    if (/[\\/]|:\/\//.test(normalizedSource)) return { scope, filePath: null };
  }

  return {
    scope,
    filePath: await resolvePathlessSkillSource(skill, scope, fileClient),
  };
}

async function toSummary(
  skill: SkillInfo,
  fileClient: FileClient,
): Promise<ProjectSkillSummary> {
  const scope = getSkillScope(skill, getAgentServerWorkingDir());
  let filePath: string | null = null;
  try {
    filePath = (await resolveSkillFilePath(skill, fileClient)).filePath;
  } catch {
    // Preserve the skill in the manager if path discovery is unavailable.
  }
  const fileParts = filePath ? getSkillFilePathParts(filePath) : null;
  return {
    name: skill.name,
    description: skill.description ?? null,
    content: skill.content ?? null,
    triggers: skill.triggers ?? [],
    source: skill.source ?? null,
    scope,
    builtin: isBuiltinSkill(skill),
    editable: Boolean(fileParts && filePath),
    deletable: Boolean(
      !isBuiltinSkill(skill) && filePath && getSkillDeleteTarget(filePath),
    ),
    filePath: fileParts ? filePath : null,
  };
}

export async function readSkillFile(
  filePath: string,
  fileClient: FileClient = getFileClient(),
): Promise<string> {
  if (!getSkillFilePathParts(filePath)) {
    throw new Error("Unsupported skill file path");
  }
  return fileClient.downloadTextFile(filePath);
}

export async function writeSkillFile(
  filePath: string,
  source: string,
  fileClient: FileClient = getFileClient(),
): Promise<void> {
  const parts = getSkillFilePathParts(filePath);
  if (!parts || !isAbsolutePath(filePath)) {
    throw new Error("Unsupported skill file path");
  }
  await fileClient.uploadTextFile(source, parts.directory, parts.fileName);
}

export async function deleteSkillFile(filePath: string): Promise<void> {
  if (!isAbsolutePath(filePath) || !getSkillDeleteTarget(filePath)) {
    throw new Error("Unsupported skill delete path");
  }

  const client = new BashClient(getAgentServerClientOptions());
  try {
    const output = await client.executeCommand(
      buildSkillDeleteCommand(filePath),
    );
    if (output.exit_code !== 0) {
      throw new Error(output.stderr || "Skill deletion command failed");
    }
  } finally {
    client.close();
  }
}

export async function writeProjectSkill(
  slug: string,
  fields: SkillMarkdownFields,
  fileClient: FileClient = getFileClient(),
): Promise<void> {
  await fileClient.uploadTextFile(
    serializeSkillMarkdown(fields),
    skillDirPath(getDckWorkspaceRoot(), slug),
    "SKILL.md",
  );
}

export function useProjectSkills() {
  const active = useActiveBackend();
  const isCloud = active.backend.kind === "cloud";
  const queryClient = useQueryClient();
  const listKey = ["skills"];
  const managerKey = ["dck", "skills", active.backend.id, active.orgId];
  const query = useQuery<ProjectSkillSummary[]>({
    queryKey: managerKey,
    queryFn: async () => {
      const skills = await SkillsService.getSettingsSkills();
      const fileClient = getFileClient();
      return Promise.all(skills.map((skill) => toSummary(skill, fileClient)));
    },
    enabled: !isCloud,
    retry: false,
    staleTime: 1000 * 60,
    meta: { disableToast: true },
  });
  const skills = query.data ?? [];
  const editableSkills = skills.filter((skill) => skill.editable);
  const readOnlySkills = skills.filter((skill) => !skill.editable);

  const save = useMutation<
    void,
    Error,
    { slug: string; fields: SkillMarkdownFields }
  >({
    mutationFn: ({ slug, fields }) => writeProjectSkill(slug, fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({ queryKey: managerKey });
    },
  });
  const saveSource = useMutation<
    void,
    Error,
    { filePath: string; source: string }
  >({
    mutationFn: ({ filePath, source }) => writeSkillFile(filePath, source),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({ queryKey: managerKey });
    },
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: deleteSkillFile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
      void queryClient.invalidateQueries({ queryKey: managerKey });
    },
  });

  return {
    skills,
    editableSkills,
    readOnlySkills,
    isLoading: query.isLoading,
    isError: query.isError,
    isSaving: save.isPending || saveSource.isPending,
    isDeleting: remove.isPending,
    saveSkill: (slug: string, fields: SkillMarkdownFields) =>
      save.mutateAsync({ slug, fields }),
    saveSkillSource: (filePath: string, source: string) =>
      saveSource.mutateAsync({ filePath, source }),
    deleteSkill: (filePath: string) => remove.mutateAsync(filePath),
    refetch: query.refetch,
  };
}
