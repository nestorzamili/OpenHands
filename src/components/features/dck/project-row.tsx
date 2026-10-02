import React from "react";
import { useTranslation } from "react-i18next";
import { ConversationStatusDot } from "#/components/features/conversation-panel/conversation-status-dot";
import { I18nKey } from "#/i18n/declaration";
import { formatRelativeTime } from "#/utils/format-relative-time";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import {
  deriveProjectStatus,
  DCK_STATUS_LABEL_KEYS,
  latestConversationForPath,
  projectLastTouched,
  relatedConversationCount,
} from "#/dck/modules";
import { useDckProjectMeta } from "#/hooks/query/use-dck-project-meta";
import type { DckProjectMeta } from "#/dck/project-metadata";

export interface ProjectEntry {
  name: string;
  path: string;
}

export function ProjectRow({
  entry,
  conversations,
  onOpen,
  isBusy = false,
  renderActions,
}: {
  entry: ProjectEntry;
  conversations: AppConversation[];
  onOpen: (path: string) => void;
  isBusy?: boolean;
  renderActions?: (meta: DckProjectMeta | null) => React.ReactNode;
}) {
  const { t, i18n } = useTranslation("openhands");
  const meta = useDckProjectMeta(entry.path).data ?? null;
  const latest = latestConversationForPath(conversations, entry.path);
  const status = deriveProjectStatus(meta, latest);
  const count = relatedConversationCount(conversations, entry.path);
  const lastTouched = projectLastTouched(conversations, entry.path);

  return (
    <div
      data-testid="dck-project-row"
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface"
    >
      <ConversationStatusDot
        executionStatus={latest?.execution_status ?? null}
        sandboxStatus={latest?.sandbox_status ?? null}
      />
      <button
        type="button"
        disabled={isBusy}
        onClick={() => onOpen(entry.path)}
        data-testid="dck-project-row-open"
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left disabled:opacity-50"
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className="truncate text-xs text-contrast">{entry.name}</span>
          {meta?.stack && (
            <span
              data-testid="dck-project-stack"
              className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-secondary"
            >
              {meta.stack}
            </span>
          )}
        </span>
        <span className="flex w-full min-w-0 items-center gap-2 text-xs text-text-tertiary">
          <span>{t(DCK_STATUS_LABEL_KEYS[status])}</span>
          <span aria-hidden="true">·</span>
          <span data-testid="dck-project-count">
            {t(I18nKey.DCK$CONVERSATION_COUNT, { count })}
          </span>
          {lastTouched && (
            <>
              <span aria-hidden="true">·</span>
              <span data-testid="dck-project-last-touched">
                {formatRelativeTime(lastTouched, i18n.language, t)}
              </span>
            </>
          )}
        </span>
      </button>
      {meta?.url && meta.port !== null && (
        <a
          href={meta.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          data-testid="dck-project-link"
          aria-label={t(I18nKey.DCK$OPEN_PROJECT_LINK, {
            name: entry.name,
            url: meta.url,
          })}
          className="shrink-0 text-xs font-medium text-indigo-400 hover:text-indigo-300"
        >
          {t(I18nKey.DCK$LOCALHOST_PORT, { port: meta.port })}
        </a>
      )}
      {renderActions?.(meta)}
    </div>
  );
}
