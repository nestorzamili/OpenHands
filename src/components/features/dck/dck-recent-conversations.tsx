import React from "react";
import { useTranslation } from "react-i18next";
import { usePaginatedConversations } from "#/hooks/query/use-paginated-conversations";
import { useNavigation } from "#/context/navigation-context";
import { ConversationStatusDot } from "#/components/features/conversation-panel/conversation-status-dot";
import { formatRelativeTime } from "#/utils/format-relative-time";
import { extensionModuleCardSurfaceClassName } from "#/utils/extension-module-card-classes";
import { DCK_COPY, flattenConversationPages } from "#/dck/modules";

export function DckRecentConversations() {
  const { t, i18n } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const query = usePaginatedConversations(20);
  const conversations = React.useMemo(() => {
    const items = flattenConversationPages(query.data?.pages);
    return [...items]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 5);
  }, [query.data]);

  if (!query.isLoading && conversations.length === 0) return null;

  return (
    <section
      data-testid="dck-recent-conversations"
      className={`${extensionModuleCardSurfaceClassName} flex w-full flex-col gap-2 border border-border p-4`}
    >
      <h2 className="text-base font-semibold text-contrast">
        {DCK_COPY.recent}
      </h2>
      <ul className="flex flex-col gap-1">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              onClick={() => navigate(`/conversations/${conversation.id}`)}
              data-testid="dck-recent-row"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface"
            >
              <ConversationStatusDot
                executionStatus={conversation.execution_status}
                sandboxStatus={conversation.sandbox_status}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-contrast">
                {conversation.title ?? conversation.id}
              </span>
              <span className="shrink-0 text-xs text-text-tertiary">
                {formatRelativeTime(conversation.updated_at, i18n.language, t)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
