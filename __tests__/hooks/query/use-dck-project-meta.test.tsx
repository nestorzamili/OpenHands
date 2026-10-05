import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDckProjectMeta } from "#/hooks/query/use-dck-project-meta";

const downloadFileMock = vi.fn();

vi.mock("@openhands/typescript-client/clients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@openhands/typescript-client/clients")
  >()),
  FileClient: class {
    downloadFile = (...args: unknown[]) => downloadFileMock(...args);
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

function encode(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

describe("useDckProjectMeta", () => {
  beforeEach(() => {
    downloadFileMock.mockReset();
    useActiveBackendMock.mockReset();
    useActiveBackendMock.mockReturnValue({
      backend: { id: "local-1", kind: "local" },
      orgId: null,
    });
  });

  it("reads and parses .dck.json for a project path", async () => {
    downloadFileMock.mockResolvedValue(
      encode(JSON.stringify({ name: "shop", port: 3100, stack: "nextjs" })),
    );

    const { result } = renderHook(
      () => useDckProjectMeta("/projects/webgen/shop"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(downloadFileMock).toHaveBeenCalledWith(
      "/projects/webgen/shop/.dck.json",
    );
    expect(result.current.data).toEqual({
      name: "shop",
      port: 3100,
      stack: "nextjs",
      url: "http://localhost:3100",
      previewPath: null,
      subdomain: null,
      lastStatus: null,
      lastCheckedAt: null,
    });
  });

  it("returns null when the file is missing", async () => {
    downloadFileMock.mockRejectedValue(new Error("not found"));

    const { result } = renderHook(
      () => useDckProjectMeta("/projects/webgen/no-meta"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    downloadFileMock.mockResolvedValue(encode("{ broken"));

    const { result } = renderHook(
      () => useDckProjectMeta("/projects/webgen/broken"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not read when the path is null", async () => {
    renderHook(() => useDckProjectMeta(null), { wrapper: makeWrapper() });
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    expect(downloadFileMock).not.toHaveBeenCalled();
  });

  it("does not read on a cloud backend", async () => {
    useActiveBackendMock.mockReturnValue({
      backend: { id: "cloud-1", kind: "cloud" },
      orgId: "org-1",
    });
    renderHook(() => useDckProjectMeta("/projects/webgen/shop"), {
      wrapper: makeWrapper(),
    });
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    expect(downloadFileMock).not.toHaveBeenCalled();
  });
});
