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
});
