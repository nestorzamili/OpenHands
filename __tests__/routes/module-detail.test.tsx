import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExecutionStatus } from "#/types/agent-server/core";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { renderWithProviders } from "test-utils";
import { ModuleDetailView } from "#/routes/module-detail";
import { getDckModuleById } from "#/dck/modules";

vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({
    default: { searchConversations: vi.fn() },
  }),
);

const mockCreateConversation = vi.fn(
  async (_payload: { workingDir?: string; query?: string }) => ({
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
  mockCreateConversation.mockClear();
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
});

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

  it("resolves ids via getDckModuleById (wrapper contract)", () => {
    expect(getDckModuleById("bogus")).toBeNull();
    expect(getDckModuleById("webgen")?.id).toBe("webgen");
  });
});

describe("ModuleDetailView projects list", () => {
  it("lists every webgen project with metadata", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    expect(await screen.findByTestId("dck-project-row")).toHaveTextContent(
      "shop",
    );
    const link = await screen.findByTestId("dck-project-link");
    expect(link).toHaveAttribute("href", "http://localhost:3100");
  });

  it("renders the webgen projects as a table with a status badge", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    expect(
      await screen.findByTestId("dck-webgen-project-table"),
    ).toBeInTheDocument();
    // `.dck.json` has no verified lastStatus and the conversation is RUNNING,
    // so the badge shows agent activity ("working"), never an unverified
    // "running".
    const badge = await screen.findByTestId("dck-project-status-badge");
    expect(badge).toHaveAttribute("data-status", "working");
  });

  it("opens the project conversation prompt-free on row click", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
      { navigation: { navigate } },
    );

    await user.click(await screen.findByTestId("dck-project-row-open"));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/conversations/conv-web");
    });
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("opens the New Project dialog and seeds a spec-filled prompt on submit", async () => {
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
    expect(payload.workingDir).toBe("/projects/webgen");
    expect(payload.query).toContain("landing-site");
    expect(payload.query).toMatch(/Database: yes/);
  });

  it("creates nothing when the New Project dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

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
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await user.click(await screen.findByTestId("dck-module-new-project"));
    await user.type(screen.getByTestId("webgen-new-project-name"), "shop");
    await user.tab();

    expect(
      await screen.findByTestId("webgen-new-project-name-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("webgen-new-project-submit")).toBeDisabled();
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });
});

describe("ModuleDetailView conversations list", () => {
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
  it("pre-fills the deploy command into the app's existing conversation", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
      { navigation: { navigate } },
    );

    await user.click(await screen.findByTestId("dck-webgen-lifecycle-menu"));
    await user.click(await screen.findByTestId("dck-lifecycle-deploy"));

    await waitFor(() => {
      expect(mockSetMessageToSend).toHaveBeenCalledTimes(1);
    });
    const command = mockSetMessageToSend.mock.calls[0][0];
    expect(command).toContain("docker compose up -d --build");
    expect(command).toContain("curl -s http://localhost:3100/");
    expect(navigate).toHaveBeenCalledWith("/conversations/conv-web");
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("creates one conversation and pre-fills when the app has none", async () => {
    vi.mocked(
      AgentServerConversationService.searchConversations,
    ).mockResolvedValue({ items: [researchConversation], next_page_id: null });
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await user.click(await screen.findByTestId("dck-webgen-lifecycle-menu"));
    await user.click(await screen.findByTestId("dck-lifecycle-deploy"));

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    });
    const createPayload = mockCreateConversation.mock.calls[0][0];
    expect(createPayload.workingDir).toBe("/projects/webgen/shop");
    expect(createPayload.query).toBeUndefined();
    expect(mockSetMessageToSend).toHaveBeenCalledTimes(1);
    expect(mockSetMessageToSend.mock.calls[0][0]).toContain(
      "docker compose up -d --build",
    );
  });

  it("rebuild pre-fills a clean restart command", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await user.click(await screen.findByTestId("dck-webgen-lifecycle-menu"));
    await user.click(await screen.findByTestId("dck-lifecycle-rebuild"));

    await waitFor(() => {
      expect(mockSetMessageToSend).toHaveBeenCalledTimes(1);
    });
    expect(mockSetMessageToSend.mock.calls[0][0]).toContain(
      "docker compose down && docker compose up -d --build",
    );
  });

  it("confirms before pre-filling the destructive delete command", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("webgen")} />,
    );

    await user.click(await screen.findByTestId("dck-webgen-lifecycle-menu"));
    await user.click(await screen.findByTestId("dck-lifecycle-delete"));
    expect(mockSetMessageToSend).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("confirm-button"));
    await waitFor(() => {
      expect(mockSetMessageToSend).toHaveBeenCalledTimes(1);
    });
    expect(mockSetMessageToSend.mock.calls[0][0]).toContain(
      "docker compose down -v --rmi local",
    );
  });

  it("shows no lifecycle menu for a non-webgen module", async () => {
    renderWithProviders(
      <ModuleDetailView dckModule={getDckModuleById("research")} />,
    );

    await screen.findByTestId("dck-module-conversation-row");
    expect(
      screen.queryByTestId("dck-webgen-lifecycle-menu"),
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
