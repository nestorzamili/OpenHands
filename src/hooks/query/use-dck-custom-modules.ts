import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  DCK_MODULES_CONFIG_FILENAME,
  parseDckModulesConfig,
  serializeDckModulesConfig,
  type DckCustomModule,
} from "#/dck/module-config";
import { DCK_BUILTIN_MODULE_IDS, getDckWorkspaceRoot } from "#/dck/modules";

function getFileClient(): FileClient {
  return new FileClient(getAgentServerClientOptions());
}

function configDir(): string {
  const [dir] = DCK_MODULES_CONFIG_FILENAME.split("/");
  return `${getDckWorkspaceRoot()}/${dir}`;
}

function configFileName(): string {
  const parts = DCK_MODULES_CONFIG_FILENAME.split("/");
  return parts[parts.length - 1];
}

function configPath(): string {
  return `${getDckWorkspaceRoot()}/${DCK_MODULES_CONFIG_FILENAME}`;
}

export async function readDckCustomModules(
  fileClient: FileClient = getFileClient(),
): Promise<DckCustomModule[]> {
  try {
    const text = await fileClient.downloadTextFile(configPath());
    return parseDckModulesConfig(text, { reservedIds: DCK_BUILTIN_MODULE_IDS });
  } catch {
    return [];
  }
}

export async function writeDckCustomModules(
  modules: DckCustomModule[],
  fileClient: FileClient = getFileClient(),
): Promise<void> {
  await fileClient.uploadTextFile(
    serializeDckModulesConfig(modules),
    configDir(),
    configFileName(),
  );
}

function dckCustomModulesQueryKey(backendId: string, orgId: string | null) {
  return ["dck", "custom-modules", backendId, orgId];
}

export function useDckCustomModules() {
  const active = useActiveBackend();
  const isCloud = active.backend.kind === "cloud";
  const queryClient = useQueryClient();
  const queryKey = dckCustomModulesQueryKey(active.backend.id, active.orgId);

  const query = useQuery<DckCustomModule[]>({
    queryKey,
    queryFn: () => readDckCustomModules(),
    enabled: !isCloud,
    retry: false,
    staleTime: 1000 * 30,
    meta: { disableToast: true },
  });

  const modules = query.data ?? [];

  const persist = useMutation<DckCustomModule[], Error, DckCustomModule[]>({
    mutationFn: async (next) => {
      await writeDckCustomModules(next);
      return next;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const save = (next: DckCustomModule[]): Promise<DckCustomModule[]> =>
    persist.mutateAsync(reindex(next));

  const upsert = (module: DckCustomModule): Promise<DckCustomModule[]> => {
    const exists = modules.some((entry) => entry.id === module.id);
    const next = exists
      ? modules.map((entry) => (entry.id === module.id ? module : entry))
      : [...modules, module];
    return save(next);
  };

  const remove = (id: string): Promise<DckCustomModule[]> =>
    save(modules.filter((entry) => entry.id !== id));

  const move = (id: string, direction: -1 | 1): Promise<DckCustomModule[]> => {
    const index = modules.findIndex((entry) => entry.id === id);
    if (index === -1) return Promise.resolve(modules);
    const target = index + direction;
    if (target < 0 || target >= modules.length) return Promise.resolve(modules);
    const next = [...modules];
    [next[index], next[target]] = [next[target], next[index]];
    return save(next);
  };

  return {
    modules,
    isLoading: query.isLoading,
    isError: query.isError,
    isSaving: persist.isPending,
    saveError: persist.error,
    refetch: query.refetch,
    upsert,
    remove,
    move,
  };
}

function reindex(modules: DckCustomModule[]): DckCustomModule[] {
  return modules.map((module, index) => ({ ...module, order: index }));
}
