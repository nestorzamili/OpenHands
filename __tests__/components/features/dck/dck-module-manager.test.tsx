import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DckModuleManager } from "#/components/features/dck/dck-module-manager";

const downloadTextFileMock = vi.fn();
const uploadTextFileMock = vi.fn();

vi.mock("@openhands/typescript-client/clients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@openhands/typescript-client/clients")
  >()),
  FileClient: class {
    downloadTextFile = (...args: unknown[]) => downloadTextFileMock(...args);
    uploadTextFile = (...args: unknown[]) => uploadTextFileMock(...args);
  },
}));

vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => ({
    backend: { id: "local-1", kind: "local" },
    orgId: null,
  }),
}));

const prefillAndOpenMock = vi.fn();
vi.mock("#/components/features/dck/use-dck-conversations", () => ({
  useAllConversations: () => [],
  useOpenConversation: () => ({
    prefillAndOpen: prefillAndOpenMock,
    openPath: vi.fn(),
    createScoped: vi.fn(),
    isCreating: false,
  }),
}));

vi.mock("#/hooks/query/use-project-skills", () => ({
  useProjectSkills: () => ({
    skills: [
      { name: "web-generator", description: null, triggers: ["scaffold"], editable: true },
    ],
    editableSkills: [],
    publicSkills: [],
    isLoading: false,
    isError: false,
    isSaving: false,
    saveSkill: vi.fn(),
    refetch: vi.fn(),
  }),
}));

function customConfig() {
  return JSON.stringify({
    modules: [
      {
        id: "custom-email",
        name: "Email Campaigns",
        slug: "email",
        iconName: "mail",
        description: "Drip sequences",
        promptTemplate: "Draft an email campaign.",
        order: 0,
      },
    ],
  });
}

function renderManager(onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DckModuleManager onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
  downloadTextFileMock.mockReset();
  uploadTextFileMock.mockReset();
  uploadTextFileMock.mockResolvedValue({ success: true });
  prefillAndOpenMock.mockReset();
});

describe("DckModuleManager", () => {
  it("lists built-ins as read-only and custom modules with controls", async () => {
    downloadTextFileMock.mockResolvedValue(customConfig());
    renderManager();

    expect(
      await screen.findByTestId("dck-module-manager-row-webgen"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-module-builtin-badge-webgen"),
    ).toBeInTheDocument();
    // Built-ins expose no edit/delete controls.
    expect(screen.queryByTestId("dck-module-edit-webgen")).toBeNull();

    expect(
      await screen.findByTestId("dck-module-edit-custom-email"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-module-delete-custom-email"),
    ).toBeInTheDocument();
  });

  it("blocks saving a module with validation errors and does not write", async () => {
    downloadTextFileMock.mockRejectedValue(new Error("not found"));
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-module-add"));
    // Submit empty form → name/slug/prompt errors, no upload.
    await user.click(screen.getByTestId("dck-module-form-save"));

    expect(
      await screen.findByTestId("dck-module-form-name-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dck-module-form-slug-error")).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-module-form-prompt-error"),
    ).toBeInTheDocument();
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  it("rejects a slug that collides with a built-in module", async () => {
    downloadTextFileMock.mockRejectedValue(new Error("not found"));
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-module-add"));
    await user.type(screen.getByTestId("dck-module-form-name"), "Fake Webgen");
    await user.type(screen.getByTestId("dck-module-form-slug"), "webgen");
    await user.type(
      screen.getByTestId("dck-module-form-prompt"),
      "Do something",
    );
    await user.click(screen.getByTestId("dck-module-form-save"));

    expect(
      await screen.findByTestId("dck-module-form-slug-error"),
    ).toBeInTheDocument();
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  it("creates a valid custom module and writes the config", async () => {
    downloadTextFileMock.mockRejectedValue(new Error("not found"));
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-module-add"));
    await user.type(screen.getByTestId("dck-module-form-name"), "Reports");
    await user.type(screen.getByTestId("dck-module-form-slug"), "reports");
    await user.type(
      screen.getByTestId("dck-module-form-prompt"),
      "Write a weekly report.",
    );
    await user.click(screen.getByTestId("dck-module-form-save"));

    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalledTimes(1));
    const [text, dir, fileName] = uploadTextFileMock.mock.calls[0];
    expect(dir).toBe("/projects/.dck");
    expect(fileName).toBe("modules.json");
    expect(JSON.parse(text).modules[0]).toMatchObject({
      name: "Reports",
      slug: "reports",
    });
  });

  it("deletes only the definition when the folder option is unchecked", async () => {
    downloadTextFileMock.mockResolvedValue(customConfig());
    const user = userEvent.setup();
    renderManager();

    await user.click(
      await screen.findByTestId("dck-module-delete-custom-email"),
    );
    await user.click(screen.getByTestId("dck-module-delete-confirm-button"));

    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalledTimes(1));
    const [text] = uploadTextFileMock.mock.calls[0];
    expect(JSON.parse(text).modules).toEqual([]);
    expect(prefillAndOpenMock).not.toHaveBeenCalled();
  });

  it("deletes the definition and dispatches a folder-cleanup conversation when opted in", async () => {
    downloadTextFileMock.mockResolvedValue(customConfig());
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderManager(onClose);

    await user.click(
      await screen.findByTestId("dck-module-delete-custom-email"),
    );
    await user.click(screen.getByTestId("dck-module-delete-folder"));
    await user.click(screen.getByTestId("dck-module-delete-confirm-button"));

    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(prefillAndOpenMock).toHaveBeenCalledTimes(1));
    const [workingDir, , command] = prefillAndOpenMock.mock.calls[0];
    expect(workingDir).toBe("/projects");
    expect(command).toContain("rm -rf /projects/email");
    expect(onClose).toHaveBeenCalled();
  });
});
