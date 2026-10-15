import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { formatRelativeTime } from "#/utils/format-relative-time";
import { projectLastTouched, type DckProjectStatus } from "#/dck/modules";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import type { DckProjectMeta } from "#/dck/project-metadata";
import type { WebgenLifecycleAction } from "#/dck/webgen-lifecycle";
import type { WebgenProjectStatus } from "#/dck/webgen-service";
import { DckProjectStatusBadge } from "./dck-project-status-badge";
import type { ProjectEntry } from "./project-row";
import { WebgenLifecycleActions } from "./webgen-lifecycle-actions";
import { WebgenRuntimeSecretsDialog } from "./webgen-runtime-secrets-dialog";
import {
  getBrowserOrigin,
  getDckProjectLinks,
  type DckProjectLinkKind,
} from "./project-links";

const CELL = "px-3 py-2 align-middle";

const LINK_ARIA_KEY: Record<DckProjectLinkKind, I18nKey> = {
  live: I18nKey.DCK$OPEN_LIVE_LINK,
  preview: I18nKey.DCK$OPEN_PREVIEW_LINK,
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
    previewPath: runtime.preview_path,
    subdomain: runtime.subdomain,
    lastStatus: status,
    lastCheckedAt: runtime.last_checked_at,
  };
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
  const [runtimeSecretsOpen, setRuntimeSecretsOpen] = useState(false);
  const meta = runtime ? metaFromRuntime(runtime) : null;
  const status: DckProjectStatus = runtime?.status ?? "unknown";
  const lastTouched = projectLastTouched(conversations, entry.path);

  return (
    <tr
      data-testid="dck-project-row"
      className="border-t border-border hover:bg-surface"
    >
      <td className={CELL}>
        <DckProjectStatusBadge status={status} />
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
          const links =
            runtime?.status === "running"
              ? getDckProjectLinks(meta, getBrowserOrigin())
              : [];
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
                  <span className="break-all">{link.url}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
              ))}
            </div>
          );
        })()}
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <WebgenLifecycleActions
            appName={entry.name}
            projectPath={entry.path}
            authProvider={meta?.authProvider ?? null}
            publishedSubdomain={meta?.subdomain ?? null}
            runtimeStatus={runtime?.status}
            onDispatch={dispatchLifecycle}
            disabled={isBusy}
            lifecycleDisabled={!runtime}
            onOpen={() => onOpen(entry.path)}
            onOpenRuntimeSecrets={() => setRuntimeSecretsOpen(true)}
          />
        </div>
        {runtimeSecretsOpen && (
          <WebgenRuntimeSecretsDialog
            projectSlug={entry.name}
            projectName={entry.name}
            onClose={() => setRuntimeSecretsOpen(false)}
          />
        )}
      </td>
    </tr>
  );
}

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
        className="w-full min-w-160 border-collapse text-sm"
      >
        <thead>
          <tr className="bg-surface">
            <th className={headClass}>{t(I18nKey.DCK$TABLE_STATUS)}</th>
            <th className={headClass}>{t(I18nKey.DCK$TABLE_NAME)}</th>
            <th className={headClass}>{t(I18nKey.DCK$TABLE_URL)}</th>
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
