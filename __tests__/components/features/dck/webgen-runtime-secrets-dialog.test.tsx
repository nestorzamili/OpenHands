import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { WebgenRuntimeSecretsDialog } from "#/components/features/dck/webgen-runtime-secrets-dialog";

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  reveal: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("#/dck/webgen-service", () => ({
  fetchWebgenRuntimeSecrets: api.fetch,
  fetchWebgenRuntimeSecretValue: api.reveal,
  saveWebgenRuntimeSecret: api.save,
  deleteWebgenRuntimeSecret: api.remove,
}));

const response = (overrides: Record<string, unknown> = {}) => ({
  project_id: "00000000-0000-4000-8000-000000000001",
  secrets: [{ name: "DATABASE_URL", configured: true, sensitive: true }],
  ...overrides,
});

function renderDialog() {
  const onClose = vi.fn();
  renderWithProviders(
    <WebgenRuntimeSecretsDialog
      projectSlug="shop"
      projectName="Shop"
      onClose={onClose}
    />,
  );
  return { onClose };
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  api.fetch.mockResolvedValue(response());
  api.reveal.mockResolvedValue({
    name: "DATABASE_URL",
    value: "runtime-test-value",
  });
  api.save.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
});

describe("WebgenRuntimeSecretsDialog", () => {
  it("omits the description and import UI while preserving reveal, edit, and scrolling", async () => {
    const user = userEvent.setup();
    const secretValue = "runtime-test-value";
    renderDialog();

    await screen.findByText("DATABASE_URL");
    const dialog = screen.getByTestId("dck-webgen-runtime-secrets-dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      screen.queryByText("DCK$RUNTIME_SECRETS_DESCRIPTION"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("DCK$RUNTIME_SECRET_MIGRATION_TITLE"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("DCK$RUNTIME_SECRET_APPLY_NOTICE"),
    ).toBeInTheDocument();
    expect(dialog).toHaveClass("max-h-[calc(100vh-2rem)]");
    expect(dialog.querySelector(".overflow-y-auto")).toHaveClass(
      "min-h-0",
      "flex-1",
    );
    expect(screen.queryByText(secretValue)).not.toBeInTheDocument();

    const reveal = screen.getByTestId(
      "dck-webgen-runtime-secret-reveal-DATABASE_URL",
    );
    await user.click(reveal);
    expect(
      await screen.findByTestId("dck-webgen-runtime-secret-value-DATABASE_URL"),
    ).toHaveTextContent(secretValue);
    expect(api.reveal).toHaveBeenCalledWith("shop", "DATABASE_URL");
    await user.click(reveal);
    expect(
      screen.queryByTestId("dck-webgen-runtime-secret-value-DATABASE_URL"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByTestId("dck-webgen-runtime-secret-edit-DATABASE_URL"),
    );
    const editValue = await screen.findByTestId(
      "dck-webgen-runtime-secret-edit-value",
    );
    expect(editValue).toHaveValue("");
    await user.selectOptions(
      screen.getByTestId("dck-webgen-runtime-secret-edit-classification"),
      "non-sensitive",
    );
    await user.click(screen.getByTestId("dck-webgen-runtime-secret-edit-save"));

    await waitFor(() => {
      expect(api.save).toHaveBeenCalledWith("shop", "DATABASE_URL", "", false);
    });
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("saves a new environment variable with the manually selected classification", async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText("DATABASE_URL");

    await user.type(
      screen.getByTestId("dck-webgen-runtime-secret-name"),
      "PUBLIC_ENDPOINT",
    );
    await user.type(
      screen.getByTestId("dck-webgen-runtime-secret-value"),
      "https://example.test",
    );
    await user.selectOptions(
      screen.getByTestId("dck-webgen-runtime-secret-classification"),
      "non-sensitive",
    );
    await user.click(screen.getByTestId("dck-webgen-runtime-secret-add"));

    await waitFor(() => {
      expect(api.save).toHaveBeenCalledWith(
        "shop",
        "PUBLIC_ENDPOINT",
        "https://example.test",
        false,
      );
    });
  });

  it("retains new-variable inputs and announces an error without exposing the value", async () => {
    const user = userEvent.setup();
    const secretValue = "typed-secret-that-must-stay-in-the-password-field";
    api.save.mockRejectedValueOnce(new Error("network unavailable"));
    renderDialog();
    await screen.findByText("DATABASE_URL");

    const name = screen.getByTestId("dck-webgen-runtime-secret-name");
    const value = screen.getByTestId("dck-webgen-runtime-secret-value");
    await user.clear(name);
    await user.type(name, "NEW_API_TOKEN");
    await user.type(value, secretValue);
    await user.click(screen.getByTestId("dck-webgen-runtime-secret-add"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(name).toHaveValue("NEW_API_TOKEN");
    expect(value).toHaveValue(secretValue);
    expect(value).toHaveAttribute("type", "password");
    expect(screen.queryByText(secretValue)).not.toBeInTheDocument();
    expect(name).toHaveAttribute(
      "aria-describedby",
      "dck-runtime-secret-error",
    );
  });

  it("deletes a saved variable after the confirmation step", async () => {
    const user = userEvent.setup();
    api.fetch
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ secrets: [] }));
    renderDialog();
    await screen.findByText("DATABASE_URL");

    const row = screen.getByText("DATABASE_URL").closest("li");
    if (!row) throw new Error("Expected the saved variable row");
    const rowQueries = within(row);
    await user.click(rowQueries.getAllByRole("button")[2]);
    await user.click(rowQueries.getAllByRole("button").at(-1)!);

    await waitFor(() => {
      expect(api.remove).toHaveBeenCalledWith("shop", "DATABASE_URL");
    });
    await waitFor(() => {
      expect(screen.queryByText("DATABASE_URL")).not.toBeInTheDocument();
    });
  });
});
