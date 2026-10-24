import type { BrainstormBoard, Mutation } from "./types";
import { readDraft, removeDraft, type DraftScope } from "./draft-store";

export interface BrainstormDraft {
  board: BrainstormBoard;
  operationIds: string[];
}

const string = (value: unknown, max = 100_000): value is string =>
  typeof value === "string" && value.length <= max;
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const reference = (value: unknown) => value === "" || id(value);

/** Unfinished text may be blank; only structurally safe drafts are recovered. */
export function isBrainstormBoard(value: unknown): value is BrainstormBoard {
  if (!value || typeof value !== "object") return false;
  const board = value as Partial<BrainstormBoard>;
  return !!(
    id(board.id) &&
    string(board.title, 300) &&
    string(board.description) &&
    reference(board.projectId) &&
    typeof board.votingOpen === "boolean" &&
    string(board.createdAt, 100) &&
    string(board.updatedAt, 100) &&
    Array.isArray(board.groups) &&
    board.groups.length <= 30 &&
    board.groups.every(
      (group) => group && id(group.id) && string(group.title, 300),
    ) &&
    new Set(board.groups.map((group) => group.id)).size ===
      board.groups.length &&
    Array.isArray(board.ideas) &&
    board.ideas.length <= 200 &&
    board.ideas.every(
      (idea) =>
        idea &&
        id(idea.id) &&
        string(idea.title, 300) &&
        string(idea.description) &&
        reference(idea.groupId) &&
        reference(idea.noteId) &&
        reference(idea.taskId) &&
        Array.isArray(idea.votes) &&
        idea.votes.length <= 501 &&
        idea.votes.every(id) &&
        new Set(idea.votes).size === idea.votes.length,
    ) &&
    new Set(board.ideas.map((idea) => idea.id)).size === board.ideas.length
  );
}

export function parseBrainstormDraft(value: unknown): BrainstormDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<BrainstormDraft>;
  return isBrainstormBoard(draft.board) &&
    Array.isArray(draft.operationIds) &&
    draft.operationIds.length <= 100 &&
    draft.operationIds.every(id)
    ? (draft as BrainstormDraft)
    : null;
}

/** Cancel only the failed operations captured by this explicitly discarded form. */
export function discardBrainstormDraft(
  scope: DraftScope,
  recoveryId: string,
  boardId: string,
  operationIds: string[],
  token?: string,
) {
  if (token) removeDraft(scope, "brainstorm-forms", recoveryId, token);
  for (const operationId of operationIds) {
    const queued = readDraft<Mutation>(scope, "mutations", operationId);
    if (
      queued?.value.action === "upsert" &&
      queued.value.entity === "brainstorms" &&
      queued.value.item?.id === boardId
    ) {
      removeDraft(scope, "mutations", operationId, queued.token);
    }
  }
}

/** Stable tie order keeps voting from unexpectedly reshuffling equally ranked ideas. */
export function rankedIdeas(board: BrainstormBoard, byVotes: boolean) {
  return byVotes
    ? board.ideas
        .map((idea, index) => ({ idea, index }))
        .sort(
          (left, right) =>
            right.idea.votes.length - left.idea.votes.length ||
            left.index - right.index,
        )
        .map((entry) => entry.idea)
    : board.ideas;
}
