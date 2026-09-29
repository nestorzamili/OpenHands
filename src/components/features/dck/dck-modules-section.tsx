import React from "react";
import { useTranslation } from "react-i18next";
import { useCreateConversation } from "#/hooks/mutation/use-create-conversation";
import { usePaginatedConversations } from "#/hooks/query/use-paginated-conversations";
import { useSearchSubdirs } from "#/hooks/query/use-search-subdirs";
import { useCanvasExtensions } from "#/hooks/query/use-canvas-extensions";
import { useNavigation } from "#/context/navigation-context";
import { ConversationStatusDot } from "#/components/features/conversation-panel/conversation-status-dot";
import { NavigationLink } from "#/components/shared/navigation-link";
import { I18nKey } from "#/i18n/declaration";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { formatRelativeTime } from "#/utils/format-relative-time";
import {
  extensionModuleCardGridClassName,
  extensionModuleCardGridContainerClassName,
  extensionModuleCardSurfaceClassName,
} from "#/utils/extension-module-card-classes";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import {
  DCK_COPY,
  DCK_MODULES,
  conversationWorkingDir,
  conversationsForBase,
  extensionEntryPath,
  flattenConversationPages,
  formatProjectCount,
  latestConversationForPath,
  type DckModule,
} from "#/dck/modules";

function useAllConversations(): AppConversation[] {
  const query = usePaginatedConversations(50);
  return React.useMemo(
    () => flattenConversationPages(query.data?.pages),
    [query.data],
  );
}

function useOpenConversation() {
  const { navigate } = useNavigation();
  const { mutateAsync: createConversation, isPending } =
    useCreateConversation();

  const openPath = React.useCallback(
    async (workingDir: string, conversations: AppConversation[]) => {
      const existing = latestConversationForPath(conversations, workingDir);
      if (existing) {
        navigate(`/conversations/${existing.id}`);
        return;
      }
      try {
        const data = await createConversation({
          workingDir,
          entryPoint: "dck_module",
        });
        navigate(`/conversations/${data.conversation_id}`);
      } catch (error) {
        displayErrorToast(error instanceof Error ? error.message : null);
      }
    },
    [createConversation, navigate],
  );

  return { openPath, isCreating: isPending };
}

function ProjectsCard({
  module,
  conversations,
  openPath,
  isCreating,
}: {
  module: DckModule;
  conversations: AppConversation[];
  openPath: (workingDir: string) => void;
  isCreating: boolean;
}) {
  const { t } = useTranslation("openhands");
  const subdirs = useSearchSubdirs(module.workspacePath);
  const entries = React.useMemo(
    () =>
      [...(subdirs.data?.items ?? [])].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    [subdirs.data],
  );

  return (
    <ModuleCardShell
      module={module}
      count={formatProjectCount(entries.length)}
      action={
        <button
          type="button"
          disabled={isCreating}
          onClick={() => openPath(module.workspacePath)}
          className="shrink-0 text-xs font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
        >
          {t(I18nKey.PROJECT$NEW_PROJECT)}
        </button>
      }
    >
      {entries.length === 0 ? (
        <p className="text-xs text-text-tertiary">{DCK_COPY.noProjects}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => {
            const latest = latestConversationForPath(conversations, entry.path);
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  disabled={isCreating}
                  onClick={() => openPath(entry.path)}
                  data-testid="dck-project-row"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface disabled:opacity-50"
                >
                  {latest && (
                    <ConversationStatusDot
                      executionStatus={latest.execution_status}
                      sandboxStatus={latest.sandbox_status}
                    />
                  )}
                  <span className="truncate text-xs text-contrast">
                    {entry.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ModuleCardShell>
  );
}

function ExtensionsCard({ module }: { module: DckModule }) {
  const { t } = useTranslation("openhands");
  const extensions = useCanvasExtensions();
  const installed = extensions.data ?? [];

  return (
    <ModuleCardShell
      module={module}
      count={formatProjectCount(installed.length)}
      action={
        <NavigationLink
          to="/apps"
          className="shrink-0 text-xs font-medium text-indigo-400 hover:text-indigo-300"
        >
          {t(I18nKey.FEATURED_AUTOMATIONS$VIEW_ALL)}
        </NavigationLink>
      }
    >
      {installed.length === 0 ? (
        <p className="text-xs text-text-tertiary">{DCK_COPY.noExtensions}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {installed.map((extension) => {
            const to = extensionEntryPath(
              extension.name,
              extension.manifest?.contributes?.pages,
            );
            return (
              <li key={extension.name}>
                <NavigationLink
                  to={to}
                  data-testid="dck-extension-row"
                  className="block truncate rounded-lg px-2 py-1.5 text-left text-xs text-contrast hover:bg-surface"
                >
                  {extension.manifest?.display_name ?? extension.name}
                </NavigationLink>
              </li>
            );
          })}
        </ul>
      )}
    </ModuleCardShell>
  );
}

function ConversationsCard({
  module,
  conversations,
  openPath,
  isCreating,
}: {
  module: DckModule;
  conversations: AppConversation[];
  openPath: (workingDir: string) => void;
  isCreating: boolean;
}) {
  const { t, i18n } = useTranslation("openhands");
  const matches = React.useMemo(
    () => conversationsForBase(conversations, module.workspacePath).slice(0, 3),
    [conversations, module.workspacePath],
  );

  return (
    <ModuleCardShell
      module={module}
      count={formatProjectCount(matches.length)}
      action={
        <button
          type="button"
          disabled={isCreating}
          onClick={() => openPath(module.workspacePath)}
          className="shrink-0 text-xs font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
        >
          {t(I18nKey.COMMON$NEW_CONVERSATION)}
        </button>
      }
    >
      {matches.length === 0 ? (
        <p className="text-xs text-text-tertiary">{DCK_COPY.noConversations}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {matches.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() =>
                  openPath(
                    conversationWorkingDir(conversation) ??
                      module.workspacePath,
                  )
                }
                data-testid="dck-module-conversation-row"
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface"
              >
                <ConversationStatusDot
                  executionStatus={conversation.execution_status}
                  sandboxStatus={conversation.sandbox_status}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-contrast">
                  {conversation.title ?? conversation.id}
                </span>
                <span className="shrink-0 text-xs text-text-tertiary">
                  {formatRelativeTime(
                    conversation.updated_at,
                    i18n.language,
                    t,
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModuleCardShell>
  );
}

export function DckModulesSection() {
  const conversations = useAllConversations();
  const { openPath, isCreating } = useOpenConversation();

  return (
    <section
      data-testid="dck-modules-section"
      className={`${extensionModuleCardGridContainerClassName} flex w-full flex-col gap-3`}
    >
      <h2 className="text-base font-semibold text-contrast">
        {DCK_COPY.modules}
      </h2>
      <div className={extensionModuleCardGridClassName}>
        {DCK_MODULES.map((module) => {
          if (module.kind === "projects") {
            return (
              <ProjectsCard
                key={module.id}
                module={module}
                conversations={conversations}
                openPath={(workingDir) =>
                  void openPath(workingDir, conversations)
                }
                isCreating={isCreating}
              />
            );
          }
          if (module.kind === "extensions") {
            return <ExtensionsCard key={module.id} module={module} />;
          }
          return (
            <ConversationsCard
              key={module.id}
              module={module}
              conversations={conversations}
              openPath={(workingDir) =>
                void openPath(workingDir, conversations)
              }
              isCreating={isCreating}
            />
          );
        })}
      </div>
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
      <p className="text-xs text-text-tertiary">{module.description}</p>
      {count !== null && <p className="text-xs text-text-tertiary">{count}</p>}
      <div className="flex min-h-0 flex-col">{children}</div>
    </section>
  );
}
