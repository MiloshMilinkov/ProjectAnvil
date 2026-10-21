"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpen,
  CheckSquare,
  Clock3,
  DoorOpen,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { Workspace } from "../lib/types";
import type { WorkLocation, WorkRoom } from "../lib/workrooms";
import { useWorkspaceFetch, useWorkspaceScope } from "./WorkspaceScope";
import {
  readDraft,
  registerDraftGuard,
  removeDraft,
  writeDraft,
} from "../lib/draft-store";
import { useDraftScope } from "./useRecoverableDraft";
import "./work-rooms.css";

type Notify = (message: string) => void;

interface WorkRoomsProps {
  workspace: Workspace;
  location: WorkLocation;
  onResume: (room: WorkRoom) => void;
  notify: Notify;
  onRoomsChanged?: (rooms: WorkRoom[]) => void;
}

interface ResumeWorkCardProps {
  onResume: (room: WorkRoom) => void;
  onManage: () => void;
  notify: Notify;
}

interface RoomsResponse {
  rooms?: WorkRoom[];
  error?: string;
}

type RoomDraft = Pick<
  WorkRoom,
  "id" | "name" | "projectId" | "taskId" | "noteIds" | "canvasId" | "location"
> & {
  revision: number;
  summary: string;
  nextStep: string;
  question: string;
};

type RoomMutation =
  | { action: "upsert"; room: Partial<WorkRoom> & { id: string } }
  | { action: "delete"; id: string };

const roomLimit = 30;
const notePinLimit = 20;
const checkpointLength = 2000;

const locationLabels: Record<WorkLocation["page"], string> = {
  overview: "Workspace overview",
  "my-work": "My work",
  tasks: "Task board",
  projects: "Projects",
  notes: "Notes",
  graph: "Relationship graph",
  canvas: "Canvas",
  collections: "Collections",
  daily: "Daily planner",
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Your work rooms could not be saved. Please try again.";
}

function savedDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not saved yet";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Rooms are fetched through the same account and workspace boundary as notes. */
function useWorkRooms() {
  const scopedFetch = useWorkspaceFetch();
  const [rooms, setRooms] = useState<WorkRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const readVersion = useRef(0);
  const pendingMutations = useRef(0);
  const currentRooms = useRef(rooms);
  useEffect(() => {
    currentRooms.current = rooms;
  }, [rooms]);

  const readResponse = useCallback(
    async (response: Response): Promise<WorkRoom[]> => {
      const result = (await response
        .json()
        .catch(() => null)) as RoomsResponse | null;
      if (!response.ok || !Array.isArray(result?.rooms)) {
        throw new Error(
          result?.error ||
            "Your work rooms could not be opened. Please try again.",
        );
      }
      return [...result.rooms].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    },
    [],
  );

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<WorkRoom[]> => {
      if (pendingMutations.current) return currentRooms.current;
      const version = ++readVersion.current;
      try {
        const response = await scopedFetch("/api/rooms", {
          cache: "no-store",
          signal,
        });
        const result = await readResponse(response);
        if (
          alive.current &&
          !signal?.aborted &&
          version === readVersion.current
        ) {
          setRooms(result);
          setError("");
        }
        return result;
      } catch (cause) {
        if (
          alive.current &&
          !signal?.aborted &&
          version === readVersion.current
        )
          setError(errorMessage(cause));
        throw cause;
      } finally {
        if (
          alive.current &&
          !signal?.aborted &&
          version === readVersion.current
        )
          setLoading(false);
      }
    },
    [readResponse, scopedFetch],
  );

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => undefined);
    const timer = window.setInterval(() => {
      if (!document.hidden)
        void refresh(controller.signal).catch(() => undefined);
    }, 10000);
    return () => {
      alive.current = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  const mutate = useCallback(
    async (mutation: RoomMutation): Promise<WorkRoom[]> => {
      pendingMutations.current++;
      // A delayed background read must not replace the response to a saved edit.
      readVersion.current++;
      try {
        const response = await scopedFetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mutation),
        });
        const result = await readResponse(response);
        if (alive.current) {
          setRooms(result);
          setError("");
        }
        return result;
      } finally {
        pendingMutations.current--;
      }
    },
    [readResponse, scopedFetch],
  );

  return { rooms, loading, error, refresh, mutate };
}

function createDraft(room: WorkRoom | null, location: WorkLocation): RoomDraft {
  if (room) {
    return {
      id: room.id,
      name: room.name,
      projectId: room.projectId,
      taskId: room.taskId,
      noteIds: [...room.noteIds],
      canvasId: room.canvasId,
      location: structuredClone(room.location),
      revision: room.revision,
      summary: room.checkpoint?.summary || "",
      nextStep: room.checkpoint?.nextStep || "",
      question: room.checkpoint?.question || "",
    };
  }

  return {
    id: crypto.randomUUID(),
    name: "",
    projectId: location.projectFilter,
    taskId: "",
    noteIds: location.noteId ? [location.noteId] : [],
    canvasId: location.canvasId,
    location: structuredClone(location),
    revision: 0,
    summary: "",
    nextStep: "",
    question: "",
  };
}

function unavailablePinCount(draft: RoomDraft, workspace: Workspace): number {
  const exists = (items: { id: string }[], id: string) =>
    !id || items.some((item) => item.id === id);
  return (
    Number(!exists(workspace.projects, draft.projectId)) +
    Number(!exists(workspace.tasks, draft.taskId)) +
    Number(!exists(workspace.canvases, draft.canvasId)) +
    draft.noteIds.filter((id) => !exists(workspace.notes, id)).length
  );
}

function cleanDraft(draft: RoomDraft, workspace: Workspace): RoomDraft {
  const projectId = workspace.projects.some(
    (project) => project.id === draft.projectId,
  )
    ? draft.projectId
    : "";
  const noteIds = draft.noteIds.filter((id) =>
    workspace.notes.some((note) => note.id === id),
  );
  const canvasId = workspace.canvases.some(
    (canvas) => canvas.id === draft.canvasId,
  )
    ? draft.canvasId
    : "";
  const noteId = workspace.notes.some(
    (note) => note.id === draft.location.noteId,
  )
    ? draft.location.noteId
    : noteIds[0] || "";

  return {
    ...draft,
    projectId,
    taskId: workspace.tasks.some((task) => task.id === draft.taskId)
      ? draft.taskId
      : "",
    noteIds,
    canvasId,
    location: {
      ...draft.location,
      projectFilter: projectId,
      noteId,
      canvasId,
      canvasViewport:
        canvasId && canvasId === draft.location.canvasId
          ? draft.location.canvasViewport
          : undefined,
    },
  };
}

interface RoomEditorProps extends WorkRoomsProps {
  room: WorkRoom | null;
  focusCheckpoint: boolean;
  onClose: () => void;
  onSave: (draft: RoomDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReload: (id: string) => Promise<WorkRoom | undefined>;
}

function isRoomDraft(value: unknown): value is RoomDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<RoomDraft>;
  return (
    typeof draft.id === "string" &&
    typeof draft.name === "string" &&
    typeof draft.projectId === "string" &&
    typeof draft.taskId === "string" &&
    Array.isArray(draft.noteIds) &&
    draft.noteIds.every((id) => typeof id === "string") &&
    typeof draft.canvasId === "string" &&
    typeof draft.revision === "number" &&
    typeof draft.summary === "string" &&
    typeof draft.nextStep === "string" &&
    typeof draft.question === "string" &&
    !!draft.location &&
    Object.hasOwn(locationLabels, draft.location.page)
  );
}

function RoomEditor({
  room,
  workspace,
  location,
  focusCheckpoint,
  onClose,
  onSave,
  onDelete,
  onReload,
}: RoomEditorProps) {
  const scope = useDraftScope();
  const recoveryId = room?.id || "new";
  const [initial] = useState(() => {
    const fresh = createDraft(room, location);
    const saved = readDraft<RoomDraft>(scope, "work-room-editors", recoveryId);
    const recovered =
      saved &&
      isRoomDraft(saved.value) &&
      isRoomDraft(saved.baseline) &&
      saved.baseline.id === saved.value.id &&
      (!room || saved.value.id === room.id);
    return {
      value: recovered ? saved.value : fresh,
      baseline: recovered ? saved.baseline : fresh,
      recovered: !!recovered,
    };
  });
  const [draft, setDraft] = useState(initial.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteSearch, setNoteSearch] = useState("");
  const [recovered, setRecovered] = useState(initial.recovered);
  const dialog = useRef<HTMLElement>(null);
  const errorPanel = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const draftRef = useRef(initial.value);
  const baseline = useRef(initial.baseline);
  const unsaved = useRef(
    JSON.stringify(initial.value) !== JSON.stringify(initial.baseline),
  );
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);

  const persistDraft = useCallback(
    (value: RoomDraft): boolean => {
      const result = writeDraft(
        scope,
        "work-room-editors",
        recoveryId,
        value,
        baseline.current,
      );
      setStorageError(result.error || "");
      return result.persisted;
    },
    [scope, recoveryId],
  );

  const changeDraft = useCallback(
    (change: RoomDraft | ((current: RoomDraft) => RoomDraft)) => {
      const next =
        typeof change === "function" ? change(draftRef.current) : change;
      draftRef.current = next;
      unsaved.current =
        JSON.stringify(next) !== JSON.stringify(baseline.current);
      setDraft(next);
      if (unsaved.current) persistDraft(next);
      else removeDraft(scope, "work-room-editors", recoveryId);
    },
    [scope, recoveryId, persistDraft],
  );

  const requestClose = useCallback(() => {
    if (busyRef.current) return;
    if (unsaved.current) setConfirmClose(true);
    else onClose();
  }, [onClose]);

  useEffect(() => {
    closeRef.current = requestClose;
  }, [requestClose]);
  useEffect(
    () =>
      registerDraftGuard(scope, "work-room-editor", {
        hasUnsaved: () => unsaved.current,
        // Checkpoints reach the server only after the explicit Save room action.
        flush: async () => !unsaved.current || persistDraft(draftRef.current),
      }),
    [scope, persistDraft],
  );
  useEffect(() => {
    if (error) errorPanel.current?.focus();
  }, [error]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current
      ?.querySelector<HTMLElement>(
        focusCheckpoint ? "#room-next-step" : "[data-room-autofocus]",
      )
      ?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
        ) || []),
      ].filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, [focusCheckpoint]);

  const filteredNotes = useMemo(() => {
    const query = noteSearch.trim().toLowerCase();
    return workspace.notes.filter(
      (note) =>
        !query || `${note.title} ${note.folder}`.toLowerCase().includes(query),
    );
  }, [noteSearch, workspace.notes]);
  const visibleNotes = useMemo(() => {
    const selected = new Set(draft.noteIds);
    // Keep chosen references visible without rendering a large vault at once.
    return [
      ...filteredNotes.filter((note) => selected.has(note.id)),
      ...filteredNotes.filter((note) => !selected.has(note.id)),
    ].slice(0, 100);
  }, [draft.noteIds, filteredNotes]);
  const missingPins = unavailablePinCount(draft, workspace);
  const selectedNoteIds = new Set(draft.noteIds);

  function update<K extends keyof RoomDraft>(key: K, value: RoomDraft[K]) {
    changeDraft((current) => ({ ...current, [key]: value }));
  }

  function captureCurrentView() {
    changeDraft((current) => ({
      ...current,
      projectId: location.projectFilter,
      canvasId: location.canvasId,
      noteIds: location.noteId
        ? [...new Set([location.noteId, ...current.noteIds])].slice(
            0,
            notePinLimit,
          )
        : current.noteIds,
      location: structuredClone(location),
    }));
  }

  function toggleNote(id: string) {
    changeDraft((current) => {
      const selected = current.noteIds.includes(id);
      if (!selected && current.noteIds.length >= notePinLimit) return current;
      const noteIds = selected
        ? current.noteIds.filter((noteId) => noteId !== id)
        : [...current.noteIds, id];
      return {
        ...current,
        noteIds,
        location: {
          ...current.location,
          noteId:
            selected && current.location.noteId === id
              ? noteIds[0] || ""
              : current.location.noteId || id,
        },
      };
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    if (!draft.name.trim()) {
      setError("Give this work room a name.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    const recoveryToken = readDraft(
      scope,
      "work-room-editors",
      recoveryId,
    )?.token;
    try {
      await onSave(
        cleanDraft({ ...draft, name: draft.name.trim() }, workspace),
      );
      if (recoveryToken)
        removeDraft(scope, "work-room-editors", recoveryId, recoveryToken);
      unsaved.current = false;
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function remove() {
    if (!room || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onDelete(room.id);
      removeDraft(scope, "work-room-editors", recoveryId);
      unsaved.current = false;
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function reload() {
    if (!room || busyRef.current) return;
    if (
      unsaved.current &&
      !window.confirm(
        "Replace your unsaved room changes with the latest saved room?",
      )
    )
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      const latest = await onReload(room.id);
      if (!latest)
        throw new Error(
          "This room was removed. Close this editor and create a new room.",
        );
      const next = createDraft(latest, location);
      baseline.current = next;
      changeDraft(next);
      setRecovered(false);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="room-modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) requestClose();
      }}
    >
      <section
        ref={dialog}
        className="room-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <header className="room-editor-heading">
          <span className="room-mark">
            <DoorOpen size={22} />
          </span>
          <div>
            <span className="room-eyebrow">KEEP YOUR PLACE</span>
            <h2 id={headingId}>
              {room ? "Edit work room" : "Create a work room"}
            </h2>
          </div>
          <button
            type="button"
            className="room-icon-button"
            aria-label="Close work room editor"
            disabled={busy}
            onClick={requestClose}
          >
            <X size={20} />
          </button>
        </header>
        <p className="room-intro">
          Pin the context you need, then leave a checkpoint for your next
          session. Your notes and tasks stay in their original places.
        </p>
        <form onSubmit={save}>
          {recovered && (
            <p className="room-notice" role="status">
              Recovered your unsaved room changes. They reach the workspace only
              when you save this room.
            </p>
          )}
          {storageError && (
            <p className="room-error" role="alert">
              {storageError}
            </p>
          )}
          <fieldset disabled={busy} className="room-fieldset">
            <label className="room-field">
              <span>Room name</span>
              <input
                data-room-autofocus
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="What are you working on?"
              />
            </label>
            <div className="room-form-grid">
              <label className="room-field">
                <span>Project</span>
                <select
                  value={draft.projectId}
                  onChange={(event) => {
                    const projectId = event.target.value;
                    changeDraft((current) => ({
                      ...current,
                      projectId,
                      location: {
                        ...current.location,
                        projectFilter: projectId,
                      },
                    }));
                  }}
                >
                  <option value="">No specific project</option>
                  {workspace.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="room-field">
                <span>Focus task</span>
                <select
                  value={draft.taskId}
                  onChange={(event) => update("taskId", event.target.value)}
                >
                  <option value="">No focus task</option>
                  {workspace.tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.key} · {task.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="room-field">
              <span>Canvas</span>
              <select
                value={draft.canvasId}
                onChange={(event) => {
                  const canvasId = event.target.value;
                  changeDraft((current) => ({
                    ...current,
                    canvasId,
                    location: {
                      ...current.location,
                      canvasId,
                      canvasViewport:
                        current.location.canvasId === canvasId
                          ? current.location.canvasViewport
                          : undefined,
                    },
                  }));
                }}
              >
                <option value="">No pinned canvas</option>
                {workspace.canvases.map((canvas) => (
                  <option key={canvas.id} value={canvas.id}>
                    {canvas.title}
                  </option>
                ))}
              </select>
            </label>

            <section
              className="room-pin-section"
              aria-labelledby={`${headingId}-notes`}
            >
              <div className="room-section-heading">
                <h3 id={`${headingId}-notes`}>
                  <BookOpen size={16} />
                  Pinned notes
                </h3>
                <span>
                  {draft.noteIds.length}/{notePinLimit}
                </span>
              </div>
              <label className="room-search">
                <Search size={16} />
                <input
                  type="search"
                  aria-label="Find notes to pin"
                  placeholder="Find a note…"
                  value={noteSearch}
                  onChange={(event) => setNoteSearch(event.target.value)}
                />
              </label>
              <div className="room-note-options">
                {visibleNotes.map((note) => (
                  <label className="room-note-option" key={note.id}>
                    <input
                      type="checkbox"
                      checked={selectedNoteIds.has(note.id)}
                      disabled={
                        !selectedNoteIds.has(note.id) &&
                        draft.noteIds.length >= notePinLimit
                      }
                      onChange={() => toggleNote(note.id)}
                    />
                    <span>
                      <strong>{note.title}</strong>
                      {note.folder && <small>{note.folder}</small>}
                    </span>
                  </label>
                ))}
                {!filteredNotes.length && (
                  <p>
                    {workspace.notes.length
                      ? "No notes match this search."
                      : "Create a note in Notes, then pin it here."}
                  </p>
                )}
              </div>
              {filteredNotes.length > visibleNotes.length && (
                <p className="room-help">
                  Showing {visibleNotes.length} of {filteredNotes.length} notes.
                  Search to find another reference.
                </p>
              )}
              <p className="room-help">
                You can pin references from anywhere in this workspace.
              </p>
            </section>

            <details
              className="room-view-options"
              open={focusCheckpoint ? undefined : true}
            >
              <summary>
                <PanelsTopLeft size={16} />
                Saved view <span>{locationLabels[draft.location.page]}</span>
              </summary>
              <div className="room-view-fields">
                <label className="room-field">
                  <span>Open when resuming</span>
                  <select
                    value={draft.location.page}
                    onChange={(event) =>
                      changeDraft((current) => ({
                        ...current,
                        location: {
                          ...current.location,
                          page: event.target.value as WorkLocation["page"],
                        },
                      }))
                    }
                  >
                    {Object.entries(locationLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="room-field">
                  <span>Open note</span>
                  <select
                    value={draft.location.noteId}
                    onChange={(event) => {
                      const noteId = event.target.value;
                      changeDraft((current) => ({
                        ...current,
                        noteIds:
                          noteId && !current.noteIds.includes(noteId)
                            ? [noteId, ...current.noteIds].slice(
                                0,
                                notePinLimit,
                              )
                            : current.noteIds,
                        location: { ...current.location, noteId },
                      }));
                    }}
                  >
                    <option value="">No specific note</option>
                    {workspace.notes.map((note) => (
                      <option key={note.id} value={note.id}>
                        {note.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="room-button"
                  type="button"
                  onClick={captureCurrentView}
                >
                  <MapPin size={16} />
                  Use my last working view
                </button>
                <p className="room-help">
                  Your last working view is {locationLabels[location.page]}. A
                  captured canvas view also keeps its position and zoom.
                </p>
              </div>
            </details>

            <section
              className="room-checkpoint-fields"
              data-tour="room-checkpoint"
              aria-labelledby={`${headingId}-checkpoint`}
            >
              <div className="room-section-heading">
                <h3 id={`${headingId}-checkpoint`}>
                  <Clock3 size={16} />
                  Resume checkpoint
                </h3>
              </div>
              <p className="room-help">
                A short handover to your future self. These fields save when you
                choose Save room.
              </p>
              <label className="room-field">
                <span>What changed</span>
                <textarea
                  rows={2}
                  maxLength={checkpointLength}
                  value={draft.summary}
                  onChange={(event) => update("summary", event.target.value)}
                  placeholder="What did you work out or finish?"
                />
              </label>
              <label className="room-field">
                <span>Next step</span>
                <textarea
                  id="room-next-step"
                  rows={2}
                  maxLength={checkpointLength}
                  value={draft.nextStep}
                  onChange={(event) => update("nextStep", event.target.value)}
                  placeholder="Where should you pick up next?"
                />
              </label>
              <label className="room-field">
                <span>Open question</span>
                <textarea
                  rows={2}
                  maxLength={checkpointLength}
                  value={draft.question}
                  onChange={(event) => update("question", event.target.value)}
                  placeholder="What still needs an answer?"
                />
              </label>
            </section>
          </fieldset>

          {missingPins > 0 && (
            <p className="room-notice" role="status">
              {missingPins} pinned {missingPins === 1 ? "item is" : "items are"}{" "}
              no longer available. Saving will remove those pins; other work
              stays unchanged.
            </p>
          )}
          {error && (
            <div
              ref={errorPanel}
              tabIndex={-1}
              className="room-error"
              role="alert"
            >
              <p>{error}</p>
              {room && (
                <>
                  <p className="room-help">
                    Reloading replaces this form with the saved room.
                  </p>
                  <button
                    type="button"
                    className="room-button"
                    disabled={busy}
                    onClick={() => void reload()}
                  >
                    <RefreshCw size={15} />
                    Reload saved room
                  </button>
                </>
              )}
            </div>
          )}

          {confirmClose && (
            <div className="room-delete-confirm" role="alert">
              <p>
                Your room changes have not been saved.{" "}
                {storageError
                  ? "A recovery copy could not be stored."
                  : "You can keep a recovery copy and finish later."}
              </p>
              <div>
                <button
                  type="button"
                  className="room-button"
                  onClick={() => setConfirmClose(false)}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  className="room-button"
                  disabled={!!storageError}
                  onClick={() => {
                    if (persistDraft(draftRef.current)) onClose();
                  }}
                >
                  Keep draft and close
                </button>
                <button
                  type="button"
                  className="room-button room-danger-button"
                  onClick={() => {
                    removeDraft(scope, "work-room-editors", recoveryId);
                    unsaved.current = false;
                    onClose();
                  }}
                >
                  Discard changes
                </button>
              </div>
            </div>
          )}
          {confirmDelete && (
            <div className="room-delete-confirm" role="alert">
              <p>
                Delete this room and its checkpoint? Its notes, tasks, and
                canvas will stay in your workspace.
              </p>
              <div>
                <button
                  type="button"
                  className="room-button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep room
                </button>
                <button
                  type="button"
                  className="room-button room-danger-button"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  Delete room
                </button>
              </div>
            </div>
          )}
          <footer className="room-editor-footer">
            {room && (
              <button
                type="button"
                className="room-icon-button room-delete-button"
                aria-label="Delete work room"
                title="Delete work room"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              type="button"
              className="room-button"
              disabled={busy}
              onClick={requestClose}
            >
              Close
            </button>
            <button
              type="submit"
              className="room-button room-primary-button"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle size={17} className="room-spinner" />
              ) : (
                <Save size={17} />
              )}
              {busy ? "Saving…" : "Save room"}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function RoomCard({
  room,
  workspace,
  onResume,
  onEdit,
}: {
  room: WorkRoom;
  workspace: Workspace;
  onResume: (room: WorkRoom) => void;
  onEdit: (room: WorkRoom, checkpoint: boolean) => void;
}) {
  const project = workspace.projects.find((item) => item.id === room.projectId);
  const task = workspace.tasks.find((item) => item.id === room.taskId);
  const canvas = workspace.canvases.find((item) => item.id === room.canvasId);
  const checkpoint = room.checkpoint;

  return (
    <article className="work-room-card">
      <header>
        <span className="room-mark">
          <DoorOpen size={21} />
        </span>
        <div>
          <h2>{room.name}</h2>
          <p>{project?.name || "Across this workspace"}</p>
        </div>
      </header>
      <div className="room-context-tags">
        <span>
          <PanelsTopLeft size={14} />
          {locationLabels[room.location.page]}
        </span>
        {room.noteIds.length > 0 && (
          <span>
            <BookOpen size={14} />
            {room.noteIds.length} {room.noteIds.length === 1 ? "note" : "notes"}
          </span>
        )}
        {canvas && (
          <span>
            <MapPin size={14} />
            Canvas pinned
          </span>
        )}
      </div>
      {task && (
        <div className="room-focus-task">
          <CheckSquare size={16} />
          <span>
            <small>FOCUS TASK</small>
            <strong>
              {task.key} · {task.title}
            </strong>
          </span>
        </div>
      )}
      <section className="room-card-checkpoint" data-tour="room-checkpoint">
        <span className="room-eyebrow">
          {checkpoint ? "PICK UP HERE" : "LEAVE A CHECKPOINT"}
        </span>
        <p>
          {checkpoint?.nextStep ||
            checkpoint?.summary ||
            "Save a next step so you can return without reconstructing your plan."}
        </p>
        {checkpoint?.question && (
          <small>
            <strong>Open question:</strong> {checkpoint.question}
          </small>
        )}
      </section>
      <p className="room-saved-at">
        <Clock3 size={14} />
        Saved {savedDate(checkpoint?.savedAt || room.updatedAt)}
      </p>
      <footer>
        <button
          type="button"
          className="room-button"
          aria-label={`Edit ${room.name}`}
          onClick={() => onEdit(room, true)}
        >
          Edit checkpoint
        </button>
        <button
          type="button"
          className="room-button room-primary-button"
          data-tour="resume-room"
          onClick={() => onResume(room)}
        >
          Resume room
          <ArrowRight size={16} />
        </button>
      </footer>
    </article>
  );
}

export default function WorkRooms(props: WorkRoomsProps) {
  const { workspace, onResume, notify } = props;
  const { account } = useWorkspaceScope();
  const { rooms, loading, error, refresh, mutate } = useWorkRooms();
  const [editor, setEditor] = useState<{
    room: WorkRoom | null;
    checkpoint: boolean;
  } | null>(null);
  const roomsChanged = useRef(props.onRoomsChanged);
  useEffect(() => {
    roomsChanged.current = props.onRoomsChanged;
  }, [props.onRoomsChanged]);

  useEffect(() => {
    if (!loading && !error) roomsChanged.current?.(rooms);
  }, [error, loading, rooms]);

  async function save(draft: RoomDraft) {
    const hasCheckpoint = [draft.summary, draft.nextStep, draft.question].some(
      (value) => value.trim(),
    );
    await mutate({
      action: "upsert",
      room: {
        id: draft.id,
        name: draft.name,
        projectId: draft.projectId,
        taskId: draft.taskId,
        noteIds: draft.noteIds,
        canvasId: draft.canvasId,
        location: draft.location,
        revision: draft.revision,
        checkpoint: hasCheckpoint
          ? {
              summary: draft.summary.trim(),
              nextStep: draft.nextStep.trim(),
              question: draft.question.trim(),
              savedAt: "",
            }
          : null,
      },
    });
    notify("Work room and checkpoint saved");
  }

  async function remove(id: string) {
    await mutate({ action: "delete", id });
    notify("Work room removed. Your pinned work is unchanged.");
  }

  return (
    <div className="page work-rooms-page" data-tour="work-rooms">
      <header className="work-rooms-heading">
        <div>
          <span className="room-eyebrow">YOUR WORK, WAITING FOR YOU</span>
          <h1>Work rooms</h1>
          <p>
            Keep the context for a piece of work together, leave a next step,
            and return to the same view.
          </p>
        </div>
        <button
          type="button"
          className="room-button room-primary-button"
          disabled={loading || rooms.length >= roomLimit}
          onClick={() => setEditor({ room: null, checkpoint: false })}
        >
          <Plus size={18} />
          New work room
        </button>
      </header>
      <div className="room-privacy-note">
        <LockKeyhole size={19} />
        <p>
          {account.user
            ? "These rooms are private to your account, even in a team workspace. Pinning an item does not change who can access it."
            : "These rooms belong to the local guest workspace. Sign in to keep rooms private to your account."}
        </p>
      </div>
      {error && (
        <div className="room-error room-page-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="room-button"
            onClick={() => void refresh().catch(() => undefined)}
          >
            <RefreshCw size={16} />
            Try again
          </button>
        </div>
      )}
      {loading && (
        <div className="room-empty" role="status">
          <LoaderCircle size={25} className="room-spinner" />
          <p>Opening your work rooms…</p>
        </div>
      )}
      {!loading && !rooms.length && !error && (
        <section className="room-empty">
          <span className="room-mark">
            <DoorOpen size={28} />
          </span>
          <h2>A place to pick up where you left off</h2>
          <p>
            Open a note or canvas, come here, and create a room from your last
            working view. Pin references and write down your next step.
          </p>
          <button
            type="button"
            className="room-button"
            onClick={() => setEditor({ room: null, checkpoint: false })}
          >
            <Plus size={17} />
            Create your first room
          </button>
        </section>
      )}
      {!loading && rooms.length > 0 && (
        <div className="work-room-grid">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              workspace={workspace}
              onResume={onResume}
              onEdit={(selected, checkpoint) =>
                setEditor({ room: selected, checkpoint })
              }
            />
          ))}
        </div>
      )}
      {rooms.length >= roomLimit && (
        <p className="room-limit-note">
          You have {roomLimit} rooms in this workspace. Remove a room you no
          longer need before creating another.
        </p>
      )}
      {editor && (
        <RoomEditor
          {...props}
          key={editor.room?.id || "new-room"}
          room={editor.room}
          focusCheckpoint={editor.checkpoint}
          onClose={() => setEditor(null)}
          onSave={save}
          onDelete={remove}
          onReload={async (id) =>
            (await refresh()).find((room) => room.id === id)
          }
        />
      )}
    </div>
  );
}

/** A small overview entry point; room details stay on their own page. */
export function ResumeWorkCard({
  onResume,
  onManage,
  notify,
}: ResumeWorkCardProps) {
  const { rooms, loading, error, refresh } = useWorkRooms();
  const room = rooms[0];

  if (loading) return null;
  if (error) {
    return (
      <section className="resume-work-card" data-tour="resume-room">
        <span className="room-mark">
          <DoorOpen size={21} />
        </span>
        <div>
          <h2>Work rooms</h2>
          <p>Your rooms could not be opened.</p>
        </div>
        <button
          type="button"
          className="room-button"
          onClick={() =>
            void refresh().catch((cause) => notify(errorMessage(cause)))
          }
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="resume-work-card" data-tour="resume-room">
      <span className="room-mark">
        <DoorOpen size={22} />
      </span>
      <div>
        <span className="room-eyebrow">
          {room ? "READY WHEN YOU ARE" : "KEEP YOUR PLACE"}
        </span>
        <h2>{room ? room.name : "Return with a clear next step"}</h2>
        <p>
          {room?.checkpoint?.nextStep ||
            room?.checkpoint?.summary ||
            (room
              ? "Resume your saved view and pinned context."
              : "Save a work room with your notes, task, canvas, and next step.")}
        </p>
      </div>
      <div className="resume-work-actions">
        <button type="button" className="room-button" onClick={onManage}>
          {room ? "All rooms" : "Create a room"}
        </button>
        {room && (
          <button
            type="button"
            className="room-button room-primary-button"
            onClick={() => onResume(room)}
          >
            Resume
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </section>
  );
}

interface WorkRoomShelfProps {
  room: WorkRoom;
  workspace: Workspace;
  onOpenNote: (id: string) => void;
  onOpenTask: (id: string) => void;
  onOpenCanvas: (id: string) => void;
  onManage: () => void;
  onDismiss: () => void;
}

/** Pinned context stays within reach without taking over the working surface. */
export function WorkRoomShelf({
  room,
  workspace,
  onOpenNote,
  onOpenTask,
  onOpenCanvas,
  onManage,
  onDismiss,
}: WorkRoomShelfProps) {
  const [expandedId, setExpandedId] = useState("");
  const expanded = expandedId === room.id;
  const contentId = useId();
  const notes = workspace.notes.filter((note) =>
    room.noteIds.includes(note.id),
  );
  const task = workspace.tasks.find((item) => item.id === room.taskId);
  const canvas = workspace.canvases.find((item) => item.id === room.canvasId);

  return (
    <section
      className="active-work-room"
      data-tour="active-room-context"
      aria-label={`Active work room: ${room.name}`}
    >
      <header>
        <button
          type="button"
          className="room-shelf-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() =>
            setExpandedId((current) => (current === room.id ? "" : room.id))
          }
        >
          <DoorOpen size={19} />
          <span>
            <strong>{room.name}</strong>
            <small>
              {room.checkpoint?.nextStep || "Your pinned context is ready."}
            </small>
          </span>
          <span className="room-shelf-indicator" aria-hidden="true">
            {expanded ? "−" : "+"}
          </span>
        </button>
        <button
          type="button"
          className="room-button"
          onClick={onManage}
          aria-label={`Manage room and checkpoint: ${room.name}`}
        >
          <Clock3 size={16} />
          <span>Checkpoint</span>
        </button>
        <button
          type="button"
          className="room-icon-button"
          aria-label="Leave active work room"
          title="Leave room; keep its saved checkpoint"
          onClick={onDismiss}
        >
          <X size={17} />
        </button>
      </header>
      {expanded && (
        <div id={contentId} className="room-shelf-content">
          <div className="room-shelf-pins">
            {task && (
              <button
                type="button"
                className="room-button"
                onClick={() => onOpenTask(task.id)}
              >
                <CheckSquare size={15} />
                <span>
                  {task.key} · {task.title}
                </span>
              </button>
            )}
            {notes.map((note) => (
              <button
                key={note.id}
                type="button"
                className="room-button"
                onClick={() => onOpenNote(note.id)}
              >
                <BookOpen size={15} />
                <span>{note.title}</span>
              </button>
            ))}
            {canvas && (
              <button
                type="button"
                className="room-button"
                onClick={() => onOpenCanvas(canvas.id)}
              >
                <PanelsTopLeft size={15} />
                <span>{canvas.title}</span>
              </button>
            )}
            {!task && !notes.length && !canvas && (
              <p className="room-help">
                Open the checkpoint to pin a task, note, or canvas.
              </p>
            )}
          </div>
          {room.checkpoint && (
            <div className="room-shelf-checkpoint">
              {room.checkpoint.summary && (
                <p>
                  <strong>What changed</strong>
                  {room.checkpoint.summary}
                </p>
              )}
              {room.checkpoint.nextStep && (
                <p>
                  <strong>Next step</strong>
                  {room.checkpoint.nextStep}
                </p>
              )}
              {room.checkpoint.question && (
                <p>
                  <strong>Open question</strong>
                  {room.checkpoint.question}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
