import * as Y from "yjs";
import {
  listDrafts,
  removeDraft,
  type DraftScope,
  type DraftRecord,
} from "./draft-store";
import {
  decodeDocumentUpdate,
  parseCollaborativeDraft,
  type CollaborativeDraft,
} from "./note-collaboration";
import { belongsToSharedNote } from "./note-collaboration-draft-keys";
export { sharedNoteDraftKey } from "./note-collaboration-draft-keys";

export interface SharedDraftReference {
  id: string;
  token: string;
  generation: string;
}
export interface SharedNoteDraft {
  id: string;
  record: DraftRecord<CollaborativeDraft, unknown>;
}

export function sharedNoteDrafts(
  scope: DraftScope,
  noteId: string,
): SharedNoteDraft[] {
  return listDrafts<unknown, unknown>(scope, "shared-notes").flatMap((item) => {
    if (item.id !== noteId && !item.id.startsWith(`${noteId}:`)) return [];
    const value = parseCollaborativeDraft(item.record.value);
    if (!value) return [];
    return belongsToSharedNote(item.id, noteId, value)
      ? [{ id: item.id, record: { ...item.record, value } }]
      : [];
  });
}

export function mergeSharedNoteDrafts(
  doc: Y.Doc,
  drafts: SharedNoteDraft[],
  generation: string,
): SharedDraftReference[] {
  const captured: SharedDraftReference[] = [];
  for (const { id, record } of drafts) {
    if (record.value.generation !== generation) continue;
    Y.applyUpdate(doc, decodeDocumentUpdate(record.value.update), "recovered");
    captured.push({ id, token: record.token, generation });
  }
  return captured;
}

/** Acknowledgement only clears the exact versions included in that saved document. */
export function acknowledgeSharedNoteDrafts(
  scope: DraftScope,
  captured: SharedDraftReference[],
): void {
  for (const item of captured)
    removeDraft(scope, "shared-notes", item.id, item.token);
}
