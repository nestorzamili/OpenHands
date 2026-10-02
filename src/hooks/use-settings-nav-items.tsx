import { Users as UsersIcon } from "lucide-react";
import { useConfig } from "#/hooks/query/use-config";
import {
  LOCKED_CLOUD_SETTINGS_NAV_PATHS,
  OSS_NAV_ITEMS,
  SettingsNavItem,
} from "#/constants/settings-nav";
import { isSettingsPageHidden } from "#/utils/settings-utils";
import { I18nKey } from "#/i18n/declaration";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { getLockedCloudHost } from "#/api/agent-server-config";
import { usePortalUser } from "#/hooks/query/use-portal-user";

export type SettingsNavRenderedItem =
  | {
      type: "item";
      item: SettingsNavItem;
    }
  | { type: "header"; text: I18nKey }
  | { type: "divider" };

export function useSettingsNavItems(): SettingsNavRenderedItem[] {
  const { data: config } = useConfig();
  const { backend } = useActiveBackend();
  const { data: portalUser } = usePortalUser();
  const featureFlags = config?.feature_flags;
  // Locked-to-Cloud still lists the full Canvas settings nav; the Cloud shell
  // remains available through "All Cloud Settings" for Cloud-owned pages.
  const isLockedToCloud = getLockedCloudHost() !== null;

  const items: SettingsNavRenderedItem[] = OSS_NAV_ITEMS.filter(
    (item) =>
      !isSettingsPageHidden(item.to, featureFlags) &&
      (!isLockedToCloud || LOCKED_CLOUD_SETTINGS_NAV_PATHS.has(item.to)),
  ).map((item) => {
    const renamedItem =
      item.to === "/settings"
        ? {
            ...item,
            text:
              backend.kind === "local"
                ? I18nKey.SETTINGS$LLM_PROFILES
                : item.text,
            subtitle:
              backend.kind === "local"
                ? I18nKey.SETTINGS$PAGE_LLM_PROFILES_SUBLINE
                : item.subtitle,
          }
        : item;

    return { type: "item", item: renamedItem } as SettingsNavRenderedItem;
  });

  // Portal user management is only relevant when portal auth gates this origin
  // and the signed-in user is an admin.
  if (portalUser?.isAdmin) {
    items.push({
      type: "item",
      item: {
        icon: <UsersIcon width={16} height={16} />,
        to: "/settings/users",
        text: "PORTAL$MANAGE_USERS",
        subtitle: "PORTAL$USERS_SUBTITLE",
      },
    });
  }

  return items;
}
