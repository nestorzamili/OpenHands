import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { formatRelativeTime } from "#/utils/format-relative-time";
import { useDckProjectMeta } from "#/hooks/query/use-dck-project-meta";
import {
  deriveProjectStatus,
  latestConversationForPath,
  projectLastTouched,
  relatedConversationCount,
} from "#/dck/modules";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import type { DckProjectMeta } from "#/dck/project-metadata";
import { DckProjectStatusBadge } from "./dck-project-status-badge";
import type { ProjectEntry } from "./project-row";
import { WebgenLifecycleActions } from "./webgen-lifecycle-actions";

const CELL = "px-3 py-2 align-middle";

function WebgenProjectTableRow({
  entry,
  conversations,
  onOpen,
  isBusy,
  dispatchLifecycle,
}: {
  entry: ProjectEntry;
  conversations: AppConversation[];
  onOpen: (path: string) => void;
  isBusy: boolean;
  dispatchLifecycle: (path: string, command: string) => void;
}) {
  const { t, i18n } = useTranslation("openhands");
  const meta: DckProjectMeta | null =
    useDckProjectMeta(entry.path).data ?? null;
  const latest = latestConversationForPath(conversations, entry.path);
  const status = deriveProjectStatus(meta, latest);
  const count = relatedConversationCount(conversations, entry.path);
  const lastTouched = projectLastTouched(conversations, entry.path);

  return (
    <tr
      data-testid="dck-project-row"
      className="border-t border-border hover:bg-surface"
    >
      <td className={CELL}>
        <div className="flex flex-col gap-0.5">
          <DckProjectStatusBadge status={status} />
          {meta?.lastCheckedAt && (
            <span
              data-testid="dck-project-verified-at"
              className="text-[11px] text-text-tertiary"
            >
              {t(I18nKey.DCK$STATUS_VERIFIED_AT, {
                time: formatRelativeTime(meta.lastCheckedAt, i18n.language, t),
              })}
            </span>
          )}
        </div>
      </td>
      <td className={CELL}>
        <button
          type="button"
          disabled={isBusy}
          onClick={() => onOpen(entry.path)}
          data-testid="dck-project-row-open"
          className="max-w-[16rem] truncate text-left text-sm font-medium text-contrast hover:text-indigo-300 disabled:opacity-50"
          title={entry.name}
        >
          {entry.name}
        </button>
      </td>
      <td className={CELL}>
        {meta?.url && meta.port !== null ? (
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="dck-project-link"
            aria-label={t(I18nKey.DCK$OPEN_PROJECT_LINK, {
              name: entry.name,
              url: meta.url,
            })}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
          >
            {t(I18nKey.DCK$LOCALHOST_PORT, { port: meta.port })}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : (
          <span className="text-xs text-text-tertiary">—</span>
        )}
      </td>
      <td className={CELL}>
        <span
          data-testid="dck-project-count"
          className="text-xs text-text-tertiary"
        >
          {t(I18nKey.DCK$CONVERSATION_COUNT, { count })}
        </span>
      </td>
      <td className={CELL}>
        {lastTouched ? (
          <span
            data-testid="dck-project-last-touched"
            className="whitespace-nowrap text-xs text-text-tertiary"
          >
            {formatRelativeTime(lastTouched, i18n.language, t)}
          </span>
        ) : (
          <span className="text-xs text-text-tertiary">—</span>
        )}
      </td>
      <td className={`${CELL} text-right`}>
        <WebgenLifecycleActions
          appName={entry.name}
          port={meta?.port ?? null}
          projectPath={entry.path}
          onDispatch={dispatchLifecycle}
          disabled={isBusy}
        />
      </td>
    </tr>
  );
}

/**
 * Webgen project list rendered as a table: status badge (with the last
 * agent-verified time), name, live URL, conversation count, last activity,
 * and the Docker lifecycle menu. Each row reads its own `.dck.json` metadata
 * via `useDckProjectMeta`.
 */
export function WebgenProjectTable({
  entries,
  conversations,
  onOpen,
  isBusy,
  dispatchLifecycle,
}: {
  entries: ProjectEntry[];
  conversations: AppConversation[];
  onOpen: (path: string) => void;
  isBusy: boolean;
  dispatchLifecycle: (path: string, command: string) => void;
}) {
  const { t } = useTranslation("openhands");
  const headClass =
    "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-text-tertiary";

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table
        data-testid="dck-webgen-project-table"
        className="w-full border-collapse text-sm"
      >
        <thead>
          <tr className="bg-surface">
            <th className={headClass}>{t(I18nKey.DCK$TABLE_STATUS)}</th>
            <th className={headClass}>{t(I18nKey.DCK$TABLE_NAME)}</th>
            <th className={headClass}>{t(I18nKey.DCK$TABLE_URL)}</th>
            <th className={headClass}>{t(I18nKey.DCK$TABLE_CONVERSATIONS)}</th>
            <th className={headClass}>{t(I18nKey.DCK$TABLE_LAST_ACTIVITY)}</th>
            <th className={`${headClass} text-right`}>
              <span className="sr-only">
                {t(I18nKey.DCK$LIFECYCLE_ACTIONS)}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <WebgenProjectTableRow
              key={entry.path}
              entry={entry}
              conversations={conversations}
              onOpen={onOpen}
              isBusy={isBusy}
              dispatchLifecycle={dispatchLifecycle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
