import {
  ServerClient,
  ConversationClient,
} from "@openhands/typescript-client/clients";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEEDED_DEFAULT_BACKEND_ID } from "#/api/backend-registry/default-backend";
import {
  BACKEND_HEALTH_STORAGE_KEY,
  MAX_CONSECUTIVE_FAILURES,
} from "#/api/backend-registry/health-storage";
import {
  __resetHealthStoreForTests,
  resetBackendHealth,
} from "#/api/backend-registry/health-store";
import type { Backend } from "#/api/backend-registry/types";
import {
  CLOUD_BACKEND_LOGGED_OUT_ERROR,
  useBackendsHealth,
} from "#/hooks/query/use-backends-health";

const countConversationsMock = vi.fn();
const getServerInfoMock = vi.fn();
const getCurrentCloudApiKeyMock = vi.fn();
const getCloudOrganizationsMock = vi.fn();

vi.mock("@openhands/typescript-client/clients", () => ({
  ServerClient: vi.fn(function ServerClientMock() {
    return { getServerInfo: getServerInfoMock };
  }),
  ConversationClient: vi.fn(function ConversationClientMock() {
    return { countConversations: countConversationsMock };
  }),
}));

vi.mock("#/api/cloud/organization-service.api", () => ({
  getCloudOrganizations: (...args: unknown[]) =>
    getCloudOrganizationsMock(...args),
  getCurrentCloudApiKey: (...args: unknown[]) =>
    getCurrentCloudApiKeyMock(...args),
}));

const localBackend: Backend = {
  id: SEEDED_DEFAULT_BACKEND_ID,
  name: "Local",
  host: "http://localhost:18000",
  apiKey: "",
  kind: "local",
};

const cloudBackend: Backend = {
  id: "cloud-1",
  name: "Production",
  host: "https://app.all-hands.dev",
  apiKey: "bearer",
  kind: "cloud",
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  countConversationsMock.mockReset();
  getServerInfoMock.mockReset();
  getServerInfoMock.mockResolvedValue({ version: "1.52.0" });
  getCurrentCloudApiKeyMock.mockReset();
  getCloudOrganizationsMock.mockReset();
  vi.mocked(ServerClient).mockClear();
  vi.mocked(ConversationClient).mockClear();
  window.localStorage.clear();
  __resetHealthStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  __resetHealthStoreForTests();
});

describe("useBackendsHealth", () => {
  it("probes local backends via authenticated lightweight count and compatible server info", async () => {
    countConversationsMock.mockResolvedValue(0);

    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current[localBackend.id].isConnected).toBe(true),
    );
    expect(countConversationsMock).toHaveBeenCalled();
    expect(getServerInfoMock).toHaveBeenCalled();
    expect(vi.mocked(ConversationClient).mock.calls[0]?.[0]).toMatchObject({
      timeout: 4000,
    });
    expect(getCurrentCloudApiKeyMock).not.toHaveBeenCalled();
  });

  it("reports disconnected when the local backend is below the compatible version floor", async () => {
    countConversationsMock.mockResolvedValue(0);
    getServerInfoMock.mockResolvedValue({ version: "1.27.1" });

    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });

    await waitFor(
      () =>
        expect(result.current[localBackend.id]).toMatchObject({
          isConnected: false,
          lastError:
            "Agent Canvas requires agent-server 1.51.0 or newer; this backend is running 1.27.1. Please upgrade the agent-server backend.",
        }),
      // Failing probes now retry a couple of times before settling.
      { timeout: 3000 },
    );
  });

  it("reports disconnected when the local probe throws", async () => {
    countConversationsMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });

    await waitFor(
      () => expect(result.current[localBackend.id].isConnected).toBe(false),
      { timeout: 3000 },
    );
  });

  it("recovers when a transient first probe fails, then succeeds on retry", async () => {
    // The first probe attempt rejects (agent-server still warming up right
    // after navigation); the quick-retry inside the query function re-probes
    // and succeeds, so the backend reports reachable without waiting for the
    // 30s poll — and because the probe ultimately succeeded, zero failures are
    // recorded toward the disabled cap.
    countConversationsMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    countConversationsMock.mockResolvedValue(0);

    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });

    await waitFor(
      () =>
        expect(result.current[localBackend.id]).toMatchObject({
          isConnected: true,
          isDegraded: true,
        }),
      { timeout: 3000 },
    );
    expect(result.current[localBackend.id].consecutiveFailures).toBe(0);
    expect(result.current[localBackend.id].lastCheckedAt).toEqual(
      expect.any(Number),
    );
    expect(result.current[localBackend.id].lastCheckDurationMs).toEqual(
      expect.any(Number),
    );
    expect(countConversationsMock).toHaveBeenCalledTimes(2);
  });

  it("polls local health at the existing 30-second interval", async () => {
    vi.useFakeTimers();
    countConversationsMock.mockResolvedValue(0);

    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(result.current[localBackend.id].isConnected).toBe(true);
    expect(countConversationsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(countConversationsMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(countConversationsMock).toHaveBeenCalledTimes(2);
  });

  it("reports invalid API key when the authenticated local probe returns 401", async () => {
    countConversationsMock.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), {
        name: "HttpError",
        status: 401,
      }),
    );

    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current[localBackend.id]).toMatchObject({
        isConnected: false,
        lastError: "Invalid API key",
      }),
    );
    expect(getServerInfoMock).not.toHaveBeenCalled();
    // A definitive auth rejection is not retried — it won't self-heal.
    expect(countConversationsMock).toHaveBeenCalledTimes(1);
  });

  it("probes cloud backends via getCurrentCloudApiKey", async () => {
    getCurrentCloudApiKeyMock.mockResolvedValue({
      orgId: "org-1",
      isLegacyKey: false,
    });

    const { result } = renderHook(() => useBackendsHealth([cloudBackend]), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current[cloudBackend.id].isConnected).toBe(true),
    );
    expect(getCurrentCloudApiKeyMock).toHaveBeenCalledWith(cloudBackend);
    expect(countConversationsMock).not.toHaveBeenCalled();
  });

  it("probes cookie-auth cloud backends via organizations without an API key", async () => {
    const cookieBackend: Backend = {
      ...cloudBackend,
      id: "cloud-cookie",
      apiKey: "",
      authMode: "cookie",
    };
    getCloudOrganizationsMock.mockResolvedValue({
      items: [],
      currentOrgId: null,
    });

    const { result } = renderHook(() => useBackendsHealth([cookieBackend]), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current[cookieBackend.id].isConnected).toBe(true),
    );
    expect(getCloudOrganizationsMock).toHaveBeenCalledWith(cookieBackend);
    expect(getCurrentCloudApiKeyMock).not.toHaveBeenCalled();
  });

  it("polls cloud health less frequently than local health", async () => {
    vi.useFakeTimers();
    getCurrentCloudApiKeyMock.mockResolvedValue({
      orgId: "org-1",
      isLegacyKey: false,
    });

    const { result } = renderHook(() => useBackendsHealth([cloudBackend]), {
      wrapper,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(result.current[cloudBackend.id].isConnected).toBe(true);
    expect(getCurrentCloudApiKeyMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getCurrentCloudApiKeyMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(270_000);
    });
    expect(getCurrentCloudApiKeyMock).toHaveBeenCalledTimes(2);
  });

  it("reports disconnected when the cloud probe throws", async () => {
    getCurrentCloudApiKeyMock.mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => useBackendsHealth([cloudBackend]), {
      wrapper,
    });

    await waitFor(
      () => expect(result.current[cloudBackend.id].isConnected).toBe(false),
      { timeout: 3000 },
    );
  });

  it("reports logged out when the cloud probe returns 401", async () => {
    getCurrentCloudApiKeyMock.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), {
        isAxiosError: true,
        response: { status: 401 },
      }),
    );

    const { result } = renderHook(() => useBackendsHealth([cloudBackend]), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current[cloudBackend.id]).toMatchObject({
        isConnected: false,
        lastError: CLOUD_BACKEND_LOGGED_OUT_ERROR,
      }),
    );
  });

  it("reports null while the first probe is still in flight", async () => {
    let resolveProbe!: () => void;
    countConversationsMock.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = () => resolve(0);
        }),
    );

    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });

    expect(result.current[localBackend.id].isConnected).toBeNull();

    resolveProbe();
    await waitFor(() =>
      expect(result.current[localBackend.id].isConnected).toBe(true),
    );
  });

  it("records the failure count and last error to the health store after a failed probe", async () => {
    // Arrange
    countConversationsMock.mockRejectedValue(new Error("ECONNREFUSED"));

    // Act
    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });

    // Assert — one failed probe surfaces the new metadata fields on
    // the hook's return value and persists them to localStorage; the
    // disabled flag stays false because we're below the cap.
    await waitFor(
      () =>
        expect(result.current[localBackend.id]).toMatchObject({
          isConnected: false,
          consecutiveFailures: 1,
          lastError: "ECONNREFUSED",
          disabled: false,
        }),
      // Retries settle before a single failure is recorded.
      { timeout: 3000 },
    );
    const persisted = JSON.parse(
      window.localStorage.getItem(BACKEND_HEALTH_STORAGE_KEY) ?? "{}",
    );
    expect(persisted[localBackend.id]).toMatchObject({
      consecutiveFailures: 1,
      disabled: false,
    });
  });

  it("does not probe a backend whose disabled state was persisted before the GUI mounted (refresh case)", async () => {
    // Arrange — simulate a prior session that already exhausted retries
    // by seeding localStorage before the hook subscribes.
    window.localStorage.setItem(
      BACKEND_HEALTH_STORAGE_KEY,
      JSON.stringify({
        [localBackend.id]: {
          consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
          lastError: "ECONNREFUSED",
          lastFailureAt: Date.now(),
          disabled: true,
        },
      }),
    );
    __resetHealthStoreForTests();
    countConversationsMock.mockResolvedValue(0);

    // Act
    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });
    // Let any microtasks drain so a stray probe would have fired by now.
    await act(async () => {
      await Promise.resolve();
    });

    // Assert — polling is gated off; no probe goes out.
    expect(countConversationsMock).not.toHaveBeenCalled();
    expect(result.current[localBackend.id]).toMatchObject({
      isConnected: false,
      disabled: true,
    });
  });

  it("re-arms polling after the user edits the backend (resetBackendHealth clears the disabled flag)", async () => {
    // Arrange — start from the persisted-disabled state.
    window.localStorage.setItem(
      BACKEND_HEALTH_STORAGE_KEY,
      JSON.stringify({
        [localBackend.id]: {
          consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
          lastError: "ECONNREFUSED",
          lastFailureAt: Date.now(),
          disabled: true,
        },
      }),
    );
    __resetHealthStoreForTests();
    countConversationsMock.mockResolvedValue(0);

    const { result } = renderHook(() => useBackendsHealth([localBackend]), {
      wrapper,
    });
    expect(countConversationsMock).not.toHaveBeenCalled();

    // Act — the active-backend-context calls resetBackendHealth when
    // host or apiKey changes; do that directly so we don't have to
    // spin up the whole context.
    act(() => {
      resetBackendHealth(localBackend.id);
    });

    // Assert — a fresh probe fires and the hook reports connected.
    await waitFor(() =>
      expect(result.current[localBackend.id].isConnected).toBe(true),
    );
    expect(countConversationsMock).toHaveBeenCalled();
  });

  it("re-probes a persisted-disabled backend when explicitly asked and clears the stale health entry on success", async () => {
    window.localStorage.setItem(
      BACKEND_HEALTH_STORAGE_KEY,
      JSON.stringify({
        [localBackend.id]: {
          consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
          lastError: "Network Error",
          lastFailureAt: Date.now(),
          disabled: true,
        },
      }),
    );
    __resetHealthStoreForTests();
    countConversationsMock.mockResolvedValue(0);

    const { result } = renderHook(
      () => useBackendsHealth([localBackend], { probeDisabledOnce: true }),
      {
        wrapper,
      },
    );

    await waitFor(() =>
      expect(result.current[localBackend.id]).toMatchObject({
        isConnected: true,
        disabled: false,
      }),
    );
    expect(countConversationsMock).toHaveBeenCalled();
    expect(window.localStorage.getItem(BACKEND_HEALTH_STORAGE_KEY)).toBeNull();
  });
});
