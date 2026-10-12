import React from "react";
import {
  Globe,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandButton } from "#/components/features/settings/brand-button";
import { ConfirmationModal } from "#/components/shared/modals/confirmation-modal";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { I18nKey } from "#/i18n/declaration";
import type { WebgenLifecycleAction } from "#/dck/webgen-lifecycle";
import { cn } from "#/utils/utils";

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_SUBDOMAINS = new Set([
  "agent",
  "www",
  "api",
  "mail",
  "smtp",
  "ftp",
  "admin",
  "root",
  "ns1",
  "ns2",
  "localhost",
]);

export function WebgenLifecycleActions({
  appName,
  projectPath,
  authProvider,
  publishedSubdomain,
  onDispatch,
  disabled = false,
}: {
  appName: string;
  projectPath: string;
  authProvider: string | null;
  publishedSubdomain: string | null;
  onDispatch: (
    projectPath: string,
    action: WebgenLifecycleAction,
    appName: string,
    authProvider: string | null,
    subdomain?: string,
  ) => Promise<boolean>;
  disabled?: boolean;
}) {
  const { t } = useTranslation("openhands");
  const [showPublishDialog, setShowPublishDialog] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = React.useState(false);
  const [subdomain, setSubdomain] = React.useState(appName);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const subdomainInputRef = React.useRef<HTMLInputElement>(null);
  const busy = disabled || isSubmitting;
  const normalizedSubdomain = subdomain.trim().toLowerCase();
  const isSubdomainValid =
    SUBDOMAIN_PATTERN.test(normalizedSubdomain) &&
    !RESERVED_SUBDOMAINS.has(normalizedSubdomain);

  React.useEffect(() => {
    if (showPublishDialog) subdomainInputRef.current?.focus();
  }, [showPublishDialog]);

  const dispatch = async (
    action: WebgenLifecycleAction,
    value?: string,
  ): Promise<boolean> => {
    if (busy) return false;
    setIsSubmitting(true);
    try {
      return await onDispatch(
        projectPath,
        action,
        appName,
        authProvider,
        value,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const runAction = (action: WebgenLifecycleAction) => {
    void dispatch(action);
  };

  const iconClassName = "size-4 shrink-0";
  const actionButtonClass =
    "inline-flex size-11 items-center justify-center rounded border border-border text-text-secondary hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => runAction("deploy")}
        data-testid="dck-lifecycle-deploy"
        aria-label={t(I18nKey.DCK$DEPLOY)}
        title={t(I18nKey.DCK$DEPLOY)}
        className={actionButtonClass}
      >
        {busy ? (
          <Loader2 className={cn(iconClassName, "animate-spin")} aria-hidden />
        ) : (
          <Play className={iconClassName} aria-hidden />
        )}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => runAction("rebuild")}
        data-testid="dck-lifecycle-rebuild"
        aria-label={t(I18nKey.DCK$REBUILD)}
        title={t(I18nKey.DCK$REBUILD)}
        className={actionButtonClass}
      >
        <RotateCcw className={iconClassName} aria-hidden />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => runAction("stop")}
        data-testid="dck-lifecycle-stop"
        aria-label={t(I18nKey.DCK$STOP)}
        title={t(I18nKey.DCK$STOP)}
        className={actionButtonClass}
      >
        <Square className={iconClassName} aria-hidden />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setShowPublishDialog(true)}
        data-testid="dck-lifecycle-publish"
        aria-label={t(I18nKey.DCK$PUBLISH)}
        title={t(I18nKey.DCK$PUBLISH)}
        className={actionButtonClass}
      >
        <Globe className={iconClassName} aria-hidden />
      </button>
      {publishedSubdomain && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmingUnpublish(true)}
          data-testid="dck-lifecycle-unpublish"
          aria-label={t(I18nKey.DCK$UNPUBLISH)}
          title={t(I18nKey.DCK$UNPUBLISH)}
          className={actionButtonClass}
        >
          <XCircle className={iconClassName} aria-hidden />
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirmingDelete(true)}
        data-testid="dck-lifecycle-delete"
        aria-label={t(I18nKey.DCK$DELETE)}
        title={t(I18nKey.DCK$DELETE)}
        className={cn(
          actionButtonClass,
          "text-status-error hover:text-status-error",
        )}
      >
        <Trash2 className={iconClassName} aria-hidden />
      </button>

      {showPublishDialog && (
        <ModalBackdrop
          onClose={busy ? undefined : () => setShowPublishDialog(false)}
          closeOnEscape={!busy}
          closeOnBackdropClick={!busy}
          aria-label={t(I18nKey.DCK$PUBLISH_DIALOG_TITLE, { name: appName })}
        >
          <form
            data-testid="dck-webgen-publish-dialog"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!isSubdomainValid || busy) return;
              const succeeded = await dispatch("publish", normalizedSubdomain);
              if (succeeded) setShowPublishDialog(false);
            }}
            className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-base-secondary p-5"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-contrast">
                {t(I18nKey.DCK$PUBLISH_DIALOG_TITLE, { name: appName })}
              </h2>
              <p className="text-sm text-text-tertiary">
                {t(I18nKey.DCK$PUBLISH_DIALOG_DESCRIPTION)}
              </p>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-contrast">
              {t(I18nKey.DCK$PUBLISH_SUBDOMAIN_LABEL)}
              <span className="flex items-center overflow-hidden rounded-md border border-border bg-base-secondary">
                <input
                  ref={subdomainInputRef}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={63}
                  required
                  value={subdomain}
                  onChange={(event) => setSubdomain(event.target.value)}
                  disabled={busy}
                  aria-invalid={subdomain.length > 0 && !isSubdomainValid}
                  aria-describedby={`dck-webgen-subdomain-hint${subdomain.length > 0 && !isSubdomainValid ? " dck-webgen-subdomain-error" : ""}`}
                  data-testid="dck-webgen-subdomain-input"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none"
                />
                <span className="whitespace-nowrap border-l border-border px-2 py-2 text-xs text-text-tertiary">
                  {t(I18nKey.DCK$PUBLISH_DOMAIN_SUFFIX)}
                </span>
              </span>
              <span
                id="dck-webgen-subdomain-hint"
                className="text-xs font-normal text-text-tertiary"
              >
                {t(I18nKey.DCK$PUBLISH_SUBDOMAIN_HINT)}
              </span>
              {subdomain.length > 0 && !isSubdomainValid && (
                <span
                  role="alert"
                  data-testid="dck-webgen-subdomain-error"
                  className="text-xs font-normal text-status-error"
                >
                  {t(I18nKey.DCK$PUBLISH_SUBDOMAIN_INVALID)}
                </span>
              )}
            </label>
            <div className="flex justify-end gap-2">
              <BrandButton
                testId="dck-webgen-publish-cancel"
                type="button"
                variant="secondary"
                isDisabled={busy}
                onClick={() => setShowPublishDialog(false)}
              >
                {t(I18nKey.BUTTON$CANCEL)}
              </BrandButton>
              <BrandButton
                testId="dck-webgen-publish-submit"
                type="submit"
                variant="primary"
                isDisabled={!isSubdomainValid || busy}
                aria-busy={busy}
              >
                {t(I18nKey.DCK$PUBLISH)}
              </BrandButton>
            </div>
          </form>
        </ModalBackdrop>
      )}

      {confirmingUnpublish && publishedSubdomain && (
        <ConfirmationModal
          text={t(I18nKey.DCK$UNPUBLISH_CONFIRM, {
            domain: publishedSubdomain,
          })}
          confirmText={t(I18nKey.DCK$UNPUBLISH)}
          isConfirming={busy}
          onConfirm={async () => {
            const succeeded = await dispatch("unpublish");
            if (succeeded) setConfirmingUnpublish(false);
          }}
          onCancel={() => setConfirmingUnpublish(false)}
        />
      )}

      {confirmingDelete && (
        <ConfirmationModal
          text={t(I18nKey.DCK$DELETE_CONFIRM, { name: appName })}
          confirmText={t(I18nKey.DCK$DELETE)}
          isConfirming={busy}
          onConfirm={async () => {
            const succeeded = await dispatch("delete");
            if (succeeded) setConfirmingDelete(false);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
