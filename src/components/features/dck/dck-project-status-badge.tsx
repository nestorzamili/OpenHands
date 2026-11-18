import { useTranslation } from "react-i18next";
import { cn } from "#/utils/utils";
import { statusToneBadgeClassName } from "#/utils/status-tone-classes";
import { DCK_STATUS_LABEL_KEYS, type DckProjectStatus } from "#/dck/modules";

/**
 * Per-status pill colors. Each status maps to a background/border/text triple
 * built on the shared semantic tokens so the badge tracks the active theme.
 * `working` pulses to signal a live agent turn; the rest are static.
 */
const STATUS_CLASS: Record<DckProjectStatus, string> = {
  starting: "border-border bg-surface text-text-secondary",
  running: `border-success/40 ${statusToneBadgeClassName.success}`,
  stopped: "border-border bg-surface text-text-tertiary",
  working: `border-success/40 ${statusToneBadgeClassName.success}`,
  idle: "border-border bg-surface text-text-secondary",
  paused: "border-border bg-surface text-text-tertiary",
  error: `border-danger/40 ${statusToneBadgeClassName.danger}`,
  configured: "border-border bg-surface text-text-secondary",
  unknown: "border-border bg-surface text-text-tertiary",
};

export function DckProjectStatusBadge({
  status,
}: {
  status: DckProjectStatus;
}) {
  const { t } = useTranslation("openhands");
  return (
    <span
      data-testid="dck-project-status-badge"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_CLASS[status],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-current",
          (status === "working" || status === "starting") &&
            "animate-pulse motion-reduce:animate-none",
        )}
      />
      {t(DCK_STATUS_LABEL_KEYS[status])}
    </span>
  );
}
