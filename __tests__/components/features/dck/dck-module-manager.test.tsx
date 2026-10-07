import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";

import { DckModuleManager } from "#/components/features/dck/dck-module-manager";

const downloadTextFileMock = vi.fn();
const uploadTextFileMock = vi.fn();
const setAgentProfileForModuleMock = vi.fn();
const agentProfiles = [
  {
    id: "active-profile",
    name: "Default Agent",
    agent_kind: "openhands",
    revision: 1,
    llm_profile_ref: "gpt",
    mcp_server_refs: null,
  },
  {
    id: "research-profile",
    name: "Research Agent",
    agent_kind: "openhands",
    revision: 1,
    llm_profile_ref: "gpt",
    mcp_server_refs: null,
  },
] as AgentProfileSummary[];

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
      {
        name: "web-generator",
        description: null,
        triggers: ["scaffold"],
        editable: true,
      },
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

function renderManager(
  onClose = vi.fn(),
  profileAssignments: Record<string, string | null> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DckModuleManager
        onClose={onClose}
        profiles={agentProfiles}
        activeAgentProfileId="active-profile"
        profileAssignments={profileAssignments}
        isCheckingAgentProfiles={false}
        setAgentProfileForModule={setAgentProfileForModuleMock}
      />
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
  setAgentProfileForModuleMock.mockReset();
});

describe("DckModuleManager", () => {
  it("shows built-ins as editable and custom modules with management controls", async () => {
    downloadTextFileMock.mockResolvedValue(customConfig());
    renderManager();

    expect(
      await screen.findByTestId("dck-module-manager-row-webgen"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-module-builtin-badge-webgen"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dck-module-edit-webgen")).toBeInTheDocument();
    expect(screen.queryByTestId("dck-module-delete-webgen")).toBeNull();

    expect(
      await screen.findByTestId("dck-module-edit-custom-email"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-module-delete-custom-email"),
    ).toBeInTheDocument();
  });

  it("edits a built-in without changing its stable folder or custom modules", async () => {
    downloadTextFileMock.mockResolvedValue(customConfig());
    uploadTextFileMock.mockImplementation(async (text: string) => {
      downloadTextFileMock.mockResolvedValue(text);
      return { success: true };
    });
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-module-edit-webgen"));
    const slug = screen.getByTestId("dck-module-form-slug");
    expect(slug).toHaveAttribute("readonly");
    expect(slug).toHaveValue("webgen");

    const name = screen.getByTestId("dck-module-form-name");
    await user.clear(name);
    await user.type(name, "Site Studio");
    const prompt = screen.getByTestId("dck-module-form-prompt");
    await user.clear(prompt);
    await user.type(prompt, "Scaffold a marketing website.");
    await user.click(screen.getByTestId("dck-module-form-save"));

    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalledTimes(1));
    const [text] = uploadTextFileMock.mock.calls[0];
    expect(JSON.parse(text)).toMatchObject({
      modules: [{ id: "custom-email", slug: "email" }],
      builtinOverrides: [
        {
          id: "webgen",
          name: "Site Studio",
          promptTemplate: "Scaffold a marketing website.",
        },
      ],
    });
    expect(JSON.parse(text).builtinOverrides[0]).not.toHaveProperty("slug");
    expect(await screen.findByText("Site Studio")).toBeInTheDocument();
  });

  it("edits an existing custom module while keeping its folder stable", async () => {
    downloadTextFileMock.mockResolvedValue(customConfig());
    uploadTextFileMock.mockImplementation(async (text: string) => {
      downloadTextFileMock.mockResolvedValue(text);
      return { success: true };
    });
    const user = userEvent.setup();
    renderManager(vi.fn(), { "custom-email": "research-profile" });

    await user.click(await screen.findByTestId("dck-module-edit-custom-email"));
    const profileSelector = screen.getByTestId(
      "dck-module-agent-profile-selector-custom-email",
    ) as HTMLSelectElement;
    expect(profileSelector).toHaveValue("research-profile");
    await user.selectOptions(profileSelector, profileSelector.options[0].value);
    expect(setAgentProfileForModuleMock).not.toHaveBeenCalled();

    const slug = screen.getByTestId("dck-module-form-slug");
    expect(slug).toHaveAttribute("readonly");
    expect(slug).toHaveValue("email");

    const name = screen.getByTestId("dck-module-form-name");
    await user.clear(name);
    await user.type(name, "Lifecycle Campaigns");
    await user.click(screen.getByTestId("dck-module-form-save"));

    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalledTimes(1));
    const [text] = uploadTextFileMock.mock.calls[0];
    expect(JSON.parse(text).modules[0]).toMatchObject({
      id: "custom-email",
      name: "Lifecycle Campaigns",
      slug: "email",
    });
    expect(JSON.parse(text).builtinOverrides).toEqual([]);
    expect(setAgentProfileForModuleMock).toHaveBeenCalledWith(
      "custom-email",
      null,
    );
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
    expect(
      screen.getByTestId("dck-module-form-slug-error"),
    ).toBeInTheDocument();
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
    expect(setAgentProfileForModuleMock).not.toHaveBeenCalled();
  });

  it("commits a new module's profile preference only after saving with its stable ID", async () => {
    downloadTextFileMock.mockRejectedValue(new Error("not found"));
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-module-add"));
    const profileSelector = screen.getByTestId(
      /dck-module-agent-profile-selector-/,
    ) as HTMLSelectElement;
    const selectorId = profileSelector.getAttribute("data-testid") ?? "";
    const moduleId = selectorId.replace(
      "dck-module-agent-profile-selector-",
      "",
    );
    expect(moduleId).not.toBe("");
    await user.selectOptions(profileSelector, "research-profile");
    expect(setAgentProfileForModuleMock).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("dck-module-form-name"), "Reports");
    await user.type(screen.getByTestId("dck-module-form-slug"), "reports");
    await user.type(
      screen.getByTestId("dck-module-form-prompt"),
      "Write a weekly report.",
    );
    await user.click(screen.getByTestId("dck-module-form-save"));

    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(setAgentProfileForModuleMock).toHaveBeenCalledWith(
        moduleId,
        "research-profile",
      ),
    );
    const [text] = uploadTextFileMock.mock.calls[0];
    const savedModule = JSON.parse(text).modules[0];
    expect(savedModule).toMatchObject({ id: moduleId, slug: "reports" });
    expect(savedModule).not.toHaveProperty("agentProfileId");
  });

  it("does not commit a selected profile when a new module form is cancelled", async () => {
    downloadTextFileMock.mockRejectedValue(new Error("not found"));
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-module-add"));
    await user.selectOptions(
      screen.getByTestId(/dck-module-agent-profile-selector-/),
      "research-profile",
    );
    await user.click(screen.getByTestId("dck-module-form-cancel"));

    expect(setAgentProfileForModuleMock).not.toHaveBeenCalled();
    expect(uploadTextFileMock).not.toHaveBeenCalled();
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
