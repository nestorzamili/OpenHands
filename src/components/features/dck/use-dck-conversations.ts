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
    isAuthLoading: query.isPending && !query.isFetched && !query.isError,
    hasData: query.data !== undefined,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}

export interface DckConversationLaunchOptions {
  agentProfileId?: string;
  canCreateNew?: boolean;
  blockedMessage?: string;
  /** Runs before the prepared message is sent to the newly selected chat. */
  beforeDispatch?: (
    conversationId: string,
  ) => Promise<"ready" | "seed-required" | void>;
  /** Keep the created blank conversation and request required seed input. */
  onSeedRequired?: (conversationId: string) => void;
}

export interface DckScopedConversationOptions {
  /** Create without a query, then stage the server capability, then send. */
  prepareInitialMessage?: (conversationId: string) => Promise<string>;
  /** Reuse a blank conversation when preparation failed after creation. */
  conversationId?: string;
}

export function useOpenConversation() {
  const { navigate } = useNavigation();
  const { mutateAsync: createConversation, isPending } =
    useCreateConversation();
  const setMessageToSend = useConversationStore(
    (state) => state.setMessageToSend,
  );
  const [isPreparing, setIsPreparing] = React.useState(false);

  const continueConversation = React.useCallback(
    (conversationId: string, command: string) => {
      setMessageToSend(command);
      navigate(`/conversations/${conversationId}`);
    },
    [navigate, setMessageToSend],
  );

  const ensureConversation = React.useCallback(
    async (
      workingDir: string,
      conversations: AppConversation[],
      agentProfileId?: string,
    ): Promise<string> => {
      const existing = latestConversationForPath(conversations, workingDir);
      if (existing) return existing.id;
      const created = await createConversation({
        workingDir,
        ...(agentProfileId ? { agentProfileId } : {}),
      });
      return created.conversation_id;
    },
    [createConversation],
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
    async (
      workingDir: string,
      query: string,
      agentProfileId?: string,
      options?: DckScopedConversationOptions,
    ): Promise<boolean> => {
      setIsPreparing(true);
      try {
        const data = options?.conversationId
          ? { conversation_id: options.conversationId }
          : await createConversation({
              workingDir,
              ...(!options?.prepareInitialMessage ? { query } : {}),
              ...(agentProfileId ? { agentProfileId } : {}),
            });
        const preparedQuery = options?.prepareInitialMessage
          ? await options.prepareInitialMessage(data.conversation_id)
          : query;
        if (options?.prepareInitialMessage) setMessageToSend(preparedQuery);
        navigate(`/conversations/${data.conversation_id}`);
        return true;
      } catch (error) {
        displayErrorToast(error instanceof Error ? error.message : null);
        return false;
      } finally {
        setIsPreparing(false);
      }
    },
    [createConversation, navigate, setMessageToSend],
  );

  const prefillAndOpen = React.useCallback(
    async (
      workingDir: string,
      conversations: AppConversation[],
      command: string,
      options?: DckConversationLaunchOptions,
    ) => {
      if (options?.canCreateNew === false) {
        const existing = latestConversationForPath(conversations, workingDir);
        if (!existing) {
          if (options.blockedMessage) displayErrorToast(options.blockedMessage);
          return;
        }
      }
      setIsPreparing(true);
      try {
        const existing = latestConversationForPath(conversations, workingDir);
        const data = existing
          ? { conversation_id: existing.id }
          : await createConversation({
              workingDir,
              ...(options?.agentProfileId
                ? { agentProfileId: options.agentProfileId }
                : {}),
            });
        const beforeDispatch = await options?.beforeDispatch?.(
          data.conversation_id,
        );
        if (beforeDispatch === "seed-required") {
          options?.onSeedRequired?.(data.conversation_id);
          return;
        }
        continueConversation(data.conversation_id, command);
      } catch (error) {
        displayErrorToast(error instanceof Error ? error.message : null);
      } finally {
        setIsPreparing(false);
      }
    },
    [continueConversation, createConversation],
  );

  return {
    openPath,
    ensureConversation,
    createScoped,
    prefillAndOpen,
    continueConversation,
    isCreating: isPending || isPreparing,
  };
}
