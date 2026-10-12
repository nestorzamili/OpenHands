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
  type DckProjectStatus,
} from "#/dck/modules";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import type { DckProjectMeta } from "#/dck/project-metadata";
import type { WebgenLifecycleAction } from "#/dck/webgen-lifecycle";
import type { WebgenProjectStatus } from "#/dck/webgen-service";
import { DckProjectStatusBadge } from "./dck-project-status-badge";
import type { ProjectEntry } from "./project-row";
import { WebgenLifecycleActions } from "./webgen-lifecycle-actions";
import {
  getBrowserOrigin,
  getDckProjectLinks,
  type DckProjectLinkKind,
} from "./project-links";

const CELL = "px-3 py-2 align-middle";

const LINK_LABEL_KEY: Record<DckProjectLinkKind, I18nKey> = {
  live: I18nKey.DCK$LIVE_LINK,
  preview: I18nKey.DCK$PREVIEW_LINK,
  local: I18nKey.DCK$LOCALHOST_PORT,
};

const LINK_ARIA_KEY: Record<DckProjectLinkKind, I18nKey> = {
  live: I18nKey.DCK$OPEN_LIVE_LINK,
  preview: I18nKey.DCK$OPEN_PREVIEW_LINK,
  local: I18nKey.DCK$OPEN_PROJECT_LINK,
};

function metaFromRuntime(runtime: WebgenProjectStatus): DckProjectMeta {
  const status =
    runtime.status === "running" ||
    runtime.status === "stopped" ||
    runtime.status === "error"
      ? runtime.status
      : null;
  return {
    name: runtime.name,
    port: runtime.port,
    stack: runtime.stack,
    authProvider: runtime.auth_provider,
    url: runtime.port === null ? null : `http://localhost:${runtime.port}`,
    previewPath: runtime.preview_path,
    subdomain: runtime.subdomain,
    lastStatus: status,
    lastCheckedAt: runtime.last_checked_at,
  };
}

function projectStatus(
  runtime: WebgenProjectStatus | undefined,
  meta: DckProjectMeta | null,
  latest: AppConversation | null,
): DckProjectStatus {
  if (runtime?.status === "unknown") return "unknown";
  if (runtime?.status === "starting") return "working";
  if (runtime) {
    if (runtime.status === "running") return "running";
    if (runtime.status === "stopped") return "stopped";
    if (runtime.status === "error") return "error";
  }
  return deriveProjectStatus(meta, latest);
}

function WebgenProjectTableRow({
  entry,
  conversations,
  onOpen,
  isBusy,
  runtime,
  dispatchLifecycle,
}: {
  entry: ProjectEntry;
  conversations: AppConversation[];
  onOpen: (path: string) => void;
  isBusy: boolean;
  runtime?: WebgenProjectStatus;
  dispatchLifecycle: (
    path: string,
    action: WebgenLifecycleAction,
    appName: string,
    authProvider: string | null,
    subdomain?: string,
  ) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation("openhands");
  const downloadedMeta = useDckProjectMeta(entry.path).data ?? null;
  const meta = runtime ? metaFromRuntime(runtime) : downloadedMeta;
  const latest = latestConversationForPath(conversations, entry.path);
  const status = projectStatus(runtime, meta, latest);
  const count = relatedConversationCount(conversations, entry.path);
  const lastTouched = projectLastTouched(conversations, entry.path);
  const checkedAt = runtime?.last_checked_at ?? meta?.lastCheckedAt;

  return (
    <tr
      data-testid="dck-project-row"
      className="border-t border-border hover:bg-surface"
    >
      <td className={CELL}>
        <div className="flex flex-col gap-0.5">
          <DckProjectStatusBadge status={status} />
          {checkedAt && (
            <span
              data-testid="dck-project-verified-at"
              className="text-xs text-text-tertiary"
            >
              {t(I18nKey.DCK$STATUS_VERIFIED_AT, {
                time: formatRelativeTime(checkedAt, i18n.language, t),
              })}
            </span>
          )}
          {runtime && runtime.containers.length > 0 && (
            <ul
              aria-label={t(I18nKey.DCK$LIVE_CONTAINER_STATUS)}
              data-testid="dck-project-containers"
              className="mt-1 flex flex-col gap-0.5 text-xs text-text-tertiary"
            >
              {runtime.containers.map((container) => (
                <li
                  key={container.id}
                  data-testid="dck-project-container-status"
                  title={container.health ?? container.state}
                >
                  <span className="font-medium text-text-secondary">
                    {container.name}
                  </span>
                  {": "}
                  {container.health ?? container.state}
                  {container.exit_code !== null
                    ? ` (exit ${container.exit_code})`
                    : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </td>
      <td className={CELL}>
        <button
          type="button"
          disabled={isBusy}
          onClick={() => onOpen(entry.path)}
          data-testid="dck-project-row-open"
          className="max-w-64 truncate text-left text-sm font-medium text-contrast hover:text-accent disabled:opacity-50"
          title={entry.name}
        >
          {entry.name}
        </button>
      </td>
      <td className={CELL}>
        {(() => {
          const links = getDckProjectLinks(meta, getBrowserOrigin());
          if (links.length === 0) {
            return <span className="text-xs text-text-tertiary">—</span>;
          }
          return (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {links.map((link) => (
                <a
                  key={link.kind}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid={`dck-project-link-${link.kind}`}
                  aria-label={t(LINK_ARIA_KEY[link.kind], {
                    name: entry.name,
                    url: link.url,
                  })}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-contrast"
                >
                  {link.kind === "local"
                    ? t(LINK_LABEL_KEY.local, { port: meta?.port })
                    : t(LINK_LABEL_KEY[link.kind])}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ))}
            </div>
          );
        })()}
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
          projectPath={entry.path}
          authProvider={meta?.authProvider ?? null}
          publishedSubdomain={meta?.subdomain ?? null}
          runtimeStatus={runtime?.status}
          onDispatch={dispatchLifecycle}
          disabled={isBusy}
        />
      </td>
    </tr>
  );
}

/** WebGen projects with runtime status sourced from the agent-server. */
export function WebgenProjectTable({
  entries,
  conversations,
  onOpen,
  isBusy,
  runtimeProjects = [],
  dispatchLifecycle,
}: {
  entries: ProjectEntry[];
  conversations: AppConversation[];
  onOpen: (path: string) => void;
  isBusy: boolean;
  runtimeProjects?: WebgenProjectStatus[];
  dispatchLifecycle: (
    path: string,
    action: WebgenLifecycleAction,
    appName: string,
    authProvider: string | null,
    subdomain?: string,
  ) => Promise<boolean>;
}) {
  const { t } = useTranslation("openhands");
  const headClass =
    "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-text-tertiary";
  const projectsBySlug = new Map(
    runtimeProjects.map((project) => [project.slug, project]),
  );

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
              runtime={projectsBySlug.get(entry.name)}
              dispatchLifecycle={dispatchLifecycle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
