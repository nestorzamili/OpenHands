import { useTranslation } from "react-i18next";
import { cn } from "#/utils/utils";
import { DCK_STATUS_LABEL_KEYS, type DckProjectStatus } from "#/dck/modules";

/**
 * Per-status pill colors. Each status maps to a background/border/text triple
 * built on the shared semantic tokens so the badge tracks the active theme.
 * `working` pulses to signal a live agent turn; the rest are static.
 */
const STATUS_CLASS: Record<DckProjectStatus, string> = {
  running: "border-status-success/30 bg-status-success/10 text-status-success",
  stopped: "border-border bg-surface text-text-tertiary",
  working: "border-status-success/30 bg-status-success/10 text-status-success",
  idle: "border-border bg-surface text-text-secondary",
  paused: "border-border bg-surface text-text-tertiary",
  error: "border-status-error/30 bg-status-error/10 text-status-error",
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
          status === "working" && "animate-pulse motion-reduce:animate-none",
        )}
      />
      {t(DCK_STATUS_LABEL_KEYS[status])}
    </span>
  );
}
