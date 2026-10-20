import React from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Trash2 } from "lucide-react";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { BrandButton } from "#/components/features/settings/brand-button";
import { MarkdownRenderer } from "#/components/features/markdown/markdown-renderer";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import {
  applySkillSourceEdit,
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
import type { SkillInfo } from "#/types/settings";

const EMPTY_DRAFT: SkillDraft = {
  name: "",
  slug: "",
  description: "",
  triggers: [],
  body: "",
};

type SkillManagerTab = "preview" | "editor";

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
                    const nextSource = applySkillSourceEdit(
                      savedSource,
                      event.target.value,
                      lineEnding,
                    );
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

export function CustomSkillAuthoring({
  onClose,
  selectedSkill,
}: {
  onClose: () => void;
  selectedSkill?: Pick<SkillInfo, "name" | "source">;
}) {
  const { t } = useTranslation("openhands");
  const {
    skills,
    editableSkills,
    isSaving,
    isDeleting,
    isLoading,
    isError,
    saveSkill,
    saveSkillSource,
    deleteSkill,
    refetch,
  } = useProjectSkills();
  const [tab, setTab] = React.useState<SkillManagerTab>("preview");
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);
  const [deletingSkill, setDeletingSkill] =
    React.useState<ProjectSkillSummary | null>(null);
  const [pendingClose, setPendingClose] = React.useState(false);
  const summary = selectedSkill
    ? skills.find(
        (skill) =>
          skill.name === selectedSkill.name &&
          skill.source === selectedSkill.source,
      )
    : undefined;
  const reservedNames = skills
    .filter((skill) => skill.builtin)
    .map((skill) => skill.name);
  const existingSlugs = editableSkills
    .filter((skill) => skill.scope === "project")
    .map((skill) => skill.filePath?.replace(/\\/g, "/").split("/").at(-2))
    .filter((name): name is string => Boolean(name));
  const handleCloseRequest = () => {
    if (hasUnsavedChanges) setPendingClose(true);
    else {
      void refetch();
      onClose();
    }
  };
  const handleCreate = async (draft: SkillDraft) => {
    const slug = draft.slug.trim().toLowerCase();
    try {
      await saveSkill(slug, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        triggers: draft.triggers,
        body: draft.body,
      });
      onClose();
    } catch {
      displayErrorToast(t(I18nKey.DCK$SKILL_SAVE_ERROR));
    }
  };
  const handleSaveSource = async (
    skill: ProjectSkillSummary,
    source: string,
  ) => {
    if (skill.builtin || !skill.editable || !skill.filePath) return false;
    try {
      await saveSkillSource(skill.filePath, source);
      return true;
    } catch {
      displayErrorToast(t(I18nKey.DCK$SKILL_SAVE_ERROR));
      return false;
    }
  };
  const handleDelete = async () => {
    if (
      !deletingSkill?.deletable ||
      !deletingSkill.filePath ||
      deletingSkill.builtin
    )
      return;
    try {
      await deleteSkill(deletingSkill.filePath);
      setDeletingSkill(null);
      onClose();
    } catch {
      displayErrorToast(t(I18nKey.DCK$SKILL_DELETE_ERROR));
    }
  };
  const isCreate = !selectedSkill;
  return (
    <ModalBackdrop
      onClose={isSaving || isDeleting ? undefined : handleCloseRequest}
    >
      <div
        data-testid="dck-skill-manager"
        style={{
          width: isCreate ? "min(40rem, 94vw)" : "min(78rem, 96vw)",
          height: isCreate ? undefined : "min(56rem, 92vh)",
        }}
        className="flex max-h-dvh w-full flex-col gap-4 overflow-hidden rounded-xl border border-border bg-base-secondary p-5"
      >
        <header className="flex shrink-0 flex-col gap-1">
          <h2 className="text-lg font-semibold text-contrast">
            {t(I18nKey.DCK$SKILL_MANAGER_TITLE)}
          </h2>
          <p className="text-xs text-text-tertiary">
            {t(I18nKey.DCK$SKILL_MANAGER_DESCRIPTION)}
          </p>
        </header>
        {isCreate ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SkillForm
              initialDraft={EMPTY_DRAFT}
              existingSlugs={existingSlugs}
              reservedNames={reservedNames}
              isSaving={isSaving}
              onCancel={handleCloseRequest}
              onSubmit={(draft) => void handleCreate(draft)}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-base">
              {isLoading ? (
                <p className="p-6 text-sm text-text-tertiary">
                  {t(I18nKey.DCK$SKILL_LOADING)}
                </p>
              ) : isError || !summary ? (
                <p
                  data-testid="dck-skill-unavailable"
                  role="alert"
                  className="p-6 text-sm text-status-error"
                >
                  {t(I18nKey.DCK$SKILL_PREVIEW_LOAD_ERROR)}
                </p>
              ) : summary.builtin ? (
                <SkillDetails
                  key={`${summary.name}-${summary.source}`}
                  skill={summary}
                  tab="preview"
                  onTabChange={() => {}}
                  isSaving={isSaving}
                  onSave={async () => false}
                  onDirtyChange={() => {}}
                />
              ) : (
                <>
                  <SkillDetails
                    key={`${summary.name}-${summary.source}`}
                    skill={summary}
                    tab={tab}
                    onTabChange={setTab}
                    isSaving={isSaving}
                    onSave={(source) => handleSaveSource(summary, source)}
                    onDirtyChange={setHasUnsavedChanges}
                  />
                  {summary.deletable && (
                    <div className="flex justify-end px-3 pb-3">
                      <BrandButton
                        type="button"
                        variant="danger"
                        testId="dck-skill-selected-delete"
                        startContent={<Trash2 size={16} aria-hidden />}
                        isDisabled={isSaving || isDeleting}
                        onClick={() => {
                          if (hasUnsavedChanges) setPendingClose(true);
                          else setDeletingSkill(summary);
                        }}
                      >
                        {t(I18nKey.DCK$SKILL_DELETE)}
                      </BrandButton>
                    </div>
                  )}
                </>
              )}
            </main>
            <div className="flex shrink-0 justify-end">
              <BrandButton
                type="button"
                variant="secondary"
                testId="dck-skill-manager-close"
                onClick={handleCloseRequest}
                isDisabled={isSaving || isDeleting}
              >
                {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
              </BrandButton>
            </div>
          </div>
        )}
        {deletingSkill && (
          <DeleteSkillConfirm
            skill={deletingSkill}
            isDeleting={isDeleting}
            onCancel={() => setDeletingSkill(null)}
            onConfirm={() => void handleDelete()}
          />
        )}
        {pendingClose && (
          <DiscardSkillChangesConfirm
            skillName={summary?.name ?? ""}
            onKeepEditing={() => setPendingClose(false)}
            onDiscard={() => {
              setPendingClose(false);
              setHasUnsavedChanges(false);
              if (summary) setDeletingSkill(summary);
              else {
                void refetch();
                onClose();
              }
            }}
          />
        )}
      </div>
    </ModalBackdrop>
  );
}
