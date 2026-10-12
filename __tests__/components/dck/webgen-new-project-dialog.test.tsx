import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { WebgenNewProjectDialog } from "#/components/features/dck/webgen-new-project-dialog";

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof WebgenNewProjectDialog>> = {},
) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  renderWithProviders(
    <WebgenNewProjectDialog
      existingNames={overrides.existingNames ?? ["shop"]}
      isSubmitting={overrides.isSubmitting ?? false}
      onSubmit={overrides.onSubmit ?? onSubmit}
      onCancel={overrides.onCancel ?? onCancel}
    />,
  );
  return { onSubmit, onCancel };
}

describe("WebgenNewProjectDialog", () => {
  it("renders the name, description, and the DB/auth toggles", () => {
    renderDialog();
    expect(screen.getByTestId("webgen-new-project-name")).toBeInTheDocument();
    expect(
      screen.getByTestId("webgen-new-project-description"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webgen-new-project-database"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("webgen-new-project-auth")).toBeInTheDocument();
  });

  it("keeps submit disabled until a valid, unique name is entered", async () => {
    const user = userEvent.setup();
    renderDialog({ existingNames: ["shop"] });
    const submit = screen.getByTestId("webgen-new-project-submit");

    // Empty name → disabled.
    expect(submit).toBeDisabled();

    // Colliding name → still disabled + error shown after touch.
    await user.type(screen.getByTestId("webgen-new-project-name"), "shop");
    await user.tab();
    expect(submit).toBeDisabled();
    expect(
      screen.getByTestId("webgen-new-project-name-error"),
    ).toBeInTheDocument();

    // A valid, unique name enables submit.
    await user.clear(screen.getByTestId("webgen-new-project-name"));
    await user.type(screen.getByTestId("webgen-new-project-name"), "my-shop");
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it("submits the collected spec with the toggles reflected", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ existingNames: [] });

    await user.type(screen.getByTestId("webgen-new-project-name"), "my-shop");
    await user.type(
      screen.getByTestId("webgen-new-project-description"),
      "a store for shoes",
    );
    await user.click(screen.getByTestId("webgen-new-project-database"));
    await user.click(screen.getByTestId("webgen-new-project-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "my-shop",
      description: "a store for shoes",
      needsDatabase: true,
      needsAuth: false,
    });
  });

  it("defaults to Better Auth when enabled and submits an explicitly named alternative", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ existingNames: [] });
    await user.type(screen.getByTestId("webgen-new-project-name"), "members");
    await user.click(screen.getByTestId("webgen-new-project-auth"));

    const provider = screen.getByTestId("webgen-new-project-auth-provider");
    expect(provider).toHaveValue("better-auth");
    await user.selectOptions(provider, "other");
    await user.type(
      screen.getByTestId("webgen-new-project-other-auth-provider"),
      "Clerk",
    );
    await user.click(screen.getByTestId("webgen-new-project-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        needsAuth: true,
        authProvider: "other",
        otherAuthProvider: "Clerk",
      }),
    );
  });

  it("collects Better Auth owner seed separately and preserves password whitespace", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ existingNames: [] });
    const password = "  Correct Horse🔐 Battery Staple  ";

    await user.type(screen.getByTestId("webgen-new-project-name"), "members");
    await user.click(screen.getByTestId("webgen-new-project-auth"));
    await user.type(
      screen.getByTestId("webgen-owner-seed-email"),
      "owner@example.test",
    );
    await user.type(screen.getByTestId("webgen-owner-seed-username"), "nestor");
    const passwordInput = screen.getByTestId("webgen-owner-seed-password");
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toHaveAttribute("autocomplete", "new-password");
    await user.type(passwordInput, password);

    await waitFor(() =>
      expect(screen.getByTestId("webgen-new-project-submit")).toBeEnabled(),
    );
    await user.click(screen.getByTestId("webgen-new-project-submit"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        name: "members",
        description: "",
        needsDatabase: false,
        needsAuth: true,
        authProvider: "better-auth",
        otherAuthProvider: "",
      },
      { email: "owner@example.test", username: "nestor", password },
    );
  });

  it("calls onCancel from the cancel button", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();
    await user.click(screen.getByTestId("webgen-new-project-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the actions while submitting", () => {
    renderDialog({ isSubmitting: true });
    expect(screen.getByTestId("webgen-new-project-submit")).toBeDisabled();
    expect(screen.getByTestId("webgen-new-project-cancel")).toBeDisabled();
  });
});
