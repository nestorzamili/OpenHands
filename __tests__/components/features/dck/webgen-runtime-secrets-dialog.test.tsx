import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { WebgenRuntimeSecretsDialog } from "#/components/features/dck/webgen-runtime-secrets-dialog";

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("#/dck/webgen-service", () => ({
  fetchWebgenRuntimeSecrets: api.fetch,
  saveWebgenRuntimeSecret: api.save,
  deleteWebgenRuntimeSecret: api.remove,
}));

const response = (overrides: Record<string, unknown> = {}) => ({
  project_id: "00000000-0000-4000-8000-000000000001",
  secrets: [{ name: "DATABASE_URL", configured: true }],
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
  api.save.mockResolvedValue({ name: "DATABASE_URL", configured: true });
  api.remove.mockResolvedValue({ deleted: true });
});

describe("WebgenRuntimeSecretsDialog", () => {
  it("omits the description and import UI while a blank edit preserves the existing value", async () => {
    const user = userEvent.setup();
    const secretValue = "never-render-this-runtime-value";
    renderDialog();

    await screen.findByText("DATABASE_URL");
    expect(
      screen.queryByText("DCK$RUNTIME_SECRETS_DESCRIPTION"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("DCK$RUNTIME_SECRET_MIGRATION_TITLE"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(secretValue)).not.toBeInTheDocument();
    expect(
      screen.getByTestId("dck-webgen-runtime-secrets-dialog"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByTestId("dck-webgen-runtime-secret-edit-DATABASE_URL"),
    );
    const editValue = await screen.findByTestId(
      "dck-webgen-runtime-secret-edit-value",
    );
    expect(editValue).toHaveValue("");
    await user.click(screen.getByTestId("dck-webgen-runtime-secret-edit-save"));

    await waitFor(() => {
      expect(api.save).toHaveBeenCalledWith("shop", "DATABASE_URL", "");
    });
    expect(api.remove).not.toHaveBeenCalled();
    expect(
      screen.getByText("DCK$RUNTIME_SECRET_APPLY_NOTICE"),
    ).toBeInTheDocument();
  });

  it("retains new-secret inputs and announces an error without exposing the value", async () => {
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
});
