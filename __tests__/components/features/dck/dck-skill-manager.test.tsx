import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DckSkillManager } from "#/components/features/dck/dck-skill-manager";

const getSkillsMock = vi.fn();
const downloadTextFileMock = vi.fn();
const uploadTextFileMock = vi.fn();

vi.mock("#/api/skills-service", () => ({
  default: {
    getSkills: (...args: unknown[]) => getSkillsMock(...args),
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
  prefillAndOpenMock.mockReset();
  uploadTextFileMock.mockResolvedValue({ success: true });
  getSkillsMock.mockResolvedValue([
    { name: "my-skill", source: "user", description: "Mine", triggers: ["mine"] },
    { name: "docker", source: "public", description: "Public", triggers: [] },
  ]);
});

describe("DckSkillManager", () => {
  it("lists project skills as editable and public skills as read-only", async () => {
    renderManager();

    expect(
      await screen.findByTestId("dck-skill-edit-my-skill"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dck-skill-delete-my-skill")).toBeInTheDocument();
    expect(screen.getByTestId("dck-skill-public-badge-docker")).toBeInTheDocument();
    expect(screen.queryByTestId("dck-skill-edit-docker")).toBeNull();
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
    await user.type(screen.getByTestId("dck-skill-form-triggers"), "seo, audit");
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

  it("deletes a project skill by dispatching a folder-cleanup conversation", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderManager(onClose);

    await user.click(await screen.findByTestId("dck-skill-delete-my-skill"));
    await user.click(screen.getByTestId("dck-skill-delete-confirm-button"));

    await waitFor(() => expect(prefillAndOpenMock).toHaveBeenCalledTimes(1));
    const [workingDir, , command] = prefillAndOpenMock.mock.calls[0];
    expect(workingDir).toBe("/projects");
    expect(command).toContain("rm -rf /projects/.agents/skills/my-skill");
    expect(onClose).toHaveBeenCalled();
  });
});
