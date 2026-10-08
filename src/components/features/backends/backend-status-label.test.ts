import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import {
  INVALID_BACKEND_API_KEY_ERROR,
  MISSING_BACKEND_API_KEY_ERROR,
} from "#/hooks/query/use-backends-health";
import { I18nKey } from "#/i18n/declaration";
import { CORS_OR_NETWORK_ERROR_MESSAGE } from "#/utils/user-facing-error";
import {
  formatBackendHealthTimestamp,
  getBackendLastCheckedLabel,
  getBackendStatusLabel,
} from "./backend-status-label";

const t = ((key: string, options?: { time?: string }) =>
  options?.time ? `${key}: ${options.time}` : key) as TFunction<"openhands">;

describe("getBackendStatusLabel", () => {
  it("prefers add API key for Cloud backends with a blank API key", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "cloud", apiKey: "" },
        { isConnected: false, lastError: CORS_OR_NETWORK_ERROR_MESSAGE },
      ),
    ).toBe(I18nKey.BACKEND$STATUS_DISCONNECTED_ADD_API_KEY);
  });

  it("maps Cloud browser-network failures to API key or network guidance", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "cloud", apiKey: "oh-cloud-key" },
        { isConnected: false, lastError: CORS_OR_NETWORK_ERROR_MESSAGE },
      ),
    ).toBe(I18nKey.BACKEND$STATUS_DISCONNECTED_CHECK_CLOUD_ACCESS);
  });

  it("keeps local browser-network failures generic", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "local", apiKey: "" },
        { isConnected: false, lastError: CORS_OR_NETWORK_ERROR_MESSAGE },
      ),
    ).toBe(I18nKey.BACKEND$STATUS_DISCONNECTED_CHECK_URL_OR_NETWORK);
  });

  it("returns connected when the health probe is connected", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "local", apiKey: "" },
        { isConnected: true, lastError: null },
      ),
    ).toBe(I18nKey.ONBOARDING$BACKEND_STATUS_CONNECTED);
  });

  it("reports a reachable but slow backend as degraded", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "local", apiKey: "" },
        { isConnected: true, isDegraded: true, lastError: null },
      ),
    ).toBe(I18nKey.BACKEND$STATUS_DEGRADED);
  });

  it("does not ask cookie-auth Cloud backends for an API key", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "cloud", authMode: "cookie", apiKey: "" },
        { isConnected: true, lastError: null },
      ),
    ).toBe(I18nKey.ONBOARDING$BACKEND_STATUS_CONNECTED);
  });

  it("formats and labels the last health-check time", () => {
    const timestamp = new Date("2026-10-08T10:00:00.000Z").getTime();
    const formatted = formatBackendHealthTimestamp(timestamp, "en-US");

    expect(formatted).toContain("2026");
    expect(
      getBackendLastCheckedLabel(t, { lastCheckedAt: timestamp }, "en-US"),
    ).toBe(`${I18nKey.BACKEND$STATUS_LAST_CHECKED}: ${formatted}`);
    expect(getBackendLastCheckedLabel(t, undefined, "en-US")).toBeNull();
  });

  it("returns disconnected for failed probes without a more specific reason", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "local", apiKey: "" },
        { isConnected: false, lastError: "Unexpected failure" },
      ),
    ).toBe(I18nKey.ONBOARDING$BACKEND_STATUS_DISCONNECTED);
  });

  it("returns checking while the health probe is unresolved", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "local", apiKey: "" },
        { isConnected: null, lastError: null },
      ),
    ).toBe(I18nKey.ONBOARDING$BACKEND_STATUS_CHECKING);
  });

  it("maps request timeouts to tunnel guidance", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "local", apiKey: "" },
        { isConnected: false, lastError: "Backend request timed out" },
      ),
    ).toBe(I18nKey.BACKEND$STATUS_DISCONNECTED_CHECK_TUNNEL);
  });

  it("maps missing and invalid API key health errors to credential guidance", () => {
    expect(
      getBackendStatusLabel(
        t,
        { kind: "cloud", apiKey: "oh-cloud-key" },
        { isConnected: false, lastError: MISSING_BACKEND_API_KEY_ERROR },
      ),
    ).toBe(I18nKey.BACKEND$STATUS_DISCONNECTED_ADD_API_KEY);

    expect(
      getBackendStatusLabel(
        t,
        { kind: "cloud", apiKey: "oh-cloud-key" },
        { isConnected: false, lastError: INVALID_BACKEND_API_KEY_ERROR },
      ),
    ).toBe(I18nKey.BACKEND$STATUS_DISCONNECTED_CHECK_API_KEY);
  });
});
