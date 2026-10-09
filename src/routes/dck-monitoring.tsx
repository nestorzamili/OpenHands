import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { BackNavButton } from "#/components/shared/buttons/back-nav-button";
import { useAllConversationsQuery } from "#/components/features/dck/use-dck-conversations";
import {
  DckMonitoringAlertList,
  DckMonitoringApplicationCard,
  DckMonitoringContainerCard,
  DckMonitoringModuleCard,
  DckMonitoringPlatformServiceCard,
  DckMonitoringSummaryCard,
} from "#/components/features/dck/dck-monitoring-components";
import { I18nKey } from "#/i18n/declaration";
import {
  getDckMonitoringAlerts,
  DCK_BESZEL_ROUTE_PATH,
  type DckMonitoringAlert,
  type DckMonitoredAppStatus,
} from "#/dck/monitoring";
import {
  conversationsForBase,
  deriveProjectStatus,
  mergeDckModules,
  type DckModule,
} from "#/dck/modules";
import { useDckModulesConfig } from "#/hooks/query/use-dck-modules-config";
import { useAutomationHealth } from "#/hooks/query/use-automation-health";
import { useDckMonitoring } from "#/hooks/query/use-dck-monitoring";
import { hasAutomationInterface } from "#/manifests/automation-interface";

const DOCKER_UNAVAILABLE_ALERT_ID = "docker:unavailable";

interface ModuleActivityItem {
  module: DckModule;
  status: ReturnType<typeof deriveProjectStatus>;
  latestActivityAt: string | null;
  workspace:
    | NonNullable<
        ReturnType<typeof useDckMonitoring>["data"]
      >["workspaceModules"][number]
    | undefined;
}

function latestTimestamp(values: Array<string | null>): string | null {
  let latestValue: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && timestamp > latestTime) {
      latestValue = value;
      latestTime = timestamp;
    }
  }
  return latestValue;
}

function formatCount(value: number, language: string): string {
  return new Intl.NumberFormat(language).format(value);
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
  const moduleActivity = React.useMemo<ModuleActivityItem[]>(
    () =>
      dckModules.map((module) => {
        const relatedConversations = conversationsForBase(
          conversationQuery.conversations,
          module.workspacePath,
        );
        const latestConversation = relatedConversations[0] ?? null;
        const workspace = workspaceBySlug.get(module.slug);
        return {
          module,
          status: deriveProjectStatus(null, latestConversation),
          latestActivityAt: latestTimestamp([
            latestConversation?.updated_at ?? null,
            workspace?.latestArtifactAt ?? null,
          ]),
          workspace,
        };
      }),
    [conversationQuery.conversations, dckModules, workspaceBySlug],
  );
  const hasWorkspaceModuleData =
    (snapshot?.workspaceModules.length ?? 0) > 0 ||
    moduleActivity.some((item) => item.latestActivityAt !== null);
  const showWorkspaceEmptyState =
    Boolean(snapshot) &&
    !conversationQuery.isLoading &&
    !conversationQuery.isError &&
    (moduleActivity.length === 0 || !hasWorkspaceModuleData);
  const dockerAvailable = snapshot?.docker.available ?? false;
  const automationStatus: DckMonitoredAppStatus = !automationAvailable
    ? "unknown"
    : automationHealth.isError || automationHealth.data?.status === "error"
      ? "error"
      : automationHealth.data?.status === "ok"
        ? "running"
        : "unknown";
  const alerts: DckMonitoringAlert[] = [
    ...getDckMonitoringAlerts(apps, dockerAvailable ? services : []),
    ...moduleActivity
      .filter((item) => item.status === "error")
      .map((item) => ({
        id: `module:${item.module.id}`,
        code: "module" as const,
        appName: item.module.name,
      })),
    ...(automationAvailable &&
    (automationHealth.isError || automationHealth.data?.status === "error")
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
            id: DOCKER_UNAVAILABLE_ALERT_ID,
            code: "service" as const,
            appName: "",
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
  const isRefreshing =
    query.isFetching ||
    automationHealth.isFetching ||
    conversationQuery.isFetching ||
    moduleConfig.isFetching;

  const refreshAll = () => {
    void query.refetch();
    void automationHealth.refetch();
    void moduleConfig.refetch();
    void conversationQuery.refetch();
  };

  return (
    <div className="custom-scrollbar-always h-full overflow-y-auto rounded-xl bg-transparent px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7">
        <BackNavButton to="/conversations">
          {t(I18nKey.DCK$BACK_TO_HOME)}
        </BackNavButton>

        <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Activity
              size={23}
              className="mt-1 shrink-0 text-accent"
              aria-hidden
            />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold leading-tight text-contrast">
                {t(I18nKey.DCK$MONITORING_TITLE)}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-contrast/80">
                {t(I18nKey.DCK$MONITORING_DESCRIPTION)}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 xl:items-end">
            <div
              data-testid="dck-monitoring-toolbar"
              className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center"
            >
              {query.isLocalBackend && (
                <a
                  href={DCK_BESZEL_ROUTE_PATH}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="dck-monitoring-beszel-link"
                  className="col-span-2 inline-flex min-h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-primary bg-base px-3 text-sm font-medium text-contrast transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:col-span-1"
                >
                  {t(I18nKey.DCK$MONITORING_BESZEL_LINK)}
                  <ArrowUpRight size={15} aria-hidden />
                </a>
              )}
              {query.isLocalBackend && snapshot && !query.isError && (
                <span
                  data-testid="dck-monitoring-live"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-semantic-success/25 bg-semantic-success/10 px-3 text-sm font-medium text-contrast"
                >
                  <span
                    className="size-2 rounded-full bg-contrast"
                    aria-hidden
                  />
                  {t(I18nKey.DCK$MONITORING_LIVE)}
                </span>
              )}
              {query.isLocalBackend && (
                <button
                  type="button"
                  onClick={refreshAll}
                  disabled={isRefreshing}
                  aria-busy={isRefreshing}
                  data-testid="dck-monitoring-refresh"
                  className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-primary bg-base px-3 text-sm font-medium text-contrast transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60"
                >
                  <RefreshCw
                    size={15}
                    className={
                      isRefreshing
                        ? "animate-spin motion-reduce:animate-none"
                        : ""
                    }
                    aria-hidden
                  />
                  {t(I18nKey.DCK$MONITORING_REFRESH)}
                </button>
              )}
            </div>
            {checkedAt && (
              <p
                data-testid="dck-monitoring-last-updated"
                className="text-xs text-contrast/80 xl:text-right"
              >
                {t(I18nKey.DCK$MONITORING_LAST_UPDATED, { time: checkedAt })}
              </p>
            )}
          </div>
        </header>

        {!query.isLocalBackend ? (
          <div
            data-testid="dck-monitoring-local-only"
            className="rounded-xl border border-border bg-base p-4 text-sm text-contrast/80"
          >
            {t(I18nKey.DCK$MONITORING_LOCAL_ONLY)}
          </div>
        ) : query.isError && !snapshot ? (
          <div
            role="alert"
            data-testid="dck-monitoring-error"
            className="flex flex-col items-start gap-3 rounded-xl border border-semantic-danger/30 bg-semantic-danger/5 p-4"
          >
            <div className="flex items-start gap-2 text-sm text-contrast">
              <AlertTriangle
                size={17}
                className="mt-0.5 shrink-0 text-contrast"
                aria-hidden
              />
              <p>{t(I18nKey.DCK$MONITORING_DOCKER_UNAVAILABLE)}</p>
            </div>
            <button
              type="button"
              onClick={refreshAll}
              disabled={isRefreshing}
              className="inline-flex min-h-11 items-center rounded-lg border border-primary px-3 text-sm font-medium text-contrast hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            >
              {t(I18nKey.DCK$RETRY)}
            </button>
          </div>
        ) : query.isLoading ? (
          <p
            role="status"
            data-testid="dck-monitoring-loading"
            className="rounded-xl border border-border bg-base p-4 text-sm text-contrast/80"
          >
            {t(I18nKey.DCK$LOADING)}
          </p>
        ) : (
          <>
            {query.isError && (
              <div
                role="alert"
                data-testid="dck-monitoring-stale-error"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-semantic-danger/30 bg-semantic-danger/5 p-4 text-sm text-contrast"
              >
                <span>{t(I18nKey.DCK$MONITORING_DOCKER_UNAVAILABLE)}</span>
                <button
                  type="button"
                  onClick={refreshAll}
                  disabled={isRefreshing}
                  className="inline-flex min-h-11 items-center rounded-lg border border-primary px-3 font-medium text-contrast hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                >
                  {t(I18nKey.DCK$RETRY)}
                </button>
              </div>
            )}

            <section
              aria-label={t(I18nKey.DCK$MONITORING_TITLE)}
              className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-3"
            >
              <DckMonitoringSummaryCard
                label={t(I18nKey.DCK$MONITORING_ACTIVE_ALERTS)}
                value={formatCount(alerts.length, i18n.language)}
                detail={
                  alerts.length > 0
                    ? t(I18nKey.DCK$MONITORING_ATTENTION)
                    : t(I18nKey.DCK$STATUS_HEALTHY)
                }
                icon={AlertTriangle}
                tone={alerts.length > 0 ? "warning" : "success"}
              />
              {dockerAvailable && services.length > 0 && (
                <DckMonitoringSummaryCard
                  label={t(I18nKey.DCK$MONITORING_PLATFORM_SERVICES)}
                  value={`${formatCount(runningServiceCount, i18n.language)} / ${formatCount(services.length, i18n.language)}`}
                  detail={t(I18nKey.DCK$STATUS_RUNNING)}
                  icon={Server}
                />
              )}
              {dockerAvailable && apps.length > 0 && (
                <DckMonitoringSummaryCard
                  label={t(I18nKey.DCK$MONITORING_APPLICATIONS)}
                  value={`${formatCount(runningAppCount, i18n.language)} / ${formatCount(apps.length, i18n.language)}`}
                  detail={t(I18nKey.DCK$STATUS_RUNNING)}
                  icon={Activity}
                />
              )}
            </section>

            <DckMonitoringAlertList alerts={alerts} />

            <section
              aria-labelledby="dck-monitoring-services-title"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="dck-monitoring-services-title"
                  className="text-lg font-semibold text-contrast"
                >
                  {t(I18nKey.DCK$MONITORING_PLATFORM_SERVICES)}
                </h2>
                <p className="text-sm text-contrast/80">
                  {dockerAvailable
                    ? formatCount(services.length, i18n.language)
                    : t(I18nKey.DCK$STATUS_UNKNOWN)}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {services.map((service) => (
                  <DckMonitoringPlatformServiceCard
                    key={service.id}
                    service={service}
                  />
                ))}
                <DckMonitoringContainerCard
                  testId="dck-monitoring-automation"
                  statusTestId="dck-monitoring-automation-status"
                  name={t(I18nKey.DCK$MONITORING_AUTOMATION)}
                  detail={
                    automationAvailable
                      ? undefined
                      : t(I18nKey.DCK$MONITORING_AUTOMATION_NOT_CONFIGURED)
                  }
                  status={automationStatus}
                  health={null}
                  container={null}
                />
              </div>
            </section>

            <section
              aria-labelledby="dck-monitoring-modules-title"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="dck-monitoring-modules-title"
                  className="text-lg font-semibold text-contrast"
                >
                  {t(I18nKey.DCK$MONITORING_WORKSPACE_MODULES)}
                </h2>
                <p
                  role={moduleConfig.isLoading ? "status" : undefined}
                  className="text-sm text-contrast/80"
                >
                  {moduleConfig.isLoading
                    ? t(I18nKey.DCK$LOADING)
                    : formatCount(moduleActivity.length, i18n.language)}
                </p>
              </div>
              {conversationQuery.isError && (
                <p
                  role="alert"
                  data-testid="dck-monitoring-conversations-error"
                  className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-contrast"
                >
                  {t(I18nKey.DCK$MONITORING_CONVERSATIONS_ERROR)}
                </p>
              )}
              {showWorkspaceEmptyState && (
                <p
                  data-testid="dck-monitoring-workspace-empty"
                  className="rounded-xl border border-border bg-base p-5 text-sm text-contrast/80"
                >
                  {t(I18nKey.DCK$MONITORING_NO_WORKSPACE_DATA)}
                </p>
              )}
              {moduleActivity.length > 0 && (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {moduleActivity.map((item) => (
                    <DckMonitoringModuleCard
                      key={item.module.id}
                      module={item.module}
                      status={item.status}
                      latestActivityAt={item.latestActivityAt}
                      workspace={item.workspace}
                      conversationsLoading={conversationQuery.isLoading}
                      conversationsError={conversationQuery.isError}
                    />
                  ))}
                </div>
              )}
            </section>

            <section
              aria-labelledby="dck-monitoring-apps-title"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="dck-monitoring-apps-title"
                  className="text-lg font-semibold text-contrast"
                >
                  {t(I18nKey.DCK$MONITORING_APPLICATIONS)}
                </h2>
                {apps.length > 0 && (
                  <p className="text-sm text-contrast/80">
                    {formatCount(apps.length, i18n.language)}
                  </p>
                )}
              </div>
              {apps.length === 0 ? (
                <p
                  data-testid="dck-monitoring-empty"
                  className="rounded-xl border border-border bg-base p-5 text-sm text-contrast/80"
                >
                  {t(I18nKey.DCK$MONITORING_NO_APPS)}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {apps.map((app) => (
                    <DckMonitoringApplicationCard key={app.id} app={app} />
                  ))}
                </div>
              )}
            </section>

            <p
              data-testid="dck-monitoring-coverage-note"
              className="rounded-lg border border-border bg-base px-4 py-3 text-xs leading-5 text-contrast/80"
            >
              {t(I18nKey.DCK$MONITORING_COVERAGE_NOTE)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
