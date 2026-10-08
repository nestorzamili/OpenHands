import { useQuery } from "@tanstack/react-query";
import { getAgentServerSessionApiKey } from "#/api/agent-server-config";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { DCK_MONITORING_QUERY_KEYS } from "#/hooks/query/query-keys";
import type { DckMonitoringSnapshot } from "#/dck/monitoring";

const DCK_MONITORING_ENDPOINT = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/__dck/monitoring`;
const DCK_MONITORING_POLL_INTERVAL_MS = 30_000;

async function fetchDckMonitoringSnapshot(): Promise<DckMonitoringSnapshot> {
  const sessionApiKey = getAgentServerSessionApiKey();
  const response = await fetch(DCK_MONITORING_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: sessionApiKey ? { "X-Session-API-Key": sessionApiKey } : undefined,
  });
  if (!response.ok) {
    throw new Error(`DCK monitoring request failed (${response.status})`);
  }
  const snapshot: unknown = await response.json();
  const record = snapshot as Partial<DckMonitoringSnapshot> | null;
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !record?.docker ||
    typeof record.docker.available !== "boolean" ||
    !Array.isArray(record.services) ||
    !Array.isArray(record.workspaceModules) ||
    !Array.isArray(record.applications)
  ) {
    throw new Error("DCK monitoring returned an invalid snapshot");
  }
  return snapshot as DckMonitoringSnapshot;
}

export function useDckMonitoring() {
  const { backend } = useActiveBackend();
  const isLocalBackend = backend.kind === "local";
  return {
    isLocalBackend,
    ...useQuery({
      queryKey: DCK_MONITORING_QUERY_KEYS.all(
        backend.id,
        backend.connectionRevision ?? 0,
      ),
      queryFn: fetchDckMonitoringSnapshot,
      enabled: isLocalBackend,
      staleTime: 10_000,
      refetchInterval: DCK_MONITORING_POLL_INTERVAL_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      retry: false,
      meta: { disableToast: true },
    }),
  };
}
