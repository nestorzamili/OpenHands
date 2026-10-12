import { SettingsInput } from "#/components/features/settings/settings-input";
import { I18nKey } from "#/i18n/declaration";
import { useTranslation } from "react-i18next";

export interface WebgenOwnerSeedInput {
  email: string;
  username: string;
  /** Kept verbatim: no trimming or Unicode normalization. */
  password: string;
}

export function validateWebgenOwnerSeed(input: WebgenOwnerSeedInput): {
  valid: boolean;
  passwordError: I18nKey | null;
} {
  const email = input.email.trim();
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const username = input.username.trim();
  const codePoints = Array.from(input.password).length;
  const utf16CodeUnits = input.password.length;
  let passwordError: I18nKey | null = null;
  if (codePoints < 15) {
    passwordError = I18nKey.DCK$OWNER_SEED_PASSWORD_TOO_SHORT;
  } else if (codePoints > 512 || utf16CodeUnits > 1024) {
    passwordError = I18nKey.DCK$OWNER_SEED_PASSWORD_TOO_LONG;
  }
  return {
    valid: validEmail && username.length <= 64 && passwordError === null,
    passwordError,
  };
}

export function WebgenOwnerSeedFields({
  value,
  onChange,
  disabled,
  showPasswordError = false,
}: {
  value: WebgenOwnerSeedInput;
  onChange: (next: WebgenOwnerSeedInput) => void;
  disabled: boolean;
  showPasswordError?: boolean;
}) {
  const { t } = useTranslation("openhands");
  const validation = validateWebgenOwnerSeed(value);
  const update = (field: keyof WebgenOwnerSeedInput, next: string) =>
    onChange({ ...value, [field]: next });

  return (
    <div className="flex flex-col gap-3" data-testid="webgen-owner-seed-fields">
      <SettingsInput
        testId="webgen-owner-seed-email"
        name="email"
        label={t(I18nKey.DCK$OWNER_SEED_EMAIL)}
        type="email"
        value={value.email}
        onChange={(next) => update("email", next)}
        autoComplete="email"
        isDisabled={disabled}
        required
        showRequiredTag
      />
      <SettingsInput
        testId="webgen-owner-seed-username"
        name="username"
        label={t(I18nKey.DCK$OWNER_SEED_USERNAME)}
        type="text"
        value={value.username}
        onChange={(next) => update("username", next)}
        autoComplete="username"
        maxLength={64}
        isDisabled={disabled}
        showOptionalTag
      />
      <SettingsInput
        testId="webgen-owner-seed-password"
        name="new-password"
        label={t(I18nKey.DCK$OWNER_SEED_PASSWORD)}
        type="password"
        value={value.password}
        onChange={(next) => update("password", next)}
        autoComplete="new-password"
        maxLength={1024}
        required
        showRequiredTag
        hint={t(I18nKey.DCK$OWNER_SEED_PASSWORD_HINT)}
        isDisabled={disabled}
        error={
          showPasswordError && validation.passwordError
            ? t(validation.passwordError)
            : undefined
        }
      />
    </div>
  );
}
