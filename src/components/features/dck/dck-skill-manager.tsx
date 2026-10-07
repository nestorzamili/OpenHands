import React from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { BrandButton } from "#/components/features/settings/brand-button";
import { MarkdownRenderer } from "#/components/features/markdown/markdown-renderer";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import {
  extractSkillMarkdownBody,
  getSkillDeleteTarget,
  validateSkillDraft,
  type SkillDraft,
} from "#/dck/skill-authoring";
import {
  readSkillFile,
  useProjectSkills,
  type ProjectSkillSummary,
} from "#/hooks/query/use-project-skills";

const EMPTY_DRAFT: SkillDraft = {
  name: "",
  slug: "",
  description: "",
  triggers: [],
  body: "",
};

type SkillManagerTab = "preview" | "editor";

type Mode =
  | {
      kind: "browse";
      selectedSkill: ProjectSkillSummary | null;
      tab: SkillManagerTab;
    }
  | { kind: "create"; draft: SkillDraft };

function SkillRow({
  skill,
  isSelected,
  onSelect,
  onDelete,
  disabled,
}: {
  skill: ProjectSkillSummary;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("openhands");
  const scopeKey =
    skill.scope === "project"
      ? I18nKey.DCK$SKILL_PROJECT_BADGE
      : skill.scope === "personal"
        ? I18nKey.DCK$SKILL_PERSONAL_BADGE
        : null;

  return (
    <li
      data-testid={`dck-skill-row-${skill.name}`}
      className={cn(
        "flex items-center gap-1 rounded-lg border border-border pr-2",
        isSelected ? "border-primary bg-surface" : "hover:bg-surface",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        aria-pressed={isSelected}
        data-testid={`dck-skill-select-${skill.name}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-contrast">
            {skill.name}
          </span>
          {skill.description && (
            <span className="truncate text-xs text-text-tertiary">
              {skill.description}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {scopeKey && (
            <span
              data-testid={`dck-skill-scope-${skill.name}`}
              className="rounded bg-base-secondary px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-tertiary"
            >
              {t(scopeKey)}
            </span>
          )}
          <span
            data-testid={
              skill.builtin
                ? `dck-skill-public-badge-${skill.name}`
                : `dck-skill-custom-badge-${skill.name}`
            }
            className="rounded bg-base-secondary px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-tertiary"
          >
            {t(
              skill.builtin
                ? I18nKey.DCK$SKILL_PUBLIC_BADGE
                : I18nKey.DCK$SKILL_CUSTOM_BADGE,
            )}
          </span>
        </span>
      </button>
      {!skill.builtin && (
        <button
          type="button"
          disabled={disabled || !skill.deletable}
          onClick={onDelete}
          data-testid={`dck-skill-delete-${skill.name}`}
          aria-label={t(I18nKey.DCK$SKILL_DELETE)}
          title={
            skill.deletable
              ? t(I18nKey.DCK$SKILL_DELETE)
              : t(I18nKey.DCK$SKILL_FILE_UNAVAILABLE)
          }
          className="rounded p-1.5 text-text-secondary hover:text-status-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 size={16} aria-hidden />
        </button>
      )}
    </li>
  );
}

function SkillForm({
  initialDraft,
  existingSlugs,
  reservedNames,
  isSaving,
  onCancel,
  onSubmit,
}: {
  initialDraft: SkillDraft;
  existingSlugs: string[];
  reservedNames: string[];
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (draft: SkillDraft) => void;
}) {
  const { t } = useTranslation("openhands");
  const [draft, setDraft] = React.useState<SkillDraft>(initialDraft);
  const [triggersText, setTriggersText] = React.useState(
    initialDraft.triggers.join(", "),
  );
  const [showErrors, setShowErrors] = React.useState(false);

  const parsedTriggers = triggersText
    .split(",")
    .map((trigger) => trigger.trim())
    .filter((trigger) => trigger.length > 0);
  const effectiveDraft: SkillDraft = { ...draft, triggers: parsedTriggers };
  const validation = validateSkillDraft(effectiveDraft, {
    existingSlugs,
    reservedNames,
  });
  const setField = (field: keyof SkillDraft, value: string) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validation.valid) {
      setShowErrors(true);
      return;
    }
    onSubmit(effectiveDraft);
  };

  const fieldClass =
    "w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-contrast";
  const labelClass = "flex flex-col gap-1 text-xs font-medium text-contrast";
  const errorClass = "text-xs text-status-error";

  return (
    <form
      data-testid="dck-skill-form"
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <label className={labelClass}>
        {t(I18nKey.DCK$SKILL_FORM_NAME_LABEL)}
        <input
          type="text"
          data-testid="dck-skill-form-name"
          value={draft.name}
          onChange={(event) => setField("name", event.target.value)}
          className={fieldClass}
        />
        {showErrors && validation.errors.name && (
          <span data-testid="dck-skill-form-name-error" className={errorClass}>
            {t(validation.errors.name)}
          </span>
        )}
      </label>
      <label className={labelClass}>
        {t(I18nKey.DCK$SKILL_FORM_SLUG_LABEL)}
        <input
          type="text"
          data-testid="dck-skill-form-slug"
          value={draft.slug}
          onChange={(event) => setField("slug", event.target.value)}
          className={fieldClass}
        />
        {showErrors && validation.errors.slug && (
          <span data-testid="dck-skill-form-slug-error" className={errorClass}>
            {t(validation.errors.slug)}
          </span>
        )}
      </label>
      <label className={labelClass}>
        {t(I18nKey.DCK$SKILL_FORM_DESCRIPTION_LABEL)}
        <input
          type="text"
          data-testid="dck-skill-form-description"
          value={draft.description}
          onChange={(event) => setField("description", event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className={labelClass}>
        {t(I18nKey.DCK$SKILL_FORM_TRIGGERS_LABEL)}
        <input
          type="text"
          data-testid="dck-skill-form-triggers"
          value={triggersText}
          onChange={(event) => setTriggersText(event.target.value)}
          className={fieldClass}
        />
        <span className="text-xs font-normal text-text-tertiary">
          {t(I18nKey.DCK$SKILL_FORM_TRIGGERS_HINT)}
        </span>
      </label>
      <label className={labelClass}>
        {t(I18nKey.DCK$SKILL_FORM_BODY_LABEL)}
        <textarea
          data-testid="dck-skill-form-body"
          value={draft.body}
          onChange={(event) => setField("body", event.target.value)}
          rows={10}
          className={cn(fieldClass, "resize-y font-mono text-xs")}
        />
        <span className="text-xs font-normal text-text-tertiary">
          {t(I18nKey.DCK$SKILL_FORM_BODY_HINT)}
        </span>
        {showErrors && validation.errors.body && (
          <span data-testid="dck-skill-form-body-error" className={errorClass}>
            {t(validation.errors.body)}
          </span>
        )}
      </label>
      <div className="flex justify-end gap-2">
        <BrandButton
          type="button"
          variant="secondary"
          testId="dck-skill-form-cancel"
          onClick={onCancel}
          isDisabled={isSaving}
        >
          {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
        </BrandButton>
        <BrandButton
          type="submit"
          variant="primary"
          testId="dck-skill-form-save"
          isDisabled={isSaving}
        >
          {t(I18nKey.DCK$SKILL_FORM_SAVE)}
        </BrandButton>
      </div>
    </form>
  );
}

function SkillDetails({
  skill,
  tab,
  onTabChange,
  isSaving,
  onSave,
  onDirtyChange,
}: {
  skill: ProjectSkillSummary;
  tab: SkillManagerTab;
  onTabChange: (tab: SkillManagerTab) => void;
  isSaving: boolean;
  onSave: (source: string) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation("openhands");
  const fallbackContent = skill.content ?? "";
  const [source, setSource] = React.useState(fallbackContent);
  const [savedSource, setSavedSource] = React.useState(fallbackContent);
  const [isLoading, setIsLoading] = React.useState(Boolean(skill.filePath));
  const [loadError, setLoadError] = React.useState(false);
  const canEdit = !skill.builtin && skill.editable && Boolean(skill.filePath);
  const isDirty = source !== savedSource;

  React.useEffect(() => {
    let cancelled = false;
    setSource(fallbackContent);
    setSavedSource(fallbackContent);
    setLoadError(false);

    if (!skill.filePath) {
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);
    void readSkillFile(skill.filePath)
      .then((loadedSource) => {
        if (cancelled) return;
        setSource(loadedSource);
        setSavedSource(loadedSource);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackContent, skill.filePath]);

  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const preview =
    extractSkillMarkdownBody(source) ||
    fallbackContent ||
    skill.description ||
    "";

  const handleSave = async () => {
    if (!canEdit || !isDirty) return;
    if (await onSave(source)) {
      setSavedSource(source);
      onDirtyChange(false);
    }
  };

  const handleDiscard = () => {
    setSource(savedSource);
    onDirtyChange(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <header className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-contrast">
            {skill.name}
          </h3>
          {skill.description && (
            <p className="mt-1 line-clamp-2 text-xs text-text-tertiary">
              {skill.description}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded bg-surface px-2 py-1 text-xs text-text-tertiary">
          {t(
            skill.builtin
              ? I18nKey.DCK$SKILL_PUBLIC_BADGE
              : I18nKey.DCK$SKILL_CUSTOM_BADGE,
          )}
        </span>
      </header>

      <div
        role="group"
        aria-label={t(I18nKey.DCK$SKILL_MANAGER_TITLE)}
        className="flex shrink-0 gap-1 border-b border-border"
      >
        <button
          type="button"
          aria-pressed={tab === "preview"}
          data-testid="dck-skill-tab-preview"
          onClick={() => onTabChange("preview")}
          className={cn(
            "border-b-2 px-3 py-2 text-sm",
            tab === "preview"
              ? "border-primary font-medium text-contrast"
              : "border-transparent text-text-secondary hover:text-contrast",
          )}
        >
          {t(I18nKey.DCK$SKILL_EDITOR_PREVIEW)}
        </button>
        {!skill.builtin && (
          <button
            type="button"
            aria-pressed={tab === "editor"}
            disabled={!canEdit}
            title={canEdit ? undefined : t(I18nKey.DCK$SKILL_FILE_UNAVAILABLE)}
            data-testid="dck-skill-tab-editor"
            onClick={() => onTabChange("editor")}
            className={cn(
              "border-b-2 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40",
              tab === "editor"
                ? "border-primary font-medium text-contrast"
                : "border-transparent text-text-secondary hover:text-contrast",
            )}
          >
            {t(I18nKey.DCK$SKILL_EDITOR_TAB)}
          </button>
        )}
      </div>

      {tab === "preview" ? (
        <section
          data-testid="dck-skill-preview-panel"
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-base p-4 text-sm text-contrast"
        >
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t(I18nKey.DCK$SKILL_LOADING)}
            </div>
          ) : preview ? (
            <MarkdownRenderer includeStandard includeHeadings>
              {preview}
            </MarkdownRenderer>
          ) : (
            <p className="text-xs text-text-tertiary">
              {t(I18nKey.DCK$SKILL_PREVIEW_UNAVAILABLE)}
            </p>
          )}
        </section>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {skill.filePath && (
            <p
              data-testid="dck-skill-source-path"
              className="shrink-0 break-all font-mono text-xs text-text-tertiary"
            >
              {skill.filePath}
            </p>
          )}
          {loadError ? (
            <p className="text-xs text-status-error">
              {t(I18nKey.DCK$SKILL_PREVIEW_LOAD_ERROR)}
            </p>
          ) : isLoading ? (
            <div className="flex flex-1 items-center justify-center text-xs text-text-tertiary">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              <span className="sr-only">{t(I18nKey.DCK$SKILL_LOADING)}</span>
            </div>
          ) : (
            <div
              data-testid="dck-skill-source-editor-layout"
              className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2"
            >
              <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
                <h4 className="border-b border-border px-3 py-2 text-xs font-semibold text-contrast">
                  {t(I18nKey.DCK$SKILL_EDITOR_SOURCE)}
                </h4>
                <textarea
                  data-testid="dck-skill-source-textarea"
                  aria-label={t(I18nKey.DCK$SKILL_EDITOR_SOURCE)}
                  spellCheck={false}
                  value={source}
                  onChange={(event) => {
                    const normalized = event.target.value.replace(
                      /\r\n?/g,
                      "\n",
                    );
                    const nextSource = normalized.replace(/\n/g, lineEnding);
                    setSource(nextSource);
                    onDirtyChange(nextSource !== savedSource);
                  }}
                  className="min-h-72 flex-1 resize-none border-0 bg-base p-3 font-mono text-xs leading-5 text-contrast outline-none focus:ring-0"
                />
              </section>
              <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
                <h4 className="border-b border-border px-3 py-2 text-xs font-semibold text-contrast">
                  {t(I18nKey.DCK$SKILL_EDITOR_PREVIEW)}
                </h4>
                <div
                  data-testid="dck-skill-markdown-preview"
                  className="min-h-72 flex-1 overflow-y-auto bg-base p-4 text-sm text-contrast"
                >
                  <MarkdownRenderer includeStandard includeHeadings>
                    {preview}
                  </MarkdownRenderer>
                </div>
              </section>
            </div>
          )}
          <div className="flex shrink-0 justify-end gap-2">
            <BrandButton
              type="button"
              variant="secondary"
              testId="dck-skill-editor-cancel"
              onClick={handleDiscard}
              isDisabled={isSaving || !isDirty}
            >
              {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
            </BrandButton>
            <BrandButton
              type="button"
              variant="primary"
              testId="dck-skill-editor-save"
              onClick={() => void handleSave()}
              isDisabled={
                isSaving || !isDirty || !canEdit || isLoading || loadError
              }
            >
              {t(I18nKey.DCK$SKILL_FORM_SAVE)}
            </BrandButton>
          </div>
        </div>
      )}
    </div>
  );
}

function DeleteSkillConfirm({
  skill,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  skill: ProjectSkillSummary;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("openhands");
  const target = skill.filePath ? getSkillDeleteTarget(skill.filePath) : null;
  return (
    <ModalBackdrop onClose={isDeleting ? undefined : onCancel}>
      <div
        data-testid="dck-skill-delete-confirm"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-base-secondary p-4"
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm text-contrast">
            {t(I18nKey.DCK$SKILL_DELETE_CONFIRM, {
              name: skill.name,
              path: target?.path ?? skill.filePath ?? "",
            })}
          </p>
          {target && (
            <code
              data-testid="dck-skill-delete-path"
              className="break-all rounded bg-base p-2 font-mono text-xs text-text-secondary"
            >
              {target.path}
            </code>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <BrandButton
            type="button"
            variant="secondary"
            testId="dck-skill-delete-cancel"
            onClick={onCancel}
            isDisabled={isDeleting}
          >
            {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
          </BrandButton>
          <BrandButton
            type="button"
            variant="danger"
            testId="dck-skill-delete-confirm-button"
            onClick={onConfirm}
            isDisabled={isDeleting}
          >
            {t(I18nKey.DCK$SKILL_DELETE)}
          </BrandButton>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function DiscardSkillChangesConfirm({
  skillName,
  onKeepEditing,
  onDiscard,
}: {
  skillName: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation("openhands");
  return (
    <ModalBackdrop onClose={onKeepEditing}>
      <div
        data-testid="dck-skill-discard-confirm"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-base-secondary p-4"
      >
        <p className="text-sm text-contrast">
          {t(I18nKey.DCK$SKILL_DISCARD_CONFIRM, { name: skillName })}
        </p>
        <div className="flex justify-end gap-2">
          <BrandButton
            type="button"
            variant="secondary"
            testId="dck-skill-discard-cancel"
            onClick={onKeepEditing}
          >
            {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
          </BrandButton>
          <BrandButton
            type="button"
            variant="danger"
            testId="dck-skill-discard-confirm-button"
            onClick={onDiscard}
          >
            {t(I18nKey.DCK$SKILL_DISCARD)}
          </BrandButton>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export function DckSkillManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("openhands");
  const {
    skills,
    editableSkills,
    isSaving,
    isDeleting,
    saveSkill,
    saveSkillSource,
    deleteSkill,
    refetch,
  } = useProjectSkills();
  const [mode, setMode] = React.useState<Mode>({
    kind: "browse",
    selectedSkill: null,
    tab: "preview",
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<(() => void) | null>(
    null,
  );
  const [deletingSkill, setDeletingSkill] =
    React.useState<ProjectSkillSummary | null>(null);

  const reservedNames = skills
    .filter((skill) => skill.builtin)
    .map((skill) => skill.name);
  const existingSlugsExcluding = (slug: string | null): string[] =>
    editableSkills
      .filter((skill) => skill.scope === "project")
      .map((skill) => skill.name)
      .filter((name) => name !== slug);

  const requestAction = (action: () => void) => {
    if (hasUnsavedChanges) {
      setPendingAction(() => action);
      return;
    }
    action();
  };

  const confirmDiscardChanges = () => {
    const action = pendingAction;
    setPendingAction(null);
    setHasUnsavedChanges(false);
    action?.();
  };

  const handleCloseRequest = () =>
    requestAction(() => {
      void refetch();
      onClose();
    });

  const openCreate = () =>
    requestAction(() => {
      setHasUnsavedChanges(false);
      setMode({ kind: "create", draft: EMPTY_DRAFT });
    });

  const handleCreate = async (draft: SkillDraft) => {
    if (mode.kind !== "create") return;
    const slug = draft.slug.trim().toLowerCase();
    try {
      await saveSkill(slug, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        triggers: draft.triggers,
        body: draft.body,
      });
      setMode({ kind: "browse", selectedSkill: null, tab: "preview" });
    } catch {
      displayErrorToast(t(I18nKey.DCK$SKILL_SAVE_ERROR));
    }
  };

  const handleSaveSource = async (
    skill: ProjectSkillSummary,
    source: string,
  ): Promise<boolean> => {
    if (!skill.editable || !skill.filePath) return false;
    try {
      await saveSkillSource(skill.filePath, source);
      return true;
    } catch {
      displayErrorToast(t(I18nKey.DCK$SKILL_SAVE_ERROR));
      return false;
    }
  };

  const handleDelete = async () => {
    const target = deletingSkill;
    if (!target?.deletable || !target.filePath) return;
    try {
      await deleteSkill(target.filePath);
      setDeletingSkill(null);
      setMode((current) =>
        current.kind === "browse" &&
        current.selectedSkill?.filePath === target.filePath
          ? { ...current, selectedSkill: null }
          : current,
      );
    } catch {
      displayErrorToast(t(I18nKey.DCK$SKILL_DELETE_ERROR));
    }
  };

  const isBrowse = mode.kind === "browse";
  return (
    <ModalBackdrop
      onClose={isSaving || isDeleting ? undefined : handleCloseRequest}
    >
      <div
        data-testid="dck-skill-manager"
        style={
          isBrowse
            ? { height: "min(56rem, 92vh)", width: "min(78rem, 96vw)" }
            : { width: "min(40rem, 94vw)" }
        }
        className={cn(
          "flex max-h-dvh flex-col gap-4 overflow-hidden rounded-xl border border-border bg-base-secondary p-5",
          isBrowse ? "w-full" : "w-full overflow-y-auto",
        )}
      >
        <header className="flex shrink-0 flex-col gap-1">
          <h2 className="text-lg font-semibold text-contrast">
            {t(I18nKey.DCK$SKILL_MANAGER_TITLE)}
          </h2>
          <p className="text-xs text-text-tertiary">
            {t(I18nKey.DCK$SKILL_MANAGER_DESCRIPTION)}
          </p>
        </header>

        {mode.kind === "create" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SkillForm
              initialDraft={mode.draft}
              existingSlugs={existingSlugsExcluding(null)}
              reservedNames={reservedNames}
              isSaving={isSaving}
              onCancel={() =>
                setMode({ kind: "browse", selectedSkill: null, tab: "preview" })
              }
              onSubmit={(draft) => void handleCreate(draft)}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3 md:grid-cols-12 md:grid-rows-1">
              <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-base md:col-span-3">
                <ul className="flex-1 space-y-2 overflow-y-auto p-2">
                  {skills.map((skill, index) => (
                    <SkillRow
                      key={`${skill.scope}-${skill.filePath ?? skill.source ?? skill.name}-${index}`}
                      skill={skill}
                      isSelected={
                        mode.selectedSkill?.filePath === skill.filePath &&
                        mode.selectedSkill?.name === skill.name
                      }
                      onSelect={() => {
                        if (
                          mode.selectedSkill?.filePath === skill.filePath &&
                          mode.selectedSkill?.name === skill.name
                        ) {
                          return;
                        }
                        requestAction(() => {
                          setHasUnsavedChanges(false);
                          setMode({
                            kind: "browse",
                            selectedSkill: skill,
                            tab: "preview",
                          });
                        });
                      }}
                      onDelete={() =>
                        requestAction(() => {
                          setHasUnsavedChanges(false);
                          setDeletingSkill(skill);
                        })
                      }
                      disabled={isSaving || isDeleting}
                    />
                  ))}
                </ul>
                <div className="border-t border-border p-2">
                  <BrandButton
                    type="button"
                    variant="secondary"
                    testId="dck-skill-add"
                    startContent={<Plus size={16} aria-hidden />}
                    onClick={openCreate}
                    isDisabled={isSaving || isDeleting}
                  >
                    {t(I18nKey.DCK$SKILL_ADD)}
                  </BrandButton>
                </div>
              </aside>

              <main className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-base md:col-span-9">
                {mode.selectedSkill ? (
                  <SkillDetails
                    key={`${mode.selectedSkill.filePath ?? mode.selectedSkill.source ?? mode.selectedSkill.name}-${mode.selectedSkill.name}`}
                    skill={mode.selectedSkill}
                    tab={mode.tab}
                    onTabChange={(tab) =>
                      setMode((current) =>
                        current.kind === "browse"
                          ? { ...current, tab }
                          : current,
                      )
                    }
                    isSaving={isSaving}
                    onSave={(source) =>
                      handleSaveSource(mode.selectedSkill!, source)
                    }
                    onDirtyChange={setHasUnsavedChanges}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-text-tertiary">
                    {t(I18nKey.DCK$SKILL_SELECT_PROMPT)}
                  </div>
                )}
              </main>
            </div>
            <div className="flex shrink-0 justify-end">
              <BrandButton
                type="button"
                variant="primary"
                testId="dck-skill-manager-close"
                onClick={() => {
                  handleCloseRequest();
                }}
                isDisabled={isSaving || isDeleting}
              >
                {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
              </BrandButton>
            </div>
          </div>
        )}
      </div>
      {deletingSkill && (
        <DeleteSkillConfirm
          skill={deletingSkill}
          isDeleting={isDeleting}
          onCancel={() => setDeletingSkill(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
      {pendingAction && (
        <DiscardSkillChangesConfirm
          skillName={
            mode.kind === "browse" ? (mode.selectedSkill?.name ?? "") : ""
          }
          onKeepEditing={() => setPendingAction(null)}
          onDiscard={confirmDiscardChanges}
        />
      )}
    </ModalBackdrop>
  );
}
