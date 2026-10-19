import { useQuery } from "@tanstack/react-query";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { fetchWebgenProjects } from "#/dck/webgen-service";

export function webgenProjectsQueryKey(
  backendId: string,
  orgId: string | null,
) {
  return ["dck", "webgen-projects", backendId, orgId] as const;
}

export function useWebgenProjects(enabled = true) {
  const active = useActiveBackend();
  const queryKey = webgenProjectsQueryKey(active.backend.id, active.orgId);

  return useQuery({
    queryKey,
    queryFn: () => fetchWebgenProjects(),
    enabled: enabled && active.backend.kind !== "cloud",
    retry: false,
    staleTime: 0,
    refetchInterval: enabled ? 5_000 : false,
    refetchIntervalInBackground: false,
    meta: { disableToast: true },
  });
}
