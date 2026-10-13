import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileClient } from "@openhands/typescript-client/clients";
import { getSnapshot } from "#/api/backend-registry/active-store";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  DCK_MODULES_CONFIG_FILENAME,
  getDckModuleAgentProfileScopeKey,
  parseDckBuiltinModuleOverrides,
  parseDckModulesConfig,
  sanitizeDckModuleAgentProfileAssignmentsByScope,
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
import { useSaveSettings } from "#/hooks/mutation/use-save-settings";
import { useSettings } from "#/hooks/query/use-settings";

export interface DckModulesConfig {
  modules: DckCustomModule[];
  builtinOverrides: DckBuiltinModuleOverride[];
}

type BuiltinEditableFields = Pick<
  DckModule,
  "name" | "iconName" | "description" | "promptTemplate" | "skillNames"
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
    const parsed: unknown = JSON.parse(text);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (!Array.isArray(parsed) &&
        "modules" in parsed &&
        !Array.isArray(parsed.modules)) ||
      (!Array.isArray(parsed) &&
        "builtinOverrides" in parsed &&
        !Array.isArray(parsed.builtinOverrides))
    ) {
      throw new Error("Invalid module registry");
    }
    return {
      modules: parseDckModulesConfig(text, {
        reservedIds: DCK_BUILTIN_MODULE_IDS,
      }),
      builtinOverrides: parseDckBuiltinModuleOverrides(
        text,
        DCK_BUILTIN_MODULE_IDS,
      ),
    };
  } catch (error) {
    if (isSdkHttpStatusError(error, 404)) return EMPTY_CONFIG;
    throw error;
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
  const backendId = active.backend.id;
  const orgId = active.orgId;
  const isCloud = active.backend.kind === "cloud";
  const workspaceRoot = getDckWorkspaceRoot();
  const scopeKey = getDckModuleAgentProfileScopeKey(orgId, workspaceRoot);
  const queryClient = useQueryClient();
  const queryKey = dckModulesConfigQueryKey(backendId, orgId);
  const settingsQuery = useSettings();
  const settings = settingsQuery.data;
  const saveSettings = useSaveSettings();
  const query = useQuery<DckModulesConfig>({
    queryKey,
    queryFn: () => readDckModulesConfig(),
    enabled: !isCloud,
    retry: false,
    staleTime: 1000 * 30,
    meta: { disableToast: true },
  });

  const config = query.data ?? EMPTY_CONFIG;
  const allAssignments = sanitizeDckModuleAgentProfileAssignmentsByScope(
    settings?.dck_module_agent_profile_assignments,
  );
  const agentProfileAssignments = allAssignments[scopeKey] ?? {};
  const persist = useMutation<DckModulesConfig, Error, DckModulesConfig>({
    mutationFn: async (next) => {
      const currentActive = getSnapshot().active;
      if (
        !query.isSuccess ||
        query.isError ||
        isCloud ||
        currentActive.backend.id !== backendId ||
        currentActive.orgId !== orgId
      ) {
        throw new Error("Module registry is unavailable or its scope changed");
      }
      const normalized = {
        ...next,
        modules: reindex(next.modules),
      };
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

  const update = (
    updater: (current: DckModulesConfig) => DckModulesConfig,
  ): Promise<DckModulesConfig> =>
    save(
      updater(queryClient.getQueryData<DckModulesConfig>(queryKey) ?? config),
    );

  const setAgentProfileForModule = async (
    moduleId: string,
    profileId: string | null,
  ): Promise<void> => {
    if (!settingsQuery.isSuccess || settingsQuery.isLoading) {
      throw new Error("Active settings scope has not loaded");
    }
    const currentActive = getSnapshot().active;
    if (
      currentActive.backend.id !== backendId ||
      currentActive.orgId !== orgId
    ) {
      throw new Error("Active settings scope changed");
    }

    const normalizedProfileId = profileId?.trim();
    await saveSettings.mutateAsync({
      dck_module_agent_profile_assignments: {
        [scopeKey]: { [moduleId]: normalizedProfileId || null },
      },
    });
  };

  const upsert = async (
    module: DckCustomModule,
    profileId?: string | null,
  ): Promise<DckModulesConfig> => {
    const next = await update((current) => {
      const exists = current.modules.some((entry) => entry.id === module.id);
      const modules = exists
        ? current.modules.map((entry) =>
            entry.id === module.id ? module : entry,
          )
        : [...current.modules, module];
      return { ...current, modules };
    });
    if (profileId !== undefined) {
      await setAgentProfileForModule(module.id, profileId);
    }
    return next;
  };

  const upsertBuiltinOverride = async (
    id: string,
    fields: BuiltinEditableFields,
    profileId?: string | null,
  ): Promise<DckModulesConfig> => {
    const defaults = getBuiltinDckModules().find((module) => module.id === id);
    if (!defaults) return Promise.reject(new Error("Unknown built-in module"));

    const override: DckBuiltinModuleOverride = { id };
    const keys = ["name", "iconName", "description", "promptTemplate"] as const;
    keys.forEach((key) => {
      if (fields[key] !== defaults[key]) override[key] = fields[key];
    });
    const sameSkillNames =
      fields.skillNames.length === defaults.skillNames.length &&
      fields.skillNames.every(
        (skillName, index) => skillName === defaults.skillNames[index],
      );
    if (!sameSkillNames) override.skillNames = [...fields.skillNames];

    const next = await update((current) => {
      const builtinOverrides = current.builtinOverrides.filter(
        (entry) => entry.id !== id,
      );
      if (Object.keys(override).length > 1) builtinOverrides.push(override);
      return { ...current, builtinOverrides };
    });
    if (profileId !== undefined) {
      await setAgentProfileForModule(id, profileId);
    }
    return next;
  };

  const remove = async (id: string): Promise<DckModulesConfig> => {
    const next = await update((current) => ({
      ...current,
      modules: current.modules.filter((entry) => entry.id !== id),
    }));
    await setAgentProfileForModule(id, null);
    return next;
  };

  const move = (id: string, direction: -1 | 1): Promise<DckModulesConfig> =>
    update((current) => {
      const index = current.modules.findIndex((entry) => entry.id === id);
      if (index === -1) return current;
      const target = index + direction;
      if (target < 0 || target >= current.modules.length) return current;
      const modules = [...current.modules];
      [modules[index], modules[target]] = [modules[target], modules[index]];
      return { ...current, modules };
    });

  return {
    modules: config.modules,
    builtinOverrides: config.builtinOverrides,
    agentProfileAssignments,
    isLoading: query.isLoading || settingsQuery.isLoading,
    isError: query.isError || settingsQuery.isError,
    isFetching: query.isFetching || settingsQuery.isFetching,
    isSaving:
      persist.isPending ||
      saveSettings.isPending ||
      query.isLoading ||
      query.isError ||
      settingsQuery.isLoading ||
      !settingsQuery.isSuccess,
    saveError: persist.error ?? saveSettings.error,
    refetch: async () => {
      await Promise.all([query.refetch(), settingsQuery.refetch()]);
    },
    upsert,
    upsertBuiltinOverride,
    setAgentProfileForModule,
    remove,
    move,
  };
}
