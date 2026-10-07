import { useTranslation } from "react-i18next";
import type { AgentProfileSummary } from "#/api/agent-profiles-service/agent-profiles-service.api";
import { I18nKey } from "#/i18n/declaration";
import type { DckModuleAgentProfileSelection } from "#/hooks/use-dck-module-agent-profiles";

const FOLLOW_ACTIVE_PROFILE = "__follow_active_profile__";
const REMOVED_MODULE_PROFILE = "__removed_module_profile__";

export function DckModuleAgentProfileSelector({
  moduleId,
  profiles,
  activeAgentProfileId,
  selection,
  disabled = false,
  onChange,
}: {
  moduleId: string;
  profiles: readonly AgentProfileSummary[];
  activeAgentProfileId: string | null;
  selection: DckModuleAgentProfileSelection;
  disabled?: boolean;
  onChange: (moduleId: string, profileId: string | null) => void;
}) {
  const { t } = useTranslation("openhands");
  const activeProfile = profiles.find(
    (profile) => profile.id === activeAgentProfileId,
  );
  const selectorId = `dck-module-agent-profile-${moduleId}`;
  const selectedValue =
    selection.status === "follow-active"
      ? FOLLOW_ACTIVE_PROFILE
      : selection.status === "unavailable"
        ? (selection.profileId ?? REMOVED_MODULE_PROFILE)
        : selection.profileId;
  const hasUnavailableSelection = selection.status === "unavailable";

  return (
    <label
      htmlFor={selectorId}
      className="flex min-w-0 flex-col gap-1 text-xs text-text-secondary"
    >
      <span>{t(I18nKey.CHAT$AGENT_PROFILE_PLACEHOLDER)}</span>
      <select
        id={selectorId}
        data-testid={`dck-module-agent-profile-selector-${moduleId}`}
        value={selectedValue}
        disabled={disabled || selection.status === "checking"}
        aria-invalid={hasUnavailableSelection || undefined}
        aria-describedby={
          hasUnavailableSelection ? `${selectorId}-warning` : undefined
        }
        onChange={(event) =>
          onChange(
            moduleId,
            event.target.value === FOLLOW_ACTIVE_PROFILE
              ? null
              : event.target.value,
          )
        }
        className="w-full min-w-0 rounded-md border border-border bg-base px-2 py-1.5 text-xs text-contrast disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value={FOLLOW_ACTIVE_PROFILE}>
          {activeProfile
            ? t(I18nKey.DCK$MODULE_AGENT_PROFILE_FOLLOW_ACTIVE_WITH_NAME, {
                name: activeProfile.name,
              })
            : t(I18nKey.DCK$MODULE_AGENT_PROFILE_FOLLOW_ACTIVE)}
        </option>
        {selection.status === "checking" && (
          <option value={selection.profileId} disabled>
            {t(I18nKey.DCK$MODULE_AGENT_PROFILE_CHECKING, {
              id: selection.profileId,
            })}
          </option>
        )}
        {selection.status === "unavailable" && (
          <option
            value={selection.profileId ?? REMOVED_MODULE_PROFILE}
            disabled
          >
            {selection.profileId
              ? t(I18nKey.AUTOMATIONS$UNAVAILABLE_AGENT_PROFILE, {
                  id: selection.profileId,
                })
              : t(I18nKey.DCK$MODULE_AGENT_PROFILE_REMOVED)}
          </option>
        )}
        {profiles.map((profile) =>
          profile.id ? (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ) : null,
        )}
      </select>
      {hasUnavailableSelection && (
        <span
          id={`${selectorId}-warning`}
          data-testid={`dck-module-agent-profile-warning-${moduleId}`}
          role="alert"
          className="text-xs text-danger"
        >
          {t(I18nKey.DCK$MODULE_AGENT_PROFILE_STALE)}
        </span>
      )}
    </label>
  );
}
