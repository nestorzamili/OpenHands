import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ConfirmationModal } from "#/components/shared/modals/confirmation-modal";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import {
  displayErrorToast,
  displaySuccessToast,
} from "#/utils/custom-toast-handlers";
import { usePortalUser } from "#/hooks/query/use-portal-user";
import {
  createPortalUser,
  deletePortalUser,
  listPortalUsers,
  type PortalUser,
  type PortalUserListEntry,
} from "#/api/portal-auth-service";

export const handle = { hideTitle: true };

type CreateUserInput = {
  username: string;
  password: string;
  isAdmin: boolean;
};

function AddUserModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateUserInput) => Promise<void>;
}) {
  const { t } = useTranslation("openhands");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const inputClass =
    "w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-contrast";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onCreate({ username, password, isAdmin });
      displaySuccessToast(t(I18nKey.PORTAL$USER_CREATED));
      onClose();
    } catch (err) {
      displayErrorToast(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop onClose={submitting ? undefined : onClose}>
      <form
        onSubmit={handleSubmit}
        data-testid="users-create-form"
        className="flex w-[min(420px,92vw)] flex-col gap-4 rounded-xl border border-border bg-base-secondary p-5"
      >
        <h2 className="text-lg font-semibold text-contrast">
          {t(I18nKey.PORTAL$ADD_USER)}
        </h2>
        <div className="flex flex-col gap-3">
          <input
            data-testid="users-create-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t(I18nKey.PORTAL$USERNAME)}
            autoComplete="off"
            required
            className={inputClass}
          />
          <input
            data-testid="users-create-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t(I18nKey.PORTAL$PASSWORD)}
            autoComplete="new-password"
            required
            className={inputClass}
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              data-testid="users-create-admin"
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
            />
            {t(I18nKey.PORTAL$GRANT_ADMIN)}
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <BrandButton
            type="button"
            variant="secondary"
            testId="users-create-cancel"
            onClick={onClose}
            isDisabled={submitting}
          >
            {t(I18nKey.BUTTON$CANCEL)}
          </BrandButton>
          <BrandButton
            type="submit"
            variant="primary"
            isDisabled={submitting || !username || password.length < 8}
            testId="users-create-submit"
          >
            {t(I18nKey.PORTAL$ADD_USER)}
          </BrandButton>
        </div>
      </form>
    </ModalBackdrop>
  );
}

interface UsersSettingsViewProps {
  currentUser: PortalUser | null | undefined;
  users: PortalUserListEntry[];
  isLoading: boolean;
  onCreate: (input: CreateUserInput) => Promise<void>;
  onDelete: (username: string) => Promise<void>;
}

export function UsersSettingsView({
  currentUser,
  users,
  isLoading,
  onCreate,
  onDelete,
}: UsersSettingsViewProps) {
  const { t } = useTranslation("openhands");
  const [addOpen, setAddOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null);

  // Admin-only page: non-admins (and non-portal, where currentUser is null)
  // get an explicit empty state rather than the management UI.
  if (!currentUser?.isAdmin) {
    return (
      <div className="p-6">
        <p
          data-testid="users-settings-forbidden"
          className="text-sm text-text-tertiary"
        >
          {t(I18nKey.PORTAL$USERS_ADMIN_ONLY)}
        </p>
      </div>
    );
  }

  const handleDelete = async (name: string) => {
    try {
      await onDelete(name);
      displaySuccessToast(t(I18nKey.PORTAL$USER_DELETED));
    } catch (err) {
      displayErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="users-settings">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-contrast">
            {t(I18nKey.PORTAL$MANAGE_USERS)}
          </h1>
          <p className="text-sm text-text-tertiary">
            {t(I18nKey.PORTAL$USERS_SUBTITLE)}
          </p>
        </div>
        <BrandButton
          type="button"
          variant="primary"
          testId="users-add-button"
          onClick={() => setAddOpen(true)}
          className="shrink-0"
        >
          {t(I18nKey.PORTAL$ADD_USER)}
        </BrandButton>
      </div>

      <div className="flex flex-col gap-1">
        {isLoading ? (
          <p className="text-sm text-text-tertiary">{t(I18nKey.DCK$LOADING)}</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="users-list">
            {users.map((u) => (
              <li
                key={u.username}
                data-testid={`users-row-${u.username}`}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-contrast">
                  {u.username}
                </span>
                {u.isAdmin && (
                  <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-secondary">
                    {t(I18nKey.PORTAL$ADMIN)}
                  </span>
                )}
                <BrandButton
                  type="button"
                  variant="danger"
                  testId={`users-delete-${u.username}`}
                  isDisabled={u.username === currentUser.username}
                  onClick={() => setPendingDelete(u.username)}
                >
                  {t(I18nKey.PORTAL$DELETE_USER)}
                </BrandButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      {addOpen && (
        <AddUserModal onClose={() => setAddOpen(false)} onCreate={onCreate} />
      )}

      {pendingDelete && (
        <ConfirmationModal
          text={t(I18nKey.PORTAL$DELETE_USER_CONFIRM, { name: pendingDelete })}
          confirmText={t(I18nKey.PORTAL$DELETE_USER)}
          onConfirm={() => handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

export default function UsersSettingsScreen() {
  const queryClient = useQueryClient();
  const { data: currentUser } = usePortalUser();
  const isAdmin = Boolean(currentUser?.isAdmin);

  const { data: users, isLoading } = useQuery({
    queryKey: ["portal-auth", "users"],
    queryFn: listPortalUsers,
    enabled: isAdmin,
    retry: false,
    meta: { disableToast: true },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["portal-auth", "users"] });

  return (
    <UsersSettingsView
      currentUser={currentUser}
      users={users ?? []}
      isLoading={isAdmin && isLoading}
      onCreate={async (input) => {
        await createPortalUser(input);
        await refresh();
      }}
      onDelete={async (name) => {
        await deletePortalUser(name);
        await refresh();
      }}
    />
  );
}
