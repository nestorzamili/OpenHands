import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import {
  deleteWebgenRuntimeSecret,
  fetchWebgenRuntimeSecrets,
  fetchWebgenRuntimeSecretValue,
  saveWebgenRuntimeSecret,
  type WebgenRuntimeSecretsResponse,
} from "#/dck/webgen-service";

const ENV_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// @spec WR-020 — Values stay hidden until an authenticated user explicitly reveals them.
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
  const [newSensitive, setNewSensitive] = useState(true);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSensitive, setEditSensitive] = useState(true);
  const [revealedSecret, setRevealedSecret] = useState<{
    name: string;
    value: string;
  } | null>(null);
  const [revealBusyName, setRevealBusyName] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setRevealedSecret(null);
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
    setRevealedSecret(null);
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

  const toggleReveal = async (name: string) => {
    clearFeedback();
    if (revealedSecret?.name === name) {
      setRevealedSecret(null);
      return;
    }
    setRevealedSecret(null);
    setRevealBusyName(name);
    try {
      const result = await fetchWebgenRuntimeSecretValue(projectSlug, name);
      if (result.name !== name) throw new Error("Unexpected secret response");
      setRevealedSecret({ name, value: result.value });
    } catch {
      setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_OPERATION_ERROR));
    } finally {
      setRevealBusyName(null);
    }
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
      await saveWebgenRuntimeSecret(projectSlug, name, newValue, newSensitive);
      setNewName("");
      setNewValue("");
      setNewSensitive(true);
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
      await saveWebgenRuntimeSecret(
        projectSlug,
        name,
        editValue,
        editSensitive,
      );
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
      setRevealedSecret(null);
      await refreshAfterMutation();
    } catch {
      setErrorMessage(t(I18nKey.DCK$RUNTIME_SECRET_OPERATION_ERROR));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalBackdrop
      onClose={onClose}
      aria-label={t(I18nKey.DCK$RUNTIME_SECRETS_TITLE, { name: projectName })}
    >
      <section
        data-testid="dck-webgen-runtime-secrets-dialog"
        className="webgen-runtime-secrets-dialog m-4 flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-canvas-base shadow-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <KeyRound
              className="mt-1 size-5 shrink-0 text-accent"
              aria-hidden
            />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-contrast">
                {t(I18nKey.DCK$RUNTIME_SECRETS_TITLE, { name: projectName })}
              </h2>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                              {t(
                                secret.sensitive !== false
                                  ? I18nKey.DCK$RUNTIME_SECRET_SENSITIVE
                                  : I18nKey.DCK$RUNTIME_SECRET_NON_SENSITIVE,
                              )}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              data-testid={`dck-webgen-runtime-secret-reveal-${secret.name}`}
                              type="button"
                              disabled={busy || revealBusyName !== null}
                              aria-pressed={
                                revealedSecret?.name === secret.name
                              }
                              onClick={() => void toggleReveal(secret.name)}
                              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-contrast hover:bg-surface disabled:opacity-50"
                            >
                              {revealBusyName === secret.name
                                ? t(I18nKey.DCK$LOADING)
                                : t(
                                    revealedSecret?.name === secret.name
                                      ? I18nKey.DCK$RUNTIME_SECRET_HIDE_VALUE
                                      : I18nKey.DCK$RUNTIME_SECRET_SHOW_VALUE,
                                  )}
                              {revealedSecret?.name === secret.name ? (
                                <EyeOff
                                  className="ml-1 inline size-3.5"
                                  aria-hidden
                                />
                              ) : (
                                <Eye
                                  className="ml-1 inline size-3.5"
                                  aria-hidden
                                />
                              )}
                            </button>
                            <button
                              data-testid={`dck-webgen-runtime-secret-edit-${secret.name}`}
                              type="button"
                              disabled={busy || revealBusyName !== null}
                              onClick={() => {
                                clearFeedback();
                                setEditingName(
                                  editingName === secret.name
                                    ? null
                                    : secret.name,
                                );
                                setEditValue("");
                                setEditSensitive(secret.sensitive !== false);
                                setRevealedSecret(null);
                                setDeleteName(null);
                              }}
                              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-contrast hover:bg-surface disabled:opacity-50"
                            >
                              {t(I18nKey.DCK$RUNTIME_SECRET_EDIT)}
                            </button>
                            <button
                              type="button"
                              disabled={busy || revealBusyName !== null}
                              onClick={() => {
                                clearFeedback();
                                setDeleteName(
                                  deleteName === secret.name
                                    ? null
                                    : secret.name,
                                );
                                setEditingName(null);
                                setEditValue("");
                                setRevealedSecret(null);
                              }}
                              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-surface disabled:opacity-50"
                            >
                              {t(I18nKey.DCK$DELETE)}
                            </button>
                          </div>
                        </div>
                        {revealedSecret?.name === secret.name && (
                          <p
                            className="mt-2 break-all rounded-md bg-surface px-3 py-2 text-sm text-contrast"
                            data-testid={`dck-webgen-runtime-secret-value-${secret.name}`}
                            role="status"
                          >
                            <code>{revealedSecret.value}</code>
                          </p>
                        )}
                        {editingName === secret.name && (
                          <form
                            className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
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
                            <label className="text-xs font-medium text-text-secondary">
                              {t(I18nKey.DCK$RUNTIME_SECRET_CLASSIFICATION)}
                              <select
                                data-testid="dck-webgen-runtime-secret-edit-classification"
                                value={
                                  editSensitive ? "sensitive" : "non-sensitive"
                                }
                                onChange={(event) =>
                                  setEditSensitive(
                                    event.target.value === "sensitive",
                                  )
                                }
                                className="mt-1 block w-full rounded-md border border-border bg-canvas-base px-3 py-2 text-sm text-contrast outline-none focus:border-accent"
                              >
                                <option value="sensitive">
                                  {t(I18nKey.DCK$RUNTIME_SECRET_SENSITIVE)}
                                </option>
                                <option value="non-sensitive">
                                  {t(I18nKey.DCK$RUNTIME_SECRET_NON_SENSITIVE)}
                                </option>
                              </select>
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
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
                  <label className="text-xs font-medium text-text-secondary">
                    {t(I18nKey.DCK$RUNTIME_SECRET_CLASSIFICATION)}
                    <select
                      data-testid="dck-webgen-runtime-secret-classification"
                      value={newSensitive ? "sensitive" : "non-sensitive"}
                      onChange={(event) =>
                        setNewSensitive(event.target.value === "sensitive")
                      }
                      className="mt-1 block w-full rounded-md border border-border bg-canvas-base px-3 py-2 text-sm text-contrast outline-none focus:border-accent"
                    >
                      <option value="sensitive">
                        {t(I18nKey.DCK$RUNTIME_SECRET_SENSITIVE)}
                      </option>
                      <option value="non-sensitive">
                        {t(I18nKey.DCK$RUNTIME_SECRET_NON_SENSITIVE)}
                      </option>
                    </select>
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
