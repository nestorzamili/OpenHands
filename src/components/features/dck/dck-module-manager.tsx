import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronUp, ChevronDown, Pencil, Trash2, Plus } from "lucide-react";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { BrandButton } from "#/components/features/settings/brand-button";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import {
  DCK_MODULE_ICONS,
  DEFAULT_DCK_MODULE_ICON,
  getBuiltinDckModules,
  getDckWorkspaceRoot,
  resolveModuleIcon,
  type DckModule,
} from "#/dck/modules";
import {
  buildModuleFolderDeleteCommand,
  composePromptWithSkillTrigger,
  makeCustomModuleId,
  validateCustomModuleDraft,
  type CustomModuleDraft,
  type DckCustomModule,
} from "#/dck/module-config";
import { useDckCustomModules } from "#/hooks/query/use-dck-custom-modules";
import { useProjectSkills } from "#/hooks/query/use-project-skills";
import {
  useAllConversations,
  useOpenConversation,
} from "#/components/features/dck/use-dck-conversations";

const ICON_NAMES = Object.keys(DCK_MODULE_ICONS);

const EMPTY_DRAFT: CustomModuleDraft = {
  name: "",
  slug: "",
  iconName: DEFAULT_DCK_MODULE_ICON,
  description: "",
  promptTemplate: "",
  skillName: "",
};

type Mode =
  | { kind: "list" }
  | { kind: "form"; editingId: string | null; draft: CustomModuleDraft };

function ModuleRow({
  module,
  readOnly,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  disabled,
}: {
  module: DckModule;
  readOnly: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("openhands");
  const Icon = module.icon;
  return (
    <li
      data-testid={`dck-module-manager-row-${module.id}`}
      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
    >
      <Icon size={18} className="shrink-0 text-text-secondary" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-contrast">
          {module.name}
        </span>
        {module.description && (
          <span className="truncate text-xs text-text-tertiary">
            {module.description}
          </span>
        )}
      </div>
      {readOnly ? (
        <span
          data-testid={`dck-module-builtin-badge-${module.id}`}
          className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-tertiary"
        >
          {t(I18nKey.DCK$MODULE_BUILTIN_BADGE)}
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={disabled || !canMoveUp}
            onClick={onMoveUp}
            data-testid={`dck-module-move-up-${module.id}`}
            aria-label={t(I18nKey.DCK$MODULE_MOVE_UP)}
            className="rounded p-1 text-text-secondary hover:text-contrast disabled:opacity-30"
          >
            <ChevronUp size={16} aria-hidden />
          </button>
          <button
            type="button"
            disabled={disabled || !canMoveDown}
            onClick={onMoveDown}
            data-testid={`dck-module-move-down-${module.id}`}
            aria-label={t(I18nKey.DCK$MODULE_MOVE_DOWN)}
            className="rounded p-1 text-text-secondary hover:text-contrast disabled:opacity-30"
          >
            <ChevronDown size={16} aria-hidden />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onEdit}
            data-testid={`dck-module-edit-${module.id}`}
            aria-label={t(I18nKey.DCK$MODULE_EDIT)}
            className="rounded p-1 text-text-secondary hover:text-contrast disabled:opacity-50"
          >
            <Pencil size={16} aria-hidden />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            data-testid={`dck-module-delete-${module.id}`}
            aria-label={t(I18nKey.DCK$MODULE_DELETE)}
            className="rounded p-1 text-status-error hover:opacity-80 disabled:opacity-50"
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      )}
    </li>
  );
}

function ModuleForm({
  initialDraft,
  reservedSlugs,
  existingSlugs,
  skillOptions,
  isSaving,
  onCancel,
  onSubmit,
}: {
  initialDraft: CustomModuleDraft;
  reservedSlugs: string[];
  existingSlugs: string[];
  skillOptions: { name: string }[];
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (draft: CustomModuleDraft) => void;
}) {
  const { t } = useTranslation("openhands");
  const [draft, setDraft] = React.useState<CustomModuleDraft>(initialDraft);
  const [showErrors, setShowErrors] = React.useState(false);

  const validation = validateCustomModuleDraft(draft, {
    reservedSlugs,
    existingSlugs,
  });

  const setField = (field: keyof CustomModuleDraft, value: string) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validation.valid) {
      setShowErrors(true);
      return;
    }
    onSubmit(draft);
  };

  const fieldClass =
    "w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-contrast";
  const labelClass = "flex flex-col gap-1 text-xs font-medium text-contrast";
  const errorClass = "text-xs text-status-error";

  return (
    <form
      data-testid="dck-module-form"
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <label className={labelClass}>
        {t(I18nKey.DCK$MODULE_FORM_NAME_LABEL)}
        <input
          type="text"
          data-testid="dck-module-form-name"
          value={draft.name}
          onChange={(event) => setField("name", event.target.value)}
          className={fieldClass}
        />
        {showErrors && validation.errors.name && (
          <span data-testid="dck-module-form-name-error" className={errorClass}>
            {t(validation.errors.name)}
          </span>
        )}
      </label>

      <label className={labelClass}>
        {t(I18nKey.DCK$MODULE_FORM_SLUG_LABEL)}
        <input
          type="text"
          data-testid="dck-module-form-slug"
          value={draft.slug}
          onChange={(event) => setField("slug", event.target.value)}
          className={fieldClass}
        />
        <span className="text-xs font-normal text-text-tertiary">
          {t(I18nKey.DCK$MODULE_FORM_SLUG_HINT)}
        </span>
        {showErrors && validation.errors.slug && (
          <span data-testid="dck-module-form-slug-error" className={errorClass}>
            {t(validation.errors.slug)}
          </span>
        )}
      </label>

      <div className={labelClass}>
        {t(I18nKey.DCK$MODULE_FORM_ICON_LABEL)}
        <div
          className="flex flex-wrap gap-2"
          data-testid="dck-module-form-icons"
        >
          {ICON_NAMES.map((iconName) => {
            const Icon = resolveModuleIcon(iconName);
            const selected = draft.iconName === iconName;
            return (
              <button
                key={iconName}
                type="button"
                data-testid={`dck-module-form-icon-${iconName}`}
                aria-pressed={selected}
                onClick={() => setField("iconName", iconName)}
                className={cn(
                  "rounded-lg border p-2 text-text-secondary hover:text-contrast",
                  selected
                    ? "border-indigo-400 text-contrast"
                    : "border-border",
                )}
              >
                <Icon size={18} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>

      <label className={labelClass}>
        {t(I18nKey.DCK$MODULE_FORM_DESCRIPTION_LABEL)}
        <input
          type="text"
          data-testid="dck-module-form-description"
          value={draft.description}
          onChange={(event) => setField("description", event.target.value)}
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        {t(I18nKey.DCK$MODULE_FORM_PROMPT_LABEL)}
        <textarea
          data-testid="dck-module-form-prompt"
          value={draft.promptTemplate}
          onChange={(event) => setField("promptTemplate", event.target.value)}
          rows={4}
          className={cn(fieldClass, "resize-y")}
        />
        <span className="text-xs font-normal text-text-tertiary">
          {t(I18nKey.DCK$MODULE_FORM_PROMPT_HINT)}
        </span>
        {showErrors && validation.errors.promptTemplate && (
          <span
            data-testid="dck-module-form-prompt-error"
            className={errorClass}
          >
            {t(validation.errors.promptTemplate)}
          </span>
        )}
      </label>

      <label className={labelClass}>
        {t(I18nKey.DCK$MODULE_FORM_SKILL_LABEL)}
        <select
          data-testid="dck-module-form-skill"
          value={draft.skillName}
          onChange={(event) => setField("skillName", event.target.value)}
          className={fieldClass}
        >
          <option value="">{t(I18nKey.DCK$MODULE_FORM_SKILL_NONE)}</option>
          {skillOptions.map((skill) => (
            <option key={skill.name} value={skill.name}>
              {skill.name}
            </option>
          ))}
        </select>
        <span className="text-xs font-normal text-text-tertiary">
          {t(I18nKey.DCK$MODULE_FORM_SKILL_HINT)}
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <BrandButton
          type="button"
          variant="secondary"
          testId="dck-module-form-cancel"
          onClick={onCancel}
          isDisabled={isSaving}
        >
          {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
        </BrandButton>
        <BrandButton
          type="submit"
          variant="primary"
          testId="dck-module-form-save"
          isDisabled={isSaving}
        >
          {t(I18nKey.DCK$MODULE_FORM_SAVE)}
        </BrandButton>
      </div>
    </form>
  );
}

function DeleteModuleConfirm({
  module,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  module: DckModule;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: (deleteFolder: boolean) => void;
}) {
  const { t } = useTranslation("openhands");
  const [deleteFolder, setDeleteFolder] = React.useState(false);

  return (
    <ModalBackdrop onClose={isDeleting ? undefined : onCancel}>
      <div
        data-testid="dck-module-delete-confirm"
        className="flex w-[28rem] max-w-[90vw] flex-col gap-4 rounded-xl border border-border bg-base-secondary p-4"
      >
        <p className="text-sm text-contrast">
          {t(I18nKey.DCK$MODULE_DELETE_CONFIRM, { name: module.name })}
        </p>
        <label className="flex cursor-pointer items-start gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            data-testid="dck-module-delete-folder"
            checked={deleteFolder}
            onChange={(event) => setDeleteFolder(event.target.checked)}
            className="mt-0.5 size-4"
          />
          {t(I18nKey.DCK$MODULE_DELETE_FOLDER_OPTION, { slug: module.slug })}
        </label>
        <div className="flex justify-end gap-2">
          <BrandButton
            type="button"
            variant="secondary"
            testId="dck-module-delete-cancel"
            onClick={onCancel}
            isDisabled={isDeleting}
          >
            {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
          </BrandButton>
          <BrandButton
            type="button"
            variant="danger"
            testId="dck-module-delete-confirm-button"
            onClick={() => onConfirm(deleteFolder)}
            isDisabled={isDeleting}
          >
            {t(I18nKey.DCK$MODULE_DELETE)}
          </BrandButton>
        </div>
      </div>
    </ModalBackdrop>
  );
}

export function DckModuleManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("openhands");
  const { modules, isSaving, upsert, remove, move } = useDckCustomModules();
  const { skills } = useProjectSkills();
  const conversations = useAllConversations();
  const { prefillAndOpen } = useOpenConversation();
  const [mode, setMode] = React.useState<Mode>({ kind: "list" });
  const [deletingModule, setDeletingModule] = React.useState<DckModule | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = React.useState(false);

  const skillOptions = skills.map((skill) => ({ name: skill.name }));
  const triggersBySkill = React.useMemo(() => {
    const map = new Map<string, string[]>();
    skills.forEach((skill) => map.set(skill.name, skill.triggers));
    return map;
  }, [skills]);

  const builtins = React.useMemo(() => getBuiltinDckModules(), []);
  const root = getDckWorkspaceRoot();
  const builtinSlugs = React.useMemo(
    () => builtins.map((module) => module.slug),
    [builtins],
  );

  const customAsModules: DckModule[] = modules.map((module) => ({
    id: module.id,
    name: module.name,
    slug: module.slug,
    workspacePath: `${root}/${module.slug}`,
    skillName: "",
    kind: "conversations",
    icon: resolveModuleIcon(module.iconName),
    iconName: module.iconName,
    description: module.description,
    promptTemplate: module.promptTemplate,
    source: "custom",
  }));

  const openCreate = () =>
    setMode({ kind: "form", editingId: null, draft: EMPTY_DRAFT });

  const openEdit = (module: DckCustomModule) =>
    setMode({
      kind: "form",
      editingId: module.id,
      draft: {
        name: module.name,
        slug: module.slug,
        iconName: module.iconName,
        description: module.description,
        promptTemplate: module.promptTemplate,
        skillName: module.skillName,
      },
    });

  const existingSlugsExcluding = (editingId: string | null): string[] =>
    modules
      .filter((module) => module.id !== editingId)
      .map((module) => module.slug);

  const handleSubmit = async (draft: CustomModuleDraft) => {
    if (mode.kind !== "form") return;
    const editingId = mode.editingId;
    const existing = editingId
      ? modules.find((module) => module.id === editingId)
      : undefined;
    const skillName = draft.skillName.trim();
    const basePrompt = draft.promptTemplate.trim();
    const promptTemplate = skillName
      ? composePromptWithSkillTrigger(
          basePrompt,
          triggersBySkill.get(skillName) ?? [],
        )
      : basePrompt;
    const next: DckCustomModule = {
      id: existing?.id ?? makeCustomModuleId(),
      name: draft.name.trim(),
      slug: draft.slug.trim().toLowerCase(),
      iconName: draft.iconName,
      description: draft.description.trim(),
      promptTemplate,
      skillName,
      order: existing?.order ?? modules.length,
    };
    try {
      await upsert(next);
      setMode({ kind: "list" });
    } catch {
      displayErrorToast(t(I18nKey.DCK$MODULE_SAVE_ERROR));
    }
  };

  const handleDelete = async (deleteFolder: boolean) => {
    const target = deletingModule;
    if (!target) return;
    setIsDeleting(true);
    try {
      await remove(target.id);
      setDeletingModule(null);
      if (deleteFolder) {
        void prefillAndOpen(
          root,
          conversations,
          buildModuleFolderDeleteCommand(target.name, target.workspacePath),
        );
        onClose();
      }
    } catch {
      displayErrorToast(t(I18nKey.DCK$MODULE_SAVE_ERROR));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        data-testid="dck-module-manager"
        className="flex max-h-[85vh] w-[34rem] max-w-[92vw] flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-base-secondary p-5"
      >
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-contrast">
            {t(I18nKey.DCK$MODULE_MANAGER_TITLE)}
          </h2>
          <p className="text-xs text-text-tertiary">
            {t(I18nKey.DCK$MODULE_MANAGER_DESCRIPTION)}
          </p>
        </header>

        {mode.kind === "form" ? (
          <ModuleForm
            initialDraft={mode.draft}
            reservedSlugs={builtinSlugs}
            existingSlugs={existingSlugsExcluding(mode.editingId)}
            skillOptions={skillOptions}
            isSaving={isSaving}
            onCancel={() => setMode({ kind: "list" })}
            onSubmit={handleSubmit}
          />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {builtins.map((module) => (
                <ModuleRow
                  key={module.id}
                  module={module}
                  readOnly
                  canMoveUp={false}
                  canMoveDown={false}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  onMoveUp={() => {}}
                  onMoveDown={() => {}}
                  disabled={isSaving}
                />
              ))}
              {customAsModules.map((module, index) => (
                <ModuleRow
                  key={module.id}
                  module={module}
                  readOnly={false}
                  canMoveUp={index > 0}
                  canMoveDown={index < customAsModules.length - 1}
                  onEdit={() =>
                    openEdit(modules.find((entry) => entry.id === module.id)!)
                  }
                  onDelete={() => setDeletingModule(module)}
                  onMoveUp={() => void move(module.id, -1)}
                  onMoveDown={() => void move(module.id, 1)}
                  disabled={isSaving}
                />
              ))}
            </ul>

            <div className="flex justify-between gap-2">
              <BrandButton
                type="button"
                variant="secondary"
                testId="dck-module-add"
                startContent={<Plus size={16} aria-hidden />}
                onClick={openCreate}
                isDisabled={isSaving}
              >
                {t(I18nKey.DCK$MODULE_ADD)}
              </BrandButton>
              <BrandButton
                type="button"
                variant="primary"
                testId="dck-module-manager-close"
                onClick={onClose}
              >
                {t(I18nKey.DCK$MODULE_FORM_CANCEL)}
              </BrandButton>
            </div>
          </>
        )}
      </div>

      {deletingModule && (
        <DeleteModuleConfirm
          module={deletingModule}
          isDeleting={isDeleting}
          onCancel={() => setDeletingModule(null)}
          onConfirm={handleDelete}
        />
      )}
    </ModalBackdrop>
  );
}
