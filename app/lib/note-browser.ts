import type { Note, NoteType } from "./types";
import { noteTypeLabel } from "./note-structures";

export interface IndexedNote {
  note: Note;
  searchText: string;
  excerpt: string;
  typeLabel: string;
  updatedLabel: string;
}

export interface NoteFilters {
  search: string;
  folder: string;
  tag: string;
  type: string;
  bookmarked: boolean;
}

/** Prepare content once per note snapshot rather than on every filter keystroke. */
export function indexNotes(
  notes: readonly Note[],
  types: NoteType[],
): IndexedNote[] {
  if (!notes.length) return [];
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  return notes.map((note) => {
    const updated = new Date(note.updatedAt);
    return {
      note,
      searchText:
        `${note.title} ${note.content} ${note.tags.join(" ")} ${Object.values(note.propertyValues || {}).join(" ")} ${note.decision ? Object.values(note.decision).join(" ") : ""}`.toLowerCase(),
      excerpt:
        note.content
          .replace(/[#*[\]`>_=]/g, "")
          .replace(/\s+/g, " ")
          .slice(0, 90) || "Empty note",
      typeLabel:
        noteTypeLabel(note, types) ||
        (note.kind === "decision" ? "Decision record" : note.folder),
      updatedLabel: Number.isNaN(updated.getTime())
        ? updated.toLocaleDateString()
        : dateFormatter.format(updated),
    };
  });
}

/** Filtering and sorting never reorder or mutate the workspace's source records. */
export function filterNotes(
  index: readonly IndexedNote[],
  filters: NoteFilters,
): IndexedNote[] {
  const query = filters.search.toLowerCase();
  return index
    .filter(
      ({ note, searchText }) =>
        (filters.folder === "all" ||
          (note.folder || "Notes") === filters.folder) &&
        (filters.tag === "all" || note.tags.includes(filters.tag)) &&
        (filters.type === "all" ||
          (filters.type === "decision"
            ? note.kind === "decision"
            : `custom:${note.customTypeId}` === filters.type)) &&
        (!filters.bookmarked || note.bookmarked) &&
        searchText.includes(query),
    )
    .sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt));
}
