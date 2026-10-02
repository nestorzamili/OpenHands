import { useQuery } from "@tanstack/react-query";
import { getPortalUser } from "#/api/portal-auth-service";

/**
 * Resolves the current portal user. `data === null` means portal auth is not
 * active on this origin (so logout / user-management UI should stay hidden).
 */
export function usePortalUser() {
  return useQuery({
    queryKey: ["portal-auth", "me"],
    queryFn: getPortalUser,
    staleTime: 5 * 60 * 1000,
    retry: false,
    meta: { disableToast: true },
  });
}
