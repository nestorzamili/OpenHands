import React from "react";
import { useTranslation } from "react-i18next";
import { Settings2 } from "lucide-react";
import { useSearchSubdirs } from "#/hooks/query/use-search-subdirs";
import { useDckModulesConfig } from "#/hooks/query/use-dck-modules-config";
import { useProjectSkills } from "#/hooks/query/use-project-skills";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import {
  getDckModuleAgentProfileIdForLaunch,
  isDckModuleAgentProfileSelectionBlocked,
  resolveDckModuleAgentProfileSelection,
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
import {
  DCK_COPY,
  mergeDckModules,
  conversationsForBase,
  dckModulePath,
  formatDckModuleCount,
  type DckModule,
} from "#/dck/modules";
import {
  useAllConversations,
  useOpenConversation,
} from "#/components/features/dck/use-dck-conversations";
import { WebgenNewProjectDialog } from "#/components/features/dck/webgen-new-project-dialog";
import type { WebgenOwnerSeedInput } from "#/components/features/dck/webgen-owner-seed-fields";
import { DckModuleManager } from "#/components/features/dck/dck-module-manager";
import { DckModuleAgentProfileSummary } from "#/components/features/dck/dck-module-agent-profile-selector";
import { buildDckModulePrompt } from "#/dck/module-config";
import {
  buildWebgenScaffoldPrompt,
  type WebgenNewProjectSpec,
} from "#/dck/webgen-new-project";
import { stageWebgenOwnerSeed } from "#/dck/webgen-owner-seed-service";

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
      count={formatDckModuleCount(count, module.kind)}
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
      {count > 0 && <ViewAllLink module={module} />}
    </ModuleCardShell>
  );
}

function ConversationsCard({
  module,
  launchPrompt,
  conversations,
  createNew,
  isCreating,
  profileSelectionBlocked,
  profileSummary,
  agentProfileId,
}: {
  module: DckModule;
  launchPrompt: string;
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
      count={formatDckModuleCount(count, module.kind)}
      profileSummary={profileSummary}
      action={
        <button
          type="button"
          disabled={isCreating || profileSelectionBlocked}
          onClick={() =>
            createNew(module.workspacePath, launchPrompt, agentProfileId)
          }
          className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium text-accent hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        >
          {t(I18nKey.COMMON$NEW_CONVERSATION)}
        </button>
      }
    >
      {count > 0 && <ViewAllLink module={module} />}
    </ModuleCardShell>
  );
}

export function DckModulesSection() {
  const { t } = useTranslation("openhands");
  const conversations = useAllConversations();
  const { createScoped, isCreating } = useOpenConversation();
  const {
    modules: customModules,
    builtinOverrides,
    agentProfileAssignments,
  } = useDckModulesConfig();
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
  const modules = React.useMemo(
    () => mergeDckModules(customModules, builtinOverrides),
    [customModules, builtinOverrides],
  );
  const [showModuleManager, setShowModuleManager] = React.useState(false);
  const launchPrompt = (
    module: DckModule,
    taskPrompt = module.promptTemplate,
  ) => buildDckModulePrompt(taskPrompt, module.skillNames, triggersBySkill);
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
        agentProfileAssignments,
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
    webgenProfileSelection?.status === "unassigned" ||
    webgenProfileSelection?.status === "unavailable"
      ? t(I18nKey.DCK$MODULE_AGENT_PROFILE_STALE)
      : webgenProfileSelection?.status === "checking"
        ? t(I18nKey.DCK$MODULE_AGENT_PROFILE_CHECKING, {
            id: webgenProfileSelection.profileId,
          })
        : undefined;
  const [showWebgenDialog, setShowWebgenDialog] = React.useState(false);
  const pendingSeedConversation = React.useRef<{
    workingDir: string;
    conversationId: string;
  } | null>(null);
  const webgenSubdirs = useSearchSubdirs(webgenModule?.workspacePath ?? null);
  const existingWebgenNames = React.useMemo(
    () => (webgenSubdirs.data?.items ?? []).map((entry) => entry.name),
    [webgenSubdirs.data],
  );

  const handleWebgenProjectSubmit = async (
    spec: WebgenNewProjectSpec,
    seed?: WebgenOwnerSeedInput,
  ) => {
    if (!webgenModule) return;
    if (webgenProfileSelectionBlocked) {
      displayErrorToast(
        webgenProfileSelectionBlockedMessage ??
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
      launchPrompt(
        webgenModule,
        buildWebgenScaffoldPrompt(spec, verificationKey),
      );
    const pending = pendingSeedConversation.current;
    const succeeded =
      requiresOwnerSeed && seed
        ? await createScoped(
            webgenModule.workspacePath,
            "",
            webgenAgentProfileId,
            {
              ...(pending?.workingDir === webgenModule.workspacePath
                ? { conversationId: pending.conversationId }
                : {}),
              prepareInitialMessage: async (conversationId) => {
                pendingSeedConversation.current = {
                  workingDir: webgenModule.workspacePath,
                  conversationId,
                };
                const staged = await stageWebgenOwnerSeed(
                  spec.name,
                  conversationId,
                  webgenModule.workspacePath,
                  seed,
                );
                return prompt(staged.verification_key);
              },
            },
          )
        : await createScoped(
            webgenModule.workspacePath,
            prompt(),
            webgenAgentProfileId,
          );
    if (succeeded) {
      pendingSeedConversation.current = null;
      setShowWebgenDialog(false);
    }
  };

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
            agentProfileAssignments,
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
                          launchPrompt(module),
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
              launchPrompt={launchPrompt(module)}
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
          onSubmit={handleWebgenProjectSubmit}
        />
      )}
      {showModuleManager && (
        <DckModuleManager
          onClose={() => setShowModuleManager(false)}
          profiles={agentProfiles}
          isCheckingAgentProfiles={isCheckingAgentProfiles}
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
