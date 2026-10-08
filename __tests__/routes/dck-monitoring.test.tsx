import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import type { DckMonitoringSnapshot } from "#/dck/monitoring";
import DckMonitoringRoute from "#/routes/dck-monitoring";

const mocks = vi.hoisted(() => ({
  monitoring: null as unknown,
  automationHealth: {
    data: { status: "ok" as "ok" | "error" },
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
  conversations: {
    conversations: [] as unknown[],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  moduleConfig: {
    modules: [] as unknown[],
    builtinOverrides: [] as unknown[],
    isLoading: false,
    refetch: vi.fn(),
  },
}));

vi.mock("#/hooks/query/use-dck-monitoring", () => ({
  useDckMonitoring: () => mocks.monitoring,
}));
vi.mock("#/hooks/query/use-automation-health", () => ({
  useAutomationHealth: () => mocks.automationHealth,
}));
vi.mock("#/components/features/dck/use-dck-conversations", () => ({
  useAllConversationsQuery: () => mocks.conversations,
}));
vi.mock("#/hooks/query/use-dck-modules-config", () => ({
  useDckModulesConfig: () => mocks.moduleConfig,
}));
vi.mock("#/manifests/automation-interface", () => ({
  hasAutomationInterface: () => true,
}));

const healthyContainer = {
  id: "container1234",
  status: "running" as const,
  health: "healthy",
  startedAt: "2026-10-07T10:00:00.000Z",
  restartCount: 0,
  cpuPercent: 3.5,
  memoryUsageBytes: 10 * 1024 * 1024,
  memoryLimitBytes: 100 * 1024 * 1024,
};

const snapshot: DckMonitoringSnapshot = {
  serverTime: "2026-10-07T20:00:00.000Z",
  docker: { available: true, version: "27.0.3", apiVersion: "1.45" },
  services: [
    {
      id: "canvas",
      name: "Canvas / Agent Server / Automation",
      containerName: "dck-agentic-canvas",
      status: "running",
      health: "healthy",
      container: healthyContainer,
    },
    {
      id: "postgres",
      name: "PostgreSQL",
      containerName: "dck-agentic-postgres",
      status: "running",
      health: "healthy",
      container: { ...healthyContainer, id: "postgres12345" },
    },
    {
      id: "beszel",
      name: "Beszel Hub",
      containerName: "dck-agentic-beszel",
      status: "running",
      health: "healthy",
      container: { ...healthyContainer, id: "beszel123456" },
    },
  ],
  workspaceModules: [
    {
      id: "research",
      name: "Research",
      slug: "research",
      artifactCount: 1,
      latestArtifactAt: "2026-10-07T19:30:00.000Z",
      recentArtifacts: [
        {
          path: "reports/market-brief.md",
          modifiedAt: "2026-10-07T19:30:00.000Z",
          sizeBytes: 4096,
        },
      ],
      truncated: false,
      scanError: false,
    },
    ...(["analytics", "content"] as const).map((slug) => ({
      id: slug,
      name: slug,
      slug,
      artifactCount: 0,
      latestArtifactAt: null,
      recentArtifacts: [],
      truncated: false,
      scanError: false,
    })),
  ],
  applications: [
    {
      id: "storefront",
      name: "Storefront",
      port: 3005,
      expectedStatus: "running",
      status: "stopped",
      health: null,
      container: {
        id: "0123456789ab",
        status: "stopped",
        health: null,
        startedAt: null,
        restartCount: 3,
        cpuPercent: null,
        memoryUsageBytes: null,
        memoryLimitBytes: null,
      },
    },
  ],
};

function setQueryState(overrides: Record<string, unknown> = {}) {
  mocks.monitoring = {
    isLocalBackend: true,
    data: snapshot,
    dataUpdatedAt: Date.parse("2026-10-07T20:00:00.000Z"),
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("DckMonitoringRoute", () => {
  beforeEach(() => {
    mocks.automationHealth.data = { status: "ok" };
    mocks.automationHealth.isFetching = false;
    mocks.automationHealth.isError = false;
    mocks.conversations.conversations = [];
    mocks.moduleConfig.modules = [];
    mocks.moduleConfig.builtinOverrides = [];
    setQueryState();
  });

  it("renders core services, module outputs, Webgen incidents, and refreshes all sources", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    setQueryState({ refetch });
    renderWithProviders(<DckMonitoringRoute />);

    expect(screen.getByTestId("dck-monitoring-beszel-link")).toHaveAttribute(
      "href",
      "/beszel/",
    );
    expect(screen.getByTestId("dck-monitoring-toolbar")).toHaveClass(
      "grid-cols-2",
      "sm:flex",
      "sm:w-auto",
    );
    expect(screen.getByTestId("dck-monitoring-live")).toBeInTheDocument();
    expect(screen.getByTestId("dck-monitoring-last-updated")).toHaveTextContent(
      "DCK$MONITORING_LAST_UPDATED",
    );
    expect(
      await screen.findByTestId("dck-monitoring-service-canvas"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-monitoring-service-postgres"),
    ).toBeInTheDocument();
    const canvasService = screen.getByTestId("dck-monitoring-service-canvas");
    expect(
      screen.getByTestId("dck-monitoring-service-status-canvas"),
    ).toHaveTextContent("DCK$STATUS_RUNNING");
    expect(
      within(canvasService).getByText("DCK$STATUS_HEALTHY"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-monitoring-service-beszel"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-monitoring-module-research"),
    ).toBeInTheDocument();
    expect(screen.getByText("reports/market-brief.md")).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-monitoring-app-storefront"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dck-monitoring-alerts")).toHaveTextContent(
      "DCK$MONITORING_STOPPED_ALERT",
    );

    await user.click(screen.getByTestId("dck-monitoring-refresh"));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mocks.automationHealth.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.moduleConfig.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.conversations.refetch).toHaveBeenCalledTimes(1);
  });

  it("preserves module monitoring when the Docker daemon is unavailable", () => {
    const offlineSnapshot: DckMonitoringSnapshot = {
      ...snapshot,
      docker: { available: false, version: null, apiVersion: null },
      services: snapshot.services.map((service) => ({
        ...service,
        status: "unknown",
        health: null,
        container: null,
      })),
      applications: snapshot.applications.map((app) => ({
        ...app,
        status: "unknown",
        health: null,
        container: null,
      })),
    };
    setQueryState({ data: offlineSnapshot });
    renderWithProviders(<DckMonitoringRoute />);

    expect(
      screen.getByTestId("dck-monitoring-docker-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-monitoring-module-research"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-monitoring-coverage-note"),
    ).toBeInTheDocument();
  });

  it("shows the last successful timestamp, but not a live badge, after a failed refresh", () => {
    setQueryState({ isError: true });
    renderWithProviders(<DckMonitoringRoute />);

    expect(
      screen.getByTestId("dck-monitoring-stale-error"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("dck-monitoring-live")).not.toBeInTheDocument();
    expect(screen.getByTestId("dck-monitoring-last-updated")).toHaveTextContent(
      "DCK$MONITORING_LAST_UPDATED",
    );
  });

  it("explains that workspace module data is not available yet", () => {
    setQueryState({
      data: { ...snapshot, workspaceModules: [] },
    });
    renderWithProviders(<DckMonitoringRoute />);

    expect(
      screen.getByTestId("dck-monitoring-workspace-empty"),
    ).toHaveTextContent("DCK$MONITORING_NO_WORKSPACE_DATA");
    expect(
      screen.getByTestId("dck-monitoring-module-research"),
    ).toBeInTheDocument();
  });

  it("does not report live or a last-update time before the first successful load", () => {
    setQueryState({ data: undefined, dataUpdatedAt: 0, isLoading: true });
    renderWithProviders(<DckMonitoringRoute />);

    expect(screen.getByTestId("dck-monitoring-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("dck-monitoring-live")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("dck-monitoring-last-updated"),
    ).not.toBeInTheDocument();
  });

  it("explains when the active backend cannot access host monitoring", () => {
    setQueryState({ isLocalBackend: false, data: undefined });
    renderWithProviders(<DckMonitoringRoute />);

    expect(screen.getByTestId("dck-monitoring-local-only")).toBeInTheDocument();
    expect(
      screen.queryByTestId("dck-monitoring-beszel-link"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("dck-monitoring-app-storefront"),
    ).not.toBeInTheDocument();
  });
});
