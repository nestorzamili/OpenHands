import { useQuery } from "@tanstack/react-query";
import { FileClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  parseDckProjectMeta,
  type DckProjectMeta,
} from "#/dck/project-metadata";

export async function readDckProjectMeta(
  projectPath: string,
): Promise<DckProjectMeta | null> {
  try {
    const buffer = await new FileClient(
      getAgentServerClientOptions(),
    ).downloadFile(`${projectPath}/.dck.json`);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return parseDckProjectMeta(text);
  } catch {
    return null;
  }
}

export function useDckProjectMeta(projectPath: string | null) {
  const active = useActiveBackend();
  const isCloud = active.backend.kind === "cloud";

  return useQuery<DckProjectMeta | null>({
    queryKey: [
      "dck",
      "project-meta",
      projectPath,
      active.backend.id,
      active.orgId,
    ],
    queryFn: () => readDckProjectMeta(projectPath as string),
    enabled: !!projectPath && !isCloud,
    retry: false,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    meta: { disableToast: true },
  });
}
