import React from "react";
import { useTranslation } from "react-i18next";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { I18nKey } from "#/i18n/declaration";
import {
  validateWebgenOwnerSeed,
  WebgenOwnerSeedFields,
  type WebgenOwnerSeedInput,
} from "./webgen-owner-seed-fields";

const EMPTY_SEED: WebgenOwnerSeedInput = {
  email: "",
  username: "",
  password: "",
};

export function WebgenOwnerSeedDialog({
  appName,
  isSubmitting,
  onSubmit,
  onCancel,
}: {
  appName: string;
  isSubmitting: boolean;
  onSubmit: (seed: WebgenOwnerSeedInput) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("openhands");
  const [seed, setSeed] = React.useState(EMPTY_SEED);
  const [showPasswordError, setShowPasswordError] = React.useState(false);
  const validation = validateWebgenOwnerSeed(seed);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setShowPasswordError(true);
    if (isSubmitting || !validation.valid) return;
    onSubmit({
      email: seed.email.trim(),
      username: seed.username.trim(),
      password: seed.password,
    });
  };

  return (
    <ModalBackdrop
      onClose={isSubmitting ? undefined : onCancel}
      closeOnEscape={!isSubmitting}
      closeOnBackdropClick={!isSubmitting}
      aria-label={t(I18nKey.DCK$OWNER_SEED_REENTRY_TITLE)}
    >
      <form
        onSubmit={handleSubmit}
        data-testid="webgen-owner-seed-dialog"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-base-secondary p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-contrast">
            {t(I18nKey.DCK$OWNER_SEED_REENTRY_TITLE)}
          </h2>
          <p className="text-sm text-text-tertiary">
            {t(I18nKey.DCK$OWNER_SEED_REENTRY_DESCRIPTION, { name: appName })}
          </p>
        </div>
        <WebgenOwnerSeedFields
          value={seed}
          onChange={setSeed}
          disabled={isSubmitting}
          showPasswordError={showPasswordError}
        />
        <div className="flex w-full justify-end gap-2">
          <BrandButton
            testId="webgen-owner-seed-cancel"
            type="button"
            variant="secondary"
            onClick={onCancel}
            isDisabled={isSubmitting}
          >
            {t(I18nKey.BUTTON$CANCEL)}
          </BrandButton>
          <BrandButton
            testId="webgen-owner-seed-submit"
            type="submit"
            variant="primary"
            isDisabled={!validation.valid || isSubmitting}
            aria-busy={isSubmitting}
          >
            {t(I18nKey.DCK$OWNER_SEED_REENTRY_SUBMIT)}
          </BrandButton>
        </div>
      </form>
    </ModalBackdrop>
  );
}
