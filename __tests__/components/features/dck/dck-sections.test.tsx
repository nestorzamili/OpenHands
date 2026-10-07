import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExecutionStatus } from "#/types/agent-server/core";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { renderWithProviders } from "test-utils";
import { DckModulesSection } from "#/components/features/dck/dck-modules-section";
import { getDckModuleAgentProfilesStorageKey } from "#/hooks/use-dck-module-agent-profiles";

const mockAgentProfiles = vi.hoisted(() => ({
  data: {
    profiles: [
      {
        id: "active-profile",
        name: "Default",
        agent_kind: "openhands",
        revision: 1,
        llm_profile_ref: "gpt",
        mcp_server_refs: null,
      },
      {
        id: "research-profile",
        name: "Research Agent",
        agent_kind: "openhands",
        revision: 1,
        llm_profile_ref: "gpt",
        mcp_server_refs: null,
      },
    ],
    active_agent_profile_id: "active-profile",
  },
}));
vi.mock("#/hooks/query/use-agent-profiles", () => ({
  useAgentProfiles: () => ({ data: mockAgentProfiles.data, isLoading: false }),
}));

vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({
    default: { searchConversations: vi.fn() },
  }),
);

const mockCreateConversation = vi.fn(
  async (_payload: {
    workingDir?: string;
    query?: string;
    agentProfileId?: string;
    entryPoint?: string;
  }) => ({
    conversation_id: "conv-new",
  }),
);

vi.mock("#/hooks/mutation/use-create-conversation", () => ({
  useCreateConversation: () => ({
    mutateAsync: mockCreateConversation,
    isPending: false,
  }),
}));

vi.mock("@openhands/typescript-client/clients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@openhands/typescript-client/clients")
  >()),
  FileClient: class {
    searchSubdirectories = vi.fn(async (path: string) => ({
      items:
        path === "/projects/webgen"
          ? [{ name: "shop", path: "/projects/webgen/shop" }]
          : [],
      next_page_id: null,
    }));

    downloadFile = vi.fn(async (path: string) => {
      if (path === "/projects/webgen/shop/.dck.json") {
        return new TextEncoder().encode(
          JSON.stringify({ name: "shop", port: 3100, stack: "nextjs" }),
        ).buffer;
      }
      throw new Error("not found");
    });

    downloadTextFile = vi.fn(async (path: string) => {
      if (path === "/projects/.dck/modules.json") {
        return JSON.stringify({
          modules: [
            {
              id: "custom-email",
              name: "Email Campaigns",
              slug: "email",
              iconName: "mail",
              description: "Drip sequences",
              promptTemplate: "Draft an email campaign for the brand.",
              order: 0,
            },
          ],
        });
      }
      throw new Error("not found");
    });

    uploadTextFile = vi.fn(async () => ({ success: true }));
  },
}));

vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => ({
    backend: { id: "test-backend", kind: "local" },
    orgId: null,
  }),
}));

vi.mock("#/hooks/query/use-is-authed", () => ({
  useIsAuthed: () => ({ data: true }),
}));

function makeConversation(
  overrides: Partial<AppConversation> & { id: string },
): AppConversation {
  return {
    title: null,
    updated_at: "2026-09-29T10:00:00.000Z",
    execution_status: ExecutionStatus.IDLE,
    sandbox_status: null,
    selected_workspace: null,
    workspace: null,
    ...overrides,
  } as AppConversation;
}

const webgenConversation = makeConversation({
  id: "conv-web",
  title: "Shop app",
  execution_status: ExecutionStatus.RUNNING,
  workspace: { working_dir: "/projects/webgen/shop" },
});

const researchConversation = makeConversation({
  id: "conv-research",
  title: "Trend report",
  updated_at: "2026-09-29T11:00:00.000Z",
  workspace: { working_dir: "/projects/research" },
});

beforeEach(() => {
  vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
  window.localStorage.removeItem(
    getDckModuleAgentProfilesStorageKey("test-backend", null),
  );
  mockCreateConversation.mockClear();
  vi.mocked(
    AgentServerConversationService.searchConversations,
  ).mockResolvedValue({
    items: [researchConversation, webgenConversation],
    next_page_id: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DckModulesSection", () => {
  it("renders the built-in module cards plus any custom modules", async () => {
    renderWithProviders(<DckModulesSection />);

    for (const id of ["webgen", "research", "analytics", "content"]) {
      expect(
        await screen.findByTestId(`dck-module-card-${id}`),
      ).toBeInTheDocument();
    }

    // Custom module from the mocked .dck/modules.json renders as a card too.
    expect(
      await screen.findByTestId("dck-module-card-custom-email"),
    ).toBeInTheDocument();

    // Count is shown; the per-project detail now lives on the module page, so
    // the home card renders no project rows.
    expect(
      await screen.findByTestId("dck-module-count-webgen"),
    ).toHaveTextContent("1 project");
    expect(screen.queryByTestId("dck-project-row")).not.toBeInTheDocument();
  });

  it("exposes a Manage modules entry point that opens the manager", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    await user.click(await screen.findByTestId("dck-manage-modules"));

    expect(await screen.findByTestId("dck-module-manager")).toBeInTheDocument();
    // Built-ins can be customized without gaining destructive controls.
    expect(
      screen.getByTestId("dck-module-builtin-badge-webgen"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dck-module-edit-webgen")).toBeInTheDocument();
    expect(screen.queryByTestId("dck-module-delete-webgen")).toBeNull();
    expect(
      screen.getByTestId("dck-module-edit-custom-email"),
    ).toBeInTheDocument();
  });

  it("links View all to the module detail page", async () => {
    renderWithProviders(<DckModulesSection />);

    const viewAll = await screen.findByTestId("dck-module-view-all-webgen");
    expect(viewAll).toHaveAttribute("href", "/modules/webgen");

    const conversationViewAll = await screen.findByTestId(
      "dck-module-view-all-research",
    );
    expect(conversationViewAll).toHaveAttribute("href", "/modules/research");
  });

  it("seeds the module prompt as the opening query for a new conversation", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />, { navigation: { navigate } });

    const contentCard = await screen.findByTestId("dck-module-card-content");
    const newButton = within(contentCard).getByRole("button");
    await user.click(newButton);

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    });
    const payload = mockCreateConversation.mock.calls[0][0];
    expect(payload.workingDir).toBe("/projects/content");
    expect(payload.query).toMatch(/content|marketing|seo/i);
    expect(payload.entryPoint).toBeUndefined();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/conversations/conv-new");
    });
  });

  it("stores a module profile choice and passes it only when launching that module", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    const researchCard = await screen.findByTestId("dck-module-card-research");
    await user.selectOptions(
      within(researchCard).getByTestId(
        "dck-module-agent-profile-selector-research",
      ),
      "research-profile",
    );
    await user.click(within(researchCard).getByRole("button"));

    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledTimes(1),
    );
    expect(mockCreateConversation.mock.calls[0][0]).toMatchObject({
      workingDir: "/projects/research",
      agentProfileId: "research-profile",
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(
          getDckModuleAgentProfilesStorageKey("test-backend", null),
        ) ?? "{}",
      ),
    ).toEqual({ research: "research-profile" });
    expect(mockAgentProfiles.data.active_agent_profile_id).toBe(
      "active-profile",
    );
  });

  it("uses the card's shared profile preference in the module edit form", async () => {
    const user = userEvent.setup();
    const storageKey = getDckModuleAgentProfilesStorageKey(
      "test-backend",
      null,
    );
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ research: "research-profile" }),
    );
    renderWithProviders(<DckModulesSection />);

    await user.click(await screen.findByTestId("dck-manage-modules"));
    const manager = await screen.findByTestId("dck-module-manager");
    await user.click(within(manager).getByTestId("dck-module-edit-research"));

    const profileSelector = within(manager).getByTestId(
      "dck-module-agent-profile-selector-research",
    ) as HTMLSelectElement;
    expect(profileSelector).toHaveValue("research-profile");
    const followActiveValue = profileSelector.options[0].value;
    await user.selectOptions(profileSelector, followActiveValue);
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      { research: "research-profile" },
    );

    await user.click(within(manager).getByTestId("dck-module-form-save"));

    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"),
      ).toEqual({}),
    );
    expect(mockAgentProfiles.data.active_agent_profile_id).toBe(
      "active-profile",
    );
  });

  it("removes a stale profile ID and requires an explicit follow-active choice", async () => {
    const user = userEvent.setup();
    const storageKey = getDckModuleAgentProfilesStorageKey(
      "test-backend",
      null,
    );
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ research: "deleted-profile" }),
    );
    renderWithProviders(<DckModulesSection />);

    const researchCard = await screen.findByTestId("dck-module-card-research");
    const selector = within(researchCard).getByTestId(
      "dck-module-agent-profile-selector-research",
    ) as HTMLSelectElement;
    const createButton = within(researchCard).getByRole("button");

    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"),
      ).toEqual({ research: null }),
    );
    expect(selector).not.toHaveValue("deleted-profile");
    expect(
      screen.getByTestId("dck-module-agent-profile-warning-research"),
    ).toBeInTheDocument();
    expect(createButton).toBeDisabled();
    await user.click(createButton);
    expect(mockCreateConversation).not.toHaveBeenCalled();

    const followActiveValue = selector.options[0].value;
    await user.selectOptions(selector, followActiveValue);
    expect(selector).toHaveValue(followActiveValue);
    expect(
      screen.queryByTestId("dck-module-agent-profile-warning-research"),
    ).not.toBeInTheDocument();
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledTimes(1),
    );
    const payload = mockCreateConversation.mock.calls[0][0];
    expect(payload.workingDir).toBe("/projects/research");
    expect(payload).not.toHaveProperty("agentProfileId");
    expect(mockAgentProfiles.data.active_agent_profile_id).toBe(
      "active-profile",
    );
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}")).toEqual(
      {},
    );
  });

  it("opens the webgen spec dialog instead of creating immediately", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    const webgenCard = await screen.findByTestId("dck-module-card-webgen");
    await user.click(within(webgenCard).getByRole("button"));

    // Dialog opens; nothing is created until the spec is submitted.
    expect(
      await screen.findByTestId("webgen-new-project-dialog"),
    ).toBeInTheDocument();
    expect(mockCreateConversation).not.toHaveBeenCalled();

    // `shop` already exists (FileClient mock) → a unique name is required.
    await user.type(
      screen.getByTestId("webgen-new-project-name"),
      "promo-site",
    );
    await user.click(screen.getByTestId("webgen-new-project-submit"));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    });
    const payload = mockCreateConversation.mock.calls[0][0];
    expect(payload.workingDir).toBe("/projects/webgen");
    expect(payload.query).toContain("promo-site");
  });
});
