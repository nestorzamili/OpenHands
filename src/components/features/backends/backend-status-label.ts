import type { TFunction } from "i18next";
import {
  isCloudBackendApiKeyOrNetworkHealthError,
  isCloudBackendLoggedOutHealthError,
  isInvalidBackendApiKeyHealthError,
  isMissingBackendApiKeyHealthError,
} from "#/hooks/query/use-backends-health";
import { I18nKey } from "#/i18n/declaration";
import {
  isBackendRequestTimeoutMessage,
  isCorsOrNetworkErrorMessage,
} from "#/utils/user-facing-error";

interface BackendStatusLabelHealth {
  isConnected?: boolean | null;
  isDegraded?: boolean;
  lastError?: string | null;
  lastCheckedAt?: number | null;
}

export function formatBackendHealthTimestamp(
  timestamp: number,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(timestamp);
}

export function getBackendLastCheckedLabel(
  t: TFunction<"openhands">,
  health: Pick<BackendStatusLabelHealth, "lastCheckedAt"> | undefined,
  locale: string,
): string | null {
  if (health?.lastCheckedAt == null) return null;
  return t(I18nKey.BACKEND$STATUS_LAST_CHECKED, {
    time: formatBackendHealthTimestamp(health.lastCheckedAt, locale),
  });
}

export function getBackendStatusLabel(
  t: TFunction<"openhands">,
  backend:
    | {
        kind?: "local" | "cloud";
        authMode?: "api-key" | "cookie";
        apiKey?: string | null;
      }
    | undefined,
  health: BackendStatusLabelHealth | undefined,
): string {
  const lastError = health?.lastError ?? null;
  const isCloud = backend?.kind === "cloud";

  if (isCloud && backend?.authMode !== "cookie" && !backend?.apiKey?.trim()) {
    return t(I18nKey.BACKEND$STATUS_DISCONNECTED_ADD_API_KEY);
  }

  if (isMissingBackendApiKeyHealthError(lastError)) {
    return t(I18nKey.BACKEND$STATUS_DISCONNECTED_ADD_API_KEY);
  }

  if (isInvalidBackendApiKeyHealthError(lastError)) {
    return t(I18nKey.BACKEND$STATUS_DISCONNECTED_CHECK_API_KEY);
  }

  if (isCloudBackendLoggedOutHealthError(lastError)) {
    return t(I18nKey.BACKEND$LOGGED_OUT);
  }

  if (health?.isConnected === true) {
    if (health.isDegraded) return t(I18nKey.BACKEND$STATUS_DEGRADED);
    return t(I18nKey.ONBOARDING$BACKEND_STATUS_CONNECTED);
  }

  if (
    isCloud &&
    health?.isConnected === false &&
    (isCloudBackendApiKeyOrNetworkHealthError(lastError) ||
      isCorsOrNetworkErrorMessage(lastError))
  ) {
    return t(I18nKey.BACKEND$STATUS_DISCONNECTED_CHECK_CLOUD_ACCESS);
  }

  if (
    health?.isConnected === false &&
    isBackendRequestTimeoutMessage(lastError)
  ) {
    return t(I18nKey.BACKEND$STATUS_DISCONNECTED_CHECK_TUNNEL);
  }

  if (health?.isConnected === false && isCorsOrNetworkErrorMessage(lastError)) {
    return t(I18nKey.BACKEND$STATUS_DISCONNECTED_CHECK_URL_OR_NETWORK);
  }

  if (health?.isConnected === false) {
    return t(I18nKey.ONBOARDING$BACKEND_STATUS_DISCONNECTED);
  }

  return t(I18nKey.ONBOARDING$BACKEND_STATUS_CHECKING);
}
