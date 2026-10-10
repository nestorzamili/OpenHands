import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { usePortalUser } from "#/hooks/query/use-portal-user";
import { logoutPortal } from "#/api/portal-auth-service";
import { useNavigation } from "#/context/navigation-context";
import { useClickOutsideElement } from "#/hooks/use-click-outside-element";
import { useCloseOnEscape } from "#/hooks/use-close-on-escape";
import { ContextMenu } from "#/ui/context-menu";
import { ContextMenuListItem } from "#/components/features/context-menu/context-menu-list-item";
import { ContextMenuIconText } from "#/components/features/context-menu/context-menu-icon-text";
import { cn } from "#/utils/utils";
import {
  dropdownFooterActionClassName,
  dropdownMenuListClassName,
  dropdownMenuRowIconWrapperClassName,
} from "#/utils/dropdown-classes";

/**
 * Portal account actions. In the server-managed sidebar this renders an
 * account trigger whose dropdown contains Settings and Logout. In the regular
 * backend selector it remains a compact account/logout footer.
 */
export function PortalAccountFooter({
  collapsed = false,
  inSidebar = false,
}: { collapsed?: boolean; inSidebar?: boolean } = {}) {
  const { t } = useTranslation("openhands");
  const { data: user } = usePortalUser();
  const { navigate } = useNavigation();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const containerRef = useClickOutsideElement<HTMLDivElement>(() =>
    setIsMenuOpen(false),
  );
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  useCloseOnEscape(isMenuOpen, () => setIsMenuOpen(false), triggerRef);

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

  const logoutButton = (
    <button
      type="button"
      data-testid="portal-logout-button"
      aria-label={collapsed ? t(I18nKey.PORTAL$LOGOUT) : undefined}
      title={collapsed ? t(I18nKey.PORTAL$LOGOUT) : undefined}
      disabled={isLoggingOut}
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleLogout}
      className={cn(
        dropdownFooterActionClassName,
        collapsed && "size-8 justify-center !p-0",
        "cursor-pointer rounded-md disabled:opacity-50",
      )}
    >
      <span className={dropdownMenuRowIconWrapperClassName} aria-hidden>
        <LogOut width={16} height={16} />
      </span>
      {!collapsed && t(I18nKey.PORTAL$LOGOUT)}
    </button>
  );

  if (inSidebar) {
    const settingsLabel = t(I18nKey.SIDEBAR$SETTINGS);
    const menu = isMenuOpen ? (
      <ContextMenu
        testId="portal-account-menu"
        position={collapsed ? "none" : "top"}
        alignment={collapsed ? "none" : "right"}
        spacing={collapsed ? "none" : "default"}
        className={cn(
          collapsed ? "absolute bottom-0 left-full ml-2 w-75" : "w-full",
        )}
      >
        <li>
          <div
            data-testid="portal-account-menu-user"
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
        </li>
        <li>
          <ContextMenuListItem
            testId="portal-settings-button"
            onClick={() => {
              setIsMenuOpen(false);
              navigate("/settings", { replace: false });
            }}
          >
            <ContextMenuIconText icon={Settings} text={settingsLabel} />
          </ContextMenuListItem>
        </li>
        <li>{logoutButton}</li>
      </ContextMenu>
    ) : null;

    return (
      <div
        ref={containerRef}
        className={cn("relative min-w-0", collapsed && "flex justify-center")}
        data-testid="portal-account-footer"
      >
        <button
          ref={triggerRef}
          type="button"
          data-testid="portal-account-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label={
            collapsed ? `Account menu for ${user.username}` : undefined
          }
          title={collapsed ? `Signed in as ${user.username}` : undefined}
          onClick={() => setIsMenuOpen((open) => !open)}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface text-left hover:bg-interactive-hover",
            collapsed ? "size-10 justify-center p-0" : "w-full px-2 py-2",
          )}
        >
          <span
            data-testid="portal-account-footer-user"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-xs font-semibold text-contrast"
            aria-hidden
          >
            {user.username.slice(0, 1).toUpperCase()}
          </span>
          {!collapsed && (
            <>
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium text-contrast"
                title={user.username}
              >
                {user.username}
              </span>
              {user.isAdmin && (
                <span className="shrink-0 rounded-full bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                  {t(I18nKey.PORTAL$ADMIN)}
                </span>
              )}
              <ChevronDown
                width={16}
                height={16}
                className={cn(
                  "shrink-0 text-muted transition-transform",
                  isMenuOpen && "rotate-180",
                )}
                aria-hidden
              />
            </>
          )}
        </button>
        {menu}
      </div>
    );
  }

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
      {logoutButton}
    </div>
  );
}
