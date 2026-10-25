import { listDrafts, type DraftScope } from "./draft-store";

/** Editor keys and startup checks stay independent of the browser CRDT engine. */
export function sharedNoteDraftKey(noteId: string, tabId: string): string {
  if (
    !/^[A-Za-z0-9_-]{1,120}$/.test(noteId) ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(tabId)
  )
    throw new Error("Choose a valid shared note and browser tab.");
  return `${noteId}:${tabId}`;
}

export function belongsToSharedNote(
  key: string,
  noteId: string,
  value: unknown,
): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as {
    noteId?: unknown;
    generation?: unknown;
    content?: unknown;
    update?: unknown;
  };
  if (
    typeof item.generation !== "string" ||
    typeof item.content !== "string" ||
    typeof item.update !== "string"
  )
    return false;
  return (
    (key === noteId && (!item.noteId || item.noteId === noteId)) ||
    (item.noteId === noteId &&
      key.startsWith(`${noteId}:`) &&
      /^[A-Za-z0-9_-]{1,120}$/.test(key.slice(noteId.length + 1)))
  );
}

export function hasSharedNoteDraft(scope: DraftScope, noteId: string): boolean {
  return listDrafts<unknown>(scope, "shared-notes").some((item) =>
    belongsToSharedNote(item.id, noteId, item.record.value),
  );
}
