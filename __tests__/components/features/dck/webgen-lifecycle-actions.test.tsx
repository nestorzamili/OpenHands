import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "test-utils";
import { WebgenLifecycleActions } from "#/components/features/dck/webgen-lifecycle-actions";

describe("WebgenLifecycleActions", () => {
  it("dispatches Deploy to the typed parent callback", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        onDispatch={onDispatch}
      />,
    );

    const button = screen.getByTestId("dck-lifecycle-deploy");
    expect(button).toBeEnabled();
    await user.click(button);
    await waitFor(() =>
      expect(onDispatch).toHaveBeenCalledWith(
        "/projects/webgen/shop",
        "deploy",
        "shop",
        null,
        undefined,
      ),
    );
  });

  it.each([
    ["dck-lifecycle-rebuild", "rebuild"],
    ["dck-lifecycle-stop", "stop"],
  ])("dispatches the %s action", async (testId, action) => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        onDispatch={onDispatch}
      />,
    );

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
  });

  it("keeps Publish open while editing and dispatches the validated subdomain", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn().mockResolvedValue(true);
    renderWithProviders(
      <WebgenLifecycleActions
        appName="shop"
        projectPath="/projects/webgen/shop"
        authProvider={null}
        publishedSubdomain={null}
        onDispatch={onDispatch}
      />,
    );

    fireEvent.click(screen.getByTestId("dck-lifecycle-publish"));
    const input = screen.getByTestId("dck-webgen-subdomain-input");
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
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-publish"));
    expect(screen.getByTestId("dck-webgen-publish-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("dck-webgen-publish-cancel"));
    expect(
      screen.queryByTestId("dck-webgen-publish-dialog"),
    ).not.toBeInTheDocument();

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
        onDispatch={onDispatch}
      />,
    );

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
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-delete"));
    await user.click(screen.getByTestId("cancel-button"));
    expect(screen.queryByTestId("confirmation-modal")).not.toBeInTheDocument();

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
        onDispatch={onDispatch}
      />,
    );

    await user.click(screen.getByTestId("dck-lifecycle-publish"));
    const input = screen.getByTestId("dck-webgen-subdomain-input");
    await user.clear(input);
    await user.type(input, "admin");

    const error = screen.getByTestId("dck-webgen-subdomain-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
    expect(screen.getByTestId("dck-webgen-publish-submit")).toBeDisabled();
    expect(onDispatch).not.toHaveBeenCalled();
  });
});
