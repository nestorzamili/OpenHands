import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomSkillAuthoring } from "#/components/features/skills/custom-skill-authoring";

const getSkillsMock = vi.fn();
const downloadTextFileMock = vi.fn();
const uploadTextFileMock = vi.fn();
const executeCommandMock = vi.fn();
const closeBashClientMock = vi.fn();
const projectSkillSource = [
  "---",
  "name: my-skill",
  "description: |",
  "  first line",
  "  second line",
  "custom_metadata:",
  "  provider: dck",
  "---",
  "# Original instructions",
  "",
  "Keep trailing spaces.  ",
  "",
].join("\n");
const personalSkillSource = [
  "---",
  "name: personal-skill",
  "description: |",
  "  Personal line one",
  "  Personal line two",
  "extra_field: preserved",
  "---",
  "# Personal instructions",
  "",
].join("\r\n");

vi.mock("#/api/skills-service", () => ({
  default: {
    getSkills: (...args: unknown[]) => getSkillsMock(...args),
    getSettingsSkills: (...args: unknown[]) => getSkillsMock(...args),
  },
}));

vi.mock("@openhands/typescript-client/clients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@openhands/typescript-client/clients")
  >()),
  FileClient: class {
    downloadTextFile = (...args: unknown[]) => downloadTextFileMock(...args);
    uploadTextFile = (...args: unknown[]) => uploadTextFileMock(...args);
  },
  BashClient: class {
    executeCommand = (...args: unknown[]) => executeCommandMock(...args);
    close = (...args: unknown[]) => closeBashClientMock(...args);
  },
}));

vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => ({
    backend: { id: "local-1", kind: "local" },
    orgId: null,
  }),
}));

vi.mock("#/api/agent-server-home", () => ({
  getAgentServerHomeDir: async () => "/home/agent",
  resolveAbsoluteAgentServerPath: async (path: string) =>
    path.startsWith("/") ? path : `/home/agent/${path}`,
}));

function renderManager(
  selectedSkill?: { name: string; source: string | null },
  onClose = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CustomSkillAuthoring onClose={onClose} selectedSkill={selectedSkill} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
  getSkillsMock.mockReset();
  downloadTextFileMock.mockReset();
  uploadTextFileMock.mockReset();
  executeCommandMock.mockReset();
  closeBashClientMock.mockReset();
  uploadTextFileMock.mockResolvedValue({ success: true });
  executeCommandMock.mockResolvedValue({ exit_code: 0, stderr: "" });
  downloadTextFileMock.mockImplementation(async (path: string) => {
    if (path === "/projects/.agents/skills/my-skill/SKILL.md") {
      return projectSkillSource;
    }
    if (path === "/home/agent/.agents/skills/personal-skill/SKILL.md") {
      return personalSkillSource;
    }
    throw Object.assign(new Error("Skill file not found"), {
      name: "HttpError",
      status: 404,
    });
  });
  getSkillsMock.mockResolvedValue([
    {
      name: "my-skill",
      source: "/projects/.agents/skills/my-skill/SKILL.md",
      description: "Mine",
      triggers: ["mine"],
    },
    {
      name: "personal-skill",
      source: "user",
      description: "Private",
      triggers: [],
    },
    {
      name: "docker",
      source: "public",
      description: "Public",
      content: "# Docker instructions\n\nUse a container.",
      triggers: [],
    },
  ]);
});

describe("DckSkillManager", () => {
  it("opens creation directly without rendering a parallel skill catalog", () => {
    renderManager();
    expect(screen.getByTestId("dck-skill-form")).toBeInTheDocument();
    expect(screen.queryByTestId("dck-skill-select-my-skill")).toBeNull();
    expect(screen.queryByTestId("dck-skill-row-my-skill")).toBeNull();
  });

  it("opens a selected custom skill without rendering a parallel catalog", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <CustomSkillAuthoring
          onClose={vi.fn()}
          selectedSkill={{
            name: "my-skill",
            source: "/projects/.agents/skills/my-skill/SKILL.md",
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("dck-skill-preview-panel")).toHaveTextContent(
        "Original instructions",
      ),
    );
    expect(screen.queryByTestId("dck-skill-select-my-skill")).toBeNull();
    expect(screen.getByTestId("dck-skill-tab-editor")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId("dck-skill-tab-editor"));
    expect(await screen.findByTestId("dck-skill-source-textarea")).toHaveValue(
      projectSkillSource,
    );
  });

  it("does not resolve a same-name skill from a different source", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <CustomSkillAuthoring
          onClose={vi.fn()}
          selectedSkill={{ name: "my-skill", source: "user" }}
        />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByTestId("dck-skill-unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("dck-skill-source-textarea")).toBeNull();
  });

  it("previews a custom skill, then edits and saves only when it is dirty", async () => {
    const user = userEvent.setup();
    renderManager({
      name: "my-skill",
      source: "/projects/.agents/skills/my-skill/SKILL.md",
    });
    await waitFor(() =>
      expect(screen.getByTestId("dck-skill-preview-panel")).toHaveTextContent(
        "Original instructions",
      ),
    );
    await user.click(screen.getByTestId("dck-skill-tab-editor"));
    expect(
      await screen.findByTestId("dck-skill-source-path"),
    ).toHaveTextContent("/projects/.agents/skills/my-skill/SKILL.md");
    expect(screen.getByTestId("dck-skill-source-textarea")).toHaveValue(
      projectSkillSource,
    );
    expect(screen.getByTestId("dck-skill-editor-save")).toBeDisabled();

    const editedSource = projectSkillSource.replace(
      "Keep trailing spaces.  ",
      "Edited body, trailing spaces kept.  ",
    );
    fireEvent.change(screen.getByTestId("dck-skill-source-textarea"), {
      target: { value: editedSource },
    });
    expect(screen.getByTestId("dck-skill-editor-save")).toBeEnabled();
    await user.click(screen.getByTestId("dck-skill-editor-save"));
    await waitFor(() =>
      expect(uploadTextFileMock).toHaveBeenCalledWith(
        editedSource,
        "/projects/.agents/skills/my-skill",
        "SKILL.md",
      ),
    );
  });

  it("saves a personal skill back to its personal source path", async () => {
    const user = userEvent.setup();
    renderManager({ name: "personal-skill", source: "user" });
    await screen.findByTestId("dck-skill-tab-editor");
    await user.click(screen.getByTestId("dck-skill-tab-editor"));
    expect(
      await screen.findByTestId("dck-skill-source-path"),
    ).toHaveTextContent("/home/agent/.agents/skills/personal-skill/SKILL.md");
    const editedSource = personalSkillSource.replace(
      "Personal instructions",
      "Updated personal instructions",
    );
    fireEvent.change(screen.getByTestId("dck-skill-source-textarea"), {
      target: { value: editedSource },
    });
    expect(screen.getByTestId("dck-skill-editor-save")).toBeEnabled();
    await user.click(screen.getByTestId("dck-skill-editor-save"));

    await waitFor(() =>
      expect(uploadTextFileMock).toHaveBeenCalledWith(
        editedSource,
        "/home/agent/.agents/skills/personal-skill",
        "SKILL.md",
      ),
    );
  });

  it("closes after discarding edits without opening delete confirmation", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderManager(
      {
        name: "my-skill",
        source: "/projects/.agents/skills/my-skill/SKILL.md",
      },
      onClose,
    );
    await user.click(await screen.findByTestId("dck-skill-tab-editor"));
    const editor = await screen.findByTestId("dck-skill-source-textarea");
    fireEvent.change(editor, {
      target: { value: `${projectSkillSource}changed` },
    });
    await user.click(screen.getByTestId("dck-skill-manager-close"));
    await user.click(screen.getByTestId("dck-skill-discard-confirm-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dck-skill-delete-confirm")).toBeNull();
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it("keeps edits made during a pending save dirty and preserves mixed line endings", async () => {
    let resolveUpload!: (value: { success: true }) => void;
    uploadTextFileMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const mixedSource = personalSkillSource.replace(
      "  Personal line two\r\n",
      "  Personal line two\n",
    );
    const originalDownload = downloadTextFileMock.getMockImplementation()!;
    downloadTextFileMock.mockImplementation(async (path: string) =>
      path === "/home/agent/.agents/skills/personal-skill/SKILL.md"
        ? mixedSource
        : originalDownload(path),
    );
    const user = userEvent.setup();
    renderManager({ name: "personal-skill", source: "user" });
    await user.click(await screen.findByTestId("dck-skill-tab-editor"));
    const editor = await screen.findByTestId("dck-skill-source-textarea");
    const firstEdit = mixedSource.replace(
      "Personal line one",
      "Edited line one",
    );
    fireEvent.change(editor, { target: { value: firstEdit } });
    await user.click(screen.getByTestId("dck-skill-editor-save"));
    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalledTimes(1));
    const secondEdit = firstEdit.replace(
      "Personal instructions",
      "Edited instructions",
    );
    fireEvent.change(editor, { target: { value: secondEdit } });
    resolveUpload({ success: true });
    await waitFor(() =>
      expect(screen.getByTestId("dck-skill-manager-close")).toBeEnabled(),
    );
    expect(editor).toHaveValue(secondEdit.replace(/\r\n/g, "\n"));
    expect(screen.getByTestId("dck-skill-editor-save")).toBeEnabled();
    expect(uploadTextFileMock).toHaveBeenNthCalledWith(
      1,
      firstEdit,
      "/home/agent/.agents/skills/personal-skill",
      "SKILL.md",
    );
    await user.click(screen.getByTestId("dck-skill-editor-save"));
    await waitFor(() =>
      expect(uploadTextFileMock).toHaveBeenNthCalledWith(
        2,
        secondEdit,
        "/home/agent/.agents/skills/personal-skill",
        "SKILL.md",
      ),
    );
  });

  it("retains selection by file path after a source edit renames the skill", async () => {
    const user = userEvent.setup();
    const path = "/projects/.agents/skills/my-skill/SKILL.md";
    renderManager({ name: "my-skill", source: path });
    await user.click(await screen.findByTestId("dck-skill-tab-editor"));
    const editor = await screen.findByTestId("dck-skill-source-textarea");
    const renamed = projectSkillSource.replace(
      "name: my-skill",
      "name: renamed skill",
    );
    uploadTextFileMock.mockImplementationOnce(async () => {
      getSkillsMock.mockResolvedValue([
        { name: "renamed skill", source: path, content: renamed },
      ]);
      downloadTextFileMock.mockResolvedValue(renamed);
      return { success: true };
    });
    fireEvent.change(editor, { target: { value: renamed } });
    await user.click(screen.getByTestId("dck-skill-editor-save"));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "renamed skill" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("dck-skill-unavailable")).toBeNull();
    expect(screen.getByTestId("dck-skill-source-textarea")).toBe(editor);
    expect(editor).toHaveValue(renamed);
  });

  it("blocks saving an invalid skill and does not write", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId("dck-skill-form-save"));

    expect(
      await screen.findByTestId("dck-skill-form-name-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dck-skill-form-slug-error")).toBeInTheDocument();
    expect(screen.getByTestId("dck-skill-form-body-error")).toBeInTheDocument();
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  it("rejects a name that shadows a public skill", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.type(screen.getByTestId("dck-skill-form-name"), "docker");
    await user.type(screen.getByTestId("dck-skill-form-slug"), "my-docker");
    await user.type(screen.getByTestId("dck-skill-form-body"), "Instructions");
    await user.click(screen.getByTestId("dck-skill-form-save"));

    expect(
      await screen.findByTestId("dck-skill-form-name-error"),
    ).toBeInTheDocument();
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  it("creates a valid skill and writes SKILL.md under .agents/skills", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.type(screen.getByTestId("dck-skill-form-name"), "SEO Audit");
    await user.type(screen.getByTestId("dck-skill-form-slug"), "seo-audit");
    await user.type(
      screen.getByTestId("dck-skill-form-triggers"),
      "seo, audit",
    );
    await user.type(
      screen.getByTestId("dck-skill-form-body"),
      "Audit the site for SEO issues.",
    );
    await user.click(screen.getByTestId("dck-skill-form-save"));

    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalledTimes(1));
    const [text, dir, fileName] = uploadTextFileMock.mock.calls[0];
    expect(dir).toBe("/projects/.agents/skills/seo-audit");
    expect(fileName).toBe("SKILL.md");
    expect(text).toContain("name: SEO Audit");
    expect(text).toContain("- seo");
    expect(text).toContain("Audit the site for SEO issues.");
  });

  it("rejects an existing storage slug even when its display name differs", async () => {
    getSkillsMock.mockResolvedValue([
      {
        name: "Copy writer",
        source: "/projects/.agents/skills/copy/SKILL.md",
        description: "Write copy",
        triggers: [],
      },
    ]);
    downloadTextFileMock.mockResolvedValue(
      "---\nname: Copy writer\ndescription: Write copy\n---\nInstructions",
    );
    const user = userEvent.setup();
    renderManager();
    await user.type(screen.getByTestId("dck-skill-form-name"), "New writer");
    await user.type(screen.getByTestId("dck-skill-form-slug"), "copy");
    await user.type(
      screen.getByTestId("dck-skill-form-body"),
      "New instructions",
    );
    await user.click(screen.getByTestId("dck-skill-form-save"));
    expect(
      await screen.findByTestId("dck-skill-form-slug-error"),
    ).toBeInTheDocument();
    expect(uploadTextFileMock).not.toHaveBeenCalled();
  });

  it("deletes a project custom skill only after showing its exact folder", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderManager(
      {
        name: "my-skill",
        source: "/projects/.agents/skills/my-skill/SKILL.md",
      },
      onClose,
    );

    await user.click(await screen.findByTestId("dck-skill-selected-delete"));
    expect(screen.getByTestId("dck-skill-delete-path")).toHaveTextContent(
      "/projects/.agents/skills/my-skill",
    );
    expect(executeCommandMock).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("dck-skill-delete-confirm-button"));

    await waitFor(() =>
      expect(executeCommandMock).toHaveBeenCalledWith(
        "rm -rf -- '/projects/.agents/skills/my-skill'",
      ),
    );
    expect(closeBashClientMock).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("deletes personal custom skills from their personal path", async () => {
    const user = userEvent.setup();
    renderManager({ name: "personal-skill", source: "user" });

    await user.click(await screen.findByTestId("dck-skill-selected-delete"));
    expect(screen.getByTestId("dck-skill-delete-path")).toHaveTextContent(
      "/home/agent/.agents/skills/personal-skill",
    );
    await user.click(screen.getByTestId("dck-skill-delete-confirm-button"));

    await waitFor(() =>
      expect(executeCommandMock).toHaveBeenCalledWith(
        "rm -rf -- '/home/agent/.agents/skills/personal-skill'",
      ),
    );
  });
});
