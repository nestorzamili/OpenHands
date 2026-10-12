import React from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BackNavButton } from "#/components/shared/buttons/back-nav-button";
import { ConversationStatusDot } from "#/components/features/conversation-panel/conversation-status-dot";
import { ProjectRow } from "#/components/features/dck/project-row";
import { WebgenProjectTable } from "#/components/features/dck/webgen-project-table";
import { WebgenNewProjectDialog } from "#/components/features/dck/webgen-new-project-dialog";
import { WebgenOwnerSeedDialog } from "#/components/features/dck/webgen-owner-seed-dialog";
import type { WebgenOwnerSeedInput } from "#/components/features/dck/webgen-owner-seed-fields";
import {
  useAllConversationsQuery,
  useOpenConversation,
} from "#/components/features/dck/use-dck-conversations";
import { useSearchSubdirs } from "#/hooks/query/use-search-subdirs";
import { useWebgenProjects } from "#/hooks/query/use-webgen-projects";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectSkills } from "#/hooks/query/use-project-skills";
import { formatRelativeTime } from "#/utils/format-relative-time";
import { buildDckModulePrompt } from "#/dck/module-config";
import {
  buildWebgenScaffoldPrompt,
  type WebgenNewProjectSpec,
} from "#/dck/webgen-new-project";
import { type WebgenLifecycleAction } from "#/dck/webgen-lifecycle";
import {
  isWebgenOwnerSeedReentryRequired,
  runWebgenLifecycleAction,
  type WebgenProjectStatus,
} from "#/dck/webgen-service";
import {
  authorizeWebgenOwnerSeedDeploy,
  isOwnerSeedReentryRequired,
  stageWebgenOwnerSeed,
} from "#/dck/webgen-owner-seed-service";
import {
  DCK_COPY,
  conversationWorkingDir,
  conversationsForBase,
  flattenConversationPages,
  findDckModuleById,
  mergeDckModules,
  type DckModule,
} from "#/dck/modules";
import { useDckModulesConfig } from "#/hooks/query/use-dck-modules-config";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import { DckModuleAgentProfileSummary } from "#/components/features/dck/dck-module-agent-profile-selector";
import {
  getDckModuleAgentProfileIdForLaunch,
  isDckModuleAgentProfileSelectionBlocked,
  resolveDckModuleAgentProfileSelection,
} from "#/hooks/use-dck-module-agent-profiles";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import type { ProjectEntry } from "#/components/features/dck/project-row";

interface PendingOwnerSeedDeploy {
  appName: string;
  projectPath: string;
  conversationId: string;
  action: "deploy" | "rebuild";
}

function ListState({
  state,
  onRetry,
  emptyText,
  emptyCta,
}: {
  state: "loading" | "error" | "empty";
  onRetry?: () => void;
  emptyText: string;
  emptyCta?: React.ReactNode;
}) {
  const { t } = useTranslation("openhands");

  if (state === "loading") {
    return (
      <p data-testid="dck-list-loading" className="text-sm text-text-tertiary">
        {t(I18nKey.DCK$LOADING)}
      </p>
    );
  }

  if (state === "error") {
    return (
      <div
        data-testid="dck-list-error"
        className="flex flex-col items-start gap-2"
      >
        <p className="text-sm text-text-tertiary">
          {t(I18nKey.DCK$LOAD_ERROR)}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid="dck-list-retry"
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-accent hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t(I18nKey.DCK$RETRY)}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="dck-list-empty"
      className="flex flex-col items-start gap-3"
    >
      <p className="text-sm text-text-tertiary">{emptyText}</p>
      {emptyCta}
    </div>
  );
}

function ModuleProjectsList({
  dckModule,
  conversations,
  openPath,
  isCreating,
  dispatchLifecycle,
  conversationsAuthLoading,
  conversationsLoaded,
  conversationsLoading,
  conversationsError,
  emptyCta,
}: {
  dckModule: DckModule;
  conversations: AppConversation[];
  openPath: (path: string) => void;
  isCreating: boolean;
  dispatchLifecycle: (
    path: string,
    action: WebgenLifecycleAction,
    appName: string,
    authProvider: string | null,
    subdomain?: string,
  ) => Promise<boolean>;
  conversationsAuthLoading: boolean;
  conversationsLoaded: boolean;
  conversationsLoading: boolean;
  conversationsError: boolean;
  emptyCta?: React.ReactNode;
}) {
  const isWebgen = dckModule.id === "webgen";
  const subdirs = useSearchSubdirs(dckModule.workspacePath);
  const runtimeProjectsQuery = useWebgenProjects(isWebgen);
  const runtimeProjects = runtimeProjectsQuery.data?.projects ?? [];
  const entries = React.useMemo(() => {
    const entriesByName = new Map<string, ProjectEntry>(
      (subdirs.data?.items ?? []).map((entry) => [entry.name, entry]),
    );
    if (isWebgen) {
      runtimeProjects.forEach((project: WebgenProjectStatus) => {
        if (!entriesByName.has(project.slug)) {
          entriesByName.set(project.slug, {
            name: project.slug,
            path: project.path,
          });
        }
      });
    }
    const resolvedEntries = [...entriesByName.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    return resolvedEntries;
  }, [isWebgen, runtimeProjects, subdirs.data]);
  const hasProjectSource = Boolean(
    subdirs.data || (isWebgen && runtimeProjectsQuery.data),
  );
  const bothProjectSourcesFailed =
    subdirs.isError && (!isWebgen || runtimeProjectsQuery.isError);

  if (bothProjectSourcesFailed || conversationsError) {
    return (
      <ListState
        state="error"
        onRetry={() => {
          void subdirs.refetch();
          if (isWebgen) void runtimeProjectsQuery.refetch();
        }}
        emptyText={DCK_COPY.noProjects}
      />
    );
  }
  if (
    (!hasProjectSource &&
      (subdirs.isLoading || runtimeProjectsQuery.isLoading)) ||
    conversationsAuthLoading ||
    conversationsLoading ||
    !conversationsLoaded
  ) {
    return <ListState state="loading" emptyText={DCK_COPY.noProjects} />;
  }
  if (entries.length === 0) {
    return (
      <ListState
        state="empty"
        emptyText={DCK_COPY.noProjects}
        emptyCta={emptyCta}
      />
    );
  }

  if (isWebgen) {
    return (
      <WebgenProjectTable
        entries={entries}
        conversations={conversations}
        onOpen={openPath}
        isBusy={isCreating}
        runtimeProjects={runtimeProjects}
        dispatchLifecycle={dispatchLifecycle}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li key={entry.path}>
          <ProjectRow
            entry={entry}
            conversations={conversations}
            onOpen={openPath}
            isBusy={isCreating}
          />
        </li>
      ))}
    </ul>
  );
}

function ModuleConversationsList({
  dckModule,
  conversations,
  openPath,
  isLoading,
  isError,
  onRetry,
  emptyCta,
}: {
  dckModule: DckModule;
  conversations: AppConversation[];
  openPath: (path: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyCta?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation("openhands");
  const matches = React.useMemo(
    () => conversationsForBase(conversations, dckModule.workspacePath),
    [conversations, dckModule.workspacePath],
  );

  if (isLoading) {
    return <ListState state="loading" emptyText={DCK_COPY.noConversations} />;
  }
  if (isError) {
    return (
      <ListState
        state="error"
        onRetry={onRetry}
        emptyText={DCK_COPY.noConversations}
      />
    );
  }
  if (matches.length === 0) {
    return (
      <ListState
        state="empty"
        emptyText={DCK_COPY.noConversations}
        emptyCta={emptyCta}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {matches.map((conversation) => (
        <li key={conversation.id}>
          <button
            type="button"
            onClick={() =>
              openPath(
                conversationWorkingDir(conversation) ?? dckModule.workspacePath,
              )
            }
            data-testid="dck-module-conversation-row"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface"
          >
            <ConversationStatusDot
              executionStatus={conversation.execution_status}
              sandboxStatus={conversation.sandbox_status}
            />
            <span className="min-w-0 flex-1 truncate text-sm text-contrast">
              {conversation.title ?? conversation.id}
            </span>
            <span className="shrink-0 text-xs text-text-tertiary">
              {formatRelativeTime(conversation.updated_at, i18n.language, t)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ModuleDetailView({
  dckModule,
}: {
  dckModule: DckModule | null;
}) {
  const { t } = useTranslation("openhands");
  const {
    conversations,
    isAuthLoading: conversationsAuthLoading,
    hasData: conversationsLoaded,
    isLoading: conversationsLoading,
    isError: conversationsError,
    refetch: refetchConversations,
  } = useAllConversationsQuery();
  const { openPath, ensureConversation, createScoped, isCreating } =
    useOpenConversation();
  const queryClient = useQueryClient();
  const { skills } = useProjectSkills();
  const triggersBySkill = React.useMemo(() => {
    const map = new Map<string, string[]>();
    skills.forEach((skill) => map.set(skill.name, skill.triggers));
    return map;
  }, [skills]);
  const agentProfilesQuery = useAgentProfiles();
  const agentProfiles = agentProfilesQuery.data?.profiles ?? [];
  const isCheckingAgentProfiles = Boolean(
    agentProfilesQuery.isLoading || agentProfilesQuery.isFetching,
  );
  const { agentProfileAssignments } = useDckModulesConfig();
  const moduleProfileSelection = dckModule
    ? resolveDckModuleAgentProfileSelection(
        dckModule.id,
        agentProfileAssignments,
        agentProfiles,
        isCheckingAgentProfiles,
      )
    : { status: "unassigned" as const };
  const moduleAgentProfileId = getDckModuleAgentProfileIdForLaunch(
    moduleProfileSelection,
  );
  const moduleProfileSelectionBlocked = isDckModuleAgentProfileSelectionBlocked(
    moduleProfileSelection,
  );
  const moduleProfileSelectionBlockedMessage =
    moduleProfileSelection.status === "unassigned" ||
    moduleProfileSelection.status === "unavailable"
      ? t(I18nKey.DCK$MODULE_AGENT_PROFILE_STALE)
      : moduleProfileSelection.status === "checking"
        ? t(I18nKey.DCK$MODULE_AGENT_PROFILE_CHECKING, {
            id: moduleProfileSelection.profileId,
          })
        : undefined;
  const moduleLaunchOptions = {
    agentProfileId: moduleAgentProfileId,
    canCreateNew: !moduleProfileSelectionBlocked,
    blockedMessage: moduleProfileSelectionBlockedMessage,
  };
  const buildModulePrompt = (taskPrompt: string) =>
    dckModule
      ? buildDckModulePrompt(taskPrompt, dckModule.skillNames, triggersBySkill)
      : taskPrompt;
  const [showNewProjectDialog, setShowNewProjectDialog] = React.useState(false);
  const [pendingOwnerSeedDeploy, setPendingOwnerSeedDeploy] =
    React.useState<PendingOwnerSeedDeploy | null>(null);
  const [pendingLifecycleSlug, setPendingLifecycleSlug] = React.useState<
    string | null
  >(null);
  const lifecycleBusy = isCreating || Boolean(pendingLifecycleSlug);
  const lifecycleUiBlocked = lifecycleBusy || Boolean(pendingOwnerSeedDeploy);
  const [isSubmittingOwnerSeed, setIsSubmittingOwnerSeed] =
    React.useState(false);
  const pendingSeedConversation = React.useRef<{
    workingDir: string;
    conversationId: string;
  } | null>(null);

  // Existing webgen project names, used to block duplicate names in the New
  // Project dialog. Only the webgen module needs this; the query is gated on
  // the module being webgen so other modules don't fetch it.
  const isWebgenModule = dckModule?.id === "webgen";
  const webgenSubdirs = useSearchSubdirs(
    isWebgenModule ? (dckModule?.workspacePath ?? null) : null,
  );
  const existingWebgenNames = React.useMemo(
    () => (webgenSubdirs.data?.items ?? []).map((entry) => entry.name),
    [webgenSubdirs.data],
  );

  if (!dckModule) {
    return (
      <div className="min-h-full">
        <div className="mx-auto max-w-4xl p-6">
          <div className="flex flex-col gap-4">
            <BackNavButton to="/conversations">
              {t(I18nKey.DCK$BACK_TO_HOME)}
            </BackNavButton>
            <p
              data-testid="dck-module-not-found"
              className="text-sm text-text-tertiary"
            >
              {t(I18nKey.DCK$MODULE_NOT_FOUND)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const Icon = dckModule.icon;
  const getCurrentConversations = async (): Promise<AppConversation[]> => {
    if (
      conversationsLoaded &&
      !conversationsLoading &&
      !conversationsAuthLoading &&
      !conversationsError
    ) {
      return conversations;
    }
    const refreshed = await refetchConversations();
    if (refreshed.isError) {
      throw refreshed.error ?? new Error("Unable to load conversations");
    }
    return flattenConversationPages(refreshed.data?.pages);
  };
  const open = (path: string) => {
    void (async () => {
      try {
        await openPath(
          path,
          await getCurrentConversations(),
          undefined,
          moduleLaunchOptions,
        );
      } catch (error) {
        displayErrorToast(error instanceof Error ? error.message : null);
      }
    })();
  };
  const performWebgenAction = async (
    appName: string,
    action: WebgenLifecycleAction,
    options: { subdomain?: string; conversationId?: string } = {},
  ) => {
    await runWebgenLifecycleAction(appName, {
      action,
      ...(options.subdomain ? { subdomain: options.subdomain } : {}),
      ...(options.conversationId
        ? { conversation_id: options.conversationId }
        : {}),
    });
    await queryClient.invalidateQueries({
      queryKey: ["dck", "webgen-projects"],
    });
    if (action === "delete") {
      await queryClient.invalidateQueries({
        queryKey: ["file", "search_subdirs"],
      });
    }
  };

  const dispatchLifecycle = async (
    path: string,
    action: WebgenLifecycleAction,
    appName: string,
    authProvider: string | null,
    subdomain?: string,
  ): Promise<boolean> => {
    if (pendingLifecycleSlug || pendingOwnerSeedDeploy) return false;
    setPendingLifecycleSlug(appName);
    let conversationId: string | undefined;
    try {
      if (
        (action === "deploy" || action === "rebuild") &&
        authProvider === "better-auth"
      ) {
        if (moduleProfileSelectionBlocked) {
          displayErrorToast(
            moduleProfileSelectionBlockedMessage ??
              t(I18nKey.DCK$MODULE_AGENT_PROFILE_STALE),
          );
          return false;
        }
        conversationId = await ensureConversation(
          path,
          await getCurrentConversations(),
          moduleAgentProfileId,
        );
        try {
          await authorizeWebgenOwnerSeedDeploy(appName, conversationId, path);
        } catch (error) {
          if (isOwnerSeedReentryRequired(error)) {
            setPendingOwnerSeedDeploy({
              appName,
              projectPath: path,
              conversationId,
              action,
            });
            return false;
          }
          throw error;
        }
      }
      await performWebgenAction(appName, action, {
        ...(subdomain ? { subdomain } : {}),
        ...(conversationId ? { conversationId } : {}),
      });
      return true;
    } catch (error) {
      if (
        (action === "deploy" || action === "rebuild") &&
        isWebgenOwnerSeedReentryRequired(error) &&
        conversationId
      ) {
        setPendingOwnerSeedDeploy({
          appName,
          projectPath: path,
          conversationId,
          action,
        });
        return false;
      }
      displayErrorToast(error instanceof Error ? error.message : null);
      return false;
    } finally {
      setPendingLifecycleSlug(null);
    }
  };

  const handleNewWebgenProject = async (
    spec: WebgenNewProjectSpec,
    seed?: WebgenOwnerSeedInput,
  ) => {
    if (moduleProfileSelectionBlocked) {
      displayErrorToast(
        moduleProfileSelectionBlockedMessage ??
          t(I18nKey.DCK$MODULE_AGENT_PROFILE_STALE),
      );
      return;
    }
    const requiresOwnerSeed = spec.needsAuth && spec.authProvider !== "other";
    if (requiresOwnerSeed && !seed) {
      displayErrorToast(t(I18nKey.DCK$OWNER_SEED_REQUIRED));
      return;
    }
    const prompt = (verificationKey?: string) =>
      buildModulePrompt(buildWebgenScaffoldPrompt(spec, verificationKey));
    const pending = pendingSeedConversation.current;
    const succeeded =
      requiresOwnerSeed && seed
        ? await createScoped(
            dckModule!.workspacePath,
            "",
            moduleAgentProfileId,
            {
              ...(pending?.workingDir === dckModule!.workspacePath
                ? { conversationId: pending.conversationId }
                : {}),
              prepareInitialMessage: async (conversationId) => {
                pendingSeedConversation.current = {
                  workingDir: dckModule!.workspacePath,
                  conversationId,
                };
                const staged = await stageWebgenOwnerSeed(
                  spec.name,
                  conversationId,
                  dckModule!.workspacePath,
                  seed,
                );
                return prompt(staged.verification_key);
              },
            },
          )
        : await createScoped(
            dckModule!.workspacePath,
            prompt(),
            moduleAgentProfileId,
          );
    if (succeeded) {
      pendingSeedConversation.current = null;
      setShowNewProjectDialog(false);
    }
  };

  const handleOwnerSeedReentry = async (seed: WebgenOwnerSeedInput) => {
    if (!pendingOwnerSeedDeploy) return;
    setIsSubmittingOwnerSeed(true);
    setPendingLifecycleSlug(pendingOwnerSeedDeploy.appName);
    try {
      await stageWebgenOwnerSeed(
        pendingOwnerSeedDeploy.appName,
        pendingOwnerSeedDeploy.conversationId,
        pendingOwnerSeedDeploy.projectPath,
        seed,
      );
      await authorizeWebgenOwnerSeedDeploy(
        pendingOwnerSeedDeploy.appName,
        pendingOwnerSeedDeploy.conversationId,
        pendingOwnerSeedDeploy.projectPath,
      );
      await performWebgenAction(
        pendingOwnerSeedDeploy.appName,
        pendingOwnerSeedDeploy.action,
        { conversationId: pendingOwnerSeedDeploy.conversationId },
      );
      setPendingOwnerSeedDeploy(null);
    } catch (error) {
      displayErrorToast(error instanceof Error ? error.message : null);
    } finally {
      setPendingLifecycleSlug(null);
      setIsSubmittingOwnerSeed(false);
    }
  };

  let headerAction: React.ReactNode = null;
  if (dckModule.kind === "projects") {
    const onNewProject = isWebgenModule
      ? () => setShowNewProjectDialog(true)
      : () =>
          void createScoped(
            dckModule.workspacePath,
            buildModulePrompt(dckModule.promptTemplate),
            moduleAgentProfileId,
          );
    headerAction = (
      <button
        type="button"
        disabled={isCreating || moduleProfileSelectionBlocked}
        onClick={onNewProject}
        data-testid="dck-module-new-project"
        className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm font-medium text-accent hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        {t(I18nKey.PROJECT$NEW_PROJECT)}
      </button>
    );
  } else if (dckModule.kind === "conversations") {
    headerAction = (
      <button
        type="button"
        disabled={isCreating || moduleProfileSelectionBlocked}
        onClick={() =>
          void createScoped(
            dckModule.workspacePath,
            buildModulePrompt(dckModule.promptTemplate),
            moduleAgentProfileId,
          )
        }
        data-testid="dck-module-new-conversation"
        className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm font-medium text-accent hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        {t(I18nKey.COMMON$NEW_CONVERSATION)}
      </button>
    );
  }

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-4xl p-6">
        <div className="flex flex-col gap-6">
          <BackNavButton to="/conversations">
            {t(I18nKey.DCK$BACK_TO_HOME)}
          </BackNavButton>
          <div
            data-testid={`dck-module-detail-${dckModule.id}`}
            className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Icon size={24} className="mt-0.5 shrink-0 text-text-secondary" />
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-xl font-semibold text-contrast">
                  {dckModule.name}
                </h1>
                {dckModule.description && (
                  <p className="text-sm text-text-tertiary">
                    {dckModule.description}
                  </p>
                )}
              </div>
            </div>
            {headerAction}
          </div>
          <div className="max-w-md rounded-lg border border-border bg-base-secondary p-3">
            <DckModuleAgentProfileSummary
              moduleId={dckModule.id}
              profiles={agentProfiles}
              selection={moduleProfileSelection}
            />
          </div>
          <div className="flex flex-col">
            {dckModule.kind === "projects" && (
              <ModuleProjectsList
                dckModule={dckModule}
                conversations={conversations}
                openPath={open}
                isCreating={lifecycleUiBlocked}
                dispatchLifecycle={dispatchLifecycle}
                conversationsAuthLoading={conversationsAuthLoading}
                conversationsLoaded={conversationsLoaded}
                conversationsLoading={conversationsLoading}
                conversationsError={conversationsError}
                emptyCta={headerAction}
              />
            )}
            {dckModule.kind === "conversations" && (
              <ModuleConversationsList
                dckModule={dckModule}
                conversations={conversations}
                openPath={open}
                isLoading={conversationsAuthLoading || conversationsLoading}
                isError={conversationsError}
                onRetry={() => void refetchConversations()}
                emptyCta={headerAction}
              />
            )}
          </div>
        </div>
      </div>
      {isWebgenModule && showNewProjectDialog && (
        <WebgenNewProjectDialog
          existingNames={existingWebgenNames}
          isSubmitting={isCreating}
          profileSelectionBlocked={moduleProfileSelectionBlocked}
          profileSelectionBlockedMessage={moduleProfileSelectionBlockedMessage}
          onCancel={() => setShowNewProjectDialog(false)}
          onSubmit={handleNewWebgenProject}
        />
      )}
      {pendingOwnerSeedDeploy && (
        <WebgenOwnerSeedDialog
          appName={pendingOwnerSeedDeploy.appName}
          isSubmitting={lifecycleBusy || isSubmittingOwnerSeed}
          onCancel={() => setPendingOwnerSeedDeploy(null)}
          onSubmit={(seed) => void handleOwnerSeedReentry(seed)}
        />
      )}
    </div>
  );
}

export default function ModuleDetail() {
  const { moduleId } = useParams();
  const { modules: customModules, builtinOverrides } = useDckModulesConfig();
  const merged = React.useMemo(
    () => mergeDckModules(customModules, builtinOverrides),
    [customModules, builtinOverrides],
  );
  return <ModuleDetailView dckModule={findDckModuleById(merged, moduleId)} />;
}
