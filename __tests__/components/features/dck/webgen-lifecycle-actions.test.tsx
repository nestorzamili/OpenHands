import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "test-utils";
import { WebgenLifecycleActions } from "#/components/features/dck/webgen-lifecycle-actions";

describe("WebgenLifecycleActions", () => {
  it.each([null, "current-shop.dckautoposting.com"])(
    "deploys without a domain dialog or publication change for %s",
    async (publishedSubdomain) => {
      const user = userEvent.setup();
      const onDispatch = vi.fn().mockResolvedValue(true);
      renderWithProviders(
        <WebgenLifecycleActions
          appName="shop"
          projectPath="/projects/webgen/shop"
          authProvider={null}
          publishedSubdomain={publishedSubdomain}
          runtimeStatus="stopped"
          onDispatch={onDispatch}
        />,
      );

      await user.click(screen.getByTestId("dck-lifecycle-menu"));

      await user.click(screen.getByTestId("dck-lifecycle-deploy"));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() =>
        expect(onDispatch).toHaveBeenCalledWith(
          "/projects/webgen/shop",
          "deploy",
          "shop",
          null,
          undefined,
        ),
      );
    },
  );

  it.each([
    ["dck-lifecycle-rebuild", "rebuild", "stopped"],
    ["dck-lifecycle-start", "start", "stopped"],
    ["dck-lifecycle-restart", "restart", "running"],
    ["dck-lifecycle-stop", "stop", "running"],
  ] as const)(
    "dispatches the %s action for its matching runtime state",
    async (testId, action, runtimeStatus) => {
      const user = userEvent.setup();
      const onDispatch = vi.fn().mockResolvedValue(true);
      renderWithProviders(
        <WebgenLifecycleActions
          appName="shop"
          projectPath="/projects/webgen/shop"
          authProvider={null}
          publishedSubdomain={null}
          runtimeStatus={runtimeStatus}
          onDispatch={onDispatch}
        />,
      );

      await user.click(screen.getByTestId("dck-lifecycle-menu"));
      await user.click(screen.getByTestId(testId));
      await waitFor(() =>
        expect(onDispatch).toHaveBeenCalledWith(
          "/projects/webgen/shop",
          action,
          "shop",
          null,
          undefined,
        ),
      );
    },
  );

  it("only shows start for a stopped app and restart/stop for a running app", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    const view = renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        runtimeStatus="stopped"
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-menu"));
    expect(screen.getByTestId("dck-lifecycle-start")).toBeInTheDocument();
    expect(
      screen.queryByTestId("dck-lifecycle-restart"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("dck-lifecycle-stop")).not.toBeInTheDocument();

    view.rerender(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        runtimeStatus="running"
        onDispatch={onDispatch}
      />,
    );
    expect(screen.queryByTestId("dck-lifecycle-start")).not.toBeInTheDocument();
    expect(screen.getByTestId("dck-lifecycle-restart")).toBeInTheDocument();
    expect(screen.getByTestId("dck-lifecycle-stop")).toBeInTheDocument();
  });

  it("opens actions with the keyboard and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        runtimeStatus="running"
        onDispatch={onDispatch}
      />,
    );
    const trigger = screen.getByTestId("dck-lifecycle-menu");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("publishes after validating the requested subdomain", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        runtimeStatus="stopped"
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-menu"));

    await user.click(screen.getByTestId("dck-lifecycle-publish"));
    const input = screen.getByTestId("dck-webgen-publish-subdomain-input");
    await user.clear(input);
    await user.type(input, "my-shop");
    expect(screen.getByTestId("dck-webgen-publish-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("dck-webgen-publish-submit"));
    await waitFor(() =>
      expect(onDispatch).toHaveBeenCalledWith(
        "/projects/webgen/shop",
        "publish",
        "shop",
        null,
        "my-shop",
      ),
    );
  });

  it("closes the Publish dialog with Cancel or Escape", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        runtimeStatus="stopped"
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-menu"));

    await user.click(screen.getByTestId("dck-lifecycle-publish"));
    expect(screen.getByTestId("dck-webgen-publish-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("dck-webgen-publish-cancel"));
    expect(
      screen.queryByTestId("dck-webgen-publish-dialog"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId("dck-lifecycle-menu"));

    await user.click(screen.getByTestId("dck-lifecycle-publish"));
    await user.keyboard("{Escape}");
    expect(
      screen.queryByTestId("dck-webgen-publish-dialog"),
    ).not.toBeInTheDocument();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("confirms Unpublish for the current public address", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain="my-shop.dckautoposting.com"
        runtimeStatus="running"
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-menu"));

    await user.click(screen.getByTestId("dck-lifecycle-unpublish"));
    expect(screen.getByTestId("confirmation-modal")).toBeInTheDocument();
    await user.click(screen.getByTestId("confirm-button"));
    await waitFor(() =>
      expect(onDispatch).toHaveBeenCalledWith(
        "/projects/webgen/shop",
        "unpublish",
        "shop",
        null,
        undefined,
      ),
    );
  });

  it("lets Delete be cancelled or confirmed", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        runtimeStatus="stopped"
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-menu"));

    await user.click(screen.getByTestId("dck-lifecycle-delete"));
    await user.click(screen.getByTestId("cancel-button"));
    expect(screen.queryByTestId("confirmation-modal")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("dck-lifecycle-menu"));

    await user.click(screen.getByTestId("dck-lifecycle-delete"));
    expect(screen.getByTestId("confirmation-modal")).toBeInTheDocument();
    await user.click(screen.getByTestId("confirm-button"));
    await waitFor(() =>
      expect(onDispatch).toHaveBeenCalledWith(
        "/projects/webgen/shop",
        "delete",
        "shop",
        null,
        undefined,
      ),
    );
  });

  it("blocks reserved subdomains and associates the validation message", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        runtimeStatus="stopped"
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-menu"));

    await user.click(screen.getByTestId("dck-lifecycle-publish"));
    const input = screen.getByTestId("dck-webgen-publish-subdomain-input");
    await user.clear(input);
    await user.type(input, "admin");

    const error = screen.getByTestId("dck-webgen-publish-subdomain-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
    expect(screen.getByTestId("dck-webgen-publish-submit")).toBeDisabled();
    expect(onDispatch).not.toHaveBeenCalled();
  });
});
