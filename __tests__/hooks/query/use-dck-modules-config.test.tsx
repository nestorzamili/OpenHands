import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDckModulesConfig } from "#/hooks/query/use-dck-modules-config";
import { getDckModuleAgentProfileScopeKey } from "#/dck/module-config";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";

const mockSettingsApi = vi.hoisted(() => ({
  value: {
    dck_module_agent_profile_assignments: {} as Record<
      string,
      Record<string, string | null>
    >,
  },
  save: vi.fn(),
}));

vi.mock("#/api/settings-service/settings-service.api", () => ({
  default: {
    getSettings: vi.fn(async () => mockSettingsApi.value),
    saveSettings: vi.fn(async (next: Record<string, unknown>) => {
      mockSettingsApi.save(next);
      mockSettingsApi.value = { ...mockSettingsApi.value, ...next };
      return true;
    }),
  },
}));

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

const useActiveBackendMock = vi.fn();
vi.mock("#/contexts/active-backend-context", () => ({
  useActiveBackend: () => useActiveBackendMock(),
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function configJson(
  modules: { id: string; name: string; slug: string }[],
  agentProfileAssignments: Record<string, string | null> = {},
): string {
  return JSON.stringify({
    modules: modules.map((m, index) => ({
      ...m,
      iconName: "mail",
      description: "",
      promptTemplate: "Do the thing.",
      order: index,
    })),
    agentProfileAssignments,
  });
}

describe("useDckModulesConfig", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
    mockSettingsApi.value = { dck_module_agent_profile_assignments: {} };
    mockSettingsApi.save.mockReset();
    downloadTextFileMock.mockReset();
    uploadTextFileMock.mockReset();
    uploadTextFileMock.mockResolvedValue({ success: true });
    useActiveBackendMock.mockReset();
    useActiveBackendMock.mockReturnValue({
      backend: { id: "local-1", kind: "local" },
      orgId: null,
    });
    __resetActiveStoreForTests();
    setRegisteredBackends([
      {
        id: "local-1",
        name: "Local",
        host: "http://localhost:3000",
        apiKey: "test-key",
        kind: "local",
      },
    ]);
    setActiveSelection({ backendId: "local-1", orgId: null });
  });

  afterEach(() => {
    __resetActiveStoreForTests();
  });

  it("returns an empty list when the config file is missing", async () => {
    downloadTextFileMock.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.modules).toEqual([]);
    expect(downloadTextFileMock).toHaveBeenCalledWith(
      "/projects/.dck/modules.json",
    );
  });

  it("reads and parses existing custom modules", async () => {
    downloadTextFileMock.mockResolvedValue(
      configJson([{ id: "custom-1", name: "Email", slug: "email" }]),
    );

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.modules).toHaveLength(1));
    expect(result.current.modules[0]).toMatchObject({
      id: "custom-1",
      slug: "email",
    });
  });

  it("upserts a new module and writes the serialized config to the .dck dir", async () => {
    downloadTextFileMock.mockResolvedValue(configJson([]));

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.upsert({
        id: "custom-9",
        name: "Reports",
        slug: "reports",
        iconName: "mail",
        description: "",
        promptTemplate: "Write a report.",
        skillNames: [],
        order: 0,
      });
    });

    expect(uploadTextFileMock).toHaveBeenCalledTimes(1);
    const [text, dir, fileName] = uploadTextFileMock.mock.calls[0];
    expect(dir).toBe("/projects/.dck");
    expect(fileName).toBe("modules.json");
    expect(JSON.parse(text).modules[0]).toMatchObject({
      id: "custom-9",
      slug: "reports",
      order: 0,
    });
  });

  it("persists a module profile selection in scoped server settings", async () => {
    downloadTextFileMock.mockResolvedValue(configJson([]));

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.upsert(
        {
          id: "custom-9",
          name: "Reports",
          slug: "reports",
          iconName: "mail",
          description: "",
          promptTemplate: "Write a report.",
          skillNames: [],
          order: 0,
        },
        "deleted-profile",
      );
    });

    expect(uploadTextFileMock).toHaveBeenCalledTimes(1);
    const [text] = uploadTextFileMock.mock.calls[0];
    expect(JSON.parse(text)).toMatchObject({
      modules: [{ id: "custom-9", slug: "reports" }],
    });
    expect(JSON.parse(text)).not.toHaveProperty("agentProfileAssignments");
    const scopeKey = getDckModuleAgentProfileScopeKey(null, "/projects");
    expect(
      mockSettingsApi.value.dck_module_agent_profile_assignments[scopeKey],
    ).toEqual({ "custom-9": "deleted-profile" });
    expect(mockSettingsApi.save).toHaveBeenCalledWith({
      dck_module_agent_profile_assignments: {
        [scopeKey]: { "custom-9": "deleted-profile" },
      },
    });
  });

  it("migrates legacy workspace assignments into settings without replacing stale profile IDs", async () => {
    downloadTextFileMock.mockResolvedValue(
      configJson([], { research: "deleted-profile" }),
    );

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });

    const scopeKey = getDckModuleAgentProfileScopeKey(null, "/projects");
    await waitFor(() =>
      expect(
        mockSettingsApi.value.dck_module_agent_profile_assignments[scopeKey],
      ).toEqual({ research: "deleted-profile" }),
    );
    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalled());
    expect(result.current.agentProfileAssignments).toEqual({
      research: "deleted-profile",
    });
    expect(uploadTextFileMock).toHaveBeenCalled();
    const [text] = uploadTextFileMock.mock.calls.at(-1)!;
    expect(JSON.parse(text)).not.toHaveProperty("agentProfileAssignments");
  });

  it("persists only changed built-in fields and preserves custom modules", async () => {
    downloadTextFileMock.mockResolvedValue(
      JSON.stringify({
        ...JSON.parse(
          configJson([{ id: "custom-1", name: "Email", slug: "email" }]),
        ),
        builtinOverrides: [],
      }),
    );

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.modules).toHaveLength(1));

    await act(async () => {
      await result.current.upsertBuiltinOverride("research", {
        name: "Desk Research",
        iconName: "search",
        description: "",
        promptTemplate: "Investigate the topic.",
        skillNames: [],
      });
    });

    const [text] = uploadTextFileMock.mock.calls[0];
    expect(JSON.parse(text)).toMatchObject({
      modules: [{ id: "custom-1", slug: "email" }],
      builtinOverrides: [
        {
          id: "research",
          name: "Desk Research",
          description: "",
          promptTemplate: "Investigate the topic.",
          skillNames: [],
        },
      ],
    });
    expect(JSON.parse(text).builtinOverrides[0]).not.toHaveProperty("iconName");
  });

  it("migrates legacy Persona config on save without losing module Skills", async () => {
    downloadTextFileMock.mockResolvedValue(
      JSON.stringify({
        modules: [
          {
            id: "custom-writer",
            name: "Writer",
            slug: "writer",
            iconName: "pen-line",
            description: "",
            promptTemplate: "Write.",
            skillName: "research-brief",
            personaId: "legacy-writer",
            order: 0,
          },
        ],
        builtinOverrides: [],
        personas: [
          {
            id: "legacy-writer",
            name: "Writer",
            roleInstructions: "Be accurate.",
            requiredSkills: ["research-brief"],
            optionalSkills: ["seo-audit"],
          },
        ],
      }),
    );

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.modules).toHaveLength(1));
    expect(result.current.modules[0].skillNames).toEqual([
      "research-brief",
      "seo-audit",
    ]);
    expect(result.current.modules[0]).not.toHaveProperty("personaId");

    await act(async () => {
      await result.current.upsert({
        ...result.current.modules[0],
        promptTemplate: "Write a concise report.",
      });
    });

    const [text] = uploadTextFileMock.mock.calls[0];
    const saved = JSON.parse(text);
    expect(saved.modules[0]).toMatchObject({
      skillNames: ["research-brief", "seo-audit"],
      promptTemplate: "Write a concise report.",
    });
    expect(saved.modules[0]).not.toHaveProperty("skillName");
    expect(saved.modules[0]).not.toHaveProperty("personaId");
    expect(saved).not.toHaveProperty("personas");
  });

  it("removes a module", async () => {
    downloadTextFileMock.mockResolvedValue(
      configJson(
        [
          { id: "a", name: "A", slug: "a" },
          { id: "b", name: "B", slug: "b" },
        ],
        { a: "profile-a", b: "profile-b" },
      ),
    );

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.modules).toHaveLength(2));
    const scopeKey = getDckModuleAgentProfileScopeKey(null, "/projects");
    await waitFor(() =>
      expect(
        mockSettingsApi.value.dck_module_agent_profile_assignments[scopeKey],
      ).toEqual({ a: "profile-a", b: "profile-b" }),
    );
    await waitFor(() => expect(uploadTextFileMock).toHaveBeenCalled());

    await act(async () => {
      await result.current.remove("a");
    });

    const [text] = uploadTextFileMock.mock.calls.at(-1)!;
    expect(JSON.parse(text).modules.map((m: { id: string }) => m.id)).toEqual([
      "b",
    ]);
    expect(JSON.parse(text)).not.toHaveProperty("agentProfileAssignments");
    expect(
      mockSettingsApi.value.dck_module_agent_profile_assignments[scopeKey],
    ).toEqual({ b: "profile-b" });
  });

  it("reorders modules with move", async () => {
    downloadTextFileMock.mockResolvedValue(
      configJson([
        { id: "a", name: "A", slug: "a" },
        { id: "b", name: "B", slug: "b" },
      ]),
    );

    const { result } = renderHook(() => useDckModulesConfig(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.modules).toHaveLength(2));

    await act(async () => {
      await result.current.move("b", -1);
    });

    const [text] = uploadTextFileMock.mock.calls[0];
    expect(JSON.parse(text).modules.map((m: { id: string }) => m.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("does not read on a cloud backend", async () => {
    useActiveBackendMock.mockReturnValue({
      backend: { id: "cloud-1", kind: "cloud" },
      orgId: "org-1",
    });

    renderHook(() => useDckModulesConfig(), { wrapper: makeWrapper() });
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    expect(downloadTextFileMock).not.toHaveBeenCalled();
  });
});
