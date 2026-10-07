import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DckSkillManager } from "#/components/features/dck/dck-skill-manager";

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

function renderManager(onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DckSkillManager onClose={onClose} />
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
    throw new Error("Skill file not found");
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
  it("keeps origin separate from scope and exposes delete only for custom skills", async () => {
    renderManager();

    expect(
      await screen.findByTestId("dck-skill-select-my-skill"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dck-skill-delete-my-skill")).toBeInTheDocument();
    expect(screen.getByTestId("dck-skill-scope-my-skill")).toHaveTextContent(
      "DCK$SKILL_PROJECT_BADGE",
    );
    expect(
      screen.getByTestId("dck-skill-custom-badge-my-skill"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("dck-skill-select-personal-skill"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-skill-scope-personal-skill"),
    ).toHaveTextContent("DCK$SKILL_PERSONAL_BADGE");
    expect(
      screen.getByTestId("dck-skill-custom-badge-personal-skill"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-skill-delete-personal-skill"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dck-skill-public-badge-docker"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("dck-skill-delete-docker")).toBeNull();
  });

  it("opens a built-in skill as preview only", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-skill-select-docker"));

    expect(
      await screen.findByTestId("dck-skill-preview-panel"),
    ).toHaveTextContent("Docker instructions");
    expect(screen.queryByTestId("dck-skill-tab-editor")).toBeNull();
    expect(screen.queryByTestId("dck-skill-delete-docker")).toBeNull();
  });

  it("previews a custom skill, then edits and saves only when it is dirty", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-skill-select-my-skill"));
    expect(
      await screen.findByTestId("dck-skill-preview-panel"),
    ).toHaveTextContent("Original instructions");
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
    renderManager();

    await user.click(
      await screen.findByTestId("dck-skill-select-personal-skill"),
    );
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

  it("asks before discarding unsaved source when switching skills", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-skill-select-my-skill"));
    await user.click(screen.getByTestId("dck-skill-tab-editor"));
    const textarea = await screen.findByTestId("dck-skill-source-textarea");
    fireEvent.change(textarea, {
      target: { value: `${projectSkillSource}\nUnsaved change` },
    });

    await user.click(screen.getByTestId("dck-skill-select-docker"));
    expect(
      await screen.findByTestId("dck-skill-discard-confirm"),
    ).toBeVisible();
    expect(screen.getByTestId("dck-skill-select-my-skill")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByTestId("dck-skill-discard-cancel"));
    expect(screen.queryByTestId("dck-skill-discard-confirm")).toBeNull();
    expect(screen.getByTestId("dck-skill-select-my-skill")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByTestId("dck-skill-select-docker"));
    await user.click(screen.getByTestId("dck-skill-discard-confirm-button"));
    expect(
      await screen.findByTestId("dck-skill-preview-panel"),
    ).toHaveTextContent("Docker instructions");
    expect(screen.queryByTestId("dck-skill-source-textarea")).toBeNull();
  });

  it("blocks saving an invalid skill and does not write", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(await screen.findByTestId("dck-skill-add"));
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

    await user.click(await screen.findByTestId("dck-skill-add"));
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

    await user.click(await screen.findByTestId("dck-skill-add"));
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

  it("deletes a project custom skill only after showing its exact folder", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderManager(onClose);

    await user.click(await screen.findByTestId("dck-skill-delete-my-skill"));
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
    expect(onClose).not.toHaveBeenCalled();
  });

  it("deletes personal custom skills from their personal path", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(
      await screen.findByTestId("dck-skill-delete-personal-skill"),
    );
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
