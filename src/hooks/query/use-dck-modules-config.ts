import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  DCK_MODULES_CONFIG_FILENAME,
  parseDckBuiltinModuleOverrides,
  parseDckModulesConfig,
  serializeDckModulesConfig,
  type DckBuiltinModuleOverride,
  type DckCustomModule,
} from "#/dck/module-config";
import {
  DCK_BUILTIN_MODULE_IDS,
  getBuiltinDckModules,
  getDckWorkspaceRoot,
  type DckModule,
} from "#/dck/modules";

export interface DckModulesConfig {
  modules: DckCustomModule[];
  builtinOverrides: DckBuiltinModuleOverride[];
}

type BuiltinEditableFields = Pick<
  DckModule,
  "name" | "iconName" | "description" | "promptTemplate" | "skillName"
>;

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

const EMPTY_CONFIG: DckModulesConfig = {
  modules: [],
  builtinOverrides: [],
};

export async function readDckModulesConfig(
  fileClient: FileClient = getFileClient(),
): Promise<DckModulesConfig> {
  try {
    const text = await fileClient.downloadTextFile(configPath());
    return {
      modules: parseDckModulesConfig(text, {
        reservedIds: DCK_BUILTIN_MODULE_IDS,
      }),
      builtinOverrides: parseDckBuiltinModuleOverrides(
        text,
        DCK_BUILTIN_MODULE_IDS,
      ),
    };
  } catch {
    return EMPTY_CONFIG;
  }
}

export async function writeDckModulesConfig(
  config: DckModulesConfig,
  fileClient: FileClient = getFileClient(),
): Promise<void> {
  await fileClient.uploadTextFile(
    serializeDckModulesConfig(config.modules, config.builtinOverrides),
    configDir(),
    configFileName(),
  );
}

function dckModulesConfigQueryKey(backendId: string, orgId: string | null) {
  return ["dck", "modules-config", backendId, orgId];
}

function reindex(modules: DckCustomModule[]): DckCustomModule[] {
  return modules.map((module, index) => ({ ...module, order: index }));
}

export function useDckModulesConfig() {
  const active = useActiveBackend();
  const isCloud = active.backend.kind === "cloud";
  const queryClient = useQueryClient();
  const queryKey = dckModulesConfigQueryKey(active.backend.id, active.orgId);

  const query = useQuery<DckModulesConfig>({
    queryKey,
    queryFn: () => readDckModulesConfig(),
    enabled: !isCloud,
    retry: false,
    staleTime: 1000 * 30,
    meta: { disableToast: true },
  });

  const config = query.data ?? EMPTY_CONFIG;

  const persist = useMutation<DckModulesConfig, Error, DckModulesConfig>({
    mutationFn: async (next) => {
      const normalized = { ...next, modules: reindex(next.modules) };
      await writeDckModulesConfig(normalized);
      return normalized;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const save = (next: DckModulesConfig): Promise<DckModulesConfig> =>
    persist.mutateAsync(next);

  const upsert = (module: DckCustomModule): Promise<DckModulesConfig> => {
    const exists = config.modules.some((entry) => entry.id === module.id);
    const modules = exists
      ? config.modules.map((entry) => (entry.id === module.id ? module : entry))
      : [...config.modules, module];
    return save({ ...config, modules });
  };

  const upsertBuiltinOverride = (
    id: string,
    fields: BuiltinEditableFields,
  ): Promise<DckModulesConfig> => {
    const defaults = getBuiltinDckModules().find((module) => module.id === id);
    if (!defaults) return Promise.reject(new Error("Unknown built-in module"));

    const override: DckBuiltinModuleOverride = { id };
    const keys = [
      "name",
      "iconName",
      "description",
      "promptTemplate",
      "skillName",
    ] as const;
    keys.forEach((key) => {
      if (fields[key] !== defaults[key]) override[key] = fields[key];
    });

    const builtinOverrides = config.builtinOverrides.filter(
      (entry) => entry.id !== id,
    );
    if (Object.keys(override).length > 1) builtinOverrides.push(override);
    return save({ ...config, builtinOverrides });
  };

  const remove = (id: string): Promise<DckModulesConfig> =>
    save({
      ...config,
      modules: config.modules.filter((entry) => entry.id !== id),
    });

  const move = (id: string, direction: -1 | 1): Promise<DckModulesConfig> => {
    const index = config.modules.findIndex((entry) => entry.id === id);
    if (index === -1) return Promise.resolve(config);
    const target = index + direction;
    if (target < 0 || target >= config.modules.length)
      return Promise.resolve(config);
    const modules = [...config.modules];
    [modules[index], modules[target]] = [modules[target], modules[index]];
    return save({ ...config, modules });
  };

  return {
    modules: config.modules,
    builtinOverrides: config.builtinOverrides,
    isLoading: query.isLoading,
    isError: query.isError,
    isSaving: persist.isPending,
    saveError: persist.error,
    refetch: query.refetch,
    upsert,
    upsertBuiltinOverride,
    remove,
    move,
  };
}
