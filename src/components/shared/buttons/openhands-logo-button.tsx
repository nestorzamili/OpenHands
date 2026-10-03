import { useTranslation } from "react-i18next";
// Keep the import binding/component name as `OpenHandsLogo` for merge-safety
// with upstream; only the asset it points to is rebranded to the DCK mark.
import DckMark from "#/assets/branding/dck-mark.svg?react";
import { NavigationLink } from "#/components/shared/navigation-link";
import { I18nKey } from "#/i18n/declaration";
import { PRODUCT_NAME } from "#/constants/branding";
import { cn } from "#/utils/utils";

const DEFAULT_LOGO_HEIGHT = 30;

export type OpenHandsLogoButtonProps = {
  className?: string;
  /** Applied to the root `<svg>` mark. */
  logoClassName?: string;
  logoWidth?: number;
  logoHeight?: number;
  /**
   * Render only the square crown mark (no wordmark). Used by the collapsed
   * sidebar rail, where a wordmark does not fit the narrow icon column. When
   * false, the same mark is rendered with the product wordmark beside it, so
   * the mark's shape and left anchor stay identical across collapse/expand —
   * only the wordmark appears or disappears.
   */
  useMark?: boolean;
};

export function OpenHandsLogoButton({
  className,
  logoClassName,
  logoHeight = DEFAULT_LOGO_HEIGHT,
  useMark = false,
}: OpenHandsLogoButtonProps = {}) {
  const { t } = useTranslation("openhands");

  const ariaLabel = t(I18nKey.BRANDING$OPENHANDS_LOGO);

  // The mark is square (1:1); render it at the available height in both states
  // so the crown never changes size or horizontal position when the sidebar
  // toggles. Only the wordmark (shown when expanded) differs.
  const mark = (
    <DckMark
      width={logoHeight}
      height={logoHeight}
      className={cn("shrink-0 text-contrast", logoClassName)}
      aria-hidden
    />
  );

  return (
    <NavigationLink
      to="/conversations"
      aria-label={ariaLabel}
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      {mark}
      {!useMark && (
        <span className="min-w-0 truncate text-sm font-semibold text-contrast">
          {PRODUCT_NAME}
        </span>
      )}
    </NavigationLink>
  );
}
