import React from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2, Plus, Loader2 } from "lucide-react";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { BrandButton } from "#/components/features/settings/brand-button";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { getDckWorkspaceRoot } from "#/dck/modules";
import {
  buildSkillFolderDeleteCommand,
  skillDirPath,
  validateSkillDraft,
  type SkillDraft,
} from "#/dck/skill-authoring";
import {
  readProjectSkill,
  useProjectSkills,
  type ProjectSkillSummary,
} from "#/hooks/query/use-project-skills";
import {
  useAllConversations,
  useOpenConversation,
} from "#/components/features/dck/use-dck-conversations";

const EMPTY_DRAFT: SkillDraft = {
  name: "",
  slug: "",
  description: "",
  triggers: [],
  body: "",
};

type Mode =
  | { kind: "list" }
  | { kind: "form"; editingSlug: string | null; draft: SkillDraft };

function SkillRow({
  skill,
  onEdit,
  onDelete,
  disabled,
}: {
  skill: ProjectSkillSummary;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("openhands");
  return (
    <li
      data-testid={`dck-skill-row-${skill.name}`}
      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-contrast">
          {skill.name}
        </span>
        {skill.description && (
          <span className="truncate text-xs text-text-tertiary">
            {skill.description}
          </span>
        )}
      </div>
      {skill.editable ? (
        <div className="flex shrink-0 items-center gap-1">
          <span
            data-testid={`dck-skill-project-badge-${skill.name}`}
            className="rounded bg-surface px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-tertiary"
          >
            {t(I18nKey.DCK$SKILL_PROJECT_BADGE)}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={onEdit}
            data-testid={`dck-skill-edit-${skill.name}`}
            aria-label={t(I18nKey.DCK$SKILL_EDIT)}
            className="rounded p-1 text-text-secondary hover:text-contrast disabled:opacity-50"
          >
            <Pencil size={16} aria-hidden />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            data-testid={`dck-skill-delete-${skill.name}`}
            aria-label={t(I18nKey.DCK$SKILL_DELETE)}
            className="rounded p-1 text-status-error hover:opacity-80 disabled:opacity-50"
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      ) : (
        <span
          data-testid={`dck-skill-public-badge-${skill.name}`}
          className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-tertiary"
        >
          {t(I18nKey.DCK$SKILL_PUBLIC_BADGE)}
        </span>
      )}
    </li>
  );
}

function SkillForm({
  initialDraft,
  isEditing,
  existingSlugs,
  reservedNames,
  isSaving,
  onCancel,
  onSubmit,
}: {
  initialDraft: SkillDraft;
  isEditing: boolean;
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
          disabled={isEditing}
          onChange={(event) => setField("slug", event.target.value)}
          className={cn(fieldClass, isEditing && "opacity-60")}
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
  return (
    <ModalBackdrop onClose={isDeleting ? undefined : onCancel}>
      <div
        data-testid="dck-skill-delete-confirm"
        className="flex w-[28rem] max-w-[90vw] flex-col gap-4 rounded-xl border border-border bg-base-secondary p-4"
      >
        <p className="text-sm text-contrast">
          {t(I18nKey.DCK$SKILL_DELETE_CONFIRM, {
            name: skill.name,
            slug: skill.name,
          })}
        </p>
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

export function DckSkillManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("openhands");
  const { editableSkills, publicSkills, isSaving, saveSkill, refetch } =
    useProjectSkills();
  const conversations = useAllConversations();
  const { prefillAndOpen } = useOpenConversation();
  const [mode, setMode] = React.useState<Mode>({ kind: "list" });
  const [loadingEdit, setLoadingEdit] = React.useState(false);
  const [deletingSkill, setDeletingSkill] =
    React.useState<ProjectSkillSummary | null>(null);

  const root = getDckWorkspaceRoot();
  const reservedNames = publicSkills.map((skill) => skill.name);
  const existingSlugsExcluding = (slug: string | null): string[] =>
    editableSkills.map((skill) => skill.name).filter((name) => name !== slug);

  const openCreate = () =>
    setMode({ kind: "form", editingSlug: null, draft: EMPTY_DRAFT });

  const openEdit = async (skill: ProjectSkillSummary) => {
    setLoadingEdit(true);
    try {
      const fields = await readProjectSkill(skill.name);
      setMode({
        kind: "form",
        editingSlug: skill.name,
        draft: {
          name: fields.name || skill.name,
          slug: skill.name,
          description: fields.description,
          triggers: fields.triggers,
          body: fields.body,
        },
      });
    } catch {
      displayErrorToast(t(I18nKey.DCK$SKILL_SAVE_ERROR));
    } finally {
      setLoadingEdit(false);
    }
  };

  const handleSubmit = async (draft: SkillDraft) => {
    if (mode.kind !== "form") return;
    const slug = (mode.editingSlug ?? draft.slug).trim().toLowerCase();
    try {
      await saveSkill(slug, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        triggers: draft.triggers,
        body: draft.body,
      });
      setMode({ kind: "list" });
    } catch {
      displayErrorToast(t(I18nKey.DCK$SKILL_SAVE_ERROR));
    }
  };

  const handleDelete = () => {
    const target = deletingSkill;
    if (!target) return;
    void prefillAndOpen(
      root,
      conversations,
      buildSkillFolderDeleteCommand(
        target.name,
        skillDirPath(root, target.name),
      ),
    );
    setDeletingSkill(null);
    onClose();
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        data-testid="dck-skill-manager"
        className="flex max-h-[88vh] w-[40rem] max-w-[94vw] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-base-secondary p-5"
      >
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-contrast">
            {t(I18nKey.DCK$SKILL_MANAGER_TITLE)}
          </h2>
          <p className="text-xs text-text-tertiary">
            {t(I18nKey.DCK$SKILL_MANAGER_DESCRIPTION)}
          </p>
        </header>

        {mode.kind === "form" ? (
          <SkillForm
            initialDraft={mode.draft}
            isEditing={mode.editingSlug !== null}
            existingSlugs={existingSlugsExcluding(mode.editingSlug)}
            reservedNames={mode.editingSlug === null ? reservedNames : []}
            isSaving={isSaving}
            onCancel={() => setMode({ kind: "list" })}
            onSubmit={handleSubmit}
          />
        ) : (
          <>
            {loadingEdit && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <Loader2 size={14} className="animate-spin" aria-hidden />
              </div>
            )}
            <ul className="flex flex-col gap-2">
              {editableSkills.map((skill) => (
                <SkillRow
                  key={skill.name}
                  skill={skill}
                  onEdit={() => void openEdit(skill)}
                  onDelete={() => setDeletingSkill(skill)}
                  disabled={isSaving || loadingEdit}
                />
              ))}
              {publicSkills.map((skill) => (
                <SkillRow
                  key={skill.name}
                  skill={skill}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  disabled
                />
              ))}
            </ul>

            <div className="flex justify-between gap-2">
              <BrandButton
                type="button"
                variant="secondary"
                testId="dck-skill-add"
                startContent={<Plus size={16} aria-hidden />}
                onClick={openCreate}
                isDisabled={isSaving}
              >
                {t(I18nKey.DCK$SKILL_ADD)}
              </BrandButton>
              <BrandButton
                type="button"
                variant="primary"
                testId="dck-skill-manager-close"
                onClick={() => {
                  void refetch();
                  onClose();
                }}
              >
                {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
              </BrandButton>
            </div>
          </>
        )}
      </div>

      {deletingSkill && (
        <DeleteSkillConfirm
          skill={deletingSkill}
          isDeleting={false}
          onCancel={() => setDeletingSkill(null)}
          onConfirm={handleDelete}
        />
      )}
    </ModalBackdrop>
  );
}
