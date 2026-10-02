import { useTranslation } from "react-i18next";
// Keep the import binding/component name as `OpenHandsLogo` for merge-safety
// with upstream; only the asset it points to is rebranded to the DCK mark.
import OpenHandsLogo from "#/assets/branding/dck-logo.svg?react";
import DckMark from "#/assets/branding/dck-mark.svg?react";
import { NavigationLink } from "#/components/shared/navigation-link";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";

const DEFAULT_LOGO_WIDTH = 46;
const DEFAULT_LOGO_HEIGHT = 30;

export type OpenHandsLogoButtonProps = {
  className?: string;
  /** Applied to the root `<svg>` (e.g. `max-w-none` so Tailwind preflight doesn’t clamp wide marks inside a narrow flex slot). */
  logoClassName?: string;
  logoWidth?: number;
  logoHeight?: number;
  /**
   * Render the square crown mark (`dck-mark.svg`) instead of the wide
   * crown+wordmark. Used by the collapsed sidebar rail, where a wordmark does
   * not fit the narrow icon column.
   */
  useMark?: boolean;
};

export function OpenHandsLogoButton({
  className,
  logoClassName,
  logoWidth = DEFAULT_LOGO_WIDTH,
  logoHeight = DEFAULT_LOGO_HEIGHT,
  useMark = false,
}: OpenHandsLogoButtonProps = {}) {
  const { t } = useTranslation("openhands");

  const ariaLabel = t(I18nKey.BRANDING$OPENHANDS_LOGO);

  const Mark = useMark ? DckMark : OpenHandsLogo;
  // The square mark is 1:1; render it at the available height so it sits
  // centered in the collapsed icon column rather than stretched to a wide box.
  const markWidth = useMark ? logoHeight : logoWidth;

  return (
    <NavigationLink
      to="/conversations"
      aria-label={ariaLabel}
      className={cn(className)}
    >
      <Mark
        width={markWidth}
        height={logoHeight}
        className={cn(
          "shrink-0 text-contrast [&_path[fill=white]]:fill-current",
          logoClassName,
        )}
      />
    </NavigationLink>
  );
}
