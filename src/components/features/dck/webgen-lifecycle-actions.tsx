import React from "react";
import ReactDOM from "react-dom";
import { useTranslation } from "react-i18next";
import { Play, RotateCcw, Square, Trash2, MoreHorizontal } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { ConfirmationModal } from "#/components/shared/modals/confirmation-modal";
import { ContextMenu } from "#/ui/context-menu";
import { ContextMenuListItem } from "#/components/features/context-menu/context-menu-list-item";
import { cn } from "#/utils/utils";
import {
  buildWebgenLifecycleCommand,
  type WebgenLifecycleAction,
} from "#/dck/webgen-lifecycle";

export function WebgenLifecycleActions({
  appName,
  port,
  projectPath,
  onDispatch,
  disabled = false,
}: {
  appName: string;
  port: number | null;
  projectPath: string;
  onDispatch: (projectPath: string, command: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("openhands");
  const [open, setOpen] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [portalStyle, setPortalStyle] = React.useState<React.CSSProperties>();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLUListElement>(null);

  const dispatch = (action: WebgenLifecycleAction) => {
    onDispatch(
      projectPath,
      buildWebgenLifecycleCommand(action, { appName, port }),
    );
  };

  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 4;
      const measured = menuRef.current?.getBoundingClientRect().height ?? 0;
      const menuHeight = measured || 4 * 36;
      const overflowsBelow =
        rect.bottom + gap + menuHeight > window.innerHeight;
      setPortalStyle({
        position: "fixed",
        zIndex: 9999,
        ...(overflowsBelow
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
        right: window.innerWidth - rect.right,
      });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const runAction = (action: WebgenLifecycleAction) => {
    setOpen(false);
    dispatch(action);
  };

  const iconClassName = "size-4 shrink-0";
  const itemClassName = "flex w-full items-center gap-2";

  const menu =
    open && portalStyle ? (
      <ContextMenu
        ref={menuRef}
        theme="popover"
        className="min-w-[10rem]"
        testId="dck-webgen-lifecycle-menu-list"
      >
        <li>
          <ContextMenuListItem
            testId="dck-lifecycle-deploy"
            onClick={() => runAction("deploy")}
            className={itemClassName}
          >
            <Play className={iconClassName} aria-hidden />
            <span>{t(I18nKey.DCK$DEPLOY)}</span>
          </ContextMenuListItem>
        </li>
        <li>
          <ContextMenuListItem
            testId="dck-lifecycle-rebuild"
            onClick={() => runAction("rebuild")}
            className={itemClassName}
          >
            <RotateCcw className={iconClassName} aria-hidden />
            <span>{t(I18nKey.DCK$REBUILD)}</span>
          </ContextMenuListItem>
        </li>
        <li>
          <ContextMenuListItem
            testId="dck-lifecycle-stop"
            onClick={() => runAction("stop")}
            className={itemClassName}
          >
            <Square className={iconClassName} aria-hidden />
            <span>{t(I18nKey.DCK$STOP)}</span>
          </ContextMenuListItem>
        </li>
        <li>
          <ContextMenuListItem
            testId="dck-lifecycle-delete"
            onClick={() => {
              setOpen(false);
              setConfirmingDelete(true);
            }}
            className={cn(itemClassName, "text-status-error")}
          >
            <Trash2 className={iconClassName} aria-hidden />
            <span>{t(I18nKey.DCK$DELETE)}</span>
          </ContextMenuListItem>
        </li>
      </ContextMenu>
    ) : null;

  return (
    <div className="flex shrink-0 items-center">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        data-testid="dck-webgen-lifecycle-menu"
        aria-label={t(I18nKey.DCK$LIFECYCLE_ACTIONS)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0 rounded border border-border p-1 text-text-secondary hover:text-contrast disabled:opacity-50"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>

      {open && portalStyle && typeof document !== "undefined"
        ? ReactDOM.createPortal(
            <div style={portalStyle}>{menu}</div>,
            document.body,
          )
        : null}

      {confirmingDelete && (
        <ConfirmationModal
          text={t(I18nKey.DCK$DELETE_CONFIRM, { name: appName })}
          confirmText={t(I18nKey.DCK$DELETE)}
          onConfirm={() => {
            setConfirmingDelete(false);
            dispatch("delete");
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
