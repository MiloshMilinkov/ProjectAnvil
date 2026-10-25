import { database, type ResolvedWorkspace } from "./access-store";
import type { Workspace } from "./types";

/** Generic content replacements end the old session rather than reviving old edits. */
export function prepareNoteDocumentStatements(
  access: ResolvedWorkspace,
  current: Workspace,
  updated: Workspace,
  committedSQL: string,
  guardValues: unknown[],
  resetAll = false,
): D1PreparedStatement[] {
  const remaining = new Map(updated.notes.map((note) => [note.id, note]));
  const reset = current.notes
    .filter(
      (note) => resetAll || remaining.get(note.id)?.content !== note.content,
    )
    .map((note) => note.id);
  if (!reset.length) return [];
  return [
    database()
      .prepare(
        `DELETE FROM note_collaboration WHERE workspace_id = ? AND note_id IN (SELECT value FROM json_each(?)) AND ${committedSQL}`,
      )
      .bind(access.id, JSON.stringify(reset), ...guardValues),
    database()
      .prepare(
        `DELETE FROM note_presence WHERE workspace_id = ? AND note_id IN (SELECT value FROM json_each(?)) AND ${committedSQL}`,
      )
      .bind(access.id, JSON.stringify(reset), ...guardValues),
  ];
}
