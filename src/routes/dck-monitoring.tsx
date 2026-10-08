import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  HardDrive,
  RefreshCw,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { BackNavButton } from "#/components/shared/buttons/back-nav-button";
import { useAllConversationsQuery } from "#/components/features/dck/use-dck-conversations";
import { I18nKey } from "#/i18n/declaration";
import {
  getDckMonitoringAlerts,
  DCK_BESZEL_ROUTE_PATH,
  type DckMonitoredService,
  type DckWorkspaceModule,
  type DckMonitoredApp,
  type DckMonitoringAlert,
  type DckMonitoredAppStatus,
} from "#/dck/monitoring";
import {
  conversationsForBase,
  deriveProjectStatus,
  DCK_STATUS_LABEL_KEYS,
  mergeDckModules,
  type DckModule,
  type DckProjectStatus,
} from "#/dck/modules";
import { useDckModulesConfig } from "#/hooks/query/use-dck-modules-config";
import { useAutomationHealth } from "#/hooks/query/use-automation-health";
import { useDckMonitoring } from "#/hooks/query/use-dck-monitoring";
import { hasAutomationInterface } from "#/manifests/automation-interface";

function formatBytes(bytes: number | null, language: string): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)} ${units[index]}`;
}

function formatUptime(startedAt: string | null, language: string): string {
  if (!startedAt) return "—";
  const timestamp = Date.parse(startedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const totalMinutes = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60_000),
  );
  const units: Intl.NumberFormatOptions["unit"][] = ["day", "hour", "minute"];
  const values = [
    Math.floor(totalMinutes / 1440),
    Math.floor((totalMinutes % 1440) / 60),
    totalMinutes % 60,
  ];
  const parts: string[] = [];
  for (let index = 0; index < units.length; index += 1) {
    if (
      values[index] > 0 ||
      (index === units.length - 1 && parts.length === 0)
    ) {
      parts.push(
        new Intl.NumberFormat(language, {
          style: "unit",
          unit: units[index],
          unitDisplay: "short",
          maximumFractionDigits: 0,
        }).format(values[index]),
      );
      if (parts.length === 2) break;
    }
  }
  return parts.join(" ");
}

function formatPercent(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)}%`;
}

function statusLabel(
  status: DckMonitoredAppStatus,
  t: (key: I18nKey) => string,
): string {
  switch (status) {
    case "running":
      return t(I18nKey.DCK$STATUS_RUNNING);
    case "stopped":
      return t(I18nKey.DCK$STATUS_STOPPED);
    case "error":
    case "missing":
      return t(I18nKey.DCK$STATUS_ERROR);
    case "restarting":
    case "starting":
      return t(I18nKey.DCK$STATUS_WORKING);
    case "not_deployed":
      return t(I18nKey.DCK$STATUS_CONFIGURED);
    case "unknown":
      return t(I18nKey.DCK$STATUS_UNKNOWN);
  }
}

function statusClasses(status: DckMonitoredAppStatus): string {
  if (status === "running") {
    return "border-semantic-success/30 bg-semantic-success/10 text-semantic-success";
  }
  if (status === "not_deployed" || status === "stopped") {
    return "border-border bg-surface text-text-secondary";
  }
  return "border-warning/30 bg-warning/10 text-warning";
}

function alertMessageKey(code: DckMonitoringAlert["code"]): I18nKey {
  switch (code) {
    case "stopped":
      return I18nKey.DCK$MONITORING_STOPPED_ALERT;
    case "unhealthy":
      return I18nKey.DCK$MONITORING_UNHEALTHY_ALERT;
    case "missing":
      return I18nKey.DCK$MONITORING_MISSING_ALERT;
    case "restarting":
      return I18nKey.DCK$MONITORING_RESTARTING_ALERT;
    case "error":
      return I18nKey.DCK$MONITORING_ERROR_ALERT;
    case "service":
      return I18nKey.DCK$MONITORING_SERVICE_ALERT;
    case "module":
      return I18nKey.DCK$MONITORING_MODULE_ALERT;
    case "automation":
      return I18nKey.DCK$MONITORING_AUTOMATION_ALERT;
  }
}

function ApplicationCard({ app }: { app: DckMonitoredApp }) {
  const { t, i18n } = useTranslation("openhands");
  const container = app.container;
  const memory = container?.memoryUsageBytes ?? null;
  const memoryLimit = container?.memoryLimitBytes ?? null;
  const memoryLabel =
    memory !== null && memoryLimit !== null
      ? `${formatBytes(memory, i18n.language)} / ${formatBytes(memoryLimit, i18n.language)}`
      : "—";
  const healthLabel =
    app.health === "healthy"
      ? t(I18nKey.DCK$STATUS_HEALTHY)
      : app.health === "unhealthy"
        ? t(I18nKey.DCK$STATUS_ERROR)
        : app.health === "starting"
          ? t(I18nKey.DCK$STATUS_WORKING)
          : "—";

  return (
    <article
      data-testid={`dck-monitoring-app-${app.id}`}
      className="flex flex-col gap-4 rounded-xl border border-border bg-base p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
            <Server size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-contrast">
              {app.name}
            </h2>
            <p className="mt-0.5 text-xs text-text-tertiary">
              {t(I18nKey.DCK$MONITORING_CONTAINER)} · {container?.id ?? "—"}
            </p>
          </div>
        </div>
        <span
          data-testid={`dck-monitoring-status-${app.id}`}
          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses(app.status)}`}
        >
          {statusLabel(app.status, t)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric
          icon={<Cpu size={14} aria-hidden />}
          label={t(I18nKey.DCK$MONITORING_CPU)}
          value={formatPercent(container?.cpuPercent ?? null, i18n.language)}
        />
        <Metric
          icon={<HardDrive size={14} aria-hidden />}
          label={t(I18nKey.DCK$MONITORING_MEMORY)}
          value={memoryLabel}
        />
        <Metric label={t(I18nKey.DCK$MONITORING_HEALTH)} value={healthLabel} />
        <Metric
          label={t(I18nKey.DCK$MONITORING_RESTARTS)}
          value={
            container?.restartCount == null
              ? "—"
              : new Intl.NumberFormat(i18n.language).format(
                  container.restartCount,
                )
          }
        />
        <Metric
          label={t(I18nKey.DCK$MONITORING_UPTIME)}
          value={formatUptime(container?.startedAt ?? null, i18n.language)}
        />
      </div>
    </article>
  );
}

function CoreServiceCard({ service }: { service: DckMonitoredService }) {
  const { t, i18n } = useTranslation("openhands");
  const container = service.container;
  const memory = container?.memoryUsageBytes ?? null;
  const memoryLimit = container?.memoryLimitBytes ?? null;
  const memoryLabel =
    memory !== null && memoryLimit !== null
      ? `${formatBytes(memory, i18n.language)} / ${formatBytes(memoryLimit, i18n.language)}`
      : "—";
  const healthLabel =
    service.health === "healthy"
      ? t(I18nKey.DCK$STATUS_HEALTHY)
      : service.health === "unhealthy"
        ? t(I18nKey.DCK$STATUS_ERROR)
        : service.health === "starting"
          ? t(I18nKey.DCK$STATUS_WORKING)
          : t(I18nKey.DCK$STATUS_UNKNOWN);
  const ServiceIcon = service.id === "postgres" ? Database : Server;
  const badgeClasses =
    service.status === "running" && service.health !== "unhealthy"
      ? "border-semantic-success/30 bg-semantic-success/10 text-semantic-success"
      : "border-warning/30 bg-warning/10 text-warning";

  return (
    <article
      data-testid={`dck-monitoring-service-${service.id}`}
      className="flex flex-col gap-4 rounded-xl border border-border bg-base p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
            <ServiceIcon size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-contrast">
              {service.name}
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary">
              {service.containerName} · {container?.id ?? "—"}
            </p>
          </div>
        </div>
        <span
          data-testid={`dck-monitoring-service-status-${service.id}`}
          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClasses}`}
        >
          {statusLabel(service.status, t)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric
          icon={<Cpu size={14} aria-hidden />}
          label={t(I18nKey.DCK$MONITORING_CPU)}
          value={formatPercent(container?.cpuPercent ?? null, i18n.language)}
        />
        <Metric
          icon={<HardDrive size={14} aria-hidden />}
          label={t(I18nKey.DCK$MONITORING_MEMORY)}
          value={memoryLabel}
        />
        <Metric label={t(I18nKey.DCK$MONITORING_HEALTH)} value={healthLabel} />
        <Metric
          label={t(I18nKey.DCK$MONITORING_RESTARTS)}
          value={
            container?.restartCount == null
              ? "—"
              : new Intl.NumberFormat(i18n.language).format(
                  container.restartCount,
                )
          }
        />
        <Metric
          label={t(I18nKey.DCK$MONITORING_UPTIME)}
          value={formatUptime(container?.startedAt ?? null, i18n.language)}
        />
      </div>
    </article>
  );
}

function formatTimestamp(value: string | null, language: string): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function moduleStatusClasses(status: DckProjectStatus): string {
  if (status === "running" || status === "working") {
    return "border-semantic-success/30 bg-semantic-success/10 text-semantic-success";
  }
  if (status === "error") return "border-warning/30 bg-warning/10 text-warning";
  return "border-border bg-surface text-text-secondary";
}

function ModuleWorkspaceCard({
  module,
  status,
  conversationCount,
  latestConversationAt,
  workspace,
}: {
  module: DckModule;
  status: DckProjectStatus;
  conversationCount: number;
  latestConversationAt: string | null;
  workspace: DckWorkspaceModule | undefined;
}) {
  const { t, i18n } = useTranslation("openhands");
  const ModuleIcon = module.icon;
  const latestActivity = [
    latestConversationAt,
    workspace?.latestArtifactAt ?? null,
  ]
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const artifactCount = workspace
    ? `${workspace.truncated ? "≥" : ""}${new Intl.NumberFormat(i18n.language).format(workspace.artifactCount)}`
    : "—";

  return (
    <article
      data-testid={`dck-monitoring-module-${module.slug}`}
      className="flex flex-col gap-4 rounded-xl border border-border bg-base p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
            <ModuleIcon size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-contrast">
              {module.name}
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary">/{module.slug}</p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${moduleStatusClasses(status)}`}
        >
          {t(DCK_STATUS_LABEL_KEYS[status] as I18nKey)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metric
          label={t(I18nKey.DCK$MONITORING_CONVERSATIONS)}
          value={new Intl.NumberFormat(i18n.language).format(conversationCount)}
        />
        <Metric
          icon={<FileText size={14} aria-hidden />}
          label={t(I18nKey.DCK$MONITORING_ARTIFACTS)}
          value={artifactCount}
        />
        <Metric
          label={t(I18nKey.DCK$MONITORING_LAST_ACTIVITY)}
          value={formatTimestamp(latestActivity ?? null, i18n.language)}
        />
      </div>

      {workspace?.scanError ? (
        <p className="text-xs text-warning">
          {t(I18nKey.DCK$MONITORING_MODULE_SCAN_ERROR)}
        </p>
      ) : workspace?.recentArtifacts.length ? (
        <ul className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-text-secondary">
          {workspace.recentArtifacts.slice(0, 4).map((artifact) => (
            <li key={artifact.path} className="flex min-w-0 items-center gap-2">
              <FileText
                size={13}
                className="shrink-0 text-text-tertiary"
                aria-hidden
              />
              <span className="truncate" title={artifact.path}>
                {artifact.path}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-text-tertiary">
          {t(I18nKey.DCK$MONITORING_NO_OUTPUTS)}
        </p>
      )}
      {workspace?.truncated && (
        <p className="text-xs text-text-tertiary">
          {t(I18nKey.DCK$MONITORING_FILES_LIMITED)}
        </p>
      )}
    </article>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-surface/70 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
        {icon}
        <span>{label}</span>
      </div>
      <p
        className="mt-1 truncate text-sm font-medium text-contrast"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function AlertList({ alerts }: { alerts: DckMonitoringAlert[] }) {
  const { t } = useTranslation("openhands");
  return (
    <section
      aria-label={t(I18nKey.DCK$MONITORING_ATTENTION)}
      data-testid="dck-monitoring-alerts"
      className="rounded-xl border border-border bg-base p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={16} className="text-warning" aria-hidden />
        <h2 className="text-sm font-semibold text-contrast">
          {t(I18nKey.DCK$MONITORING_ATTENTION)}
        </h2>
      </div>
      {alerts.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <CheckCircle2
            size={16}
            className="text-semantic-success"
            aria-hidden
          />
          {t(I18nKey.DCK$MONITORING_NO_ALERTS)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              data-testid={`dck-monitoring-alert-${alert.id}`}
              className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-sm text-contrast"
            >
              <AlertTriangle
                size={15}
                className="mt-0.5 shrink-0 text-warning"
                aria-hidden
              />
              <span>
                {t(alertMessageKey(alert.code), { name: alert.appName })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function DckMonitoringRoute() {
  const { t, i18n } = useTranslation("openhands");
  const query = useDckMonitoring();
  const automationAvailable = hasAutomationInterface();
  const automationHealth = useAutomationHealth({
    enabled: query.isLocalBackend && automationAvailable,
    refetchInterval:
      query.isLocalBackend && automationAvailable ? 30_000 : false,
  });
  const conversationQuery = useAllConversationsQuery({
    enabled: query.isLocalBackend,
  });
  const moduleConfig = useDckModulesConfig();
  const snapshot = query.data;
  const apps = snapshot?.applications ?? [];
  const services = snapshot?.services ?? [];
  const dckModules = React.useMemo(
    () =>
      mergeDckModules(
        moduleConfig.modules,
        moduleConfig.builtinOverrides,
      ).filter((module) => module.id !== "webgen"),
    [moduleConfig.builtinOverrides, moduleConfig.modules],
  );
  const workspaceBySlug = React.useMemo(
    () =>
      new Map(
        (snapshot?.workspaceModules ?? []).map((entry) => [entry.slug, entry]),
      ),
    [snapshot?.workspaceModules],
  );
  const moduleActivity = React.useMemo(
    () =>
      dckModules.map((module) => {
        const relatedConversations = conversationsForBase(
          conversationQuery.conversations,
          module.workspacePath,
        );
        const latestConversation = relatedConversations[0] ?? null;
        return {
          module,
          status: deriveProjectStatus(null, latestConversation),
          conversationCount: relatedConversations.length,
          latestConversationAt: latestConversation?.updated_at ?? null,
          workspace: workspaceBySlug.get(module.slug),
        };
      }),
    [conversationQuery.conversations, dckModules, workspaceBySlug],
  );
  const hasWorkspaceModuleData =
    (snapshot?.workspaceModules.length ?? 0) > 0 ||
    moduleActivity.some((item) => item.conversationCount > 0);
  const showWorkspaceEmptyState =
    Boolean(snapshot) &&
    !conversationQuery.isLoading &&
    !conversationQuery.isError &&
    (moduleActivity.length === 0 || !hasWorkspaceModuleData);
  const dockerAvailable = snapshot?.docker.available ?? false;
  const alerts = [
    ...getDckMonitoringAlerts(apps, dockerAvailable ? services : []),
    ...moduleActivity
      .filter((item) => item.status === "error")
      .map((item) => ({
        id: `module:${item.module.id}`,
        code: "module" as const,
        appName: item.module.name,
      })),
    ...(automationAvailable && automationHealth.data?.status === "error"
      ? [
          {
            id: "automation:health",
            code: "automation" as const,
            appName: t(I18nKey.DCK$MONITORING_AUTOMATION),
          },
        ]
      : []),
    ...(snapshot && !dockerAvailable
      ? [
          {
            id: "docker:unavailable",
            code: "service" as const,
            appName: "Docker Engine",
          },
        ]
      : []),
  ];
  const checkedAt =
    snapshot && query.dataUpdatedAt > 0
      ? new Intl.DateTimeFormat(i18n.language, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }).format(query.dataUpdatedAt)
      : null;
  const runningServiceCount = services.filter(
    (service) => service.status === "running",
  ).length;
  const runningAppCount = apps.filter((app) => app.status === "running").length;
  const automationStatus: DckMonitoredAppStatus = !automationAvailable
    ? "unknown"
    : automationHealth.data?.status === "ok"
      ? "running"
      : automationHealth.data?.status === "error" || automationHealth.isError
        ? "error"
        : "unknown";

  const refreshAll = () => {
    void query.refetch();
    void automationHealth.refetch();
    void moduleConfig.refetch();
    void conversationQuery.refetch();
  };

  return (
    <div className="custom-scrollbar-always h-full overflow-y-auto rounded-xl bg-transparent px-4 py-5 md:px-6 lg:px-10.5">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <BackNavButton to="/conversations">
          {t(I18nKey.DCK$BACK_TO_HOME)}
        </BackNavButton>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Activity
              size={23}
              className="mt-1 shrink-0 text-accent"
              aria-hidden
            />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-contrast">
                {t(I18nKey.DCK$MONITORING_TITLE)}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-text-tertiary">
                {t(I18nKey.DCK$MONITORING_DESCRIPTION)}
              </p>
            </div>
          </div>
          <div
            data-testid="dck-monitoring-toolbar"
            className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center sm:gap-3"
          >
            {query.isLocalBackend && (
              <a
                href={DCK_BESZEL_ROUTE_PATH}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="dck-monitoring-beszel-link"
                className="col-span-2 inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-base px-3 py-2 text-sm font-medium text-accent hover:bg-surface sm:col-span-1"
              >
                {t(I18nKey.DCK$MONITORING_BESZEL_LINK)}
                <ArrowUpRight size={14} aria-hidden />
              </a>
            )}
            {query.isLocalBackend && snapshot && !query.isError && (
              <span
                data-testid="dck-monitoring-live"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-semantic-success/25 bg-semantic-success/10 px-3 py-1.5 text-xs text-semantic-success"
              >
                <span
                  className="size-1.5 animate-pulse rounded-full bg-semantic-success"
                  aria-hidden
                />
                {t(I18nKey.DCK$MONITORING_LIVE)}
              </span>
            )}
            {query.isLocalBackend && (
              <button
                type="button"
                onClick={refreshAll}
                disabled={query.isFetching || automationHealth.isFetching}
                data-testid="dck-monitoring-refresh"
                className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-base px-3 py-2 text-sm font-medium text-contrast hover:bg-surface disabled:opacity-60"
              >
                <RefreshCw
                  size={15}
                  className={
                    query.isFetching || automationHealth.isFetching
                      ? "animate-spin"
                      : ""
                  }
                  aria-hidden
                />
                {t(I18nKey.DCK$MONITORING_REFRESH)}
              </button>
            )}
          </div>
        </header>

        {!query.isLocalBackend ? (
          <div
            data-testid="dck-monitoring-local-only"
            className="rounded-xl border border-border bg-base p-4 text-sm text-text-secondary"
          >
            {t(I18nKey.DCK$MONITORING_LOCAL_ONLY)}
          </div>
        ) : query.isError && !snapshot ? (
          <div
            role="alert"
            data-testid="dck-monitoring-error"
            className="flex flex-col items-start gap-3 rounded-xl border border-semantic-danger/25 bg-semantic-danger/5 p-4"
          >
            <div className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle
                size={17}
                className="mt-0.5 shrink-0"
                aria-hidden
              />
              <p>{t(I18nKey.DCK$MONITORING_DOCKER_UNAVAILABLE)}</p>
            </div>
            <button
              type="button"
              onClick={refreshAll}
              data-testid="dck-monitoring-error-retry"
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-accent hover:text-accent/80"
            >
              {t(I18nKey.DCK$RETRY)}
            </button>
          </div>
        ) : query.isLoading ? (
          <p
            data-testid="dck-monitoring-loading"
            className="text-sm text-text-tertiary"
          >
            {t(I18nKey.DCK$LOADING)}
          </p>
        ) : (
          <>
            {query.isError && (
              <div
                role="alert"
                data-testid="dck-monitoring-stale-error"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-semantic-danger/25 bg-semantic-danger/5 p-4 text-sm text-danger"
              >
                <span>{t(I18nKey.DCK$MONITORING_DOCKER_UNAVAILABLE)}</span>
                <button
                  type="button"
                  onClick={refreshAll}
                  className="font-medium text-accent hover:text-accent/80"
                >
                  {t(I18nKey.DCK$RETRY)}
                </button>
              </div>
            )}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label={t(I18nKey.DCK$MONITORING_PLATFORM_SERVICES)}
                value={
                  dockerAvailable
                    ? `${new Intl.NumberFormat(i18n.language).format(runningServiceCount)}/${new Intl.NumberFormat(i18n.language).format(services.length)}`
                    : "—"
                }
                icon={<Server size={17} aria-hidden />}
              />
              <SummaryCard
                label={t(I18nKey.DCK$MONITORING_WORKSPACE_MODULES)}
                value={new Intl.NumberFormat(i18n.language).format(
                  moduleActivity.length,
                )}
                icon={<FileText size={17} aria-hidden />}
              />
              <SummaryCard
                label={t(I18nKey.DCK$MONITORING_APPLICATIONS)}
                value={
                  dockerAvailable
                    ? `${new Intl.NumberFormat(i18n.language).format(runningAppCount)}/${new Intl.NumberFormat(i18n.language).format(apps.length)}`
                    : "—"
                }
                icon={<Activity size={17} aria-hidden />}
              />
              <SummaryCard
                label={t(I18nKey.DCK$MONITORING_ACTIVE_ALERTS)}
                value={new Intl.NumberFormat(i18n.language).format(
                  alerts.length,
                )}
                icon={<AlertTriangle size={17} aria-hidden />}
                isAlert={alerts.length > 0}
              />
            </section>

            <AlertList alerts={alerts} />

            <section
              className="flex flex-col gap-3"
              aria-label={t(I18nKey.DCK$MONITORING_PLATFORM_SERVICES)}
            >
              <h2 className="text-base font-semibold text-contrast">
                {t(I18nKey.DCK$MONITORING_PLATFORM_SERVICES)}
              </h2>
              {!dockerAvailable && (
                <div
                  role="alert"
                  data-testid="dck-monitoring-docker-unavailable"
                  className="rounded-xl border border-warning/25 bg-warning/5 p-4 text-sm text-warning"
                >
                  {t(I18nKey.DCK$MONITORING_DOCKER_UNAVAILABLE)}
                </div>
              )}
              <div className="flex flex-col gap-3">
                {services.map((service) => (
                  <CoreServiceCard key={service.id} service={service} />
                ))}
              </div>
              <article
                data-testid="dck-monitoring-automation"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-base p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-surface text-text-secondary">
                    <Activity size={18} aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-contrast">
                      {t(I18nKey.DCK$MONITORING_AUTOMATION)}
                    </h3>
                    <p className="text-xs text-text-tertiary">
                      {automationAvailable
                        ? automationHealth.data?.status === "ok"
                          ? t(I18nKey.DCK$STATUS_RUNNING)
                          : automationStatus === "error"
                            ? t(I18nKey.DCK$STATUS_ERROR)
                            : t(I18nKey.DCK$STATUS_UNKNOWN)
                        : t(I18nKey.DCK$MONITORING_AUTOMATION_NOT_CONFIGURED)}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${automationAvailable ? statusClasses(automationStatus) : "border-border bg-surface text-text-secondary"}`}
                >
                  {automationAvailable
                    ? statusLabel(automationStatus, t)
                    : t(I18nKey.DCK$STATUS_UNKNOWN)}
                </span>
              </article>
            </section>

            <section
              className="flex flex-col gap-3"
              aria-label={t(I18nKey.DCK$MONITORING_WORKSPACE_MODULES)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-contrast">
                  {t(I18nKey.DCK$MONITORING_WORKSPACE_MODULES)}
                </h2>
                {checkedAt && (
                  <span
                    data-testid="dck-monitoring-last-updated"
                    className="text-xs text-text-tertiary"
                  >
                    {t(I18nKey.DCK$MONITORING_LAST_UPDATED, {
                      time: checkedAt,
                    })}
                  </span>
                )}
              </div>
              {showWorkspaceEmptyState && (
                <p
                  data-testid="dck-monitoring-workspace-empty"
                  className="rounded-xl border border-border bg-base p-5 text-sm text-text-tertiary"
                >
                  {t(I18nKey.DCK$MONITORING_NO_WORKSPACE_DATA)}
                </p>
              )}
              {moduleActivity.length > 0 && (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {moduleActivity.map((item) => (
                    <ModuleWorkspaceCard key={item.module.id} {...item} />
                  ))}
                </div>
              )}
            </section>

            <section
              className="flex flex-col gap-3"
              aria-label={t(I18nKey.DCK$MONITORING_APPLICATIONS)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-contrast">
                  {t(I18nKey.DCK$MONITORING_APPLICATIONS)}
                </h2>
              </div>
              {apps.length === 0 ? (
                <p
                  data-testid="dck-monitoring-empty"
                  className="rounded-xl border border-border bg-base p-5 text-sm text-text-tertiary"
                >
                  {t(I18nKey.DCK$MONITORING_NO_APPS)}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {apps.map((app) => (
                    <ApplicationCard key={app.id} app={app} />
                  ))}
                </div>
              )}
            </section>
            <p
              data-testid="dck-monitoring-coverage-note"
              className="rounded-xl border border-border bg-base p-4 text-xs text-text-tertiary"
            >
              {t(I18nKey.DCK$MONITORING_COVERAGE_NOTE)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  isAlert = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  isAlert?: boolean;
}) {
  return (
    <article className="flex items-center gap-3 rounded-xl border border-border bg-base p-4">
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${isAlert ? "bg-warning/10 text-warning" : "bg-surface text-text-secondary"}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-text-tertiary">{label}</p>
        <p className="mt-0.5 text-xl font-semibold text-contrast">{value}</p>
      </div>
    </article>
  );
}
