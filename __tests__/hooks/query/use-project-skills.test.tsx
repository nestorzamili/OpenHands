import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import SkillsService from "#/api/skills-service";
import {
  deleteSkillFile,
  readSkillFile,
  useProjectSkills,
  writeProjectSkill,
  writeSkillFile,
} from "#/hooks/query/use-project-skills";
import type { SkillInfo } from "#/types/settings";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  upload: vi.fn(),
  execute: vi.fn(),
  close: vi.fn(),
  home: vi.fn(),
  workingDirectory: vi.fn(),
}));

vi.mock("@openhands/typescript-client/clients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@openhands/typescript-client/clients")
  >()),
  FileClient: class {
    downloadTextFile = mocks.download;
    uploadTextFile = mocks.upload;
  },
  BashClient: class {
    executeCommand = mocks.execute;
    close = mocks.close;
  },
}));

vi.mock("#/api/agent-server-home", () => ({
  getAgentServerHomeDir: mocks.home,
  resolveAbsoluteAgentServerPath: mocks.workingDirectory,
}));

const backend = {
  id: "local-skills",
  name: "Local",
  host: "http://localhost:8000",
  apiKey: "test-key",
  kind: "local" as const,
  connectionRevision: 1,
};

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ActiveBackendProvider>{children}</ActiveBackendProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "/projects");
  __resetActiveStoreForTests();
  setRegisteredBackends([backend]);
  setActiveSelection({ backendId: backend.id, orgId: null });
  mocks.home.mockReset().mockResolvedValue("/home/agent");
  mocks.workingDirectory.mockReset().mockResolvedValue("/work/current");
  mocks.download
    .mockReset()
    .mockResolvedValue("---\nname: helper\n---\nRaw source\n");
  mocks.upload.mockReset().mockResolvedValue({ success: true });
  mocks.execute.mockReset().mockResolvedValue({ exit_code: 0, stderr: "" });
});

describe("Skills file scope boundaries", () => {
  it("deletes only the selected supported skill directory and closes its client", async () => {
    await deleteSkillFile("/projects/.agents/skills/helper/SKILL.md");

    expect(mocks.execute).toHaveBeenCalledWith(
      "rm -rf -- '/projects/.agents/skills/helper'",
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("rejects direct custom file operations on Cloud", async () => {
    setRegisteredBackends([
      { ...backend, host: "https://app.example.com", kind: "cloud" },
    ]);
    setActiveSelection({ backendId: backend.id, orgId: null });
    const path = "/projects/.agents/skills/helper/SKILL.md";

    await expect(readSkillFile(path)).rejects.toThrow("Unsupported");
    await expect(writeSkillFile(path, "source")).rejects.toThrow("Unsupported");
    await expect(deleteSkillFile(path)).rejects.toThrow("Unsupported");

    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([
    "/projects/research/.agents/skills/helper/SKILL.md",
    "/home/agent/.openhands/skills/helper/SKILL.md",
    "/work/current/.agents/skills/helper/SKILL.md",
  ])("allows raw saves within a configured root: %s", async (path) => {
    const source =
      "---\r\nname: helper\nunknown: preserved\r\n---\nInstructions  \n";

    await writeSkillFile(path, source);

    expect(mocks.upload).toHaveBeenCalledWith(
      source,
      path.slice(0, path.lastIndexOf("/")),
      "SKILL.md",
    );
  });

  it.each([
    "/unrelated/.agents/skills/helper/SKILL.md",
    "/projects-other/.agents/skills/helper/SKILL.md",
    "/projects/../outside/.agents/skills/helper/SKILL.md",
    ".agents/skills/helper/SKILL.md",
    "https://example.com/.agents/skills/helper/SKILL.md",
  ])(
    "rejects untrusted read, write and delete targets without I/O: %s",
    async (path) => {
      await expect(readSkillFile(path)).rejects.toThrow("Unsupported");
      await expect(writeSkillFile(path, "content")).rejects.toThrow(
        "Unsupported",
      );
      await expect(deleteSkillFile(path)).rejects.toThrow("Unsupported");

      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it("permits DCK files but not personal files when home resolution fails", async () => {
    mocks.home.mockRejectedValue(new Error("Home unavailable"));
    mocks.workingDirectory.mockRejectedValue(
      new Error("Working directory unavailable"),
    );

    await writeSkillFile(
      "/projects/.agents/skills/helper/SKILL.md",
      "DCK source",
    );
    await expect(
      writeSkillFile(
        "/home/agent/.agents/skills/helper/SKILL.md",
        "Personal source",
      ),
    ).rejects.toThrow("Unsupported");

    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("rejects a backend connection change during root discovery", async () => {
    mocks.home.mockImplementationOnce(async () => {
      setRegisteredBackends([
        { ...backend, host: "http://localhost:9000", connectionRevision: 2 },
      ]);
      return "/home/agent";
    });

    await expect(
      writeSkillFile("/projects/.agents/skills/helper/SKILL.md", "source"),
    ).rejects.toThrow("Unsupported");

    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("keeps out-of-root skills visible but disables both destructive controls", async () => {
    vi.spyOn(SkillsService, "getSettingsSkills").mockResolvedValue([
      {
        name: "outside",
        type: "knowledge",
        source: "/unrelated/.agents/skills/outside/SKILL.md",
        triggers: [],
      } as SkillInfo,
    ]);

    const { result } = renderHook(() => useProjectSkills(), { wrapper });
    await waitFor(() => expect(result.current.skills).toHaveLength(1));

    expect(result.current.skills[0]).toMatchObject({
      name: "outside",
      editable: false,
      deletable: false,
      filePath: null,
    });
  });

  it("rejects a traversal slug at the create boundary before any filesystem I/O", async () => {
    await expect(
      writeProjectSkill("../outside", {
        name: "outside",
        description: "",
        triggers: [],
        body: "Instructions",
      }),
    ).rejects.toThrow("Unsupported");

    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each([
    ["seo-audit", "SEO Audit"],
    ["seo-audit", "other-name"],
    ["seo--audit", "seo--audit"],
    ["a".repeat(65), "a".repeat(65)],
  ])(
    "rejects a native-incompatible create for %s / %s before filesystem I/O",
    async (slug, name) => {
      await expect(
        writeProjectSkill(slug, {
          name,
          description: "Guide",
          triggers: [],
          body: "Instructions",
        }),
      ).rejects.toThrow("Unsupported");
      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.upload).not.toHaveBeenCalled();
    },
  );
});
