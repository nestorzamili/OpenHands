import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExecutionStatus } from "#/types/agent-server/core";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import SettingsService from "#/api/settings-service/settings-service.api";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { resetTestHandlersMockSettings } from "#/mocks/settings-handlers";
import { getDckModuleAgentProfileScopeKey } from "#/dck/module-config";
import { renderWithProviders } from "test-utils";
import { DckModulesSection } from "#/components/features/dck/dck-modules-section";

const mockDckModulesConfig = vi.hoisted(() => ({
  text: "",
  lastUploaded: null as string | null,
}));

const mockSetMessageToSend = vi.fn();
vi.mock("#/stores/conversation-store", () => ({
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({ setMessageToSend: mockSetMessageToSend }),
}));

const mockOwnerSeedService = vi.hoisted(() => ({
  stage: vi.fn(),
}));
vi.mock("#/dck/webgen-owner-seed-service", () => ({
  stageWebgenOwnerSeed: mockOwnerSeedService.stage,
}));

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
  BashClient: class {
    executeCommand = vi.fn(async () => ({ exit_code: 0 }));
    close = vi.fn();
  },
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
        return mockDckModulesConfig.text;
      }
      throw new Error("not found");
    });

    uploadTextFile = vi.fn(async (text: string) => {
      mockDckModulesConfig.text = text;
      mockDckModulesConfig.lastUploaded = text;
      return { success: true };
    });
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

async function getScopedProfileAssignments() {
  const settings = await SettingsService.getSettings();
  const scopeKey = getDckModuleAgentProfileScopeKey(null, "/projects");
  return settings.dck_module_agent_profile_assignments?.[scopeKey] ?? {};
}

beforeEach(() => {
  vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
  __resetActiveStoreForTests();
  setRegisteredBackends([
    {
      id: "test-backend",
      name: "Local",
      host: "http://localhost:3000",
      apiKey: "test-key",
      kind: "local",
    },
  ]);
  setActiveSelection({ backendId: "test-backend", orgId: null });
  resetTestHandlersMockSettings();
  SettingsService.invalidateCache();
  mockDckModulesConfig.text = JSON.stringify({
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
    agentProfileAssignments: {},
  });
  mockDckModulesConfig.lastUploaded = null;
  mockCreateConversation.mockClear();
  mockSetMessageToSend.mockClear();
  mockOwnerSeedService.stage.mockReset().mockResolvedValue({
    verification_key: "public-verification-key",
  });
  vi.mocked(
    AgentServerConversationService.searchConversations,
  ).mockResolvedValue({
    items: [researchConversation, webgenConversation],
    next_page_id: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetActiveStoreForTests();
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

  it("keeps empty cards concise while showing the count and core action", async () => {
    renderWithProviders(<DckModulesSection />);

    const analyticsCard = await screen.findByTestId(
      "dck-module-card-analytics",
    );
    expect(
      within(analyticsCard).getByTestId("dck-module-count-analytics"),
    ).toHaveTextContent("0 conversations");
    expect(within(analyticsCard).getByRole("button")).toBeInTheDocument();
    expect(
      within(analyticsCard).queryByText("No conversations yet"),
    ).toBeNull();
  });

  it("exposes a Manage modules entry point that opens the manager", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    await user.click(await screen.findByTestId("dck-manage-modules"));

    expect(await screen.findByTestId("dck-module-manager")).toBeInTheDocument();
    // Default modules stay editable without gaining destructive controls.
    expect(
      screen.queryByTestId("dck-module-builtin-badge-webgen"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("dck-module-edit-webgen")).toBeInTheDocument();
    expect(screen.queryByTestId("dck-module-delete-webgen")).toBeNull();
    expect(
      screen.getByTestId("dck-module-edit-custom-email"),
    ).toBeInTheDocument();
  });

  it("keeps module and Agent Profile configuration in the module manager", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    await user.click(await screen.findByTestId("dck-manage-modules"));
    expect(await screen.findByTestId("dck-module-manager")).toBeInTheDocument();
    expect(screen.queryByTestId("dck-module-manage-personas")).toBeNull();
    await user.click(screen.getByTestId("dck-module-edit-research"));
    expect(
      screen.getByTestId("dck-module-agent-profile-selector-research"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("dck-module-form-skills"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("dck-module-form-persona")).toBeNull();
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

  it("blocks launch and prompts for a profile when a module has no saved assignment", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    const researchCard = await screen.findByTestId("dck-module-card-research");
    const launchButton = within(researchCard).getByRole("button");
    expect(launchButton).toBeDisabled();
    expect(
      screen.queryByTestId("dck-module-agent-profile-summary-research"),
    ).not.toBeInTheDocument();

    await user.click(launchButton);
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("seeds the module prompt as the opening query for a new conversation", async () => {
    await SettingsService.saveSettings({
      dck_module_agent_profile_assignments: {
        [getDckModuleAgentProfileScopeKey(null, "/projects")]: {
          content: "active-profile",
        },
      },
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />, { navigation: { navigate } });

    const contentCard = await screen.findByTestId("dck-module-card-content");
    await waitFor(() =>
      expect(within(contentCard).getByRole("button")).toBeEnabled(),
    );
    const newButton = within(contentCard).getByRole("button");
    await user.click(newButton);

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    });
    const payload = mockCreateConversation.mock.calls[0][0];
    expect(payload.workingDir).toBe("/projects/content");
    expect(payload.query).toMatch(/content|marketing|seo/i);
    expect(payload.query).not.toContain("Use the content-creator skill");
    expect(payload.entryPoint).toBeUndefined();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/conversations/conv-new");
    });
  });

  it("chooses a module profile in the editor and uses it when launching from home", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    const researchCard = await screen.findByTestId("dck-module-card-research");
    expect(
      within(researchCard).queryByRole("combobox"),
    ).not.toBeInTheDocument();
    expect(
      within(researchCard).queryByTestId(
        "dck-module-agent-profile-summary-research",
      ),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("dck-manage-modules"));
    const manager = await screen.findByTestId("dck-module-manager");
    await user.click(within(manager).getByTestId("dck-module-edit-research"));
    await user.selectOptions(
      within(manager).getByTestId("dck-module-agent-profile-selector-research"),
      "research-profile",
    );
    await user.click(within(manager).getByTestId("dck-module-form-save"));

    await waitFor(() =>
      expect(getScopedProfileAssignments()).resolves.toEqual({
        research: "research-profile",
      }),
    );
    expect(
      JSON.parse(mockDckModulesConfig.lastUploaded ?? "{}"),
    ).not.toHaveProperty("agentProfileAssignments");
    await user.keyboard("{Escape}");
    await user.click(within(researchCard).getByRole("button"));

    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledTimes(1),
    );
    expect(mockCreateConversation.mock.calls[0][0]).toMatchObject({
      workingDir: "/projects/research",
      agentProfileId: "research-profile",
    });
    expect(mockAgentProfiles.data.active_agent_profile_id).toBe(
      "active-profile",
    );
  });

  it("reads and updates the card's saved profile in the module edit form", async () => {
    const user = userEvent.setup();
    const originalRegistry = mockDckModulesConfig.text;
    await SettingsService.saveSettings({
      dck_module_agent_profile_assignments: {
        [getDckModuleAgentProfileScopeKey(null, "/projects")]: {
          research: "research-profile",
        },
      },
    });
    renderWithProviders(<DckModulesSection />);

    const researchCard = await screen.findByTestId("dck-module-card-research");
    expect(
      within(researchCard).queryByRole("combobox"),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(researchCard).getByRole("button")).toBeEnabled(),
    );

    await user.click(await screen.findByTestId("dck-manage-modules"));
    const manager = await screen.findByTestId("dck-module-manager");
    await user.click(within(manager).getByTestId("dck-module-edit-research"));

    const profileSelector = within(manager).getByTestId(
      "dck-module-agent-profile-selector-research",
    ) as HTMLSelectElement;
    expect(profileSelector).toHaveValue("research-profile");
    await user.selectOptions(profileSelector, "active-profile");
    await expect(getScopedProfileAssignments()).resolves.toEqual({
      research: "research-profile",
    });

    await user.click(within(manager).getByTestId("dck-module-form-save"));

    await waitFor(() =>
      expect(getScopedProfileAssignments()).resolves.toEqual({
        research: "active-profile",
      }),
    );
    expect(mockDckModulesConfig.lastUploaded).toBeNull();
    expect(mockDckModulesConfig.text).toBe(originalRegistry);
    expect(mockAgentProfiles.data.active_agent_profile_id).toBe(
      "active-profile",
    );
  });

  it("blocks a stale assignment until it is reassigned to a valid profile", async () => {
    const user = userEvent.setup();
    const originalRegistry = mockDckModulesConfig.text;
    await SettingsService.saveSettings({
      dck_module_agent_profile_assignments: {
        [getDckModuleAgentProfileScopeKey(null, "/projects")]: {
          research: "deleted-profile",
        },
      },
    });
    renderWithProviders(<DckModulesSection />);

    const researchCard = await screen.findByTestId("dck-module-card-research");
    const createButton = within(researchCard).getByRole("button");

    await waitFor(() =>
      expect(getScopedProfileAssignments()).resolves.toEqual({
        research: "deleted-profile",
      }),
    );
    expect(
      JSON.parse(mockDckModulesConfig.lastUploaded ?? "{}"),
    ).not.toHaveProperty("agentProfileAssignments");
    expect(
      screen.queryByTestId("dck-module-agent-profile-summary-research"),
    ).not.toBeInTheDocument();
    expect(
      within(researchCard).queryByRole("combobox"),
    ).not.toBeInTheDocument();
    expect(createButton).toBeDisabled();
    await user.click(createButton);
    expect(mockCreateConversation).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("dck-manage-modules"));
    const manager = await screen.findByTestId("dck-module-manager");
    await user.click(within(manager).getByTestId("dck-module-edit-research"));
    const selector = within(manager).getByTestId(
      "dck-module-agent-profile-selector-research",
    ) as HTMLSelectElement;
    await user.selectOptions(selector, "active-profile");
    await user.click(within(manager).getByTestId("dck-module-form-save"));

    await waitFor(() =>
      expect(getScopedProfileAssignments()).resolves.toEqual({
        research: "active-profile",
      }),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(createButton).toBeEnabled());
    await user.click(createButton);

    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledTimes(1),
    );
    const payload = mockCreateConversation.mock.calls[0][0];
    expect(payload.workingDir).toBe("/projects/research");
    expect(payload.agentProfileId).toBe("active-profile");
    expect(mockAgentProfiles.data.active_agent_profile_id).toBe(
      "active-profile",
    );
    expect(mockDckModulesConfig.lastUploaded).toBeNull();
    expect(mockDckModulesConfig.text).toBe(originalRegistry);
  });

  it("opens the webgen spec dialog instead of creating immediately", async () => {
    await SettingsService.saveSettings({
      dck_module_agent_profile_assignments: {
        [getDckModuleAgentProfileScopeKey(null, "/projects")]: {
          webgen: "active-profile",
        },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    const webgenCard = await screen.findByTestId("dck-module-card-webgen");
    await waitFor(() =>
      expect(within(webgenCard).getByRole("button")).toBeEnabled(),
    );
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
    expect(payload.workingDir).toBe("/projects/webgen/promo-site");
    expect(mockSetMessageToSend).toHaveBeenCalledWith(
      expect.stringContaining("promo-site"),
    );
  });

  it("stages Better Auth owner credentials before sending the home-dialog opening task", async () => {
    await SettingsService.saveSettings({
      dck_module_agent_profile_assignments: {
        [getDckModuleAgentProfileScopeKey(null, "/projects")]: {
          webgen: "active-profile",
        },
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />);

    const webgenCard = await screen.findByTestId("dck-module-card-webgen");
    await waitFor(() =>
      expect(within(webgenCard).getByRole("button")).toBeEnabled(),
    );
    await user.click(within(webgenCard).getByRole("button"));
    await user.type(screen.getByTestId("webgen-new-project-name"), "members");
    await user.click(screen.getByTestId("webgen-new-project-auth"));
    await user.type(
      screen.getByTestId("webgen-owner-seed-email"),
      "owner@example.com",
    );
    await user.type(
      screen.getByTestId("webgen-owner-seed-password"),
      "Correct Horse Battery Staple!",
    );
    await user.click(screen.getByTestId("webgen-new-project-submit"));

    await waitFor(() =>
      expect(mockOwnerSeedService.stage).toHaveBeenCalledOnce(),
    );
    expect(mockCreateConversation).toHaveBeenCalledOnce();
    expect(mockCreateConversation.mock.calls[0][0]).not.toHaveProperty("query");
    expect(mockOwnerSeedService.stage).toHaveBeenCalledWith(
      "members",
      "conv-new",
      "/projects/webgen/members",
      {
        email: "owner@example.com",
        username: "",
        password: "Correct Horse Battery Staple!",
      },
    );
    expect(mockSetMessageToSend).toHaveBeenCalledOnce();
    expect(mockSetMessageToSend.mock.calls[0][0]).toContain(
      "public-verification-key",
    );
    expect(mockSetMessageToSend.mock.calls[0][0]).not.toContain(
      "Correct Horse Battery Staple!",
    );
    expect(
      screen.queryByTestId("webgen-new-project-dialog"),
    ).not.toBeInTheDocument();
  });
});
