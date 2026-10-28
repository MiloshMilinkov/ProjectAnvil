"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckSquare,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  statuses,
  priorities,
  uid,
  type Workspace,
  type Task,
  type Status,
  type FeatureProps,
} from "../lib/types";
import {
  discardDraftMutations,
  readDraft,
  removeDraft,
  writeDraft,
} from "../lib/draft-store";
import { useDraftGuard, useDraftScope } from "./useRecoverableDraft";
import { useDialog } from "./useDialog";
import { Avatar, Empty, StatusIcon } from "./WorkspacePrimitives";
import Markdown from "./Markdown";
import SourceNoteCard from "./SourceNoteCard";
import { useWorkspaceFetch } from "./WorkspaceScope";
import {
  parseRecoverableTask,
  parseTaskDraft,
  replaceTaskDraft,
  type TaskForm,
} from "../lib/task-drafts";
import "./entity-editors.css";
import PersonalTemplates from "./PersonalTemplates";
import { duplicateTask } from "../lib/task-copy";
import {
  instantiateTaskTemplate,
  taskTemplateContent,
} from "../lib/personal-templates";
import { moveToTrash } from "../lib/trash-actions";
import {
  TaskHierarchyFields,
  TaskScheduleOptions,
  taskScheduleError,
} from "./TaskPlanningFields";
import { taskChildrenProgress } from "../lib/planning-progress";
import WatchControl, { MentionHelp } from "./WatchControl";
export default function TaskDialog({
  workspace: w,
  task,
  initialTask,
  onDuplicate,
  projectId,
  personId,
  initialStatus,
  mutate,
  onClose,
  openNote,
  openTask,
  notify,
}: {
  workspace: Workspace;
  task?: Task;
  initialTask?: Task;
  onDuplicate?: (task: Task) => void;
  projectId: string;
  personId: string;
  initialStatus: Status;
  mutate: FeatureProps["mutate"];
  onClose: () => void;
  openNote: (id: string) => void;
  openTask?: (id: string) => void;
  notify: FeatureProps["notify"];
}) {
  const scope = useDraftScope();
  const scopedFetch = useWorkspaceFetch();
  const draftId = task?.id || "new-task";
  const [initialRecovery] = useState(() =>
    parseTaskDraft(
      readDraft<unknown, unknown>(scope, "tasks", draftId),
      task?.id,
    ),
  );
  const [recovered, setRecovered] = useState(!!initialRecovery);
  const [exists, setExists] = useState(!!task || !!initialRecovery?.baseline);
  const originalTask = useRef<Task | null>(
    initialRecovery ? initialRecovery.baseline : task || null,
  );
  const [freshForm] = useState<TaskForm>(() => ({
    task: structuredClone(
      task ||
        initialTask || {
          id: uid(),
          key: "",
          title: "",
          description: "",
          status: initialStatus,
          priority: "medium",
          type: "task",
          projectId: w.projects.some((p) => p.id === projectId)
            ? projectId
            : "",
          assigneeId: w.people.some((p) => p.id === personId) ? personId : "",
          startDate: "",
          dueDate: "",
          parentId: "",
          milestoneId: "",
          recurrence: null,
          reminder: null,
          estimate: 0,
          tags: [],
          noteIds: [],
          blockedBy: [],
          subtasks: [],
          comments: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
    ),
    tagText: (task || initialTask)?.tags.join(", ") || "",
    comment: "",
    subtask: "",
  }));
  const [form, setForm] = useState<TaskForm>(
    () => initialRecovery?.value || freshForm,
  );
  const { task: draft, tagText, comment, subtask } = form;
  const latestForm = useRef(form);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [draftError, setDraftError] = useState(""),
    [closePrompt, setClosePrompt] = useState(false),
    [preview, setPreview] = useState(false),
    [tab, setTab] = useState("details");
  const [planningOpen, setPlanningOpen] = useState(() => {
    const initial = initialRecovery?.value || freshForm;
    return !!(
      initial.task.parentId ||
      initial.task.milestoneId ||
      initial.task.estimate ||
      initial.task.type !== "task" ||
      initial.tagText.trim() ||
      initial.task.recurrence ||
      initial.task.reminder ||
      initial.task.recurrenceNextId ||
      w.tasks.some((item) => item.parentId === initial.task.id)
    );
  });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [copyPending, setCopyPending] = useState(
    !!initialTask && !!initialRecovery,
  );
  const seedIsCopy = !!initialTask?.title.trim();
  const busy = useRef(false),
    dirty = useRef(!!initialRecovery || !!initialTask),
    dialogRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const token = useRef(initialRecovery?.token);
  useEffect(() => {
    if (!initialTask || initialRecovery) return;
    const result = writeDraft(scope, "tasks", draftId, freshForm, null);
    token.current = result.record.token;
    let active = true;
    queueMicrotask(() => {
      if (active) setDraftError(result.error || "");
    });
    return () => {
      active = false;
    };
  }, [initialTask, initialRecovery, scope, draftId, freshForm]);
  function change(patch: Partial<TaskForm>) {
    if (busy.current) return;
    const next = { ...latestForm.current, ...patch };
    latestForm.current = next;
    setForm(next);
    const baselineForm = originalTask.current
      ? {
          task: originalTask.current,
          tagText: originalTask.current.tags.join(", "),
          comment: "",
          subtask: "",
        }
      : {
          ...freshForm,
          task: {
            ...freshForm.task,
            id: next.task.id,
            createdAt: next.task.createdAt,
            updatedAt: next.task.updatedAt,
          },
        };
    dirty.current =
      (!originalTask.current && !!initialTask) ||
      JSON.stringify(next) !== JSON.stringify(baselineForm);
    if (!dirty.current) {
      if (token.current) removeDraft(scope, "tasks", draftId, token.current);
      token.current = undefined;
      setDraftError("");
      return;
    }
    const result = writeDraft(
      scope,
      "tasks",
      draftId,
      next,
      originalTask.current,
    );
    token.current = result.record.token;
    setDraftError(result.error || "");
  }
  function replaceUnfinishedTask(next: TaskForm) {
    const result = replaceTaskDraft(
      scope,
      draftId,
      latestForm.current.task.id,
      next,
    );
    originalTask.current = null;
    latestForm.current = next;
    setForm(next);
    setExists(false);
    setRecovered(false);
    setCopyPending(false);
    dirty.current = true;
    token.current = result.record.token;
    setDraftError(result.error || "");
    dialogRef.current
      ?.querySelector<HTMLInputElement>(".task-title-input input")
      ?.focus();
  }
  const set = <K extends keyof Task>(key: K, value: Task[K]) =>
    change({ task: { ...latestForm.current.task, [key]: value } });
  function requestClose() {
    if (busy.current) return;
    if (dirty.current) setClosePrompt(true);
    else onClose();
  }
  function discard() {
    if (busy.current) return;
    if (!removeDraft(scope, "tasks", draftId, token.current)) {
      setDraftError(
        "A newer draft is present in another tab. Reopen the task to review it before discarding.",
      );
      return;
    }
    discardDraftMutations(scope, "tasks", draft.id);
    dirty.current = false;
    onClose();
  }
  useDialog(dialogRef, requestClose, saving);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useDraftGuard(scope, `task:${draftId}`, {
    hasUnsaved: () => dirty.current || busy.current,
    hasUnpersisted: () => hasUnpersistedDraftsForTask(),
  });
  // Read this editor's failed recovery state without recursively inspecting guards.
  function hasUnpersistedDraftsForTask() {
    return !!draftError;
  }
  function addSubtask() {
    const value = latestForm.current;
    if (!value.subtask.trim()) return true;
    if (
      value.task.subtasks.length >= 200 ||
      value.subtask.trim().length > 300
    ) {
      setError("Use at most 200 subtasks, with names up to 300 characters.");
      return false;
    }
    change({
      task: {
        ...value.task,
        subtasks: [
          ...value.task.subtasks,
          { id: uid(), title: value.subtask.trim(), done: false },
        ],
      },
      subtask: "",
    });
    return true;
  }
  function addComment() {
    const value = latestForm.current;
    if (!value.comment.trim()) return true;
    if (
      value.task.comments.length >= 500 ||
      value.comment.trim().length > 10000
    ) {
      setError(
        "Use at most 500 discussion messages, with up to 10,000 characters per message.",
      );
      return false;
    }
    change({
      task: {
        ...value.task,
        comments: [
          ...value.task.comments,
          {
            id: uid(),
            personId,
            body: value.comment.trim(),
            createdAt: new Date().toISOString(),
          },
        ],
      },
      comment: "",
    });
    return true;
  }
  async function save(close = true): Promise<boolean> {
    if (busy.current) return false;
    if (!latestForm.current.task.title.trim()) {
      setError("Give your task a title.");
      return false;
    }
    const { startDate, dueDate } = latestForm.current.task;
    const planningError = taskScheduleError(latestForm.current.task);
    const children = taskChildrenProgress(w, latestForm.current.task.id);
    if (
      planningError ||
      (latestForm.current.task.status === "done" &&
        children.completed < children.total)
    ) {
      setTab("details");
      setPlanningOpen(true);
      setError(
        planningError ||
          "Finish the child tasks before completing this parent.",
      );
      return false;
    }
    if (startDate && dueDate && startDate > dueDate) {
      setTab("details");
      setError("Planned start date must be on or before the due date.");
      return false;
    }
    // Save any unfinished discussion/checklist text with the task, rather than losing it on close.
    if (latestForm.current.comment.trim() && !addComment()) return false;
    if (latestForm.current.subtask.trim() && !addSubtask()) return false;
    const value = structuredClone(latestForm.current);
    const sentToken = token.current;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const cleaned: Task = {
        ...value.task,
        title: value.task.title.trim(),
        tags: [
          ...new Set(
            value.tagText
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        ],
      };
      const original = originalTask.current;
      const item = original
        ? {
            id: cleaned.id,
            ...Object.fromEntries(
              Object.entries(cleaned).filter(
                ([key, value]) =>
                  ![
                    "id",
                    "key",
                    "createdAt",
                    "updatedAt",
                    "recurrenceNextId",
                    "recurringFromId",
                  ].includes(key) &&
                  JSON.stringify(value) !==
                    JSON.stringify(original[key as keyof Task]),
              ),
            ),
          }
        : {
            ...Object.fromEntries(
              Object.entries(cleaned).filter(
                ([key]) =>
                  !["recurrenceNextId", "recurringFromId"].includes(key),
              ),
            ),
            key: "",
          };
      const saved = await mutate({
        action: "upsert",
        entity: "tasks",
        item,
        base: original ? { ...original } : null,
      });
      const committed = saved.tasks.find((item) => item.id === cleaned.id);
      if (!committed)
        throw new Error(
          "The task is no longer available. Your draft is kept for recovery.",
        );
      originalTask.current = committed;
      const next = {
        task: committed,
        tagText: committed.tags.join(", "),
        comment: "",
        subtask: "",
      };
      latestForm.current = next;
      setForm(next);
      if (sentToken) removeDraft(scope, "tasks", draftId, sentToken);
      dirty.current = false;
      setRecovered(false);
      setDraftError("");
      notify(exists ? "Task updated" : "Task created");
      setExists(true);
      if (close) onClose();
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "The task could not be saved.",
      );
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function loadLatest() {
    if (busy.current) return;
    if (
      dirty.current &&
      !window.confirm(
        "Discard this unfinished task form and load the latest saved task?",
      )
    )
      return;
    busy.current = true;
    setSaving(true);
    const previousToken = token.current;
    try {
      const response = await scopedFetch("/api/state", { cache: "no-store" });
      const result = (await response.json()) as {
        workspace?: Workspace;
        error?: string;
      };
      if (!response.ok || !result.workspace)
        throw new Error(result.error || "The latest task could not be loaded.");
      const latest = parseRecoverableTask(
        result.workspace.tasks.find(
          (item) => item.id === latestForm.current.task.id,
        ),
      );
      if (!latest)
        throw new Error(
          "No saved version was found. Your unfinished task is kept; retry saving or copy it before closing.",
        );
      const next = {
        task: latest,
        tagText: latest.tags.join(", "),
        comment: "",
        subtask: "",
      };
      originalTask.current = latest;
      latestForm.current = next;
      dirty.current = false;
      setForm(next);
      if (previousToken) removeDraft(scope, "tasks", draftId, previousToken);
      discardDraftMutations(scope, "tasks", latest.id);
      setExists(true);
      token.current = undefined;
      setRecovered(false);
      setClosePrompt(false);
      setDraftError("");
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The latest task could not be loaded.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function deleteTask() {
    if (
      busy.current ||
      !task ||
      !window.confirm(
        "Move this task and its discussion to Trash? You can restore it later.",
      )
    )
      return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      await moveToTrash(
        mutate,
        notify,
        {
          entity: "tasks",
          id: task.id,
          base: originalTask.current ? { ...originalTask.current } : null,
        },
        "Task",
        scope,
      );
      removeDraft(scope, "tasks", draftId, token.current);
      discardDraftMutations(scope, "tasks", task.id, {
        preserveQueuedDeletion: true,
      });
      dirty.current = false;
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The task could not be deleted.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function openLinkedNote(id: string) {
    if (await save(false)) {
      onClose();
      openNote(id);
    }
  }
  async function openRelatedTask(id: string) {
    if (!openTask || (dirty.current && !(await save(false)))) return;
    onClose();
    openTask(id);
  }
  const blocked = draft.blockedBy.filter(
    (id) => w.tasks.find((t) => t.id === id)?.status !== "done",
  );
  const configuredPlanning = [
    draft.parentId && "Parent task",
    draft.milestoneId && "Milestone",
    draft.estimate > 0 && "Effort",
    draft.type !== "task" && "Type",
    tagText.trim() && "Tags",
    draft.recurrence && "Repeat",
    draft.reminder && "Reminder",
  ].filter(Boolean);
  const childCount = w.tasks.filter(
    (item) => item.parentId === draft.id,
  ).length;
  const planningSummary = configuredPlanning.length
    ? configuredPlanning.join(" · ")
    : childCount
      ? `${childCount} child ${childCount === 1 ? "task" : "tasks"}`
      : "Parent, milestone, effort, tags, repeat & reminder";
  const fieldId = useId();
  const invalidDateRange = !!(
    draft.startDate &&
    draft.dueDate &&
    draft.startDate > draft.dueDate
  );
  return (
    <div
      className="modal-shade task-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        className="task-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={exists ? "Edit task" : "Create task"}
        aria-busy={saving}
      >
        <div className="dialog-heading">
          <div className="task-dialog-breadcrumb">
            <CheckSquare size={17} />
            <span>{draft.key || "NEW TASK"}</span>
            <ChevronRight size={13} />
            <span>
              {w.projects.find((p) => p.id === draft.projectId)?.name ||
                "Workspace"}
            </span>
          </div>
          <button
            className="btn-icon"
            aria-label="Close task"
            onClick={requestClose}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </div>
        <div className="task-dialog-body">
          {copyPending && (
            <div
              className="warning-box duplicate-recovery-choice"
              role="status"
            >
              <span>
                An unfinished new task was recovered. Your requested{" "}
                {seedIsCopy ? "copy" : "new task"} is ready if you prefer to
                start with it.
              </span>
              <button
                className="btn"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Replace the recovered new-task draft with this ${seedIsCopy ? "copy" : "new task"}?`,
                    )
                  )
                    return;
                  replaceUnfinishedTask(freshForm);
                }}
              >
                {seedIsCopy ? "Use copy instead" : "Use new task instead"}
              </button>
              <button className="btn" onClick={() => setCopyPending(false)}>
                Keep recovered task
              </button>
            </div>
          )}
          {recovered && (
            <p className="draft-recovery-note" role="status">
              Recovered task draft from this device.
            </p>
          )}
          {draftError && (
            <p role="alert" className="form-error">
              {draftError}
            </p>
          )}
          {closePrompt && (
            <div className="warning-box draft-close-prompt" role="alert">
              <span>
                Keep this draft to finish later, or discard your changes.
              </span>
              <button
                className="btn"
                disabled={!!draftError}
                onClick={() => {
                  if (!draftError) onClose();
                }}
              >
                Keep draft & close
              </button>
              <button className="btn danger" onClick={discard}>
                Discard draft
              </button>
              <button className="btn" onClick={() => setClosePrompt(false)}>
                Keep editing
              </button>
            </div>
          )}
          <fieldset disabled={saving} className="dialog-fields">
            <div className="task-title-input">
              <label htmlFor={`${fieldId}-title`} className="task-title-label">
                Task title
              </label>
              <input
                id={`${fieldId}-title`}
                autoFocus
                placeholder="What needs to happen?"
                maxLength={300}
                required
                aria-invalid={(!!error && !draft.title.trim()) || undefined}
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </div>
            <div className="task-meta-grid task-essential-fields">
              <label>
                Status
                <select
                  value={draft.status}
                  onChange={(e) => set("status", e.target.value as Status)}
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  value={draft.priority}
                  onChange={(e) =>
                    set("priority", e.target.value as Task["priority"])
                  }
                >
                  {priorities.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assignee
                <select
                  value={draft.assigneeId}
                  onChange={(e) => set("assigneeId", e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {w.people
                    .filter((p) => !p.inactive || p.id === draft.assigneeId)
                    .map((p) => (
                      <option key={p.id} value={p.id} disabled={p.inactive}>
                        {p.name}
                        {p.inactive ? " (former member)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Project
                <select
                  value={draft.projectId}
                  onChange={(e) =>
                    change({
                      task: {
                        ...latestForm.current.task,
                        projectId: e.target.value,
                        parentId: "",
                        milestoneId: "",
                      },
                    })
                  }
                >
                  <option value="">No project</option>
                  {w.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <section
              className="task-planning task-date-fields"
              aria-label="Task dates"
            >
              <div className="task-section-heading">
                <h3>
                  Dates <span className="editor-optional">Optional</span>
                </h3>
              </div>
              <p id={`${fieldId}-schedule-help`} className="task-schedule-help">
                Set either date or both. Planned start and due date can be the
                same day.
              </p>
              <div className="task-meta-grid">
                <label>
                  Planned start date
                  <input
                    type="date"
                    value={draft.startDate}
                    max={draft.dueDate || undefined}
                    aria-invalid={invalidDateRange || undefined}
                    aria-describedby={`${fieldId}-schedule-help${invalidDateRange ? ` ${fieldId}-schedule-error` : ""}`}
                    onChange={(e) => set("startDate", e.target.value)}
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={draft.dueDate}
                    min={draft.startDate || undefined}
                    aria-invalid={invalidDateRange || undefined}
                    aria-describedby={`${fieldId}-schedule-help${invalidDateRange ? ` ${fieldId}-schedule-error` : ""}`}
                    onChange={(e) => set("dueDate", e.target.value)}
                  />
                </label>
              </div>
              {invalidDateRange && (
                <p
                  id={`${fieldId}-schedule-error`}
                  className="task-schedule-error"
                  role="alert"
                >
                  Planned start date must be on or before the due date.
                </p>
              )}
            </section>
            <div className="task-template-toolbar" data-tour="task-templates">
              {task && (
                <WatchControl
                  reference={{ type: "task", id: task.id }}
                  notify={notify}
                />
              )}
              <button
                className="btn"
                disabled={saving}
                onClick={() => setTemplatesOpen(true)}
              >
                <Copy size={15} />
                My task templates
              </button>
              {task && onDuplicate && (
                <button
                  className="btn"
                  disabled={saving}
                  data-tour="duplicate-task"
                  onClick={async () => {
                    if (dirty.current && !(await save(false))) return;
                    onDuplicate(duplicateTask(originalTask.current || task, w));
                  }}
                >
                  <Copy size={15} />
                  Duplicate task
                </button>
              )}
            </div>

            {blocked.length > 0 && (
              <div className="warning-box">
                <Link2 size={15} />
                Waiting on {blocked.length} unfinished{" "}
                {blocked.length === 1 ? "dependency" : "dependencies"}.
              </div>
            )}
            <div
              className="view-tabs dialog-tabs"
              role="group"
              aria-label="Task sections"
            >
              <button
                className={tab === "details" ? "selected" : ""}
                aria-pressed={tab === "details"}
                onClick={() => setTab("details")}
              >
                Details
              </button>
              <button
                className={tab === "connections" ? "selected" : ""}
                aria-pressed={tab === "connections"}
                onClick={() => setTab("connections")}
              >
                <Link2 size={14} />
                Connections
              </button>
              <button
                className={tab === "activity" ? "selected" : ""}
                aria-pressed={tab === "activity"}
                onClick={() => setTab("activity")}
              >
                Discussion <span>{draft.comments.length}</span>
              </button>
            </div>
            {tab === "details" && (
              <>
                <SourceNoteCard
                  task={draft}
                  workspace={w}
                  onOpenNote={(id) => void openLinkedNote(id)}
                />
                <div className="field-heading">
                  <label
                    htmlFor={preview ? undefined : `${fieldId}-description`}
                  >
                    Description
                  </label>
                  <button
                    className="text-button"
                    aria-pressed={preview}
                    onClick={() => setPreview((p) => !p)}
                  >
                    {preview ? "Edit Markdown" : "Preview"}
                  </button>
                </div>
                {preview ? (
                  <div className="task-description-preview">
                    <Markdown
                      content={
                        draft.description ||
                        "*Add a description to give your team context.*"
                      }
                      workspace={w}
                      onNoteClick={(id) => void openLinkedNote(id)}
                    />
                  </div>
                ) : (
                  <textarea
                    id={`${fieldId}-description`}
                    className="description-editor"
                    maxLength={100000}
                    placeholder="Add context, acceptance criteria, or link an idea with [[Note title]]…"
                    value={draft.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                )}
                <div className="field-heading">
                  <label htmlFor={`${fieldId}-subtask`}>
                    Subtasks{" "}
                    <span className="muted">
                      {draft.subtasks.filter((s) => s.done).length}/
                      {draft.subtasks.length}
                    </span>
                  </label>
                </div>
                <div className="subtasks">
                  {draft.subtasks.map((s) => (
                    <div key={s.id}>
                      <button
                        className={"subtask-check " + (s.done ? "checked" : "")}
                        aria-label={"Toggle " + s.title}
                        aria-pressed={s.done}
                        onClick={() =>
                          set(
                            "subtasks",
                            draft.subtasks.map((x) =>
                              x.id === s.id ? { ...x, done: !x.done } : x,
                            ),
                          )
                        }
                      >
                        {s.done && <Check size={12} />}
                      </button>
                      <span className={s.done ? "completed" : ""}>
                        {s.title}
                      </span>
                      <button
                        className="btn-icon"
                        aria-label={"Remove " + s.title}
                        onClick={() =>
                          set(
                            "subtasks",
                            draft.subtasks.filter((x) => x.id !== s.id),
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="inline-add">
                  <Plus size={15} />
                  <input
                    id={`${fieldId}-subtask`}
                    value={subtask}
                    maxLength={300}
                    placeholder="Add a small next step…"
                    onChange={(e) => change({ subtask: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addSubtask();
                      }
                    }}
                  />
                  <button
                    className="text-button"
                    disabled={!subtask.trim()}
                    onClick={addSubtask}
                  >
                    Add
                  </button>
                </div>
                <details
                  className="task-advanced-planning"
                  open={planningOpen}
                  onToggle={(event) =>
                    setPlanningOpen(event.currentTarget.open)
                  }
                  data-tour="task-planning-options"
                >
                  <summary>
                    <span>More planning options</span>
                    <small>{planningSummary}</small>
                  </summary>
                  <div className="task-advanced-planning-body">
                    <p className="editor-field-help">
                      Add structure when you need it. These options stay with
                      the task when this section is closed.
                    </p>
                    <div className="task-meta-grid task-planning-options">
                      <label>
                        Effort points
                        <input
                          type="number"
                          min="0"
                          max="999"
                          value={draft.estimate}
                          onChange={(e) =>
                            set("estimate", Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        Type
                        <select
                          value={draft.type}
                          onChange={(e) =>
                            set("type", e.target.value as Task["type"])
                          }
                        >
                          {["task", "story", "bug", "epic"].map((t) => (
                            <option key={t} value={t}>
                              {t.charAt(0).toUpperCase() + t.slice(1)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Tags
                        <input
                          placeholder="planning, research"
                          value={tagText}
                          onChange={(e) => change({ tagText: e.target.value })}
                        />
                      </label>
                    </div>
                    <TaskHierarchyFields
                      task={draft}
                      workspace={w}
                      onChange={(patch) =>
                        change({
                          task: { ...latestForm.current.task, ...patch },
                        })
                      }
                      onOpenTask={
                        openTask ? (id) => void openRelatedTask(id) : undefined
                      }
                    />
                    <TaskScheduleOptions
                      task={draft}
                      workspace={w}
                      onChange={(patch) =>
                        change({
                          task: { ...latestForm.current.task, ...patch },
                        })
                      }
                      onOpenTask={
                        openTask ? (id) => void openRelatedTask(id) : undefined
                      }
                    />
                  </div>
                </details>
              </>
            )}
            {tab === "connections" && (
              <>
                <div className="field-heading">
                  <label>Linked notes</label>
                  <span className="muted small-text">
                    Keep the context close
                  </span>
                </div>
                <div className="connection-options">
                  {w.notes.map((n) => (
                    <label key={n.id}>
                      <input
                        type="checkbox"
                        checked={draft.noteIds.includes(n.id)}
                        disabled={draft.source?.noteId === n.id}
                        onChange={(e) =>
                          set(
                            "noteIds",
                            e.target.checked
                              ? [...draft.noteIds, n.id]
                              : draft.noteIds.filter((id) => id !== n.id),
                          )
                        }
                      />
                      <BookOpen size={14} />
                      <span>
                        {n.title}
                        {draft.source?.noteId === n.id && (
                          <small className="muted"> · Source note</small>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn-icon"
                        aria-label={"Open " + n.title}
                        disabled={saving}
                        onClick={() => void openLinkedNote(n.id)}
                      >
                        <ExternalLink size={12} />
                      </button>
                    </label>
                  ))}
                  {!w.notes.length && (
                    <p className="task-connections-empty">
                      No notes yet. Create a note in Notes, then link it here to
                      keep the task&apos;s context close.
                    </p>
                  )}
                </div>
                <div className="field-heading">
                  <label>Blocked by</label>
                  <span className="muted small-text">
                    Tasks that need to finish first
                  </span>
                </div>
                <div className="connection-options">
                  {w.tasks
                    .filter((t) => t.id !== draft.id)
                    .map((t) => (
                      <label key={t.id}>
                        <input
                          type="checkbox"
                          checked={draft.blockedBy.includes(t.id)}
                          onChange={(e) =>
                            set(
                              "blockedBy",
                              e.target.checked
                                ? [...draft.blockedBy, t.id]
                                : draft.blockedBy.filter((id) => id !== t.id),
                            )
                          }
                        />
                        <StatusIcon status={t.status} />
                        <span>
                          <small className="muted">{t.key}</small> {t.title}
                        </span>
                      </label>
                    ))}
                  {!w.tasks.some((t) => t.id !== draft.id) && (
                    <p className="task-connections-empty">
                      No other tasks yet. Add another task to choose work that
                      needs to finish before this one.
                    </p>
                  )}
                </div>
              </>
            )}
            {tab === "activity" && (
              <>
                <div className="comments">
                  {draft.comments.map((c) => (
                    <article key={c.id}>
                      <Avatar
                        person={w.people.find((p) => p.id === c.personId)}
                        small
                        label={c.personId ? "Former member" : "Guest"}
                      />
                      <div>
                        <header>
                          <strong>
                            {w.people.find((p) => p.id === c.personId)?.name ||
                              (c.personId ? "Former member" : "Guest")}
                          </strong>
                          <small>
                            {new Date(c.createdAt).toLocaleString()}
                          </small>
                        </header>
                        <p>{c.body}</p>
                      </div>
                    </article>
                  ))}
                  {!draft.comments.length && (
                    <Empty
                      title="Start a conversation"
                      text="Keep decisions and feedback with the task."
                    />
                  )}
                </div>
                <label
                  className="task-discussion-label"
                  htmlFor={`${fieldId}-comment`}
                >
                  Add an update
                </label>
                <MentionHelp />
                <textarea
                  id={`${fieldId}-comment`}
                  className="field"
                  placeholder="Share an update or decision…"
                  value={comment}
                  maxLength={10000}
                  onChange={(e) => change({ comment: e.target.value })}
                />
                <button
                  className="btn"
                  disabled={!comment.trim()}
                  onClick={addComment}
                >
                  <Plus size={14} />
                  Add to discussion
                </button>
                <p className="small-text muted">
                  Save the task to keep your discussion updates.
                </p>
              </>
            )}
          </fieldset>
          {error && (
            <div
              ref={errorRef}
              tabIndex={-1}
              className="entity-editor-error"
              role="alert"
            >
              <p className="form-error">{error}</p>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => void loadLatest()}
              >
                {exists ? "Use latest saved values" : "Check saved version"}
              </button>
            </div>
          )}
        </div>
        <footer className="dialog-footer">
          {task && (
            <button
              className="btn danger editor-delete"
              aria-label="Move task to Trash"
              title="Move task to Trash"
              disabled={saving}
              onClick={() => void deleteTask()}
            >
              <Trash2 size={16} />
              <span>Trash</span>
            </button>
          )}
          <span className="small-text muted">
            {task
              ? "Updated " + new Date(task.updatedAt).toLocaleDateString()
              : "Make the next step clear."}
          </span>
          <button className="btn" onClick={requestClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => save()}
          >
            {saving ? "Saving…" : exists ? "Save changes" : "Create task"}
            <Check size={15} />
          </button>
        </footer>
      </section>
      {templatesOpen && (
        <PersonalTemplates
          kind="task"
          source={taskTemplateContent({
            ...draft,
            tags: tagText
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          })}
          sourceTitle={draft.title}
          onClose={() => setTemplatesOpen(false)}
          onUse={async (template) => {
            if (template.kind !== "task") return;
            const seeded = instantiateTaskTemplate(template.content, {
              projectId: draft.projectId,
            });
            if (exists) {
              if (!onDuplicate)
                throw new Error("Create a new task to use this template.");
              if (dirty.current && !(await save(false)))
                throw new Error(
                  "Save your current task before using a template.",
                );
              onDuplicate(seeded);
              return;
            }
            const next = {
              task: { ...seeded, id: draft.id },
              tagText: seeded.tags.join(", "),
              comment: "",
              subtask: "",
            };
            if (dirty.current) {
              if (
                !window.confirm(
                  "Replace the current unfinished task with this template?",
                )
              )
                throw new Error("Your current task is kept.");
              replaceUnfinishedTask(next);
            } else change(next);
          }}
        />
      )}
    </div>
  );
}
