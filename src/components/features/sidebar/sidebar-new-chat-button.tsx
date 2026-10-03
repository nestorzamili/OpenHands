import React from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { useNavigation } from "#/context/navigation-context";
import { useCreateConversation } from "#/hooks/mutation/use-create-conversation";
import { useIsCreatingConversation } from "#/hooks/use-is-creating-conversation";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { StyledTooltip } from "#/components/shared/buttons/styled-tooltip";
import { SidebarCollapsedIconSlot } from "./sidebar-collapsed-icon-slot";
import {
  SIDEBAR_ICON_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_CLASS,
  sidebarNavLabelClassName,
  sidebarNavRowClassName,
} from "./sidebar-layout";

const ICON_SIZE = 18;

/**
 * Starts a brand-new conversation and navigates to it. Replaces the old
 * `/conversations` link, which only opened the module home (routes/home.tsx is
 * mounted at `conversations`) — so "New chat" never actually started a chat.
 * Making it an action keeps the label honest.
 */
export function SidebarNewChatButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const { mutateAsync: createConversation } = useCreateConversation();
  const isCreating = useIsCreatingConversation();
  const label = t(I18nKey.SIDEBAR$NEW_CHAT);

  const handleClick = React.useCallback(async () => {
    if (isCreating) return;
    try {
      const data = await createConversation({ entryPoint: "sidebar_new_chat" });
      navigate(`/conversations/${data.conversation_id}`);
    } catch (error) {
      displayErrorToast(error instanceof Error ? error.message : null);
    }
  }, [createConversation, isCreating, navigate]);

  const icon = <Plus width={ICON_SIZE} height={ICON_SIZE} aria-hidden />;

  const button = (
    <button
      type="button"
      data-testid="sidebar-conversations-link"
      aria-label={collapsed ? label : undefined}
      aria-busy={isCreating || undefined}
      disabled={isCreating}
      onClick={handleClick}
      className={cn(
        sidebarNavRowClassName({ collapsed }),
        !collapsed && SIDEBAR_ROW_INTERACTIVE_CLASS.idle,
        isCreating && "opacity-50",
      )}
    >
      {collapsed ? (
        <SidebarCollapsedIconSlot active={false}>
          {icon}
        </SidebarCollapsedIconSlot>
      ) : (
        <span className={SIDEBAR_ICON_SLOT_CLASS}>{icon}</span>
      )}
      <span className={sidebarNavLabelClassName(collapsed)}>{label}</span>
    </button>
  );

  if (!collapsed) return button;

  return (
    <StyledTooltip content={label} placement="right">
      {button}
    </StyledTooltip>
  );
}
