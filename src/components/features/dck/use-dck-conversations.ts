import React from "react";
import { useCreateConversation } from "#/hooks/mutation/use-create-conversation";
import { usePaginatedConversations } from "#/hooks/query/use-paginated-conversations";
import { useNavigation } from "#/context/navigation-context";
import { useConversationStore } from "#/stores/conversation-store";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import {
  flattenConversationPages,
  latestConversationForPath,
} from "#/dck/modules";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";

export function useAllConversations(): AppConversation[] {
  const query = usePaginatedConversations(50);
  return React.useMemo(
    () => flattenConversationPages(query.data?.pages),
    [query.data],
  );
}

export function useAllConversationsQuery(options: { enabled?: boolean } = {}) {
  const query = usePaginatedConversations(50, options);
  const conversations = React.useMemo(
    () => flattenConversationPages(query.data?.pages),
    [query.data],
  );
  return {
    conversations,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export interface DckConversationLaunchOptions {
  agentProfileId?: string;
  canCreateNew?: boolean;
  blockedMessage?: string;
}

export function useOpenConversation() {
  const { navigate } = useNavigation();
  const { mutateAsync: createConversation, isPending } =
    useCreateConversation();
  const setMessageToSend = useConversationStore(
    (state) => state.setMessageToSend,
  );

  const openPath = React.useCallback(
    async (
      workingDir: string,
      conversations: AppConversation[],
      promptTemplate?: string,
      options?: DckConversationLaunchOptions,
    ) => {
      const existing = latestConversationForPath(conversations, workingDir);
      if (existing) {
        navigate(`/conversations/${existing.id}`);
        return;
      }
      if (options?.canCreateNew === false) {
        if (options.blockedMessage) displayErrorToast(options.blockedMessage);
        return;
      }
      try {
        const data = await createConversation({
          workingDir,
          ...(promptTemplate ? { query: promptTemplate } : {}),
          ...(options?.agentProfileId
            ? { agentProfileId: options.agentProfileId }
            : {}),
        });
        navigate(`/conversations/${data.conversation_id}`);
      } catch (error) {
        displayErrorToast(error instanceof Error ? error.message : null);
      }
    },
    [createConversation, navigate],
  );

  const createScoped = React.useCallback(
    async (workingDir: string, query: string, agentProfileId?: string) => {
      try {
        const data = await createConversation({
          workingDir,
          query,
          ...(agentProfileId ? { agentProfileId } : {}),
        });
        navigate(`/conversations/${data.conversation_id}`);
      } catch (error) {
        displayErrorToast(error instanceof Error ? error.message : null);
      }
    },
    [createConversation, navigate],
  );

  const prefillAndOpen = React.useCallback(
    async (
      workingDir: string,
      conversations: AppConversation[],
      command: string,
      options?: DckConversationLaunchOptions,
    ) => {
      const existing = latestConversationForPath(conversations, workingDir);
      if (existing) {
        setMessageToSend(command);
        navigate(`/conversations/${existing.id}`);
        return;
      }
      if (options?.canCreateNew === false) {
        if (options.blockedMessage) displayErrorToast(options.blockedMessage);
        return;
      }
      try {
        const data = await createConversation({
          workingDir,
          ...(options?.agentProfileId
            ? { agentProfileId: options.agentProfileId }
            : {}),
        });
        setMessageToSend(command);
        navigate(`/conversations/${data.conversation_id}`);
      } catch (error) {
        displayErrorToast(error instanceof Error ? error.message : null);
      }
    },
    [createConversation, navigate, setMessageToSend],
  );

  return { openPath, createScoped, prefillAndOpen, isCreating: isPending };
}
