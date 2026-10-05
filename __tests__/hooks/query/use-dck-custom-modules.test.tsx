import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDckCustomModules } from "#/hooks/query/use-dck-custom-modules";

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
): string {
  return JSON.stringify({
    modules: modules.map((m, index) => ({
      ...m,
      iconName: "mail",
      description: "",
      promptTemplate: "Do the thing.",
      order: index,
    })),
  });
}

describe("useDckCustomModules", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_DCK_WORKSPACE_ROOT", "");
    downloadTextFileMock.mockReset();
    uploadTextFileMock.mockReset();
    uploadTextFileMock.mockResolvedValue({ success: true });
    useActiveBackendMock.mockReset();
    useActiveBackendMock.mockReturnValue({
      backend: { id: "local-1", kind: "local" },
      orgId: null,
    });
  });

  it("returns an empty list when the config file is missing", async () => {
    downloadTextFileMock.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(() => useDckCustomModules(), {
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

    const { result } = renderHook(() => useDckCustomModules(), {
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

    const { result } = renderHook(() => useDckCustomModules(), {
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

  it("removes a module", async () => {
    downloadTextFileMock.mockResolvedValue(
      configJson([
        { id: "a", name: "A", slug: "a" },
        { id: "b", name: "B", slug: "b" },
      ]),
    );

    const { result } = renderHook(() => useDckCustomModules(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.modules).toHaveLength(2));

    await act(async () => {
      await result.current.remove("a");
    });

    const [text] = uploadTextFileMock.mock.calls[0];
    expect(JSON.parse(text).modules.map((m: { id: string }) => m.id)).toEqual([
      "b",
    ]);
  });

  it("reorders modules with move", async () => {
    downloadTextFileMock.mockResolvedValue(
      configJson([
        { id: "a", name: "A", slug: "a" },
        { id: "b", name: "B", slug: "b" },
      ]),
    );

    const { result } = renderHook(() => useDckCustomModules(), {
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

    renderHook(() => useDckCustomModules(), { wrapper: makeWrapper() });
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    expect(downloadTextFileMock).not.toHaveBeenCalled();
  });
});
