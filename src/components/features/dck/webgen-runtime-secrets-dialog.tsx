import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import {
  deleteWebgenRuntimeSecret,
  fetchWebgenRuntimeSecrets,
  migrateWebgenRuntimeSecret,
  saveWebgenRuntimeSecret,
  WebgenServiceError,
  type WebgenLegacySecretCandidate,
  type WebgenRuntimeSecretsResponse,
} from "#/dck/webgen-service";

const ENV_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// @spec WR-020 — This dialog lists secret names only; saved values are never rendered or cached.
export function WebgenRuntimeSecretsDialog({
  projectSlug,
  projectName,
  onClose,
}: {
  projectSlug: string;
  projectName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("openhands");
  const [data, setData] = useState<WebgenRuntimeSecretsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [confirmCandidate, setConfirmCandidate] = useState<string | null>(null);
  const [ambiguousConfirmed, setAmbiguousConfirmed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setData(await fetchWebgenRuntimeSecrets(projectSlug));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAfterMutation = async () => {
    try {
      setData(await fetchWebgenRuntimeSecrets(projectSlug));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  };

  const clearFeedback = () => {
    setFeedback("");
    setErrorMessage("");
  };

  const submitNew = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    const name = newName.trim();
    if (!ENV_NAME.test(name)) {
      setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_INVALID_NAME));
      return;
    }
    if (!newValue) {
      setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_VALUE_REQUIRED));
      return;
    }
    setBusy(true);
    try {
      await saveWebgenRuntimeSecret(projectSlug, name, newValue);
      setNewName("");
      setNewValue("");
      setFeedback(t(I18nKey.DCK$RUNTIME_SECRET_SAVED));
      await refreshAfterMutation();
    } catch {
      setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_OPERATION_ERROR));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (name: string) => {
    clearFeedback();
    setBusy(true);
    try {
      await saveWebgenRuntimeSecret(projectSlug, name, editValue);
      setEditingName(null);
      setEditValue("");
      setFeedback(t(I18nKey.DCK$RUNTIME_SECRET_SAVED));
      await refreshAfterMutation();
    } catch {
      setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_OPERATION_ERROR));
    } finally {
      setBusy(false);
    }
  };

  const deleteSecret = async (name: string) => {
    clearFeedback();
    setBusy(true);
    try {
      await deleteWebgenRuntimeSecret(projectSlug, name);
      setDeleteName(null);
      setEditingName(null);
      setEditValue("");
      await refreshAfterMutation();
    } catch {
      setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_OPERATION_ERROR));
    } finally {
      setBusy(false);
    }
  };

  const moveCandidate = async (candidate: WebgenLegacySecretCandidate) => {
    clearFeedback();
    setBusy(true);
    try {
      const result = await migrateWebgenRuntimeSecret(
        projectSlug,
        candidate.source_name,
        candidate.ambiguous && ambiguousConfirmed,
      );
      setConfirmCandidate(null);
      setAmbiguousConfirmed(false);
      setFeedback(
        result.pending
          ? t(I18nKey.DCK$RUNTIME_SECRET_MOVE_PENDING)
          : t(I18nKey.DCK$RUNTIME_SECRET_MOVED),
      );
      await refreshAfterMutation();
    } catch (error) {
      if (
        error instanceof WebgenServiceError &&
        (error.code === "migration_pending" ||
          error.code === "migration_source_still_exists")
      ) {
        setFeedback(t(I18nKey.DCK$RUNTIME_SECRET_MOVE_PENDING));
      } else if (
        error instanceof WebgenServiceError &&
        error.code === "migration_confirmation_required"
      ) {
        setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_AMBIGUOUS_WARNING));
      } else {
        setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_OPERATION_ERROR));
      }
      await refreshAfterMutation();
    } finally {
      setBusy(false);
    }
  };

  const pendingSources = new Set(
    (data?.pending_migrations ?? []).map((item) => item.source_name),
  );

  return (
    <ModalBackdrop
      onClose={onClose}
      aria-label={t(I18nKey.DCK$RUNTIME_SECRETS_TITLE, { name: projectName })}
    >
      <section
        data-testid="dck-webgen-runtime-secrets-dialog"
        className="webgen-runtime-secrets-dialog m-4 flex max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-canvas-base shadow-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <KeyRound
              className="mt-1 size-5 shrink-0 text-accent"
              aria-hidden
            />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-contrast">
                {t(I18nKey.DCK$RUNTIME_SECRETS_TITLE, { name: projectName })}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                {t(I18nKey.DCK$RUNTIME_SECRETS_DESCRIPTION)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(I18nKey.BUTTON$CLOSE)}
            className="rounded p-1 text-text-tertiary hover:bg-surface hover:text-contrast"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          {loading && (
            <p className="py-5 text-sm text-text-secondary" role="status">
              {t(I18nKey.DCK$LOADING)}
            </p>
          )}
          {loadError && (
            <div
              className="my-4 flex flex-wrap items-center justify-between gap-3"
              role="alert"
            >
              <p className="text-sm text-danger">{t(I18nKey.DCK$LOAD_ERROR)}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="text-sm font-medium text-accent hover:underline"
              >
                {t(I18nKey.DCK$RETRY)}
              </button>
            </div>
          )}

          {!loading && data && (
            <>
              <section
                className="mt-5"
                aria-labelledby="runtime-secret-list-title"
              >
                <h3
                  id="runtime-secret-list-title"
                  className="text-sm font-semibold text-contrast"
                >
                  {t(I18nKey.DCK$RUNTIME_SECRET_LIST_TITLE)}
                </h3>
                {data.secrets.length === 0 ? (
                  <p className="mt-2 text-sm text-text-secondary">
                    {t(I18nKey.DCK$RUNTIME_SECRET_EMPTY)}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                    {data.secrets.map((secret) => (
                      <li key={secret.name} className="px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <code className="break-all text-sm font-medium text-contrast">
                              {secret.name}
                            </code>
                            <span className="ml-2 text-xs text-text-tertiary">
                              {t(I18nKey.DCK$RUNTIME_SECRET_CONFIGURED_HIDDEN)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              data-testid={`dck-webgen-runtime-secret-edit-${secret.name}`}
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                clearFeedback();
                                setEditingName(
                                  editingName === secret.name
                                    ? null
                                    : secret.name,
                                );
                                setEditValue("");
                                setDeleteName(null);
                              }}
                              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-contrast hover:bg-surface disabled:opacity-50"
                            >
                              {t(I18nKey.DCK$RUNTIME_SECRET_EDIT)}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                clearFeedback();
                                setDeleteName(
                                  deleteName === secret.name
                                    ? null
                                    : secret.name,
                                );
                                setEditingName(null);
                                setEditValue("");
                              }}
                              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-surface disabled:opacity-50"
                            >
                              {t(I18nKey.DCK$DELETE)}
                            </button>
                          </div>
                        </div>
                        {editingName === secret.name && (
                          <form
                            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveEdit(secret.name);
                            }}
                          >
                            <label className="flex-1 text-xs font-medium text-text-secondary">
                              {t(I18nKey.DCK$RUNTIME_SECRET_NEW_VALUE)}
                              <input
                                data-testid="dck-webgen-runtime-secret-edit-value"
                                type="password"
                                autoComplete="new-password"
                                spellCheck={false}
                                value={editValue}
                                onChange={(event) =>
                                  setEditValue(event.target.value)
                                }
                                className="mt-1 block w-full rounded-md border border-border bg-canvas-base px-3 py-2 text-sm text-contrast outline-none focus:border-accent"
                              />
                            </label>
                            <button
                              data-testid="dck-webgen-runtime-secret-edit-save"
                              type="submit"
                              disabled={busy}
                              className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                              {t(I18nKey.BUTTON$SAVE)}
                            </button>
                          </form>
                        )}
                        {deleteName === secret.name && (
                          <div
                            className="mt-3 rounded-md border border-danger/40 bg-canvas-base p-3"
                            role="group"
                            aria-label={t(
                              I18nKey.DCK$RUNTIME_SECRET_DELETE_CONFIRM,
                              { name: secret.name },
                            )}
                          >
                            <p className="text-sm text-text-secondary">
                              {t(I18nKey.DCK$RUNTIME_SECRET_DELETE_CONFIRM, {
                                name: secret.name,
                              })}
                            </p>
                            <div className="mt-3 flex justify-end gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setDeleteName(null)}
                                className="rounded border border-border px-3 py-2 text-sm text-contrast disabled:opacity-50"
                              >
                                {t(I18nKey.BUTTON$CANCEL)}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void deleteSecret(secret.name)}
                                className="rounded bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                              >
                                {t(I18nKey.DCK$DELETE)}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <form
                className="mt-5 rounded-md border border-border p-3"
                onSubmit={submitNew}
              >
                <h3 className="text-sm font-semibold text-contrast">
                  {t(I18nKey.DCK$RUNTIME_SECRET_ADD_TITLE)}
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-text-secondary">
                    {t(I18nKey.DCK$RUNTIME_SECRET_NAME)}
                    <input
                      data-testid="dck-webgen-runtime-secret-name"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      aria-invalid={
                        errorMessage
                          ? !ENV_NAME.test(newName.trim())
                          : undefined
                      }
                      aria-describedby={
                        errorMessage ? "dck-runtime-secret-error" : undefined
                      }
                      className="mt-1 block w-full rounded-md border border-border bg-canvas-base px-3 py-2 text-sm text-contrast outline-none focus:border-accent"
                    />
                  </label>
                  <label className="text-xs font-medium text-text-secondary">
                    {t(I18nKey.DCK$RUNTIME_SECRET_VALUE)}
                    <input
                      data-testid="dck-webgen-runtime-secret-value"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={newValue}
                      onChange={(event) => setNewValue(event.target.value)}
                      className="mt-1 block w-full rounded-md border border-border bg-canvas-base px-3 py-2 text-sm text-contrast outline-none focus:border-accent"
                    />
                  </label>
                </div>
                <button
                  data-testid="dck-webgen-runtime-secret-add"
                  type="submit"
                  disabled={busy}
                  className="mt-3 rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t(I18nKey.DCK$RUNTIME_SECRET_ADD)}
                </button>
              </form>

              <section
                className="mt-5 border-t border-border pt-4"
                aria-labelledby="runtime-secret-migration-title"
              >
                <h3
                  id="runtime-secret-migration-title"
                  className="text-sm font-semibold text-contrast"
                >
                  {t(I18nKey.DCK$RUNTIME_SECRET_MIGRATION_TITLE)}
                </h3>
                <p className="mt-2 text-sm text-text-secondary">
                  {t(I18nKey.DCK$RUNTIME_SECRET_MIGRATION_DESCRIPTION)}
                </p>
                {!data.migration_available && (
                  <p className="mt-2 text-sm text-warning" role="status">
                    {t(I18nKey.DCK$RUNTIME_SECRET_MIGRATION_UNAVAILABLE)}
                  </p>
                )}
                {data.migration_candidates.length === 0 ? (
                  <p className="mt-2 text-sm text-text-secondary">
                    {t(I18nKey.DCK$RUNTIME_SECRET_MIGRATION_EMPTY)}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                    {data.migration_candidates.map((candidate) => {
                      const isPending =
                        Boolean(candidate.pending) ||
                        pendingSources.has(candidate.source_name);
                      return (
                        <li key={candidate.source_name} className="px-3 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 text-sm">
                              <p className="break-all">
                                <span className="text-text-secondary">
                                  {t(I18nKey.DCK$RUNTIME_SECRET_AGENT_NAME)}:
                                </span>{" "}
                                <code>{candidate.source_name}</code>
                              </p>
                              <p className="mt-1 break-all">
                                <span className="text-text-secondary">
                                  {t(I18nKey.DCK$RUNTIME_SECRET_APP_NAME)}:
                                </span>{" "}
                                <code>{candidate.runtime_name}</code>
                              </p>
                              {isPending && (
                                <p className="mt-1 text-xs text-warning">
                                  {t(I18nKey.DCK$RUNTIME_SECRET_MOVE_PENDING)}
                                </p>
                              )}
                              {candidate.ambiguous && (
                                <p className="mt-1 text-xs text-warning">
                                  {t(
                                    I18nKey.DCK$RUNTIME_SECRET_AMBIGUOUS_WARNING,
                                  )}
                                </p>
                              )}
                            </div>
                            <button
                              data-testid={`dck-webgen-runtime-secret-move-${candidate.source_name}`}
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                clearFeedback();
                                setConfirmCandidate(
                                  confirmCandidate === candidate.source_name
                                    ? null
                                    : candidate.source_name,
                                );
                                setAmbiguousConfirmed(false);
                              }}
                              className="shrink-0 rounded border border-border px-3 py-2 text-sm font-medium text-contrast hover:bg-surface disabled:opacity-50"
                            >
                              {isPending
                                ? t(I18nKey.DCK$RUNTIME_SECRET_VERIFY_REMOVAL)
                                : t(I18nKey.DCK$RUNTIME_SECRET_MOVE)}
                            </button>
                          </div>
                          {confirmCandidate === candidate.source_name && (
                            <div className="mt-3 rounded-md border border-border bg-surface p-3">
                              <p className="text-sm text-text-secondary">
                                {t(I18nKey.DCK$RUNTIME_SECRET_MOVE_CONFIRM, {
                                  source: candidate.source_name,
                                  target: candidate.runtime_name,
                                })}
                              </p>
                              {candidate.ambiguous && (
                                <label className="mt-3 flex items-start gap-2 text-sm text-text-secondary">
                                  <input
                                    data-testid="dck-webgen-runtime-secret-ambiguous-confirm"
                                    type="checkbox"
                                    checked={ambiguousConfirmed}
                                    onChange={(event) =>
                                      setAmbiguousConfirmed(
                                        event.target.checked,
                                      )
                                    }
                                    className="mt-1"
                                  />
                                  <span>
                                    {t(
                                      I18nKey.DCK$RUNTIME_SECRET_AMBIGUOUS_WARNING,
                                    )}
                                  </span>
                                </label>
                              )}
                              <div className="mt-3 flex justify-end gap-2">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setConfirmCandidate(null)}
                                  className="rounded border border-border px-3 py-2 text-sm text-contrast disabled:opacity-50"
                                >
                                  {t(I18nKey.BUTTON$CANCEL)}
                                </button>
                                <button
                                  data-testid="dck-webgen-runtime-secret-move-confirm"
                                  type="button"
                                  disabled={
                                    busy ||
                                    (candidate.ambiguous && !ambiguousConfirmed)
                                  }
                                  onClick={() => void moveCandidate(candidate)}
                                  className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                                >
                                  {isPending
                                    ? t(
                                        I18nKey.DCK$RUNTIME_SECRET_VERIFY_REMOVAL,
                                      )
                                    : t(I18nKey.DCK$RUNTIME_SECRET_MOVE)}
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}

          <p className="mt-5 border-t border-border pt-3 text-xs font-medium text-text-tertiary">
            {t(I18nKey.DCK$RUNTIME_SECRET_APPLY_NOTICE)}
          </p>
          {feedback && (
            <p
              className="mt-3 text-sm text-success"
              role="status"
              aria-live="polite"
            >
              {feedback}
            </p>
          )}
          {errorMessage && (
            <p
              id="dck-runtime-secret-error"
              className="mt-3 text-sm text-danger"
              role="alert"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <footer className="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-2 text-sm font-medium text-contrast hover:bg-surface"
          >
            {t(I18nKey.BUTTON$CLOSE)}
          </button>
        </footer>
      </section>
    </ModalBackdrop>
  );
}
