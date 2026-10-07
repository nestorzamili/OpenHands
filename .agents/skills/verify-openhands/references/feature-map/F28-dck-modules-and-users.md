# DCK modules and portal users

DCK module pages expose workspace-backed project or conversation lists, while the portal users page lets an administrator inspect and manage login accounts.

Source: `src/routes/module-detail.tsx`, `src/components/features/dck/`, `src/routes/users-settings.tsx`, `src/api/portal-auth-service.ts`.

## Sub-features

- `F28.module-workspaces`: a DCK module route shows the module and its project or conversation workspace.
- `F28.portal-user-administration`: a portal administrator can inspect the user list and open the create-user form; non-admins receive an explicit access-denied state.

## How to get to it (user POV)

- Open a DCK module from the module navigation, or enter `/modules/<moduleId>` directly (for example, `/modules/webgen`).
- Open `/settings/users` directly while signed in as a portal administrator. Non-admin users see an access-denied state instead of the management UI.

## Driving it with control-openhands

Preconditions:

- Launch this checkout and confirm `control-openhands doctor` is `ok`.
- Configure the DCK workspace and ensure the built-in `webgen` module is available.
- For the users page, sign in through the portal with an administrator account.

- **Open a module (`F28.module-workspaces`).** Run `control-openhands browser goto /modules/webgen`, `control-openhands browser wait 'testid=dck-module-detail-webgen'`, then `control-openhands browser snapshot 'testid=dck-module-detail-webgen'`. The module heading and its project state are visible; the New Project action is present when the workspace is ready. Capture `control-openhands browser screenshot --feature F28.module-workspaces --name webgen`.
- **Inspect portal users (`F28.portal-user-administration`).** Run `control-openhands browser goto /settings/users`, `control-openhands browser wait 'testid=users-settings'`, then `control-openhands browser snapshot 'testid=users-settings'`. The management heading, user list, and Add User control are present. This read-only check does not create or delete an account; capture `control-openhands browser screenshot --feature F28.portal-user-administration --name admin-users`.
- **Check non-admin access (`F28.portal-user-administration`).** In a separate session signed in as a non-admin, open `/settings/users` and run `control-openhands browser wait 'testid=users-settings-forbidden'`. The explicit admin-only state is shown and no user-management controls are available.

## Gotchas

- The module page depends on the DCK workspace root and module configuration; an empty project list is valid when no projects exist.
- `/settings/users` is portal-only and admin-gated. Do not interpret its access-denied state outside the portal-admin precondition as a rendering failure.
- The current administrator cannot delete their own account; this map does not exercise account creation or deletion.
