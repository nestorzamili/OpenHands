import React from "react";
import { BashClient } from "@openhands/typescript-client/clients";
import { quote } from "shell-quote";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { getSnapshot } from "#/api/backend-registry/active-store";
import {
  validateWebgenAppName,
  type WebgenNewProjectSpec,
} from "#/dck/webgen-new-project";
import { stageWebgenOwnerSeed } from "#/dck/webgen-owner-seed-service";
import type { WebgenOwnerSeedInput } from "./webgen-owner-seed-fields";
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
  return useAllConversationsQuery().conversations;
}

export function useAllConversationsQuery(options: { enabled?: boolean } = {}) {
  const query = usePaginatedConversations(50, options);
  const pages = query.data?.pages;
  const cursors = pages?.map((page) => page.next_page_id).filter(Boolean) ?? [];
  const repeatedCursor = new Set(cursors).size !== cursors.length;
  React.useEffect(() => {
    if (
      options.enabled !== false &&
      query.hasNextPage &&
      !query.isFetching &&
      !query.isError &&
      !repeatedCursor
    )
      void query.fetchNextPage({ cancelRefetch: false });
  }, [
    options.enabled,
    query.hasNextPage,
    query.isFetching,
    query.isError,
    query.fetchNextPage,
    repeatedCursor,
  ]);
  const complete = query.isSuccess && !query.hasNextPage;
  const conversations = React.useMemo(
    () => [
      ...new Map(
        flattenConversationPages(query.data?.pages).map((conversation) => [
          conversation.id,
          conversation,
        ]),
      ).values(),
    ],
    [query.data],
  );
  return {
    conversations,
    isLoading:
      query.isLoading ||
      (query.hasNextPage && !query.isError && !repeatedCursor),
    isAuthLoading: query.isPending && !query.isFetched && !query.isError,
    hasData: complete,
    isComplete: complete,
    isError: query.isError || repeatedCursor,
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
  const active = useActiveBackend();
  const allConversations = useAllConversationsQuery();
  const pendingWebgen = React.useRef<{ scope: string; id: string } | null>(
    null,
  );
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
      if (!allConversations.isComplete)
        throw new Error(
          "Conversation list is incomplete. Retry loading conversations.",
        );
      const existing = latestConversationForPath(conversations, workingDir);
      if (existing) return existing.id;
      const created = await createConversation({
        workingDir,
        ...(agentProfileId ? { agentProfileId } : {}),
      });
      return created.conversation_id;
    },
    [createConversation, allConversations.isComplete],
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
      if (!allConversations.isComplete) return;
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
    [createConversation, navigate, allConversations.isComplete],
  );

  const createScoped = React.useCallback(
    async (
      workingDir: string,
      query: string,
      agentProfileId?: string,
      options?: DckScopedConversationOptions,
    ): Promise<boolean> => {
      setIsPreparing(true);
      const origin = getSnapshot().active;
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
        const current = getSnapshot().active;
        if (
          current.backend.id !== origin.backend.id ||
          current.orgId !== origin.orgId
        )
          return false;
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
      if (!allConversations.isComplete) return;
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
    [continueConversation, createConversation, allConversations.isComplete],
  );

  const createWebgenProject = async (
    root: string,
    spec: WebgenNewProjectSpec,
    prompt: (verificationKey?: string) => string,
    seed?: WebgenOwnerSeedInput,
    agentProfileId?: string,
  ) => {
    if (!validateWebgenAppName(spec.name, []).valid) return false;
    const workingDir = `${root.replace(/\/$/, "")}/${spec.name.trim()}`;
    const scope = JSON.stringify([active.backend.id, active.orgId, workingDir]);
    const pending =
      pendingWebgen.current?.scope === scope ? pendingWebgen.current : null;
    setIsPreparing(true);
    try {
      const client = new BashClient(getAgentServerClientOptions());
      try {
        const result = await client.executeCommand(
          `mkdir -p -- ${quote([workingDir])}`,
        );
        if (result.exit_code !== 0)
          throw new Error("Could not prepare project workspace");
      } finally {
        client.close();
      }
      const current = getSnapshot().active;
      if (
        current.backend.id !== active.backend.id ||
        current.orgId !== active.orgId
      )
        return false;
      const succeeded = await createScoped(workingDir, "", agentProfileId, {
        ...(pending ? { conversationId: pending.id } : {}),
        prepareInitialMessage: async (id) => {
          pendingWebgen.current = { scope, id };
          if (spec.needsAuth && spec.authProvider !== "other") {
            if (!seed) throw new Error("Owner credentials are required");
            const staged = await stageWebgenOwnerSeed(
              spec.name.trim(),
              id,
              workingDir,
              seed,
            );
            return prompt(staged.verification_key);
          }
          return prompt();
        },
      });
      if (succeeded) pendingWebgen.current = null;
      return succeeded;
    } catch (error) {
      displayErrorToast(error instanceof Error ? error.message : null);
      return false;
    } finally {
      setIsPreparing(false);
    }
  };

  return {
    openPath,
    openConversation: (id: string) => navigate(`/conversations/${id}`),
    createWebgenProject,
    ensureConversation,
    createScoped,
    prefillAndOpen,
    continueConversation,
    isCreating: isPending || isPreparing,
  };
}
