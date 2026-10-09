export const DCK_MONITORING_ROUTE_SEGMENT = "monitoring";
export const DCK_MONITORING_ROUTE_PATH = `/${DCK_MONITORING_ROUTE_SEGMENT}`;

export type DckMonitoredAppStatus =
  | "running"
  | "stopped"
  | "restarting"
  | "starting"
  | "missing"
  | "error"
  | "not_deployed"
  | "unknown";

export type DckMonitoringAlertCode =
  | "stopped"
  | "unhealthy"
  | "missing"
  | "restarting"
  | "error"
  | "service"
  | "module"
  | "automation";

export interface DckMonitoredContainer {
  id: string | null;
  status: DckMonitoredAppStatus;
  health: string | null;
  startedAt: string | null;
  restartCount: number | null;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
}

export interface DckMonitoredApp {
  id: string;
  name: string;
  port: number | null;
  expectedStatus: "running" | "stopped" | "error" | null;
  status: DckMonitoredAppStatus;
  health: string | null;
  container: DckMonitoredContainer | null;
}

export interface DckMonitoredService {
  id: string;
  name: string;
  containerName: string;
  status: DckMonitoredAppStatus;
  health: string | null;
  container: DckMonitoredContainer | null;
}

export interface DckWorkspaceArtifact {
  path: string;
  modifiedAt: string;
  sizeBytes: number;
}

export interface DckWorkspaceModule {
  id: string;
  name: string;
  slug: string;
  artifactCount: number;
  latestArtifactAt: string | null;
  recentArtifacts: DckWorkspaceArtifact[];
  truncated: boolean;
  scanError: boolean;
}

export interface DckMonitoringSnapshot {
  serverTime: string;
  docker: {
    available: boolean;
    version: string | null;
    apiVersion: string | null;
  };
  services: DckMonitoredService[];
  workspaceModules: DckWorkspaceModule[];
  applications: DckMonitoredApp[];
}

export interface DckMonitoringAlert {
  id: string;
  code: DckMonitoringAlertCode;
  appName: string;
}

export function getDckMonitoringAlerts(
  applications: readonly DckMonitoredApp[],
  services: readonly DckMonitoredService[] = [],
): DckMonitoringAlert[] {
  const alerts: DckMonitoringAlert[] = [];
  for (const app of applications) {
    let code: DckMonitoringAlertCode | null = null;
    if (app.health === "unhealthy") {
      code = "unhealthy";
    } else if (app.status === "missing") {
      code = "missing";
    } else if (app.status === "restarting") {
      code = "restarting";
    } else if (app.status === "error") {
      code = "error";
    } else if (app.status === "stopped" && app.expectedStatus === "running") {
      code = "stopped";
    }
    if (code) alerts.push({ id: `${app.id}:${code}`, code, appName: app.name });
  }
  for (const service of services) {
    if (service.status === "unknown") continue;
    if (service.status === "running" && service.health !== "unhealthy")
      continue;
    alerts.push({
      id: `service:${service.id}`,
      code: "service",
      appName: service.name,
    });
  }
  return alerts;
}
