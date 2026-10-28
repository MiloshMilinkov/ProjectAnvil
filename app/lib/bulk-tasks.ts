import { uid, type Mutation, type Mutate, type Task } from "./types";
import {
  readDraft,
  removeDraft,
  writeDraft,
  type DraftRecord,
  type DraftScope,
} from "./draft-store";
import { recoverPendingOperation } from "./editor-mutations";

export type BulkTaskPatch = Partial<
  Pick<
    Task,
    | "status"
    | "priority"
    | "assigneeId"
    | "projectId"
    | "milestoneId"
    | "parentId"
    | "startDate"
    | "dueDate"
  >
>;
export interface BulkResult {
  id: string;
  status: "saved" | "failed" | "not-run";
  error?: string;
}
const fields = [
  "status",
  "priority",
  "assigneeId",
  "projectId",
  "milestoneId",
  "parentId",
  "startDate",
  "dueDate",
] as const;

/** Freeze only the fields being changed, so unrelated newer edits still merge. */
export function buildBulkMutations(
  tasks: Task[],
  patch: BulkTaskPatch,
  scope: DraftScope,
): Mutation[] {
  if (!tasks.length || tasks.length > 100)
    throw new Error("Select between 1 and 100 tasks.");
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
    throw new Error("Select each task only once.");
  const changed = fields.filter((field) => Object.hasOwn(patch, field));
  if (!changed.length) throw new Error("Choose at least one field to change.");
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depth = (task: Task) => {
    let count = 0;
    const visited = new Set([task.id]);
    let parent = task.parentId;
    while (parent && !visited.has(parent) && byId.has(parent)) {
      visited.add(parent);
      count++;
      parent = byId.get(parent)?.parentId;
    }
    return count;
  };
  // Families share a project. Reopen parents first, except when a real move detaches children.
  const projectOrder = new Map<string, number>();
  tasks.forEach((task) => {
    if (!projectOrder.has(task.projectId))
      projectOrder.set(task.projectId, projectOrder.size);
  });
  const ordered =
    patch.status || Object.hasOwn(patch, "projectId")
      ? [...tasks].sort((a, b) => {
          const group =
            projectOrder.get(a.projectId)! - projectOrder.get(b.projectId)!;
          if (group) return group;
          const moving =
            Object.hasOwn(patch, "projectId") &&
            patch.projectId !== a.projectId;
          const direction = patch.status === "done" || moving ? -1 : 1;
          return direction * (depth(a) - depth(b));
        })
      : tasks;
  return ordered.map((task) => {
    const updates =
      Object.hasOwn(patch, "projectId") && patch.projectId !== task.projectId
        ? { parentId: "", milestoneId: "", ...patch }
        : patch;
    const keys = fields.filter((field) => Object.hasOwn(updates, field));
    const mutation = recoverPendingOperation(scope, {
      action: "upsert",
      entity: "tasks",
      item: {
        id: task.id,
        ...Object.fromEntries(keys.map((field) => [field, updates[field]])),
      },
      base: {
        id: task.id,
        ...Object.fromEntries(keys.map((field) => [field, task[field] ?? ""])),
        ...(keys.includes("startDate") || keys.includes("dueDate")
          ? { startDate: task.startDate, dueDate: task.dueDate }
          : {}),
      },
    });
    mutation.operationId ||= uid();
    return mutation;
  });
}

/** Preserve individual failures and receipt IDs; a lost reply never becomes a new operation. */
export async function runBulkMutations(
  mutations: Mutation[],
  mutate: Mutate,
  onProgress: (result: BulkResult) => void,
  shouldContinue: () => boolean = () => true,
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  let stopped = false;
  for (const mutation of mutations) {
    const id = String(mutation.item?.id || "");
    let result: BulkResult;
    if (stopped || !shouldContinue()) {
      stopped = true;
      result = { id, status: "not-run" };
    } else {
      try {
        await mutate(mutation);
        result = { id, status: "saved" };
      } catch (cause) {
        result = {
          id,
          status: "failed",
          error:
            cause instanceof Error
              ? cause.message
              : "This task could not be saved.",
        };
        const status =
          cause && typeof cause === "object" && "status" in cause
            ? Number(cause.status)
            : 0;
        // Avoid repeating slow network failures or continuing after access is revoked.
        stopped = !status || status >= 500 || [401, 403, 404].includes(status);
      }
    }
    results.push(result);
    onProgress(result);
  }
  return results;
}

/** Explicit replacement retires only captured failed writes, after archiving all of them. */
export function supersedeBulkFailures(
  scope: DraftScope,
  captured: DraftRecord<Mutation>[],
  keepOperationIds: Set<string>,
): string | null {
  const candidates = captured.filter((record) => {
    const operationId = record.value.operationId;
    return (
      record.value.action === "upsert" &&
      record.value.entity === "tasks" &&
      !!operationId &&
      !keepOperationIds.has(operationId) &&
      readDraft(scope, "mutations", operationId)?.token === record.token
    );
  });
  for (const record of candidates) {
    const operationId = record.value.operationId!;
    const copy = writeDraft(
      scope,
      "recovery-copies",
      `bulk:${operationId}:${record.token}`,
      {
        entity: "mutations",
        id: operationId,
        record,
      },
      null,
    );
    if (copy.error)
      return "The previous batch could not be saved for recovery. Keep this page open and free up browser storage before replacing it.";
  }
  for (const record of candidates) {
    const operationId = record.value.operationId!;
    if (
      !removeDraft(scope, "mutations", operationId, record.token) &&
      readDraft(scope, "mutations", operationId)?.token === record.token
    )
      return "Some earlier pending saves could not be cleared. Keep this page open and try again when browser storage is available.";
  }
  return null;
}
