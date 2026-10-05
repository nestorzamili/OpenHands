import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileClient } from "@openhands/typescript-client/clients";
import SkillsService from "#/api/skills-service";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { getDckWorkspaceRoot } from "#/dck/modules";
import {
  parseSkillMarkdown,
  serializeSkillMarkdown,
  skillDirPath,
  skillFilePath,
  type SkillMarkdownFields,
} from "#/dck/skill-authoring";
import { useActiveBackend } from "#/contexts/active-backend-context";
import type { SkillInfo } from "#/types/settings";

export interface ProjectSkillSummary {
  name: string;
  description: string | null;
  triggers: string[];
  /** Whether the skill is an editable project skill or a read-only public one. */
  editable: boolean;
}

function getFileClient(): FileClient {
  return new FileClient(getAgentServerClientOptions());
}

/**
 * A skill is editable here only when it is a workspace/project skill — i.e. not
 * the bundled public catalog (`source: "public"`). The agent-server tags
 * user/project skills with other sources; the home-page list also returns the
 * bundled public set, which we keep but mark read-only.
 */
function isEditableSkill(skill: SkillInfo): boolean {
  return skill.source !== "public";
}

function toSummary(skill: SkillInfo): ProjectSkillSummary {
  return {
    name: skill.name,
    description: skill.description ?? null,
    triggers: skill.triggers ?? [],
    editable: isEditableSkill(skill),
  };
}

export async function readProjectSkill(
  slug: string,
  fileClient: FileClient = getFileClient(),
): Promise<SkillMarkdownFields> {
  const text = await fileClient.downloadTextFile(
    skillFilePath(getDckWorkspaceRoot(), slug),
  );
  return parseSkillMarkdown(text);
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
  const listKey = ["skills", null];

  const query = useQuery<SkillInfo[]>({
    queryKey: ["skills", null, active.backend.id, active.orgId],
    queryFn: () => SkillsService.getSkills(),
    enabled: !isCloud,
    retry: false,
    staleTime: 1000 * 60,
    meta: { disableToast: true },
  });

  const skills = (query.data ?? []).map(toSummary);
  const editableSkills = skills.filter((skill) => skill.editable);
  const publicSkills = skills.filter((skill) => !skill.editable);

  const save = useMutation<
    void,
    Error,
    { slug: string; fields: SkillMarkdownFields }
  >({
    mutationFn: ({ slug, fields }) => writeProjectSkill(slug, fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  return {
    skills,
    editableSkills,
    publicSkills,
    isLoading: query.isLoading,
    isError: query.isError,
    isSaving: save.isPending,
    saveSkill: (slug: string, fields: SkillMarkdownFields) =>
      save.mutateAsync({ slug, fields }),
    refetch: query.refetch,
  };
}
