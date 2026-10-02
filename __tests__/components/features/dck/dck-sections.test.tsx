import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExecutionStatus } from "#/types/agent-server/core";
import type { AppConversation } from "#/api/conversation-service/agent-server-conversation-service.types";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import CanvasExtensionsService from "#/api/canvas-extensions-service";
import { renderWithProviders } from "test-utils";
import { DckModulesSection } from "#/components/features/dck/dck-modules-section";
import { DckRecentConversations } from "#/components/features/dck/dck-recent-conversations";

vi.mock(
  "#/api/conversation-service/agent-server-conversation-service.api",
  () => ({
    default: { searchConversations: vi.fn() },
  }),
);

vi.mock("#/api/canvas-extensions-service", () => ({
  default: { listInstalled: vi.fn() },
}));

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
  vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DckModulesSection", () => {
  it("renders all five module cards with a count (no inline project list)", async () => {
    renderWithProviders(<DckModulesSection />);

    for (const id of [
      "webgen",
      "dashboards",
      "research",
      "powerbi",
      "analytics",
    ]) {
      expect(
        await screen.findByTestId(`dck-module-card-${id}`),
      ).toBeInTheDocument();
    }

    // Count is shown; the per-project detail now lives on the module page, so
    // the home card renders no project rows.
    expect(
      await screen.findByTestId("dck-module-count-webgen"),
    ).toHaveTextContent("1 project");
    expect(screen.queryByTestId("dck-project-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dck-project-link")).not.toBeInTheDocument();
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

    const powerbiCard = await screen.findByTestId("dck-module-card-powerbi");
    const newButton = within(powerbiCard).getByRole("button");
    await user.click(newButton);

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    });
    const payload = mockCreateConversation.mock.calls[0][0];
    expect(payload.workingDir).toBe("/projects/powerbi");
    expect(payload.query).toMatch(/power bi|dax|power query/i);
    expect(payload.entryPoint).toBeUndefined();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/conversations/conv-new");
    });
  });
});

describe("DckRecentConversations", () => {
  it("lists recent conversations newest first and navigates on click", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<DckRecentConversations />, {
      navigation: { navigate },
    });

    const rows = await screen.findAllByTestId("dck-recent-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Trend report");

    await user.click(rows[1]);
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/conversations/conv-web");
    });
  });
});
