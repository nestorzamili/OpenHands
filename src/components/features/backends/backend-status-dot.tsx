import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import {
  getBackendLastCheckedLabel,
  getBackendStatusLabel,
} from "./backend-status-label";

interface BackendStatusDotProps {
  /** `null` while the first probe is in flight. */
  isConnected: boolean | null | "unavailable";
  isDegraded?: boolean;
  lastCheckedAt?: number | null;
  className?: string;
}

/**
 * Small colored dot that reflects backend reachability:
 *   - green when connected
 *   - amber when reachable but slow or recovered after a retry
 *   - red when disconnected
 *   - dim gray while the first probe is in flight
 */
export function BackendStatusDot({
  isConnected,
  isDegraded = false,
  lastCheckedAt,
  className,
}: BackendStatusDotProps) {
  const { t, i18n } = useTranslation("openhands");
  let color: string;
  let status: string;
  if (isConnected === "unavailable") {
    color = "bg-text-tertiary";
    status = "unavailable";
  } else if (isConnected === true && isDegraded) {
    color = "bg-warning";
    status = "degraded";
  } else if (isConnected === true) {
    color = "bg-status-success";
    status = "connected";
  } else if (isConnected === false) {
    color = "bg-status-error";
    status = "disconnected";
  } else {
    color = "bg-interactive-selected";
    status = "checking";
  }
  const label =
    isConnected === "unavailable"
      ? t(I18nKey.BACKEND$NO_BACKEND_AVAILABLE)
      : getBackendStatusLabel(t, undefined, { isConnected, isDegraded });
  const lastCheckedLabel = getBackendLastCheckedLabel(
    t,
    { lastCheckedAt },
    i18n.resolvedLanguage ?? i18n.language,
  );
  const accessibleLabel = lastCheckedLabel
    ? `${label} — ${lastCheckedLabel}`
    : label;

  return (
    <span
      data-testid="backend-status-dot"
      data-status={status}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      role="status"
      className={cn(
        "inline-block w-2 h-2 rounded-full shrink-0",
        color,
        className,
      )}
    />
  );
}
