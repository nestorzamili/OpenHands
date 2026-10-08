import { describe, expect, it } from "vitest";
import { getDckMonitoringAlerts } from "#/dck/monitoring";
import type { DckMonitoredApp, DckMonitoredService } from "#/dck/monitoring";

const app = (
  id: string,
  status: DckMonitoredApp["status"],
  expectedStatus: DckMonitoredApp["expectedStatus"],
  health: string | null = null,
): DckMonitoredApp => ({
  id,
  name: id,
  port: null,
  expectedStatus,
  status,
  health,
  container: null,
});

describe("getDckMonitoringAlerts", () => {
  it("reports unhealthy, missing, restarting, error, and unexpectedly stopped apps", () => {
    const alerts = getDckMonitoringAlerts([
      app("unhealthy-app", "running", "running", "unhealthy"),
      app("missing-app", "missing", "running"),
      app("restarting-app", "restarting", "running"),
      app("error-app", "error", "error"),
      app("stopped-app", "stopped", "running"),
      app("intentionally-stopped", "stopped", "stopped"),
      app("not-deployed", "not_deployed", null),
    ]);

    expect(alerts).toEqual([
      {
        id: "unhealthy-app:unhealthy",
        code: "unhealthy",
        appName: "unhealthy-app",
      },
      { id: "missing-app:missing", code: "missing", appName: "missing-app" },
      {
        id: "restarting-app:restarting",
        code: "restarting",
        appName: "restarting-app",
      },
      { id: "error-app:error", code: "error", appName: "error-app" },
      { id: "stopped-app:stopped", code: "stopped", appName: "stopped-app" },
    ]);
  });

  it("alerts for unavailable core services but ignores unknown daemon state", () => {
    const service = (
      id: string,
      status: DckMonitoredService["status"],
      health: string | null,
    ): DckMonitoredService => ({
      id,
      name: id,
      containerName: `dck-agentic-${id}`,
      status,
      health,
      container: null,
    });

    expect(
      getDckMonitoringAlerts(
        [],
        [
          service("canvas", "stopped", null),
          service("postgres", "unknown", null),
          service("healthy-service", "running", "healthy"),
        ],
      ),
    ).toEqual([{ id: "service:canvas", code: "service", appName: "canvas" }]);
  });
});
