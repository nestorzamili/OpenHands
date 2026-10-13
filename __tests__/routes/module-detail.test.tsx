import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { ModuleDetailView } from "#/routes/module-detail";
import { getDckModuleById } from "#/dck/modules";
import type { WebgenRuntimeStatus } from "#/dck/webgen-service";

const mockDckModulesConfig = vi.hoisted(() => ({ text: "" }));

const mockOwnerSeedService = vi.hoisted(() => ({
  stage: vi.fn(),
  authorize: vi.fn(),
}));
const mockWebgenService = vi.hoisted(() => ({ run: vi.fn() }));
const mockRuntimeProjects = vi.hoisted(() => ({
  available: true,
  projects: [
    {
      slug: "shop",
      path: "/projects/webgen/shop",
      name: "shop",
      port: 3100,
      stack: "nextjs",
      auth_provider: null as string | null,
      preview_path: null as string | null,
      subdomain: null as string | null,
      status: "stopped" as WebgenRuntimeStatus,
      last_checked_at: null,
      containers: [],
    },
  ],
}));
vi.mock("#/dck/webgen-owner-seed-service", () => ({
  stageWebgenOwnerSeed: mockOwnerSeedService.stage,
  authorizeWebgenOwnerSeedDeploy: mockOwnerSeedService.authorize,
  isOwnerSeedReentryRequired: (error: unknown) =>
    error instanceof Error && "status" in error && error.status === 410,
}));
vi.mock("#/dck/webgen-service", () => ({
  runWebgenLifecycleAction: mockWebgenService.run,
  isWebgenOwnerSeedReentryRequired: (error: unknown) =>
    error instanceof Error && "status" in error && error.status === 410,
}));
vi.mock("#/hooks/query/use-webgen-projects", () => ({
  useWebgenProjects: () => ({
    data: mockRuntimeProjects.available ? mockRuntimeProjects : undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
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
    downloadTextFile = vi.fn(async (path: string) => {
      if (path === "/projects/.dck/modules.json") {
        return mockDckModulesConfig.text;
      }
      throw new Error("not found");
    });

    uploadTextFile = vi.fn(
      async (content: string, _directory: string, _fileName: string) => {
        mockDckModulesConfig.text = content;
      },
    );

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
  },
}));

vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => ({
    backend: { id: "test-backend", kind: "local" },
    orgId: null,
  }),
}));

const mockSetMessageToSend = vi.fn();
vi.mock("#/stores/conversation-store", () => ({
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({ setMessageToSend: mockSetMessageToSend }),
}));

function makeConversation(
  overrides: Partial<AppConversation> & { id: string },
): AppConversation {
  return {
    title: null,
    updated_at: "2026-09-29T10:00:00.000Z",
    execution_status: ExecutionStatus.RUNNING,
    sandbox_status: null,
    selected_workspace: null,
    workspace: null,
    ...overrides,
  } as AppConversation;
}

const webgenConversation = makeConversation({
  id: "conv-web",
  title: "Shop app",
  workspace: { working_dir: "/projects/webgen/shop" },
});

const researchConversation = makeConversation({
  id: "conv-research",
  title: "Trend report",
  workspace: { working_dir: "/projects/research" },
});

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
    modules: [],
    agentProfileAssignments: {},
  });
  mockCreateConversation.mockClear();
  mockOwnerSeedService.stage.mockReset().mockResolvedValue({
    verification_key: "public-verification-key",
  });
  mockOwnerSeedService.authorize.mockReset().mockResolvedValue({
    status: "authorized",
  });
  mockWebgenService.run.mockReset().mockResolvedValue({
    project: mockRuntimeProjects.projects[0],
  });
  mockRuntimeProjects.projects[0].auth_provider = null;
  mockRuntimeProjects.available = true;
  mockRuntimeProjects.projects[0].subdomain = null;
  mockRuntimeProjects.projects[0].status = "stopped";
  mockRuntimeProjects.projects[0].preview_path = null;
  mockSetMessageToSend.mockClear();
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

async function getScopedProfileAssignments() {
  const settings = await SettingsService.getSettings();
  const scopeKey = getDckModuleAgentProfileScopeKey(null, "/projects");
  return settings.dck_module_agent_profile_assignments?.[scopeKey] ?? {};
}

function setModuleProfileAssignments(
  agentProfileAssignments: Record<string, string | null>,
) {
  mockDckModulesConfig.text = JSON.stringify({
    modules: [],
    agentProfileAssignments,
  });
}

async function waitForAssignedModuleProfile(
  moduleId: string,
  profileId: string,
) {
  const profileName = mockAgentProfiles.data.profiles.find(
    (profile) => profile.id === profileId,
  )?.name;
  await waitFor(async () => {
    expect(await getScopedProfileAssignments()).toMatchObject({
      [moduleId]: profileId,
    });
    expect(
      screen.getByTestId(`dck-module-agent-profile-summary-${moduleId}`),
    ).toHaveTextContent(profileName ?? profileId);
    expect(
      screen.queryByTestId(
        `dck-module-agent-profile-summary-warning-${moduleId}`,
      ),
    ).not.toBeInTheDocument();
  });
  await waitFor(() =>
    expect(JSON.parse(mockDckModulesConfig.text)).not.toHaveProperty(
      "agentProfileAssignments",
    ),
  );
}

async function waitForLegacyAssignmentMigration() {
  await waitFor(() =>
    expect(JSON.parse(mockDckModulesConfig.text)).not.toHaveProperty(
      "agentProfileAssignments",
    ),
  );
}

describe("ModuleDetailView header", () => {
  it("renders the module header for a resolved module", () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );
    expect(screen.getByTestId("dck-module-detail-webgen")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Web Generator",
    );
  });

  it("renders a not-found state when the module is null", () => {
    renderWithProviders(<ModuleDetailView dckModule={null} />);
    expect(screen.getByTestId("dck-module-not-found")).toBeInTheDocument();
  });

  it("shows the saved profile read-only and applies it to a new conversation", async () => {
    const user = userEvent.setup();
    setModuleProfileAssignments({ research: "research-profile" });
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("research")} />,
    );

    expect(
      await screen.findByTestId("dck-module-agent-profile-summary-research"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByTestId("dck-module-agent-profile-summary-research"),
      ).toHaveTextContent("Research Agent"),
    );
    await waitForLegacyAssignmentMigration();
    expect(
      screen.queryByTestId("dck-module-agent-profile-selector-research"),
    ).not.toBeInTheDocument();
    const newConversationButton = within(
      screen.getByTestId("dck-module-detail-research"),
    ).getByTestId("dck-module-new-conversation");
    await user.click(newConversationButton);

    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledTimes(1),
    );
    expect(mockCreateConversation.mock.calls[0][0]).toMatchObject({
      workingDir: "/projects/research",
      agentProfileId: "research-profile",
    });
  });

  it("blocks new module conversations when a saved profile is unavailable", async () => {
    const user = userEvent.setup();
    setModuleProfileAssignments({ research: "deleted-profile" });
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("research")} />,
    );

    const warning = await screen.findByTestId(
      "dck-module-agent-profile-summary-warning-research",
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("dck-module-agent-profile-summary-research"),
      ).not.toHaveTextContent("DCK$MODULE_AGENT_PROFILE_NOT_ASSIGNED"),
    );
    const newConversationButton = within(
      screen.getByTestId("dck-module-detail-research"),
    ).getByTestId("dck-module-new-conversation");
    await waitFor(() =>
      expect(getScopedProfileAssignments()).resolves.toEqual({
        research: "deleted-profile",
      }),
    );
    await waitForLegacyAssignmentMigration();
    expect(warning).toBeInTheDocument();
    expect(
      screen.queryByTestId("dck-module-agent-profile-selector-research"),
    ).not.toBeInTheDocument();
    expect(newConversationButton).toBeDisabled();
    await user.click(newConversationButton);
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("resolves ids via getDckModuleById (wrapper contract)", () => {
    expect(getDckModuleById("bogus")).toBeNull();
    expect(getDckModuleById("webgen")?.id).toBe("webgen");
  });
});

describe("ModuleDetailView projects list", () => {
  it("keeps project chat available when runtime metadata is unavailable", async () => {
    mockRuntimeProjects.available = false;
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
      { navigation: { navigate } },
    );
    await user.click(await screen.findByTestId("dck-lifecycle-menu"));
    expect(screen.getByTestId("dck-lifecycle-deploy")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByTestId("dck-lifecycle-chat"));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/conversations/conv-web"),
    );
    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("dck-project-link-preview"),
    ).not.toBeInTheDocument();
  });

  it("starts a prompt-free chat in the website workspace when no related chat exists", async () => {
    setModuleProfileAssignments({ webgen: "active-profile" });
    vi.mocked(
      AgentServerConversationService.searchConversations,
    ).mockResolvedValue({ items: [researchConversation], next_page_id: null });
    const user = userEvent.setup();
    const navigate = vi.fn();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
      { navigation: { navigate } },
    );
    await waitForAssignedModuleProfile("webgen", "active-profile");
    await user.click(await screen.findByTestId("dck-lifecycle-menu"));
    await user.click(screen.getByTestId("dck-lifecycle-chat"));
    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledWith({
        workingDir: "/projects/webgen/shop",
        agentProfileId: "active-profile",
      }),
    );
    expect(navigate).toHaveBeenCalledWith("/conversations/conv-new");
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it.each(["starting", "unknown", "stopped", "error"] as const)(
    "shows the %s runtime badge without advertising an available preview",
    async (status) => {
      mockRuntimeProjects.projects[0].status = status;
      mockRuntimeProjects.projects[0].preview_path = "/preview/shop";
      renderWithProviders(
        <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
      );

      expect(
        await screen.findByTestId("dck-project-status-badge"),
      ).toHaveAttribute("data-status", status);
      expect(
        screen.queryByTestId("dck-project-link-preview"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("dck-project-link-local"),
      ).not.toBeInTheDocument();
    },
  );

  it("links a running preview under the current origin", async () => {
    mockRuntimeProjects.projects[0].status = "running";
    mockRuntimeProjects.projects[0].preview_path = "/preview/shop";
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    expect(
      await screen.findByTestId("dck-project-link-preview"),
    ).toHaveAttribute("href", `${window.location.origin}/preview/shop`);
    expect(screen.getByTestId("dck-project-link-preview")).toHaveTextContent(
      `${window.location.origin}/preview/shop`,
    );
    expect(
      screen.queryByTestId("dck-project-link-live"),
    ).not.toBeInTheDocument();
  });

  it("shows only the published link when old metadata also contains a preview", async () => {
    mockRuntimeProjects.projects[0].status = "running";
    mockRuntimeProjects.projects[0].preview_path = "/preview/shop";
    mockRuntimeProjects.projects[0].subdomain = "shop.dckautoposting.com";
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    expect(
      await screen.findByTestId("dck-project-link-live"),
    ).toHaveTextContent("https://shop.dckautoposting.com/");
    expect(await screen.findByTestId("dck-project-link-live")).toHaveAttribute(
      "href",
      "https://shop.dckautoposting.com/",
    );
    expect(
      screen.queryByTestId("dck-project-link-preview"),
    ).not.toBeInTheDocument();
  });

  it("lists every webgen project with metadata", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    expect(await screen.findByTestId("dck-project-row")).toHaveTextContent(
      "shop",
    );
    expect(
      screen.queryByTestId("dck-project-link-local"),
    ).not.toBeInTheDocument();
  });

  it("renders the webgen projects as a table with a status badge", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    expect(
      await screen.findByTestId("dck-webgen-project-table"),
    ).toBeInTheDocument();
    const badge = await screen.findByTestId("dck-project-status-badge");
    expect(badge).toHaveAttribute("data-status", "stopped");
  });

  it("opens the project conversation prompt-free on row click", async () => {
    const navigate = vi.fn();
    setModuleProfileAssignments({ webgen: "deleted-profile" });
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
      { navigation: { navigate } },
    );

    await waitForLegacyAssignmentMigration();
    fireEvent.click(await screen.findByTestId("dck-project-row-open"));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/conversations/conv-web");
    });
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("runs typed lifecycle actions even when the saved agent profile is unavailable", async () => {
    setModuleProfileAssignments({ webgen: "deleted-profile" });
    vi.mocked(
      AgentServerConversationService.searchConversations,
    ).mockResolvedValue({ items: [], next_page_id: null });
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    expect(
      await screen.findByTestId(
        "dck-module-agent-profile-summary-warning-webgen",
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(getScopedProfileAssignments()).resolves.toEqual({
        webgen: "deleted-profile",
      }),
    );
    await waitForLegacyAssignmentMigration();
    expect(screen.getByTestId("dck-module-new-project")).toBeDisabled();

    fireEvent.click(await screen.findByTestId("dck-project-row-open"));
    expect(mockCreateConversation).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-deploy"));
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "deploy",
      });
    });
    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it("opens the New Project dialog and seeds a spec-filled prompt on submit", async () => {
    setModuleProfileAssignments({ webgen: "active-profile" });
    vi.mocked(
      AgentServerConversationService.searchConversations,
    ).mockResolvedValue({
      items: [researchConversation],
      next_page_id: null,
    });
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    // Clicking New project opens the dialog — it must NOT create immediately.
    await waitForAssignedModuleProfile("webgen", "active-profile");
    await user.click(await screen.findByTestId("dck-module-new-project"));
    expect(
      await screen.findByTestId("webgen-new-project-dialog"),
    ).toBeInTheDocument();
    expect(mockCreateConversation).not.toHaveBeenCalled();

    await user.type(
      screen.getByTestId("webgen-new-project-name"),
      "landing-site",
    );
    await user.click(screen.getByTestId("webgen-new-project-database"));
    await user.click(screen.getByTestId("webgen-new-project-submit"));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    });
    const payload = mockCreateConversation.mock.calls[0][0];
    expect(payload.workingDir).toBe("/projects/webgen/landing-site");
    expect(mockSetMessageToSend).toHaveBeenCalledWith(
      expect.stringContaining("landing-site"),
    );
    expect(mockSetMessageToSend).toHaveBeenCalledWith(
      expect.stringMatching(/Database: yes/),
    );
  });

  it("creates nothing when the New Project dialog is cancelled", async () => {
    setModuleProfileAssignments({ webgen: "active-profile" });
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await waitForAssignedModuleProfile("webgen", "active-profile");
    await user.click(await screen.findByTestId("dck-module-new-project"));
    await user.click(await screen.findByTestId("webgen-new-project-cancel"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("webgen-new-project-dialog"),
      ).not.toBeInTheDocument();
    });
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("blocks a duplicate project name in the New Project dialog", async () => {
    // `shop` already exists under webgen (FileClient mock), so submit stays
    // disabled and no conversation is created.
    setModuleProfileAssignments({ webgen: "active-profile" });
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await waitForAssignedModuleProfile("webgen", "active-profile");
    await user.click(await screen.findByTestId("dck-module-new-project"));
    await user.type(screen.getByTestId("webgen-new-project-name"), "shop");
    await user.tab();

    expect(
      await screen.findByTestId("webgen-new-project-name-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("webgen-new-project-submit")).toBeDisabled();
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("keeps the Better Auth project dialog open after staging fails and retries the same conversation", async () => {
    setModuleProfileAssignments({ webgen: "active-profile" });
    mockOwnerSeedService.stage
      .mockRejectedValueOnce(new Error("secure provisioning unavailable"))
      .mockResolvedValueOnce({ verification_key: "public-verification-key" });
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await waitForAssignedModuleProfile("webgen", "active-profile");
    await user.click(await screen.findByTestId("dck-module-new-project"));
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
    expect(screen.getByTestId("webgen-new-project-dialog")).toBeInTheDocument();
    expect(mockSetMessageToSend).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("webgen-new-project-submit"));
    await waitFor(() =>
      expect(mockOwnerSeedService.stage).toHaveBeenCalledTimes(2),
    );
    expect(mockCreateConversation).toHaveBeenCalledOnce();
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

describe("ModuleDetailView conversations list", () => {
  it("loads later pages and opens the clicked older conversation", async () => {
    const older = {
      ...researchConversation,
      id: "older",
      title: "Older report",
      updated_at: "2026-09-20T10:00:00Z",
    };
    vi.mocked(
      AgentServerConversationService.searchConversations,
    ).mockImplementation(async (_limit, cursor) =>
      cursor
        ? { items: [older], next_page_id: null }
        : { items: [researchConversation], next_page_id: "page-two" },
    );
    const navigate = vi.fn();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("research")} />,
      { navigation: { navigate } },
    );
    fireEvent.click(await screen.findByText("Older report"));
    expect(navigate).toHaveBeenCalledWith("/conversations/older");
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });
  it("lists conversations for a conversations-kind module", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("research")} />,
    );

    expect(
      await screen.findByTestId("dck-module-conversation-row"),
    ).toHaveTextContent("Trend report");
  });
});

describe("ModuleDetailView webgen lifecycle actions", () => {
  it("deploys through the typed API without sending a command to chat", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    const deployButton = await screen.findByTestId("dck-lifecycle-deploy");
    expect(deployButton).toBeEnabled();
    fireEvent.click(deployButton);
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "deploy",
      });
    });
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it("uses an existing conversation only to authorize Better Auth seed delivery", async () => {
    mockRuntimeProjects.projects[0].auth_provider = "better-auth";
    setModuleProfileAssignments({ webgen: "active-profile" });
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await waitForAssignedModuleProfile("webgen", "active-profile");
    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-deploy"));
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "deploy",
        conversation_id: "conv-web",
      });
    });
    expect(mockOwnerSeedService.authorize).toHaveBeenCalledWith(
      "shop",
      "conv-web",
      "/projects/webgen/shop",
    );
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it("creates a blank conversation when Better Auth has no existing project conversation", async () => {
    mockRuntimeProjects.projects[0].auth_provider = "better-auth";
    vi.mocked(
      AgentServerConversationService.searchConversations,
    ).mockResolvedValue({ items: [researchConversation], next_page_id: null });
    setModuleProfileAssignments({ webgen: "research-profile" });
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await waitForAssignedModuleProfile("webgen", "research-profile");
    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-deploy"));
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "deploy",
        conversation_id: "conv-new",
      });
    });
    expect(mockCreateConversation).toHaveBeenCalledWith({
      workingDir: "/projects/webgen/shop",
      agentProfileId: "research-profile",
    });
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it("requests fresh owner seed credentials when the staged capability has expired", async () => {
    mockRuntimeProjects.projects[0].auth_provider = "better-auth";
    setModuleProfileAssignments({ webgen: "active-profile" });
    const expired = Object.assign(new Error("expired"), { status: 410 });
    mockOwnerSeedService.authorize.mockRejectedValueOnce(expired);
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await waitForAssignedModuleProfile("webgen", "active-profile");
    await waitForAssignedModuleProfile("webgen", "active-profile");
    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-deploy"));
    expect(
      await screen.findByTestId("webgen-owner-seed-dialog"),
    ).toBeInTheDocument();
    await user.type(
      screen.getByTestId("webgen-owner-seed-email"),
      "owner@example.com",
    );
    await user.type(
      screen.getByTestId("webgen-owner-seed-password"),
      "Correct Horse Battery Staple!",
    );
    await user.click(screen.getByTestId("webgen-owner-seed-submit"));

    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "deploy",
        conversation_id: "conv-web",
      });
    });
    expect(mockOwnerSeedService.stage).toHaveBeenCalledWith(
      "shop",
      "conv-web",
      "/projects/webgen/shop",
      expect.objectContaining({ email: "owner@example.com" }),
    );
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it("sends rebuild as a typed API operation", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-rebuild"));
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "rebuild",
      });
    });
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it("starts a stopped app through the typed API without rebuilding", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-start"));
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "start",
      });
    });
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it("confirms before sending the destructive delete operation", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-delete"));
    expect(mockWebgenService.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("confirm-button"));
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "delete",
      });
    });
    expect(mockSetMessageToSend).not.toHaveBeenCalled();
  });

  it("publishes after validating the requested subdomain", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-publish"));
    const input = screen.getByTestId("dck-webgen-publish-subdomain-input");
    expect(screen.getByTestId("dck-webgen-publish-submit")).toBeInTheDocument();
    await user.clear(input);
    expect(screen.getByTestId("dck-webgen-publish-submit")).toBeInTheDocument();
    await user.type(input, "my-shop");
    expect(screen.getByTestId("dck-webgen-publish-submit")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dck-webgen-publish-submit"));
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "publish",
        subdomain: "my-shop",
      });
    });
  });

  it("unpublishes the current subdomain through the typed API", async () => {
    mockRuntimeProjects.projects[0].subdomain = "shop.dckautoposting.com";
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    fireEvent.click(await screen.findByTestId("dck-lifecycle-menu"));
    fireEvent.click(await screen.findByTestId("dck-lifecycle-unpublish"));
    fireEvent.click(screen.getByTestId("confirm-button"));
    await waitFor(() => {
      expect(mockWebgenService.run).toHaveBeenCalledWith("shop", {
        action: "unpublish",
      });
    });
  });

  it("shows no lifecycle controls for a non-webgen module", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("research")} />,
    );

    await screen.findByTestId("dck-module-conversation-row");
    expect(
      screen.queryByTestId("dck-lifecycle-deploy"),
    ).not.toBeInTheDocument();
  });
});

describe("ModuleDetailView list states", () => {
  it("shows an empty state with the New conversation CTA", async () => {
    vi.mocked(
      AgentServerConversationService.searchConversations,
    ).mockResolvedValue({ items: [], next_page_id: null });

    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("research")} />,
    );

    const empty = await screen.findByTestId("dck-list-empty");
    expect(
      within(empty).getByTestId("dck-module-new-conversation"),
    ).toBeInTheDocument();
  });

  it("shows an error state with retry when conversations fail to load", async () => {
    vi.mocked(
      AgentServerConversationService.searchConversations,
    ).mockRejectedValue(new Error("boom"));

    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("research")} />,
    );

    expect(await screen.findByTestId("dck-list-error")).toBeInTheDocument();
    expect(screen.getByTestId("dck-list-retry")).toBeInTheDocument();
  });
});
