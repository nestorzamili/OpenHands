import React from "react";
import {
  CirclePlay,
  Globe,
  KeyRound,
  Loader2,
  MoreVertical,
  MessageSquare,
  Play,
  RotateCcw,
  RotateCw,
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
import type { WebgenRuntimeStatus } from "#/dck/webgen-service";
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@heroui/react";

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
  previewPath,
  hasDeployment,
  runtimeStatus,
  onDispatch,
  disabled = false,
  lifecycleDisabled = false,
  onOpen,
  onOpenRuntimeSecrets,
}: {
  appName: string;
  projectPath: string;
  authProvider: string | null;
  publishedSubdomain: string | null;
  previewPath?: string | null;
  hasDeployment?: boolean;
  runtimeStatus?: WebgenRuntimeStatus;
  onDispatch: (
    projectPath: string,
    action: WebgenLifecycleAction,
    appName: string,
    authProvider: string | null,
    subdomain?: string,
  ) => Promise<boolean>;
  disabled?: boolean;
  lifecycleDisabled?: boolean;
  onOpen?: () => void;
  onOpenRuntimeSecrets?: () => void;
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

  const openPublishDialog = () => {
    const currentLabel = publishedSubdomain?.replace(
      /\.dckautoposting\.com$/i,
      "",
    );
    setSubdomain(currentLabel || appName);
    setShowPublishDialog(true);
  };

  const dispatch = async (
    action: WebgenLifecycleAction,
    value?: string,
  ): Promise<boolean> => {
    if (busy || lifecycleDisabled) return false;
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
  const hasExistingDeployment =
    Boolean(previewPath || publishedSubdomain || hasDeployment) ||
    runtimeStatus === "running" ||
    runtimeStatus === "starting";
  const knownLifecycleState =
    runtimeStatus === "running" ||
    runtimeStatus === "stopped" ||
    runtimeStatus === "error";
  const showDeployPreview =
    !hasExistingDeployment &&
    (runtimeStatus === "stopped" || runtimeStatus === "error");
  const showRebuild = hasExistingDeployment && knownLifecycleState;
  const canStart =
    hasExistingDeployment &&
    (runtimeStatus === "stopped" || runtimeStatus === "error");
  const canRestart =
    hasExistingDeployment &&
    (runtimeStatus === "running" || runtimeStatus === "error");
  const canStop =
    hasExistingDeployment &&
    (runtimeStatus === "running" || runtimeStatus === "error");

  const actions = [
    ...(onOpen
      ? [
          {
            id: "chat",
            label: I18nKey.DCK$CHAT_WITH_WEBSITE,
            icon: MessageSquare,
            run: onOpen,
          },
        ]
      : []),
    ...(onOpenRuntimeSecrets
      ? [
          {
            id: "environment",
            label: I18nKey.DCK$RUNTIME_SECRETS_ACTION,
            icon: KeyRound,
            run: onOpenRuntimeSecrets,
          },
        ]
      : []),
    ...(showDeployPreview
      ? [
          {
            id: "deploy",
            label: I18nKey.DCK$DEPLOY_PREVIEW,
            icon: Play,
            run: () => runAction("deploy"),
          },
        ]
      : []),
    ...(showRebuild
      ? [
          {
            id: "rebuild",
            label: I18nKey.DCK$REBUILD,
            icon: RotateCcw,
            run: () => runAction("rebuild"),
          },
        ]
      : []),
    ...(canStart
      ? [
          {
            id: "start",
            label: I18nKey.DCK$START,
            icon: CirclePlay,
            run: () => runAction("start"),
          },
        ]
      : []),
    ...(canRestart
      ? [
          {
            id: "restart",
            label: I18nKey.DCK$RESTART,
            icon: RotateCw,
            run: () => runAction("restart"),
          },
        ]
      : []),
    ...(canStop
      ? [
          {
            id: "stop",
            label: I18nKey.DCK$STOP,
            icon: Square,
            run: () => runAction("stop"),
          },
        ]
      : []),
    ...(!publishedSubdomain
      ? [
          {
            id: "publish",
            label: I18nKey.DCK$PUBLISH,
            icon: Globe,
            run: openPublishDialog,
          },
        ]
      : []),
    ...(publishedSubdomain
      ? [
          {
            id: "unpublish",
            label: I18nKey.DCK$UNPUBLISH,
            icon: XCircle,
            run: () => setConfirmingUnpublish(true),
          },
        ]
      : []),
    {
      id: "delete",
      label: I18nKey.DCK$DELETE,
      icon: Trash2,
      run: () => setConfirmingDelete(true),
    },
  ];

  return (
    <div className="flex shrink-0 items-center justify-end">
      <Dropdown placement="bottom-end" disableAnimation>
        <DropdownTrigger>
          <button
            type="button"
            disabled={busy}
            data-testid="dck-lifecycle-menu"
            aria-label={t(I18nKey.DCK$LIFECYCLE_ACTIONS)}
            className="inline-flex size-11 items-center justify-center rounded text-text-secondary hover:bg-surface hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <MoreVertical className="size-4" aria-hidden />
            )}
          </button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label={t(I18nKey.DCK$LIFECYCLE_ACTIONS)}
          disabledKeys={actions
            .filter(
              (action) =>
                busy ||
                (lifecycleDisabled &&
                  action.id !== "chat" &&
                  action.id !== "environment"),
            )
            .map((action) => action.id)}
          onAction={(key) => actions.find((action) => action.id === key)?.run()}
        >
          {actions.map((action) => (
            <DropdownItem
              key={action.id}
              data-testid={`dck-lifecycle-${action.id}`}
              textValue={t(action.label)}
              startContent={
                <action.icon className="size-4 shrink-0" aria-hidden />
              }
              className={action.id === "delete" ? "text-danger" : undefined}
              color={action.id === "delete" ? "danger" : "default"}
            >
              {t(action.label)}
            </DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>

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
                  aria-describedby={`dck-webgen-publish-subdomain-hint${subdomain.length > 0 && !isSubdomainValid ? " dck-webgen-publish-subdomain-error" : ""}`}
                  data-testid="dck-webgen-publish-subdomain-input"
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none"
                />
                <span className="whitespace-nowrap border-l border-border px-2 py-2 text-xs text-text-tertiary">
                  {t(I18nKey.DCK$PUBLISH_DOMAIN_SUFFIX)}
                </span>
              </span>
              <span
                id="dck-webgen-publish-subdomain-hint"
                className="text-xs font-normal text-text-tertiary"
              >
                {t(I18nKey.DCK$PUBLISH_SUBDOMAIN_HINT)}
              </span>
              {subdomain.length > 0 && !isSubdomainValid && (
                <span
                  id="dck-webgen-publish-subdomain-error"
                  role="alert"
                  data-testid="dck-webgen-publish-subdomain-error"
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
