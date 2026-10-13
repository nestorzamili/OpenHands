import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileClient } from "@openhands/typescript-client/clients";
import { getSnapshot } from "#/api/backend-registry/active-store";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import { useActiveBackend } from "#/contexts/active-backend-context";
import {
  DCK_MODULES_CONFIG_FILENAME,
  getDckModuleAgentProfileScopeKey,
  parseDckModuleAgentProfileAssignments,
  parseDckBuiltinModuleOverrides,
  parseDckModulesConfig,
  sanitizeDckModuleAgentProfileAssignments,
  sanitizeDckModuleAgentProfileAssignmentsByScope,
  serializeDckModulesConfig,
  type DckBuiltinModuleOverride,
  type DckCustomModule,
  type DckModuleAgentProfileAssignments,
} from "#/dck/module-config";
import {
  DCK_BUILTIN_MODULE_IDS,
  getBuiltinDckModules,
  getDckWorkspaceRoot,
  type DckModule,
} from "#/dck/modules";
import { useSaveSettings } from "#/hooks/mutation/use-save-settings";
import { SETTINGS_QUERY_KEYS } from "#/hooks/query/query-keys";
import { useSettings } from "#/hooks/query/use-settings";
import type { Settings } from "#/types/settings";

export interface DckModulesConfig {
  modules: DckCustomModule[];
  builtinOverrides: DckBuiltinModuleOverride[];
  /** Read only to migrate assignments written by older versions of the app. */
  legacyAgentProfileAssignments: DckModuleAgentProfileAssignments;
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
  legacyAgentProfileAssignments: {},
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
      legacyAgentProfileAssignments:
        parseDckModuleAgentProfileAssignments(text),
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
  const legacyAssignments = sanitizeDckModuleAgentProfileAssignments(
    config.legacyAgentProfileAssignments,
  );
  await fileClient.uploadTextFile(
    serializeDckModulesConfig(
      config.modules,
      config.builtinOverrides,
      Object.keys(legacyAssignments).length > 0 ? legacyAssignments : undefined,
    ),
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

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
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
  const settingsQueryKey = [
    ...SETTINGS_QUERY_KEYS.personal(),
    backendId,
    orgId,
  ];
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
  const hasStoredScope = hasOwn(allAssignments, scopeKey);
  const agentProfileAssignments = allAssignments[scopeKey] ?? {};
  const legacyAssignments = sanitizeDckModuleAgentProfileAssignments(
    config.legacyAgentProfileAssignments,
  );
  const migrationToken = `${backendId}:${scopeKey}`;
  const migrationAttemptedRef = useRef<string | null>(null);
  const [migrationPending, setMigrationPending] = useState(false);
  const [migrationError, setMigrationError] = useState<unknown>(null);

  useEffect(() => {
    if (
      isCloud ||
      !query.isSuccess ||
      !settingsQuery.isSuccess ||
      settingsQuery.isLoading ||
      Object.keys(legacyAssignments).length === 0
    ) {
      return;
    }

    if (hasStoredScope) {
      // The server-backed value is authoritative (including an intentionally
      // empty map); do not resurrect the old workspace-file assignment.
      const cleanupToken = `cleanup:${migrationToken}`;
      if (migrationAttemptedRef.current === cleanupToken) return;
      migrationAttemptedRef.current = cleanupToken;
      queryClient.setQueryData<DckModulesConfig>(queryKey, (current) =>
        current ? { ...current, legacyAgentProfileAssignments: {} } : current,
      );
      void writeDckModulesConfig({
        ...config,
        legacyAgentProfileAssignments: {},
      }).catch(() => undefined);
      return;
    }

    if (migrationAttemptedRef.current === migrationToken) return;
    migrationAttemptedRef.current = migrationToken;
    setMigrationPending(true);
    setMigrationError(null);

    const nextAssignments = {
      ...allAssignments,
      [scopeKey]: legacyAssignments,
    };
    void saveSettings
      .mutateAsync({
        dck_module_agent_profile_assignments: nextAssignments,
      })
      .then(async () => {
        migrationAttemptedRef.current = `cleanup:${migrationToken}`;
        queryClient.setQueryData<DckModulesConfig>(queryKey, (current) =>
          current ? { ...current, legacyAgentProfileAssignments: {} } : current,
        );
        // Best-effort cleanup; settings are already the canonical persisted
        // source if this legacy file write cannot complete.
        await writeDckModulesConfig({
          ...config,
          legacyAgentProfileAssignments: {},
        }).catch(() => undefined);
      })
      .catch((error: unknown) => {
        setMigrationError(error);
      })
      .finally(() => setMigrationPending(false));
  }, [
    allAssignments,
    config,
    hasStoredScope,
    isCloud,
    legacyAssignments,
    migrationToken,
    query.isSuccess,
    queryClient,
    queryKey,
    saveSettings.mutateAsync,
    scopeKey,
    settingsQuery.isLoading,
    settingsQuery.isSuccess,
  ]);

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
        legacyAgentProfileAssignments: sanitizeDckModuleAgentProfileAssignments(
          next.legacyAgentProfileAssignments,
        ),
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

    const latestSettings =
      queryClient.getQueryData<Settings>(settingsQueryKey) ?? settings;
    const latestScopes = sanitizeDckModuleAgentProfileAssignmentsByScope(
      latestSettings?.dck_module_agent_profile_assignments,
    );
    const hasLatestScope = hasOwn(latestScopes, scopeKey);
    const nextScope = {
      ...(hasLatestScope ? latestScopes[scopeKey] : legacyAssignments),
    };
    const normalizedProfileId = profileId?.trim();
    if (normalizedProfileId) {
      nextScope[moduleId] = normalizedProfileId;
    } else {
      nextScope[moduleId] = null;
    }

    await saveSettings.mutateAsync({
      dck_module_agent_profile_assignments: {
        [scopeKey]: hasLatestScope
          ? { [moduleId]: normalizedProfileId || null }
          : nextScope,
      },
    });

    queryClient.setQueryData<DckModulesConfig>(queryKey, (current) =>
      current ? { ...current, legacyAgentProfileAssignments: {} } : current,
    );
    if (Object.keys(legacyAssignments).length > 0) {
      void writeDckModulesConfig({
        ...config,
        legacyAgentProfileAssignments: {},
      }).catch(() => undefined);
    }
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
    const next = await update((current) => {
      const legacyAgentProfileAssignments = {
        ...current.legacyAgentProfileAssignments,
      };
      delete legacyAgentProfileAssignments[id];
      return {
        ...current,
        modules: current.modules.filter((entry) => entry.id !== id),
        legacyAgentProfileAssignments,
      };
    });
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
    isError: query.isError || settingsQuery.isError || migrationError !== null,
    isFetching: query.isFetching || settingsQuery.isFetching,
    isSaving:
      persist.isPending ||
      saveSettings.isPending ||
      migrationPending ||
      query.isLoading ||
      query.isError ||
      settingsQuery.isLoading ||
      !settingsQuery.isSuccess,
    saveError: persist.error ?? saveSettings.error ?? migrationError,
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
