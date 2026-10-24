import { priorities, statuses, type Task } from "./types";
import {
  discardDraftMutations,
  writeDraft,
  type DraftRecord,
  type DraftScope,
} from "./draft-store";

export interface TaskForm {
  task: Task;
  tagText: string;
  comment: string;
  subtask: string;
}

/** Call only after the user explicitly discards the previous unfinished task. */
export function replaceTaskDraft(
  scope: DraftScope,
  draftId: string,
  previousTaskId: string,
  replacement: TaskForm,
) {
  const result = writeDraft<TaskForm, Task>(
    scope,
    "tasks",
    draftId,
    replacement,
    null,
  );
  // Retrying an abandoned failed save must not recreate the discarded task.
  // Recovery copies from other windows remain separate and are left untouched.
  discardDraftMutations(scope, "tasks", previousTaskId);
  return result;
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<Task>;
  const strings = [
    "id",
    "key",
    "title",
    "description",
    "projectId",
    "assigneeId",
    "startDate",
    "dueDate",
    "createdAt",
    "updatedAt",
  ] as const;
  const stringArray = (items: unknown, limit: number) =>
    Array.isArray(items) &&
    items.length <= limit &&
    items.every((item) => typeof item === "string");
  return (
    strings.every((key) => typeof task[key] === "string") &&
    statuses.some((status) => status.id === task.status) &&
    priorities.includes(task.priority as Task["priority"]) &&
    ["task", "story", "bug", "epic"].includes(task.type || "") &&
    typeof task.estimate === "number" &&
    Number.isFinite(task.estimate) &&
    stringArray(task.tags, 40) &&
    stringArray(task.noteIds, 500) &&
    stringArray(task.blockedBy, 500) &&
    Array.isArray(task.subtasks) &&
    task.subtasks.length <= 200 &&
    task.subtasks.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.done === "boolean",
    ) &&
    Array.isArray(task.comments) &&
    task.comments.length <= 500 &&
    task.comments.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.personId === "string" &&
        typeof item.body === "string" &&
        typeof item.createdAt === "string",
    ) &&
    (task.source === undefined ||
      (!!task.source &&
        typeof task.source.noteId === "string" &&
        typeof task.source.excerpt === "string"))
  );
}

/** Preserve old recovery copies while supplying their newly introduced field. */
export function parseRecoverableTask(value: unknown): Task | null {
  const normalized =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !("startDate" in value)
      ? { ...value, startDate: "" }
      : value;
  return isTask(normalized) ? normalized : null;
}

/** A draft may contain an unfinished date range; the editor makes it repairable. */
export function parseTaskDraft(
  record: DraftRecord<unknown, unknown> | null,
  expectedTaskId?: string,
): DraftRecord<TaskForm, Task> | null {
  if (!record || !record.value || typeof record.value !== "object") return null;
  const form = record.value as Partial<TaskForm>;
  const task = parseRecoverableTask(form.task);
  const baseline =
    record.baseline === null ? null : parseRecoverableTask(record.baseline);
  if (
    !task ||
    typeof form.tagText !== "string" ||
    typeof form.comment !== "string" ||
    typeof form.subtask !== "string" ||
    (record.baseline !== null && (!baseline || baseline.id !== task.id)) ||
    (expectedTaskId &&
      (task.id !== expectedTaskId ||
        !baseline ||
        baseline.id !== expectedTaskId))
  )
    return null;
  return {
    ...record,
    value: {
      ...form,
      task,
      tagText: form.tagText,
      comment: form.comment,
      subtask: form.subtask,
    },
    baseline,
  };
}
