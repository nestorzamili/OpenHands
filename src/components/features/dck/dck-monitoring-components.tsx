import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  FileText,
  HardDrive,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import {
  type DckMonitoredAppStatus,
  type DckMonitoredContainer,
  type DckMonitoringAlert,
  type DckMonitoredApp,
  type DckMonitoredService,
  type DckWorkspaceModule,
} from "#/dck/monitoring";
import {
  DCK_STATUS_LABEL_KEYS,
  type DckModule,
  type DckProjectStatus,
} from "#/dck/modules";

const STATUS_TONE_CLASSES = {
  success: "border-semantic-success/30 bg-semantic-success/10 text-contrast",
  warning: "border-warning/30 bg-warning/10 text-contrast",
  danger: "border-semantic-danger/30 bg-semantic-danger/10 text-contrast",
  neutral: "border-border bg-surface text-contrast/80",
} as const;

type StatusTone = keyof typeof STATUS_TONE_CLASSES;

function statusTone(status: DckMonitoredAppStatus): StatusTone {
  if (status === "running") return "success";
  if (status === "starting" || status === "restarting") return "warning";
  if (status === "error" || status === "missing") return "danger";
  return "neutral";
}

function monitoredStatusLabel(
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

export function DckMonitoringStatusBadge({
  status,
  label,
  testId,
}: {
  status: DckMonitoredAppStatus;
  label?: string;
  testId?: string;
}) {
  const { t } = useTranslation("openhands");
  return (
    <span
      data-testid={testId}
      className={`inline-flex min-h-7 shrink-0 items-center rounded-md border px-2.5 py-1 text-xs font-medium ${STATUS_TONE_CLASSES[statusTone(status)]}`}
    >
      {label ?? monitoredStatusLabel(status, t)}
    </span>
  );
}

function formatBytes(bytes: number, language: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) {
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(bytes)} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}

function formatPercent(value: number, language: string): string {
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatTimestamp(value: string, language: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function MetricGrid({
  metrics,
  columns = 3,
}: {
  metrics: Array<{
    key: string;
    label: string;
    value: string;
    icon?: React.ReactNode;
  }>;
  columns?: 2 | 3;
}) {
  if (metrics.length === 0) return null;
  return (
    <dl
      className={`grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 ${columns === 3 ? "xl:grid-cols-3" : ""}`}
    >
      {metrics.map((metric) => (
        <div
          key={metric.key}
          className="min-w-0 rounded-lg bg-surface px-3 py-2"
        >
          <dt className="flex items-center gap-1.5 text-xs text-contrast/80">
            {metric.icon}
            <span>{metric.label}</span>
          </dt>
          <dd className="mt-1 break-words text-sm font-medium text-contrast">
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function resolvedContainerStatus(
  status: DckMonitoredAppStatus,
  health: string | null,
  t: (key: I18nKey) => string,
): { status: DckMonitoredAppStatus; label: string } {
  if (status !== "running") {
    return { status, label: monitoredStatusLabel(status, t) };
  }
  if (health === "healthy") {
    return { status: "running", label: t(I18nKey.DCK$STATUS_HEALTHY) };
  }
  if (health === "unhealthy") {
    return { status: "error", label: t(I18nKey.DCK$STATUS_ERROR) };
  }
  if (health === "starting") {
    return { status: "starting", label: t(I18nKey.DCK$STATUS_WORKING) };
  }
  return { status, label: monitoredStatusLabel(status, t) };
}

export function DckMonitoringContainerCard({
  testId,
  statusTestId,
  name,
  detail,
  status,
  health,
  container,
  icon: Icon = Server,
}: {
  testId: string;
  statusTestId: string;
  name: string;
  detail?: string | null;
  status: DckMonitoredAppStatus;
  health: string | null;
  container: DckMonitoredContainer | null;
  icon?: LucideIcon;
}) {
  const { t, i18n } = useTranslation("openhands");
  const displayStatus = resolvedContainerStatus(status, health, t);
  const metrics: Array<{
    key: string;
    label: string;
    value: string;
    icon?: React.ReactNode;
  }> = [];

  if (container?.cpuPercent != null && Number.isFinite(container.cpuPercent)) {
    metrics.push({
      key: "cpu",
      label: t(I18nKey.DCK$MONITORING_CPU),
      value: formatPercent(container.cpuPercent, i18n.language),
      icon: <Cpu size={14} aria-hidden />,
    });
  }

  if (
    container?.memoryUsageBytes != null &&
    Number.isFinite(container.memoryUsageBytes) &&
    container.memoryUsageBytes >= 0
  ) {
    const limit = container.memoryLimitBytes;
    const value =
      limit != null && Number.isFinite(limit) && limit > 0
        ? `${formatBytes(container.memoryUsageBytes, i18n.language)} / ${formatBytes(limit, i18n.language)}`
        : formatBytes(container.memoryUsageBytes, i18n.language);
    metrics.push({
      key: "memory",
      label: t(I18nKey.DCK$MONITORING_MEMORY),
      value,
      icon: <HardDrive size={14} aria-hidden />,
    });
  }

  if (container?.restartCount != null && container.restartCount > 0) {
    metrics.push({
      key: "restarts",
      label: t(I18nKey.DCK$MONITORING_RESTARTS),
      value: new Intl.NumberFormat(i18n.language).format(
        container.restartCount,
      ),
    });
  }

  return (
    <article
      data-testid={testId}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-base p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-contrast/80">
            <Icon size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold text-contrast sm:text-base">
              {name}
            </h3>
            {detail && (
              <p
                className="mt-0.5 truncate text-xs text-contrast/80"
                title={detail}
              >
                {detail}
              </p>
            )}
            {container?.id && (
              <p className="mt-0.5 text-xs text-text-tertiary">
                {t(I18nKey.DCK$MONITORING_CONTAINER)} {container.id}
              </p>
            )}
          </div>
        </div>
        <DckMonitoringStatusBadge
          status={displayStatus.status}
          label={displayStatus.label}
          testId={statusTestId}
        />
      </div>

      <div data-testid={metrics.length ? `${testId}-metrics` : undefined}>
        <MetricGrid metrics={metrics} />
      </div>
    </article>
  );
}

function projectStatusTone(status: DckProjectStatus): StatusTone {
  if (status === "running" || status === "working") return "success";
  if (status === "error") return "danger";
  return "neutral";
}

export function DckMonitoringModuleCard({
  module,
  status,
  latestActivityAt,
  workspace,
  conversationsLoading,
  conversationsError,
}: {
  module: DckModule;
  status: DckProjectStatus;
  latestActivityAt: string | null;
  workspace: DckWorkspaceModule | undefined;
  conversationsLoading: boolean;
  conversationsError: boolean;
}) {
  const { t, i18n } = useTranslation("openhands");
  const ModuleIcon = module.icon;
  const latestActivity = latestActivityAt
    ? formatTimestamp(latestActivityAt, i18n.language)
    : null;
  const artifactCount =
    workspace && !workspace.scanError
      ? `${workspace.truncated ? "≥" : ""}${new Intl.NumberFormat(i18n.language).format(workspace.artifactCount)}`
      : null;
  const metrics = [
    ...(artifactCount
      ? [
          {
            key: "artifacts",
            label: t(I18nKey.DCK$MONITORING_ARTIFACTS),
            value: artifactCount,
          },
        ]
      : []),
    ...(latestActivity
      ? [
          {
            key: "last-activity",
            label: t(I18nKey.DCK$MONITORING_LAST_ACTIVITY),
            value: latestActivity,
          },
        ]
      : []),
  ];

  return (
    <article
      data-testid={`dck-monitoring-module-${module.slug}`}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-base p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-contrast/80">
            <ModuleIcon size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold text-contrast sm:text-base">
              {module.name}
            </h3>
            <p className="mt-0.5 truncate text-xs text-contrast/80">
              /{module.slug}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex min-h-7 shrink-0 items-center rounded-md border px-2.5 py-1 text-xs font-medium ${STATUS_TONE_CLASSES[projectStatusTone(status)]}`}
        >
          {t(DCK_STATUS_LABEL_KEYS[status] as I18nKey)}
        </span>
      </div>

      <MetricGrid metrics={metrics} columns={2} />

      {workspace?.scanError ? (
        <p
          role="alert"
          className="border-t border-border pt-3 text-sm text-contrast"
        >
          {t(I18nKey.DCK$MONITORING_MODULE_SCAN_ERROR)}
        </p>
      ) : workspace?.recentArtifacts.length ? (
        <ul
          aria-label={t(I18nKey.DCK$MONITORING_ARTIFACTS)}
          className="flex min-w-0 flex-col gap-2 border-t border-border pt-3 text-sm text-contrast/80"
        >
          {workspace.recentArtifacts.slice(0, 4).map((artifact) => (
            <li key={artifact.path} className="flex min-w-0 items-center gap-2">
              <FileText
                size={14}
                className="shrink-0 text-contrast/80"
                aria-hidden
              />
              <span className="min-w-0 truncate" title={artifact.path}>
                {artifact.path}
              </span>
            </li>
          ))}
        </ul>
      ) : conversationsLoading ? (
        <p
          role="status"
          className="border-t border-border pt-3 text-sm text-contrast/80"
        >
          {t(I18nKey.DCK$LOADING)}
        </p>
      ) : conversationsError ? null : (
        <p className="border-t border-border pt-3 text-sm text-contrast/80">
          {t(I18nKey.DCK$MONITORING_NO_OUTPUTS)}
        </p>
      )}

      {workspace?.truncated && (
        <p className="text-xs text-contrast/80">
          {t(I18nKey.DCK$MONITORING_FILES_LIMITED)}
        </p>
      )}
    </article>
  );
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

export function DckMonitoringAlertList({
  alerts,
}: {
  alerts: DckMonitoringAlert[];
}) {
  const { t, i18n } = useTranslation("openhands");
  const hasAlerts = alerts.length > 0;
  return (
    <section
      aria-labelledby="dck-monitoring-alert-title"
      data-testid="dck-monitoring-alerts"
      className={`rounded-xl border p-4 sm:p-5 ${hasAlerts ? "border-warning/30 bg-warning/5" : "border-border bg-base"}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle
            size={17}
            className={hasAlerts ? "text-contrast" : "text-contrast/80"}
            aria-hidden
          />
          <h2
            id="dck-monitoring-alert-title"
            className="text-base font-semibold text-contrast"
          >
            {t(I18nKey.DCK$MONITORING_ATTENTION)}
          </h2>
        </div>
        <span className="min-w-8 rounded-md bg-surface px-2 py-1 text-center text-sm font-semibold text-contrast tabular-nums">
          {new Intl.NumberFormat(i18n.language).format(alerts.length)}
        </span>
      </div>

      {hasAlerts ? (
        <ul aria-live="polite" className="flex flex-col gap-2">
          {alerts.map((alert) => {
            const isDockerUnavailable = alert.id === "docker:unavailable";
            return (
              <li
                key={alert.id}
                role={isDockerUnavailable ? "alert" : undefined}
                data-testid={
                  isDockerUnavailable
                    ? "dck-monitoring-docker-unavailable"
                    : `dck-monitoring-alert-${alert.id}`
                }
                className="flex min-w-0 items-start gap-2 rounded-lg border border-warning/20 bg-base px-3 py-2.5 text-sm text-contrast"
              >
                <AlertTriangle
                  size={15}
                  className="mt-0.5 shrink-0 text-contrast"
                  aria-hidden
                />
                <span>
                  {isDockerUnavailable
                    ? t(I18nKey.DCK$MONITORING_DOCKER_UNAVAILABLE)
                    : t(alertMessageKey(alert.code), { name: alert.appName })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p
          role="status"
          className="flex items-start gap-2 text-sm text-contrast/80"
        >
          <CheckCircle2
            size={16}
            className="mt-0.5 shrink-0 text-contrast"
            aria-hidden
          />
          <span>{t(I18nKey.DCK$MONITORING_NO_ALERTS)}</span>
        </p>
      )}
    </section>
  );
}

export function DckMonitoringSummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  tone?: "neutral" | "warning" | "success";
}) {
  const iconClasses =
    tone === "warning"
      ? "bg-warning/10 text-contrast"
      : tone === "success"
        ? "bg-semantic-success/10 text-contrast"
        : "bg-surface text-contrast/80";
  return (
    <article className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-base p-4">
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconClasses}`}
      >
        <Icon size={18} aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm text-contrast/80">{label}</p>
        <p className="mt-0.5 text-xl font-semibold leading-tight text-contrast tabular-nums">
          {value}
        </p>
        {detail && <p className="mt-1 text-xs text-contrast/80">{detail}</p>}
      </div>
    </article>
  );
}

export function DckMonitoringPlatformServiceCard({
  service,
}: {
  service: DckMonitoredService;
}) {
  return (
    <DckMonitoringContainerCard
      testId={`dck-monitoring-service-${service.id}`}
      statusTestId={`dck-monitoring-service-status-${service.id}`}
      name={service.name}
      detail={service.containerName}
      status={service.status}
      health={service.health}
      container={service.container}
      icon={service.id === "postgres" ? Database : Server}
    />
  );
}

export function DckMonitoringApplicationCard({
  app,
}: {
  app: DckMonitoredApp;
}) {
  return (
    <DckMonitoringContainerCard
      testId={`dck-monitoring-app-${app.id}`}
      statusTestId={`dck-monitoring-status-${app.id}`}
      name={app.name}
      status={app.status}
      health={app.health}
      container={app.container}
    />
  );
}
