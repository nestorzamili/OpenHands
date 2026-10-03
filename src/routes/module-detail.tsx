import React from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BackNavButton } from "#/components/shared/buttons/back-nav-button";
import { ConversationStatusDot } from "#/components/features/conversation-panel/conversation-status-dot";
import { ProjectRow } from "#/components/features/dck/project-row";
import { WebgenProjectTable } from "#/components/features/dck/webgen-project-table";
import { WebgenNewProjectDialog } from "#/components/features/dck/webgen-new-project-dialog";
import {
  useAllConversationsQuery,
  useOpenConversation,
} from "#/components/features/dck/use-dck-conversations";
import { useSearchSubdirs } from "#/hooks/query/use-search-subdirs";
import { formatRelativeTime } from "#/utils/format-relative-time";
import {
  buildWebgenScaffoldPrompt,
  type WebgenNewProjectSpec,
} from "#/dck/webgen-new-project";
import {
  DCK_COPY,
  conversationWorkingDir,
  conversationsForBase,
  getDckModuleById,
  type DckModule,
} from "#/dck/modules";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";

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
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-indigo-400 hover:text-indigo-300"
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
  conversationsLoading,
  conversationsError,
  emptyCta,
}: {
  dckModule: DckModule;
  conversations: AppConversation[];
  openPath: (path: string) => void;
  isCreating: boolean;
  dispatchLifecycle: (path: string, command: string) => void;
  conversationsLoading: boolean;
  conversationsError: boolean;
  emptyCta?: React.ReactNode;
}) {
  const subdirs = useSearchSubdirs(dckModule.workspacePath);
  const entries = React.useMemo(
    () =>
      [...(subdirs.data?.items ?? [])].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    [subdirs.data],
  );

  const isWebgen = dckModule.id === "webgen";

  if (subdirs.isLoading || conversationsLoading) {
    return <ListState state="loading" emptyText={DCK_COPY.noProjects} />;
  }
  if (subdirs.isError || conversationsError) {
    return (
      <ListState
        state="error"
        onRetry={() => void subdirs.refetch()}
        emptyText={DCK_COPY.noProjects}
      />
    );
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
    isLoading: conversationsLoading,
    isError: conversationsError,
    refetch: refetchConversations,
  } = useAllConversationsQuery();
  const { openPath, createScoped, prefillAndOpen, isCreating } =
    useOpenConversation();
  const [showNewProjectDialog, setShowNewProjectDialog] = React.useState(false);

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
  const open = (path: string) => void openPath(path, conversations, undefined);
  const dispatchLifecycle = (path: string, command: string) =>
    void prefillAndOpen(path, conversations, command);

  let headerAction: React.ReactNode = null;
  if (dckModule.kind === "projects") {
    const onNewProject = isWebgenModule
      ? () => setShowNewProjectDialog(true)
      : () =>
          void createScoped(dckModule.workspacePath, dckModule.promptTemplate);
    headerAction = (
      <button
        type="button"
        disabled={isCreating}
        onClick={onNewProject}
        data-testid="dck-module-new-project"
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
      >
        {t(I18nKey.PROJECT$NEW_PROJECT)}
      </button>
    );
  } else if (dckModule.kind === "conversations") {
    headerAction = (
      <button
        type="button"
        disabled={isCreating}
        onClick={() =>
          void createScoped(dckModule.workspacePath, dckModule.promptTemplate)
        }
        data-testid="dck-module-new-conversation"
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
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
            className="flex items-start justify-between gap-3"
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
          <div className="flex flex-col">
            {dckModule.kind === "projects" && (
              <ModuleProjectsList
                dckModule={dckModule}
                conversations={conversations}
                openPath={open}
                isCreating={isCreating}
                dispatchLifecycle={dispatchLifecycle}
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
                isLoading={conversationsLoading}
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
          onCancel={() => setShowNewProjectDialog(false)}
          onSubmit={(spec: WebgenNewProjectSpec) => {
            void createScoped(
              dckModule.workspacePath,
              buildWebgenScaffoldPrompt(spec),
            );
            setShowNewProjectDialog(false);
          }}
        />
      )}
    </div>
  );
}

export default function ModuleDetail() {
  const { moduleId } = useParams();
  return <ModuleDetailView dckModule={getDckModuleById(moduleId)} />;
}
