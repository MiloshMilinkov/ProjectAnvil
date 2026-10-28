"use client";
import { useMemo, useRef, useState, type RefObject } from "react";
import {
  BookOpen,
  Bookmark,
  CalendarDays,
  FileText,
  Folder,
  Plus,
  Search,
  Tag,
  X,
} from "lucide-react";
import type { Note, NoteType } from "../../lib/types";
import { indexNotes, filterNotes } from "../../lib/note-browser";
const emptyTypes: NoteType[] = [];
interface Props {
  id: string;
  browserRef: RefObject<HTMLElement | null>;
  mode: "notes" | "daily";
  mobileVisible: boolean;
  modalOpen: boolean;
  canCreate: boolean;
  canManageTypes: boolean;
  notes: Note[];
  noteTypes?: NoteType[];
  selectedId: string;
  onClose: () => void;
  onCreate: () => void;
  onManageTypes: () => void;
  onSelect: (id: string) => void | Promise<void>;
}
/** Local browsing state stays independent of the active editor and its save flow. */
export default function NoteBrowser({
  id,
  browserRef,
  mode,
  mobileVisible,
  modalOpen,
  canCreate,
  canManageTypes,
  notes,
  noteTypes = emptyTypes,
  selectedId,
  onClose,
  onCreate,
  onManageTypes,
  onSelect,
}: Props) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState("all");
  const [tag, setTag] = useState("all");
  const [noteTypeFilter, setNoteTypeFilter] = useState("all");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const index = useMemo(() => indexNotes(notes, noteTypes), [notes, noteTypes]);
  const folders = useMemo(
    () => [...new Set(notes.map((note) => note.folder || "Notes"))].sort(),
    [notes],
  );
  const tags = useMemo(
    () => [...new Set(notes.flatMap((note) => note.tags))].sort(),
    [notes],
  );
  const visible = useMemo(
    () =>
      filterNotes(index, {
        search,
        folder,
        tag,
        type: noteTypeFilter,
        bookmarked: bookmarksOnly,
      }),
    [index, search, folder, tag, noteTypeFilter, bookmarksOnly],
  );
  const hasFilters =
    !!search ||
    folder !== "all" ||
    tag !== "all" ||
    noteTypeFilter !== "all" ||
    bookmarksOnly;
  function clearFilters() {
    setSearch("");
    setFolder("all");
    setTag("all");
    setNoteTypeFilter("all");
    setBookmarksOnly(false);
    searchInput.current?.focus();
  }
  return (
    <aside
      ref={browserRef}
      id={id}
      className={`note-browser ${mobileVisible ? "mobile-visible" : ""}`}
      role={modalOpen ? "dialog" : undefined}
      aria-modal={modalOpen ? true : undefined}
      aria-label="Browse notes"
    >
      <div className="note-browser-title">
        <span>
          {mode === "daily" ? (
            <CalendarDays size={18} />
          ) : (
            <BookOpen size={18} />
          )}{" "}
          {mode === "daily" ? "Daily journal" : "Notes"}
        </span>
        <button
          className="btn-icon"
          title="New note"
          aria-label="New note"
          disabled={!canCreate}
          onClick={onCreate}
        >
          <Plus size={17} />
        </button>
        <button
          className="btn-icon note-browser-close"
          aria-label="Close notes browser"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <label className="note-search">
        <Search size={15} />
        <input
          ref={searchInput}
          aria-label="Search notes"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a note…"
        />
        <kbd>⌕</kbd>
      </label>
      <div className="note-scope">
        <button
          className={bookmarksOnly ? "active" : ""}
          aria-pressed={bookmarksOnly}
          onClick={() => setBookmarksOnly((value) => !value)}
        >
          <Bookmark size={13} fill={bookmarksOnly ? "currentColor" : "none"} />{" "}
          Bookmarked
        </button>
        <span role="status">
          {hasFilters ? `${visible.length} of ` : ""}
          {notes.length} {notes.length === 1 ? "note" : "notes"}
        </span>
      </div>
      <div className="note-filter-row">
        <label>
          <Folder size={13} />
          <select
            aria-label="Filter notes by folder"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          >
            <option value="all">All folders</option>
            {folders.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <Tag size={13} />
          <select
            aria-label="Filter notes by tag"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          >
            <option value="all">All tags</option>
            {tags.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="note-type-filter">
        <select
          aria-label="Filter by note type"
          value={noteTypeFilter}
          onChange={(event) => setNoteTypeFilter(event.target.value)}
        >
          <option value="all">All note types</option>
          <option value="decision">Decision records</option>
          {noteTypes.map((type) => (
            <option key={type.id} value={`custom:${type.id}`}>
              {type.name}
              {type.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        className="btn note-types-browser-action"
        disabled={!canManageTypes}
        onClick={onManageTypes}
        data-tour="custom-note-types"
      >
        Manage note types
      </button>
      {hasFilters && (
        <div className="note-filter-actions">
          <button className="btn" onClick={clearFilters}>
            Clear note filters
          </button>
        </div>
      )}
      <div className="note-list">
        {visible.length ? (
          visible.map(({ note, excerpt, typeLabel, updatedLabel }) => (
            <button
              key={note.id}
              className={`note-list-item ${selectedId === note.id ? "selected" : ""}`}
              aria-current={selectedId === note.id ? "page" : undefined}
              onClick={() => onSelect(note.id)}
            >
              <div className="note-list-item-top">
                <span className={`note-type-symbol kind-${note.kind}`}>
                  {note.kind === "daily" ? (
                    <CalendarDays size={16} />
                  ) : (
                    <FileText size={16} />
                  )}
                </span>
                <span className="note-list-name">
                  {note.title || "Untitled note"}
                </span>
                {note.bookmarked && (
                  <Bookmark
                    size={12}
                    className="note-bookmarked"
                    fill="currentColor"
                  />
                )}
              </div>
              <p>{excerpt}</p>
              <div className="note-list-meta">
                <span>{typeLabel}</span>
                <span>{updatedLabel}</span>
              </div>
            </button>
          ))
        ) : (
          <div className="note-list-empty">
            <Search size={25} />
            <p>
              {notes.length
                ? "No notes match these filters. Try another search, folder, tag, type, or bookmark filter."
                : canCreate
                  ? "No notes here yet. Create your first note to get started."
                  : "No notes are available in this view yet."}
            </p>
            <button className="btn" disabled={!canCreate} onClick={onCreate}>
              Create a note
            </button>
          </div>
        )}
      </div>
      <div className="note-browser-footer">
        <div className="note-vault-dot" />
        <span>Your notes</span>
        <button
          className="btn-icon"
          title="New note from template"
          disabled={!canCreate}
          onClick={onCreate}
        >
          <Plus size={15} />
        </button>
      </div>
    </aside>
  );
}
