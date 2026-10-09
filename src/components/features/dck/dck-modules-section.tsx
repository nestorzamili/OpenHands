import React from "react";
import { useTranslation } from "react-i18next";
import { Activity, Settings2 } from "lucide-react";
import { useSearchSubdirs } from "#/hooks/query/use-search-subdirs";
import { useDckModulesConfig } from "#/hooks/query/use-dck-modules-config";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import {
  getDckModuleAgentProfileIdForLaunch,
  isDckModuleAgentProfileSelectionBlocked,
  resolveDckModuleAgentProfileSelection,
  useDckModuleAgentProfiles,
} from "#/hooks/use-dck-module-agent-profiles";
import { NavigationLink } from "#/components/shared/navigation-link";
import { I18nKey } from "#/i18n/declaration";
import {
  extensionModuleCardGridClassName,
  extensionModuleCardGridContainerClassName,
  extensionModuleCardSurfaceClassName,
} from "#/utils/extension-module-card-classes";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import { DCK_MONITORING_ROUTE_PATH } from "#/dck/monitoring";
import {
  DCK_COPY,
  mergeDckModules,
  conversationsForBase,
  dckModulePath,
  formatProjectCount,
  type DckModule,
} from "#/dck/modules";
import {
  useAllConversations,
  useOpenConversation,
} from "#/components/features/dck/use-dck-conversations";
import { WebgenNewProjectDialog } from "#/components/features/dck/webgen-new-project-dialog";
import { DckModuleManager } from "#/components/features/dck/dck-module-manager";
import { DckModuleAgentProfileSummary } from "#/components/features/dck/dck-module-agent-profile-selector";
import {
  buildWebgenScaffoldPrompt,
  type WebgenNewProjectSpec,
} from "#/dck/webgen-new-project";

function ViewAllLink({ module }: { module: DckModule }) {
  const { t } = useTranslation("openhands");
  return (
    <NavigationLink
      to={dckModulePath(module.id)}
      data-testid={`dck-module-view-all-${module.id}`}
      className="inline-flex min-h-11 shrink-0 items-center self-start rounded-md px-2 text-sm font-medium text-accent hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {t(I18nKey.FEATURED_AUTOMATIONS$VIEW_ALL)}
    </NavigationLink>
  );
}

function ProjectsCard({
  module,
  onNewProject,
  isCreating,
  profileSelectionBlocked,
  profileSummary,
}: {
  module: DckModule;
  onNewProject: () => void;
  isCreating: boolean;
  profileSelectionBlocked: boolean;
  profileSummary: React.ReactNode;
}) {
  const { t } = useTranslation("openhands");
  const subdirs = useSearchSubdirs(module.workspacePath);
  const count = subdirs.data?.items?.length ?? 0;

  return (
    <ModuleCardShell
      module={module}
      count={formatProjectCount(count)}
      profileSummary={profileSummary}
      action={
        <button
          type="button"
          disabled={isCreating || profileSelectionBlocked}
          onClick={onNewProject}
          className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium text-accent hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {t(I18nKey.PROJECT$NEW_PROJECT)}
        </button>
      }
    >
      {count === 0 ? (
        <p className="text-xs text-text-tertiary">{DCK_COPY.noProjects}</p>
      ) : (
        <ViewAllLink module={module} />
      )}
    </ModuleCardShell>
  );
}

function ConversationsCard({
  module,
  conversations,
  createNew,
  isCreating,
  profileSelectionBlocked,
  profileSummary,
  agentProfileId,
}: {
  module: DckModule;
  conversations: AppConversation[];
  createNew: (
    workingDir: string,
    promptTemplate?: string,
    agentProfileId?: string,
  ) => void;
  isCreating: boolean;
  profileSelectionBlocked: boolean;
  profileSummary: React.ReactNode;
  agentProfileId?: string;
}) {
  const { t } = useTranslation("openhands");
  const count = React.useMemo(
    () => conversationsForBase(conversations, module.workspacePath).length,
    [conversations, module.workspacePath],
  );

  return (
    <ModuleCardShell
      module={module}
      count={formatProjectCount(count)}
      profileSummary={profileSummary}
      action={
        <button
          type="button"
          disabled={isCreating || profileSelectionBlocked}
          onClick={() =>
            createNew(
              module.workspacePath,
              module.promptTemplate,
              agentProfileId,
            )
          }
          className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium text-accent hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {t(I18nKey.COMMON$NEW_CONVERSATION)}
        </button>
      }
    >
      {count === 0 ? (
        <p className="text-xs text-text-tertiary">{DCK_COPY.noConversations}</p>
      ) : (
        <ViewAllLink module={module} />
      )}
    </ModuleCardShell>
  );
}

export function DckModulesSection() {
  const { t } = useTranslation("openhands");
  const conversations = useAllConversations();
  const { createScoped, isCreating } = useOpenConversation();
  const { modules: customModules, builtinOverrides } = useDckModulesConfig();
  const agentProfilesQuery = useAgentProfiles();
  const agentProfiles = agentProfilesQuery.data?.profiles ?? [];
  const isCheckingAgentProfiles = Boolean(
    agentProfilesQuery.isLoading || agentProfilesQuery.isFetching,
  );
  const agentProfilesVerified =
    Boolean(agentProfilesQuery.data) &&
    !isCheckingAgentProfiles &&
    !agentProfilesQuery.isError;
  const { assignments, setAgentProfileForModule } = useDckModuleAgentProfiles(
    agentProfiles,
    agentProfilesVerified,
  );
  const activeAgentProfileId =
    agentProfilesQuery.data?.active_agent_profile_id ?? null;
  const modules = React.useMemo(
    () => mergeDckModules(customModules, builtinOverrides),
    [customModules, builtinOverrides],
  );
  const [showModuleManager, setShowModuleManager] = React.useState(false);
  const createNew = (
    workingDir: string,
    promptTemplate?: string,
    agentProfileId?: string,
  ) => void createScoped(workingDir, promptTemplate ?? "", agentProfileId);

  // Webgen uses a spec dialog (name/description/DB/auth) before creating a
  // conversation, so the first message carries the spec and the agent starts
  // scaffolding without a round-trip of clarifying questions.
  const webgenModule = modules.find((module) => module.id === "webgen") ?? null;
  const webgenProfileSelection = webgenModule
    ? resolveDckModuleAgentProfileSelection(
        webgenModule.id,
        assignments,
        agentProfiles,
        isCheckingAgentProfiles,
      )
    : null;
  const webgenAgentProfileId = webgenProfileSelection
    ? getDckModuleAgentProfileIdForLaunch(webgenProfileSelection)
    : undefined;
  const webgenProfileSelectionBlocked = webgenProfileSelection
    ? isDckModuleAgentProfileSelectionBlocked(webgenProfileSelection)
    : false;
  const webgenProfileSelectionBlockedMessage =
    webgenProfileSelection?.status === "unavailable"
      ? t(I18nKey.DCK$MODULE_AGENT_PROFILE_STALE)
      : webgenProfileSelection?.status === "checking"
        ? t(I18nKey.DCK$MODULE_AGENT_PROFILE_CHECKING, {
            id: webgenProfileSelection.profileId,
          })
        : undefined;
  const [showWebgenDialog, setShowWebgenDialog] = React.useState(false);
  const webgenSubdirs = useSearchSubdirs(webgenModule?.workspacePath ?? null);
  const existingWebgenNames = React.useMemo(
    () => (webgenSubdirs.data?.items ?? []).map((entry) => entry.name),
    [webgenSubdirs.data],
  );

  return (
    <section
      data-testid="dck-modules-section"
      className={`${extensionModuleCardGridContainerClassName} flex w-full flex-col gap-3`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-contrast">
          {DCK_COPY.modules}
        </h2>
        <div className="flex flex-wrap items-center gap-1 sm:justify-end">
          <NavigationLink
            to={DCK_MONITORING_ROUTE_PATH}
            data-testid="dck-monitoring-open"
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-accent hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Activity size={14} aria-hidden />
            {t(I18nKey.DCK$MONITORING_TITLE)}
          </NavigationLink>
          <button
            type="button"
            onClick={() => setShowModuleManager(true)}
            data-testid="dck-manage-modules"
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-text-secondary hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Settings2 size={14} aria-hidden />
            {t(I18nKey.DCK$MANAGE_MODULES)}
          </button>
        </div>
      </div>
      <div className={extensionModuleCardGridClassName}>
        {modules.map((module) => {
          const profileSelection = resolveDckModuleAgentProfileSelection(
            module.id,
            assignments,
            agentProfiles,
            isCheckingAgentProfiles,
          );
          const moduleAgentProfileId =
            getDckModuleAgentProfileIdForLaunch(profileSelection);
          const profileSelectionBlocked =
            isDckModuleAgentProfileSelectionBlocked(profileSelection);
          const profileSummary = (
            <DckModuleAgentProfileSummary
              moduleId={module.id}
              profiles={agentProfiles}
              activeAgentProfileId={activeAgentProfileId}
              selection={profileSelection}
            />
          );

          if (module.kind === "projects") {
            return (
              <ProjectsCard
                key={module.id}
                module={module}
                profileSummary={profileSummary}
                profileSelectionBlocked={profileSelectionBlocked}
                onNewProject={
                  module.id === "webgen"
                    ? () => setShowWebgenDialog(true)
                    : () =>
                        createNew(
                          module.workspacePath,
                          module.promptTemplate,
                          moduleAgentProfileId,
                        )
                }
                isCreating={isCreating}
              />
            );
          }
          return (
            <ConversationsCard
              key={module.id}
              module={module}
              conversations={conversations}
              createNew={createNew}
              agentProfileId={moduleAgentProfileId}
              profileSummary={profileSummary}
              isCreating={isCreating}
              profileSelectionBlocked={profileSelectionBlocked}
            />
          );
        })}
      </div>
      {webgenModule && showWebgenDialog && (
        <WebgenNewProjectDialog
          existingNames={existingWebgenNames}
          isSubmitting={isCreating}
          profileSelectionBlocked={webgenProfileSelectionBlocked}
          profileSelectionBlockedMessage={webgenProfileSelectionBlockedMessage}
          onCancel={() => setShowWebgenDialog(false)}
          onSubmit={(spec: WebgenNewProjectSpec) => {
            if (webgenProfileSelectionBlocked) {
              displayErrorToast(
                webgenProfileSelectionBlockedMessage ??
                  t(I18nKey.DCK$MODULE_AGENT_PROFILE_STALE),
              );
              return;
            }
            void createScoped(
              webgenModule.workspacePath,
              buildWebgenScaffoldPrompt(spec),
              webgenAgentProfileId,
            );
            setShowWebgenDialog(false);
          }}
        />
      )}
      {showModuleManager && (
        <DckModuleManager
          onClose={() => setShowModuleManager(false)}
          profiles={agentProfiles}
          activeAgentProfileId={activeAgentProfileId}
          profileAssignments={assignments}
          isCheckingAgentProfiles={isCheckingAgentProfiles}
          setAgentProfileForModule={setAgentProfileForModule}
        />
      )}
    </section>
  );
}

function ModuleCardShell({
  module,
  count,
  action,
  profileSummary,
  children,
}: {
  module: DckModule;
  count: string | null;
  action: React.ReactNode;
  profileSummary: React.ReactNode;
  children: React.ReactNode;
}) {
  const Icon = module.icon;
  return (
    <section
      data-testid={`dck-module-card-${module.id}`}
      className={`${extensionModuleCardSurfaceClassName} flex flex-col gap-3 border border-border p-4`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={18} className="shrink-0 text-text-secondary" />
          <h3 className="truncate text-sm font-semibold text-contrast">
            {module.name}
          </h3>
        </div>
        {action}
      </div>
      {module.description && (
        <p className="text-xs text-text-tertiary">{module.description}</p>
      )}
      {count !== null && (
        <p
          data-testid={`dck-module-count-${module.id}`}
          className="text-xs text-text-tertiary"
        >
          {count}
        </p>
      )}
      {profileSummary}
      <div className="flex min-h-0 flex-col">{children}</div>
    </section>
  );
}
