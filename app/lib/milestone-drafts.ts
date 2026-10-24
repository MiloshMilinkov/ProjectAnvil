import { readDraft, removeDraft, type DraftScope } from "./draft-store";
import type { Milestone, Mutation } from "./types";

export interface MilestoneDraft {
  milestone: Milestone;
  operationIds: string[];
}

export function parseMilestoneDraft(value: unknown): MilestoneDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<MilestoneDraft>;
  const milestone = draft.milestone;
  if (
    !milestone ||
    typeof milestone !== "object" ||
    ![
      milestone.id,
      milestone.title,
      milestone.description,
      milestone.targetDate,
    ].every((item) => typeof item === "string") ||
    typeof milestone.archived !== "boolean" ||
    !Array.isArray(draft.operationIds) ||
    draft.operationIds.length > 100 ||
    !draft.operationIds.every(
      (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(id),
    )
  )
    return null;
  return draft as MilestoneDraft;
}

/** Cancels only the failed saves created by this explicitly discarded form. */
export function discardMilestoneDraft(
  scope: DraftScope,
  projectId: string,
  recoveryId: string,
  operationIds: string[],
  token?: string,
) {
  if (token) removeDraft(scope, "milestone-forms", recoveryId, token);
  for (const id of operationIds) {
    const queued = readDraft<Mutation>(scope, "mutations", id);
    const mutation = queued?.value;
    if (
      queued &&
      mutation?.action === "upsert" &&
      mutation.entity === "projects" &&
      mutation.item?.id === projectId &&
      Object.keys(mutation.item).every(
        (key) => key === "id" || key === "milestones",
      )
    ) {
      removeDraft(scope, "mutations", id, queued.token);
    }
  }
}
