import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { WebgenProjectTable } from "#/components/features/dck/webgen-project-table";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("#/dck/webgen-service", () => ({
  fetchWebgenRuntimeSecrets: api.fetch,
  saveWebgenRuntimeSecret: vi.fn(),
  deleteWebgenRuntimeSecret: vi.fn(),
  migrateWebgenRuntimeSecret: vi.fn(),
}));

describe("WebgenProjectTable runtime secret entry point", () => {
  it("opens the Environment manager from the three-dot menu for the selected website", async () => {
    const user = userEvent.setup();
    api.fetch.mockResolvedValue({
      project_id: "00000000-0000-4000-8000-000000000001",
      secrets: [],
      pending_migrations: [],
      migration_available: true,
      migration_candidates: [],
    });
    renderWithProviders(
      <WebgenProjectTable
        entries={[
          { name: "shop", path: "/workspace/webgen/shop" },
          { name: "other-site", path: "/workspace/webgen/other-site" },
        ]}
        conversations={[]}
        onOpen={vi.fn()}
        isBusy={false}
        dispatchLifecycle={vi.fn().mockResolvedValue(true)}
      />,
    );

    const menus = screen.getAllByTestId("dck-lifecycle-menu");
    expect(menus).toHaveLength(2);
    await user.click(menus[1]);
    await user.click(screen.getByTestId("dck-lifecycle-environment"));
    await waitFor(() => expect(api.fetch).toHaveBeenCalledWith("other-site"));
    expect(
      screen.getByTestId("dck-webgen-runtime-secrets-dialog"),
    ).toBeInTheDocument();
  });
});
