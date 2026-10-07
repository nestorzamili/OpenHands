import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { formControlSettingsFieldClassName } from "#/utils/form-control-classes";
import { cn } from "#/utils/utils";
import {
  validateWebgenAppName,
  type WebgenNewProjectSpec,
} from "#/dck/webgen-new-project";

interface WebgenNewProjectDialogProps {
  /** Existing project names under `webgen/`, used for collision checks. */
  existingNames: readonly string[];
  /** True while the conversation is being created after submit. */
  isSubmitting: boolean;
  /** Prevent starting a conversation until the module profile is resolved. */
  profileSelectionBlocked?: boolean;
  /** Localized reason the module profile currently blocks submission. */
  profileSelectionBlockedMessage?: string;
  onSubmit: (spec: WebgenNewProjectSpec) => void;
  onCancel: () => void;
}

/**
 * Collects the webgen project spec (name, description, DB/auth) BEFORE any
 * conversation is created, so the first message already carries the spec and
 * the agent starts scaffolding without a round-trip of clarifying questions.
 * Name validation (slug rule + collision with existing projects) runs live;
 * submit stays disabled until the name is valid.
 */
export function WebgenNewProjectDialog({
  existingNames,
  isSubmitting,
  profileSelectionBlocked = false,
  profileSelectionBlockedMessage,
  onSubmit,
  onCancel,
}: WebgenNewProjectDialogProps) {
  const { t } = useTranslation("openhands");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [needsDatabase, setNeedsDatabase] = React.useState(false);
  const [needsAuth, setNeedsAuth] = React.useState(false);
  // Only surface the name error after the field has been touched, so the
  // dialog doesn't open shouting "required" at an untouched input.
  const [nameTouched, setNameTouched] = React.useState(false);

  const validation = validateWebgenAppName(name, existingNames);
  const showNameError = nameTouched && !validation.valid;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validation.valid) {
      setNameTouched(true);
      return;
    }
    if (isSubmitting || profileSelectionBlocked) return;
    onSubmit({ name: name.trim(), description, needsDatabase, needsAuth });
  };

  return (
    <ModalBackdrop
      onClose={isSubmitting ? undefined : onCancel}
      closeOnEscape={!isSubmitting}
      closeOnBackdropClick={!isSubmitting}
      aria-label={t(I18nKey.DCK$NEW_PROJECT_DIALOG_TITLE)}
    >
      <form
        onSubmit={handleSubmit}
        data-testid="webgen-new-project-dialog"
        className="flex w-[28rem] max-w-[90vw] flex-col gap-4 rounded-xl border border-border bg-base-secondary p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-contrast">
            {t(I18nKey.DCK$NEW_PROJECT_DIALOG_TITLE)}
          </h2>
          <p className="text-sm text-text-tertiary">
            {t(I18nKey.DCK$NEW_PROJECT_DIALOG_DESCRIPTION)}
          </p>
          {profileSelectionBlocked && profileSelectionBlockedMessage && (
            <p
              data-testid="webgen-new-project-profile-warning"
              role="alert"
              className="text-sm text-danger"
            >
              {profileSelectionBlockedMessage}
            </p>
          )}
        </div>

        <SettingsInput
          testId="webgen-new-project-name"
          label={t(I18nKey.DCK$NEW_PROJECT_NAME_LABEL)}
          type="text"
          value={name}
          onChange={setName}
          onBlur={() => setNameTouched(true)}
          placeholder={t(I18nKey.DCK$NEW_PROJECT_NAME_PLACEHOLDER)}
          showRequiredTag
          hint={t(I18nKey.DCK$NEW_PROJECT_NAME_HINT)}
          isDisabled={isSubmitting}
          error={
            showNameError && validation.errorKey
              ? t(validation.errorKey)
              : undefined
          }
        />

        <label className="flex w-full flex-col gap-2.5">
          <span className="text-sm">
            {t(I18nKey.DCK$NEW_PROJECT_DESCRIPTION_LABEL)}
          </span>
          <textarea
            data-testid="webgen-new-project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t(I18nKey.DCK$NEW_PROJECT_DESCRIPTION_PLACEHOLDER)}
            rows={3}
            disabled={isSubmitting}
            className={cn(
              formControlSettingsFieldClassName,
              "h-auto resize-y py-2 disabled:bg-surface-raised disabled:border-border-subtle",
            )}
          />
        </label>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-contrast">
            <input
              type="checkbox"
              data-testid="webgen-new-project-database"
              checked={needsDatabase}
              onChange={(event) => setNeedsDatabase(event.target.checked)}
              disabled={isSubmitting}
            />
            {t(I18nKey.DCK$NEW_PROJECT_NEEDS_DATABASE)}
          </label>
          <label className="flex items-center gap-2 text-sm text-contrast">
            <input
              type="checkbox"
              data-testid="webgen-new-project-auth"
              checked={needsAuth}
              onChange={(event) => setNeedsAuth(event.target.checked)}
              disabled={isSubmitting}
            />
            {t(I18nKey.DCK$NEW_PROJECT_NEEDS_AUTH)}
          </label>
        </div>

        <div className="flex w-full justify-end gap-2">
          <BrandButton
            testId="webgen-new-project-cancel"
            type="button"
            variant="secondary"
            onClick={onCancel}
            isDisabled={isSubmitting}
          >
            {t(I18nKey.BUTTON$CANCEL)}
          </BrandButton>
          <BrandButton
            testId="webgen-new-project-submit"
            type="submit"
            variant="primary"
            isDisabled={
              !validation.valid || isSubmitting || profileSelectionBlocked
            }
            aria-busy={isSubmitting}
          >
            {t(I18nKey.DCK$NEW_PROJECT_CREATE)}
          </BrandButton>
        </div>
      </form>
    </ModalBackdrop>
  );
}
