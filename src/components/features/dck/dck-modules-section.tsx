import React from "react";
import { useTranslation } from "react-i18next";
import { useSearchSubdirs } from "#/hooks/query/use-search-subdirs";
import { NavigationLink } from "#/components/shared/navigation-link";
import { I18nKey } from "#/i18n/declaration";
import {
  extensionModuleCardGridClassName,
  extensionModuleCardGridContainerClassName,
  extensionModuleCardSurfaceClassName,
} from "#/utils/extension-module-card-classes";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import {
  DCK_COPY,
  getDckModules,
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
      className="mt-1 shrink-0 self-start text-xs font-medium text-indigo-400 hover:text-indigo-300"
    >
      {t(I18nKey.FEATURED_AUTOMATIONS$VIEW_ALL)}
    </NavigationLink>
  );
}

function ProjectsCard({
  module,
  onNewProject,
  isCreating,
}: {
  module: DckModule;
  onNewProject: () => void;
  isCreating: boolean;
}) {
  const { t } = useTranslation("openhands");
  const subdirs = useSearchSubdirs(module.workspacePath);
  const count = subdirs.data?.items?.length ?? 0;

  return (
    <ModuleCardShell
      module={module}
      count={formatProjectCount(count)}
      action={
        <button
          type="button"
          disabled={isCreating}
          onClick={onNewProject}
          className="shrink-0 text-xs font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
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
}: {
  module: DckModule;
  conversations: AppConversation[];
  createNew: (workingDir: string, promptTemplate?: string) => void;
  isCreating: boolean;
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
      action={
        <button
          type="button"
          disabled={isCreating}
          onClick={() => createNew(module.workspacePath, module.promptTemplate)}
          className="shrink-0 text-xs font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
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
  const conversations = useAllConversations();
  const { createScoped, isCreating } = useOpenConversation();
  const modules = getDckModules();
  const createNew = (workingDir: string, promptTemplate?: string) =>
    void createScoped(workingDir, promptTemplate ?? "");

  // Webgen uses a spec dialog (name/description/DB/auth) before creating a
  // conversation, so the first message carries the spec and the agent starts
  // scaffolding without a round-trip of clarifying questions.
  const webgenModule = modules.find((module) => module.id === "webgen") ?? null;
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
      <h2 className="text-base font-semibold text-contrast">
        {DCK_COPY.modules}
      </h2>
      <div className={extensionModuleCardGridClassName}>
        {modules.map((module) => {
          if (module.kind === "projects") {
            return (
              <ProjectsCard
                key={module.id}
                module={module}
                onNewProject={
                  module.id === "webgen"
                    ? () => setShowWebgenDialog(true)
                    : () =>
                        createNew(module.workspacePath, module.promptTemplate)
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
              isCreating={isCreating}
            />
          );
        })}
      </div>
      {webgenModule && showWebgenDialog && (
        <WebgenNewProjectDialog
          existingNames={existingWebgenNames}
          isSubmitting={isCreating}
          onCancel={() => setShowWebgenDialog(false)}
          onSubmit={(spec: WebgenNewProjectSpec) => {
            void createScoped(
              webgenModule.workspacePath,
              buildWebgenScaffoldPrompt(spec),
            );
            setShowWebgenDialog(false);
          }}
        />
      )}
    </section>
  );
}

function ModuleCardShell({
  module,
  count,
  action,
  children,
}: {
  module: DckModule;
  count: string | null;
  action: React.ReactNode;
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
      <div className="flex min-h-0 flex-col">{children}</div>
    </section>
  );
}
