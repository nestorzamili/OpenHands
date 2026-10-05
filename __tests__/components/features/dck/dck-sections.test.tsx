import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExecutionStatus } from "#/types/agent-server/core";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { renderWithProviders } from "test-utils";
import { DckModulesSection } from "#/components/features/dck/dck-modules-section";

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

    expect(
      await screen.findByTestId("dck-module-manager"),
    ).toBeInTheDocument();
    // Built-in modules show a read-only badge; custom modules get edit controls.
    expect(
      screen.getByTestId("dck-module-builtin-badge-webgen"),
    ).toBeInTheDocument();
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
