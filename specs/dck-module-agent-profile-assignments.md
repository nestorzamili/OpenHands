# DCK Module Agent Profile Assignments

### DCK-PROFILE-001: Server-backed persistence

- A module's selected Agent Profile is a user preference, not module-definition data.
- Persist `dck_module_agent_profile_assignments` through the settings service; do not write current assignments to browser storage or `.dck/modules.json`.
- Local Agent Server stores it in `misc_settings.app_preferences` using `PATCH /api/settings` and `misc_settings_diff`.
- Cloud round-trips the same flat preference through `/api/v1/settings`; the selected organization context must accompany the request.
- Module definitions and built-in overrides remain in `.dck/modules.json`.

### DCK-PROFILE-002: Stable scope

- The stored shape is `{ [scopeKey]: { [moduleId]: profileId } }`.
- `scopeKey` is the JSON tuple `[organizationId, normalizedWorkspaceRoot]`; `organizationId` is `null` when the active settings scope has no selected organization.
- User identity is provided by the settings service: a Local Agent Server's settings are server-owned, and Cloud preferences are owned by the authenticated account and selected organization.
- A module with no entry is unassigned. A saved empty scope represents no assigned profiles.

### ~~DCK-PROFILE-003: Retired~~

### DCK-PROFILE-004: No implicit profile fallback

- Never substitute the globally active Agent Profile when a module has no assignment or its assigned profile is missing/deleted.
- Unassigned, unresolved, and unavailable selections block module conversation creation and module launch actions.
- Keep a stale ID visible in the module editor and blocked until the user explicitly chooses an available profile.
- Changing the global active profile does not change any module assignment.

### Verification

- Local settings tests assert the nested `misc_settings_diff.app_preferences` save and GET round-trip.
- Cloud settings tests assert assignment round-trip and selected organization context.
- DCK tests cover stable scope, settings-only reads, deletion cleanup, unassigned/stale launch blocking, and no active-profile fallback.
