import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { UsersSettingsView } from "#/routes/users-settings";
import type { PortalUserListEntry } from "#/api/portal-auth-service";

const USERS: PortalUserListEntry[] = [
  { username: "grok", isAdmin: true, createdAt: null },
  { username: "bob", isAdmin: false, createdAt: null },
];

describe("UsersSettingsView", () => {
  it("shows an admin-only message for a non-admin", () => {
    renderWithProviders(
      <UsersSettingsView
        currentUser={{ username: "bob", isAdmin: false }}
        users={[]}
        isLoading={false}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("users-settings-forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("users-create-form")).not.toBeInTheDocument();
  });

  it("lists users and disables deleting the current admin", () => {
    renderWithProviders(
      <UsersSettingsView
        currentUser={{ username: "grok", isAdmin: true }}
        users={USERS}
        isLoading={false}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId("users-row-grok")).toBeInTheDocument();
    expect(screen.getByTestId("users-row-bob")).toBeInTheDocument();
    // Self-delete guarded in the UI (and server).
    expect(screen.getByTestId("users-delete-grok")).toBeDisabled();
    expect(screen.getByTestId("users-delete-bob")).not.toBeDisabled();
  });

  it("creates a user via the Add user modal", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <UsersSettingsView
        currentUser={{ username: "grok", isAdmin: true }}
        users={USERS}
        isLoading={false}
        onCreate={onCreate}
        onDelete={vi.fn()}
      />,
    );

    // Form is behind the modal: not present until "Add user" is clicked.
    expect(screen.queryByTestId("users-create-form")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("users-add-button"));
    expect(screen.getByTestId("users-create-form")).toBeInTheDocument();

    await user.type(screen.getByTestId("users-create-username"), "ada");
    await user.type(screen.getByTestId("users-create-password"), "adapass12");
    await user.click(screen.getByTestId("users-create-admin"));
    await user.click(screen.getByTestId("users-create-submit"));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        username: "ada",
        password: "adapass12",
        isAdmin: true,
      }),
    );
    // Modal closes after a successful create.
    await waitFor(() =>
      expect(screen.queryByTestId("users-create-form")).not.toBeInTheDocument(),
    );
  });

  it("deletes a user after confirmation", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <UsersSettingsView
        currentUser={{ username: "grok", isAdmin: true }}
        users={USERS}
        isLoading={false}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByTestId("users-delete-bob"));
    // Confirmation modal appears; confirm.
    await user.click(screen.getByTestId("confirm-button"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("bob"));
  });
});
