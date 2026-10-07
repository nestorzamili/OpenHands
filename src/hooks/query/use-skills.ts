import { useQuery } from "@tanstack/react-query";
import SkillsService from "#/api/skills-service";
import { SkillInfo } from "#/types/settings";

/**
 * @param projectDir Workspace root to load project skills from. Conversation
 *   views pass the conversation's own workspace so the catalog matches the
 *   skills loaded into that conversation; the global Skills page omits it and
 *   loads skills from both the active project and the DCK workspace.
 */
export const useSkills = (projectDir?: string) =>
  useQuery<SkillInfo[]>({
    queryKey:
      projectDir === undefined
        ? ["skills", "settings"]
        : ["skills", projectDir],
    queryFn: () =>
      projectDir === undefined
        ? SkillsService.getSettingsSkills()
        : SkillsService.getSkills(projectDir),
    staleTime: 1000 * 60 * 10, // 10 minutes – skill list rarely changes
    refetchOnWindowFocus: false,
  });
