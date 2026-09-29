import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
  vi.mocked(
    AgentServerConversationService.searchConversations,
  ).mockResolvedValue({
    items: [researchConversation, webgenConversation],
    next_page_id: null,
  });
  vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([]);
});

describe("DckModulesSection", () => {
  it("renders all five module cards with the webgen project list", async () => {
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
    expect(await screen.findByTestId("dck-project-row")).toHaveTextContent(
      "shop",
    );
  });

  it("opens the existing conversation for a project row", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<DckModulesSection />, { navigation: { navigate } });

    await user.click(await screen.findByTestId("dck-project-row"));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/conversations/conv-web");
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
