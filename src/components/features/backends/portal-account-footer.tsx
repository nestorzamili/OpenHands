import React from "react";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { usePortalUser } from "#/hooks/query/use-portal-user";
import { logoutPortal } from "#/api/portal-auth-service";
import { cn } from "#/utils/utils";
import {
  dropdownFooterActionClassName,
  dropdownMenuListClassName,
  dropdownMenuRowIconWrapperClassName,
} from "#/utils/dropdown-classes";

/**
 * Portal account block for the backend-selector (environment) dropdown footer:
 * shows the signed-in username and a logout action. Renders only when portal
 * auth is active on this origin (`usePortalUser` resolves a user).
 */
export function PortalAccountFooter() {
  const { t } = useTranslation("openhands");
  const { data: user } = usePortalUser();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  if (!user) return null;

  const handleLogout = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsLoggingOut(true);
    try {
      await logoutPortal();
    } finally {
      // Reload so the server-side gate serves the login page again.
      window.location.assign("/");
    }
  };

  return (
    <div
      className={cn(dropdownMenuListClassName, "border-t border-border")}
      data-testid="portal-account-footer"
    >
      <div
        data-testid="portal-account-footer-user"
        className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-tertiary"
      >
        <span className="min-w-0 flex-1 truncate" title={user.username}>
          {user.username}
        </span>
        {user.isAdmin && (
          <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs uppercase tracking-wide">
            {t(I18nKey.PORTAL$ADMIN)}
          </span>
        )}
      </div>
      <button
        type="button"
        data-testid="portal-logout-button"
        disabled={isLoggingOut}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleLogout}
        className={cn(
          dropdownFooterActionClassName,
          "cursor-pointer rounded-md disabled:opacity-50",
        )}
      >
        <span className={dropdownMenuRowIconWrapperClassName} aria-hidden>
          <LogOut width={16} height={16} />
        </span>
        {t(I18nKey.PORTAL$LOGOUT)}
      </button>
    </div>
  );
}
