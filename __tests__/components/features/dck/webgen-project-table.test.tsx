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
}));

describe("WebgenProjectTable runtime secret entry point", () => {
  it("opens the Environment manager from the three-dot menu for the selected website", async () => {
    const user = userEvent.setup();
    api.fetch.mockResolvedValue({
      project_id: "00000000-0000-4000-8000-000000000001",
      secrets: [],
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

  it("follows the deployment journey from first preview through running, stopped, and published states", async () => {
    const user = userEvent.setup();
    const dispatchLifecycle = vi.fn().mockResolvedValue(true);
    const runtime = (
      status: "running" | "stopped",
      hasDeployment: boolean,
      previewPath: string | null,
      subdomain: string | null,
    ) => ({
      slug: "shop",
      path: "/workspace/webgen/shop",
      name: "shop",
      port: 3000,
      stack: "next",
      auth_provider: null,
      preview_path: previewPath,
      subdomain,
      has_deployment: hasDeployment,
      status,
      last_checked_at: null,
      containers: [],
    });
    const view = renderWithProviders(
      <WebgenProjectTable
        entries={[{ name: "shop", path: "/workspace/webgen/shop" }]}
        conversations={[]}
        onOpen={vi.fn()}
        isBusy={false}
        runtimeProjects={[runtime("stopped", false, null, null)]}
        dispatchLifecycle={dispatchLifecycle}
      />,
    );
    const menu = () => screen.getByTestId("dck-lifecycle-menu");

    await user.click(menu());
    expect(screen.getByTestId("dck-lifecycle-deploy")).toBeInTheDocument();
    expect(
      screen.queryByTestId("dck-lifecycle-rebuild"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId("dck-lifecycle-deploy"));
    await waitFor(() =>
      expect(dispatchLifecycle).toHaveBeenLastCalledWith(
        "/workspace/webgen/shop",
        "deploy",
        "shop",
        null,
        undefined,
      ),
    );

    view.rerender(
      <WebgenProjectTable
        entries={[{ name: "shop", path: "/workspace/webgen/shop" }]}
        conversations={[]}
        onOpen={vi.fn()}
        isBusy={false}
        runtimeProjects={[runtime("running", true, "/preview/shop", null)]}
        dispatchLifecycle={dispatchLifecycle}
      />,
    );
    await user.click(menu());
    expect(
      screen.queryByTestId("dck-lifecycle-deploy"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("dck-lifecycle-rebuild")).toBeInTheDocument();
    await user.click(screen.getByTestId("dck-lifecycle-rebuild"));
    await waitFor(() =>
      expect(dispatchLifecycle).toHaveBeenLastCalledWith(
        "/workspace/webgen/shop",
        "rebuild",
        "shop",
        null,
        undefined,
      ),
    );

    view.rerender(
      <WebgenProjectTable
        entries={[{ name: "shop", path: "/workspace/webgen/shop" }]}
        conversations={[]}
        onOpen={vi.fn()}
        isBusy={false}
        runtimeProjects={[runtime("stopped", true, "/preview/shop", null)]}
        dispatchLifecycle={dispatchLifecycle}
      />,
    );
    await user.click(menu());
    expect(
      screen.queryByTestId("dck-lifecycle-deploy"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("dck-lifecycle-start")).toBeInTheDocument();
    expect(screen.getByTestId("dck-lifecycle-rebuild")).toBeInTheDocument();

    view.rerender(
      <WebgenProjectTable
        entries={[{ name: "shop", path: "/workspace/webgen/shop" }]}
        conversations={[]}
        onOpen={vi.fn()}
        isBusy={false}
        runtimeProjects={[
          runtime("stopped", true, null, "shop.dckautoposting.com"),
        ]}
        dispatchLifecycle={dispatchLifecycle}
      />,
    );
    expect(
      screen.queryByTestId("dck-lifecycle-deploy"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("dck-lifecycle-publish"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("dck-lifecycle-unpublish")).toBeInTheDocument();
    expect(screen.getByTestId("dck-lifecycle-start")).toBeInTheDocument();
  });
});
