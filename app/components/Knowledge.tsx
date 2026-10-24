"use client";
import { useWorkspaceFetch } from "./WorkspaceScope";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDialog } from "./useDialog";
import { useMediaQuery } from "./useMediaQuery";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  GitMerge,
  History,
  ImagePlus,
  Link2,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  Plus,
  Presentation,
  Scissors,
  Search,
  Settings2,
  Square,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { FeatureProps, Media, Note, Workspace } from "../lib/types";
import { today, uid } from "../lib/types";
import {
  discardDraftMutations,
  listDrafts,
  readDraft,
  registerDraftGuard,
  removeDraft,
  writeDraft,
  type DraftRecord,
  type DraftScope,
} from "../lib/draft-store";
import {
  isRecoverableNoteRecord,
  parseNewNoteDraft,
  parseNoteCopyDraft,
  stagePersonalNoteTemplate,
  type NewNoteDraft,
  type NoteTemplateId,
} from "../lib/note-drafts";
import { useDraftScope } from "./useRecoverableDraft";
import Markdown from "./Markdown";
import NoteTaskComposer from "./NoteTaskComposer";
import LinkedNoteTasks from "./LinkedNoteTasks";
import PersonalTemplates from "./PersonalTemplates";
import { noteTemplateContent } from "../lib/personal-templates";
import { moveToTrash } from "../lib/trash-actions";
import "./knowledge.css";
import "./templates.css";
import "./note-recovery.css";
import "./knowledge-ux.css";

type Props = FeatureProps & {
  selectedNote: string;
  mode: "notes" | "daily";
  tourActive?: boolean;
  onSelectNote: (id: string) => void;
};
type Kind = Note["kind"];
type EditableKey =
  | "title"
  | "content"
  | "folder"
  | "tags"
  | "projectId"
  | "kind"
  | "bookmarked"
  | "properties";
const editableKeys: EditableKey[] = [
  "title",
  "content",
  "folder",
  "tags",
  "projectId",
  "kind",
  "bookmarked",
  "properties",
];
type LocalEdit = {
  value: Note[EditableKey];
  base: Note[EditableKey];
  version: number;
};
type NoteSnapshot = Note["snapshots"][number];
function recoveredNoteDrafts(scope: DraftScope) {
  return listDrafts<unknown, unknown>(scope, "notes").filter(
    (item): item is { id: string; record: DraftRecord<Note> } =>
      isRecoverableNoteRecord(item.record, item.id),
  );
}

function restoredEdits(
  note: Note,
  baseline: Note | null,
): Map<EditableKey, LocalEdit> {
  return new Map(
    editableKeys
      .filter(
        (key) => JSON.stringify(note[key]) !== JSON.stringify(baseline?.[key]),
      )
      .map((key) => [
        key,
        { value: note[key], base: baseline?.[key] ?? note[key], version: 1 },
      ]),
  );
}

function NoteDialog({
  children,
  className,
  label,
  onClose,
  busy = false,
}: {
  children: ReactNode;
  className: string;
  label: string;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialog(ref, onClose, busy);
  return (
    <section
      ref={ref}
      className={className}
      onClick={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children}
    </section>
  );
}
type TemplateId = NoteTemplateId;
const templateCategories = [
  "General",
  "Planning",
  "Everyday",
  "Wellbeing",
  "Learning",
  "Creative",
] as const;
type TemplateCategory = (typeof templateCategories)[number];
const templates: {
  id: TemplateId;
  kind: Kind;
  label: string;
  description: string;
  category: TemplateCategory;
  folder: string;
  body: string;
}[] = [
  {
    id: "blank",
    kind: "note",
    label: "Blank note",
    description: "A simple page for any idea.",
    category: "General",
    folder: "Notes",
    body: "# Overview\n\n",
  },
  {
    id: "project-brief",
    kind: "note",
    label: "Project brief",
    description: "Define the goal, scope, and next steps.",
    category: "Planning",
    folder: "Projects",
    body: "# Project overview\n\n## Goal\n\n## What success looks like\n\n## Scope\n\n### Included\n\n- \n\n### Out of scope\n\n- \n\n## Milestones\n\n| Milestone | Target date | Owner | Status |\n| --- | --- | --- | --- |\n| | | | |\n\n## Risks & open questions\n\n## Next actions\n\n- [ ] \n",
  },
  {
    id: "weekly-plan",
    kind: "note",
    label: "Weekly plan",
    description: "Priorities, commitments, and a weekly review.",
    category: "Planning",
    folder: "Planning",
    body: "# Week of\n\n## Main priorities\n\n- [ ] \n- [ ] \n- [ ] \n\n## Weekly schedule\n\n| Day | Focus | Commitments |\n| --- | --- | --- |\n| Monday | | |\n| Tuesday | | |\n| Wednesday | | |\n| Thursday | | |\n| Friday | | |\n| Saturday | | |\n| Sunday | | |\n\n## Notes & reminders\n\n## Weekly review\n\n### What went well\n\n### What to change next week\n",
  },
  {
    id: "daily-journal",
    kind: "daily",
    label: "Daily journal",
    description: "Plan your day and reflect on it.",
    category: "Everyday",
    folder: "Journal",
    body: "# Today’s focus\n\n- [ ] \n\n## Activity log\n\n## Ideas & discoveries\n\n## End-of-day reflection\n",
  },
  {
    id: "habit-tracker",
    kind: "note",
    label: "Habit tracker",
    description: "Track routines in a flexible weekly checklist.",
    category: "Everyday",
    folder: "Routines",
    body: "# Routine goals\n\n## Week of\n\n| Habit | Mon | Tue | Wed | Thu | Fri | Sat | Sun |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| | | | | | | | |\n| | | | | | | | |\n| | | | | | | | |\n\n## What helps me stay consistent\n\n## Obstacles & adjustments\n\n## Weekly reflection\n",
  },
  {
    id: "workout-log",
    kind: "note",
    label: "Workout log",
    description: "Record your own sessions, progress, and reflections.",
    category: "Wellbeing",
    folder: "Fitness",
    body: "# Session details\n\n| Property | Detail |\n| --- | --- |\n| Date | |\n| Session focus | |\n| Location | |\n\n## Activity log\n\n| Exercise or activity | Sets | Repetitions | Duration | Notes |\n| --- | --- | --- | --- | --- |\n| | | | | |\n| | | | | |\n\n## How the session felt\n\n## Progress & observations\n\n## Notes for next time\n",
  },
  {
    id: "meal-plan",
    kind: "note",
    label: "Meal plan",
    description: "Plan meals, groceries, and preparation.",
    category: "Wellbeing",
    folder: "Everyday",
    body: "# Week of\n\n## Preferences & practical needs\n\n## Meal ideas\n\n| Day | Breakfast | Lunch | Dinner | Other |\n| --- | --- | --- | --- | --- |\n| Monday | | | | |\n| Tuesday | | | | |\n| Wednesday | | | | |\n| Thursday | | | | |\n| Friday | | | | |\n| Saturday | | | | |\n| Sunday | | | | |\n\n## Grocery list\n\n- [ ] \n\n## Preparation & leftovers\n\n## Recipes & notes\n",
  },
  {
    id: "study-notes",
    kind: "note",
    label: "Study notes",
    description: "Organize concepts, questions, and practice.",
    category: "Learning",
    folder: "Learning",
    body: "# Topic\n\n## Learning goals\n\n- [ ] \n\n## Key concepts\n\n## Notes & examples\n\n## Questions to revisit\n\n## Practice & review\n\n- [ ] \n\n## Sources & further reading\n",
  },
  {
    id: "personal-budget",
    kind: "note",
    label: "Personal budget",
    description: "Keep planned and actual amounts in one place.",
    category: "Everyday",
    folder: "Personal",
    body: "# Budget period\n\n## Goals & reminders\n\n## Income\n\n| Source | Planned | Actual | Notes |\n| --- | --- | --- | --- |\n| | | | |\n\n## Spending\n\n| Category | Planned | Actual | Notes |\n| --- | --- | --- | --- |\n| | | | |\n| | | | |\n\n## Savings & upcoming costs\n\n## Period review\n",
  },
  {
    id: "trip-planner",
    kind: "note",
    label: "Trip planner",
    description: "Bring bookings, itineraries, and packing together.",
    category: "Everyday",
    folder: "Travel",
    body: "# Trip overview\n\n| Property | Detail |\n| --- | --- |\n| Destination | |\n| Dates | |\n| Travelers | |\n\n## Bookings & important details\n\n## Itinerary\n\n| Date | Place or activity | Time | Notes |\n| --- | --- | --- | --- |\n| | | | |\n\n## Packing checklist\n\n- [ ] \n\n## Costs & reminders\n\n## Useful contacts & links\n",
  },
  {
    id: "worldbuilding",
    kind: "world",
    label: "Worldbuilding",
    description: "Places, histories, systems, and lore.",
    category: "Creative",
    folder: "Worldbuilding",
    body: "# Overview\n\n## Atmosphere\n\n## History\n\n## Locations\n\n## Rules of the world\n\n## Open questions\n\n- [ ] Explore this idea\n",
  },
  {
    id: "character",
    kind: "character",
    label: "Character",
    description: "Identity, motivations, and relationships.",
    category: "Creative",
    folder: "Characters",
    body: "# Identity\n\n| Property | Detail |\n| --- | --- |\n| Role | |\n| Motivation | |\n| Home | |\n\n## Backstory\n\n## Personality\n\n## Relationships\n\n## Character arc\n",
  },
  {
    id: "research",
    kind: "research",
    label: "Research",
    description: "Sources, findings, and next steps.",
    category: "Learning",
    folder: "Research",
    body: "# Question\n\n## Sources\n\n## Findings\n\n## Implications\n\n## Next steps\n\n- [ ] Review findings\n",
  },
  {
    id: "meeting",
    kind: "meeting",
    label: "Meeting",
    description: "Agendas, decisions, and follow-up actions.",
    category: "Planning",
    folder: "Meetings",
    body: "# Agenda\n\n- \n\n## Notes\n\n## Decisions\n\n## Action items\n\n- [ ] \n",
  },
];
const noteKinds: { kind: Kind; label: string }[] = [
  { kind: "note", label: "Note" },
  { kind: "world", label: "Worldbuilding" },
  { kind: "character", label: "Character" },
  { kind: "research", label: "Research" },
  { kind: "daily", label: "Daily journal" },
  { kind: "meeting", label: "Meeting" },
];

function newNote(
  templateId: TemplateId,
  title: string,
  projectId: string,
): Note {
  const template = templates.find((item) => item.id === templateId)!;
  const kind = template.kind;
  const now = new Date().toISOString();
  return {
    id: uid(),
    title,
    content: template.body,
    kind,
    folder: template.folder,
    tags: [],
    projectId,
    bookmarked: false,
    properties:
      kind === "character"
        ? { Role: "", Faction: "", Status: "Draft" }
        : { Status: "Draft" },
    snapshots: [],
    createdAt: now,
    updatedAt: now,
  };
}
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const kindLabel = (kind: Kind) =>
  noteKinds.find((item) => item.kind === kind)?.label || "Note";

export default function Knowledge({
  workspace,
  mutate,
  selectedNote,
  onSelectNote,
  mode,
  tourActive = false,
  projectFilter,
  currentPerson,
  openTask,
  openNote,
  notify,
}: Props) {
  const scopedFetch = useWorkspaceFetch();
  const controlId = useId();
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const emptyCreateRef = useRef<HTMLButtonElement>(null);
  const browserButtonRef = useRef<HTMLButtonElement>(null);
  const browserRef = useRef<HTMLElement>(null);
  const mobileLayout = useMediaQuery("(max-width: 750px)");
  const draftScope = useDraftScope();
  const [recoveredNotes] = useState(() => recoveredNoteDrafts(draftScope));
  const [localNoteValues, setLocalNoteValues] = useState<Record<string, Note>>(
    () =>
      Object.fromEntries(
        recoveredNotes.map((item) => [item.id, item.record.value]),
      ),
  );
  const [draft, setDraft] = useState<Note | null>(
    () =>
      recoveredNotes.find((item) => item.id === selectedNote)?.record.value ||
      workspace.notes.find((note) => note.id === selectedNote) ||
      null,
  );
  const [draftStorageError, setDraftStorageError] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState(
    () => recoveredNotes.length > 0,
  );
  const [history, setHistory] = useState<NoteSnapshot[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [restoringHistory, setRestoringHistory] = useState(false);
  const [newNoteDraft] = useState(() =>
    parseNewNoteDraft(
      readDraft<unknown>(draftScope, "note-forms", "new-note")?.value,
    ),
  );
  const [personalCreation, setPersonalCreation] = useState(
    !!newNoteDraft?.personalTemplateId,
  );
  const [view, setView] = useState<"edit" | "preview" | "split">("split");
  // Small screens show one pane while retaining Split when the window widens.
  const effectiveView = mobileLayout && view === "split" ? "preview" : view;
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("all");
  const [tag, setTag] = useState("all");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newTemplateId, setNewTemplateId] = useState<TemplateId>(
    newNoteDraft?.templateId || "blank",
  );
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategory, setTemplateCategory] = useState<
    "all" | TemplateCategory
  >("all");
  const [newTitle, setNewTitle] = useState(newNoteDraft?.title || "");
  const [creating, setCreating] = useState(false);
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "pending" | "error"
  >("saved");
  const [details, setDetails] = useState(true);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [personalTemplatesOpen, setPersonalTemplatesOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeId, setMergeId] = useState("");
  const [slides, setSlides] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [tagInput, setTagInput] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordError, setRecordError] = useState("");
  const [recordingRecovery, setRecordingRecovery] = useState(false);
  const [mobileBrowser, setMobileBrowser] = useState(false);
  const browserDialogOpen = mobileLayout && mobileBrowser;
  useDialog(
    browserRef,
    () => setMobileBrowser(false),
    false,
    browserDialogOpen,
  );
  const [linkOpen, setLinkOpen] = useState(false);
  const [taskSource, setTaskSource] = useState<{
    note: Note;
    excerpt: string;
  } | null>(null);
  const [preparingTask, setPreparingTask] = useState(false);
  const [taskSourceError, setTaskSourceError] = useState("");
  const draftRef = useRef(draft);
  const draftCache = useRef(
    new Map(recoveredNotes.map((item) => [item.id, item.record.value])),
  );
  const draftTokens = useRef(
    new Map(recoveredNotes.map((item) => [item.id, item.record.token])),
  );
  const localEdits = useRef(
    new Map(
      recoveredNotes.map((item) => [
        item.id,
        restoredEdits(item.record.value, item.record.baseline),
      ]),
    ),
  );
  const sentVersions = useRef(new Map<string, Map<EditableKey, number>>());
  const pending = useRef<Note | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const mutateRef = useRef(mutate);
  const selectedRef = useRef(selectedNote);
  const version = useRef(1);
  const mounted = useRef(true);
  const editor = useRef<HTMLTextAreaElement>(null);
  const previewPane = useRef<HTMLDivElement>(null);
  const selectedTaskExcerpt = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordingResult = useRef<Promise<boolean>>(Promise.resolve(true));
  const completeRecording = useRef<((success: boolean) => void) | null>(null);
  const uploadPending = useRef(false);
  const recordedFile = useRef<File | null>(null);
  const recordingTarget = useRef("");
  const requestingMicrophone = useRef(false);
  const newNoteForm = useRef<NewNoteDraft>(
    newNoteDraft || { title: "", templateId: "blank" },
  );
  const creatingRef = useRef(false);
  const workspaceRef = useRef(workspace);
  useLayoutEffect(() => {
    mutateRef.current = mutate;
    workspaceRef.current = workspace;
    selectedRef.current = selectedNote;
  }, [mutate, workspace, selectedNote]);

  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1050px)");
    const collapse = () => {
      if (narrow.matches) setDetails(false);
    };
    collapse();
    narrow.addEventListener("change", collapse);
    return () => narrow.removeEventListener("change", collapse);
  }, []);

  useEffect(() => {
    if (mode !== "notes") return;
    const matching = workspace.notes.filter(
      (note) =>
        !projectFilter ||
        projectFilter === "all" ||
        note.projectId === projectFilter,
    );
    if (
      workspace.notes.some((note) => note.id === selectedNote) ||
      draftCache.current.has(selectedNote)
    )
      return;
    const next = [...matching].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
    if (next) onSelectNote(next.id);
    else if (selectedNote) onSelectNote("");
  }, [mode, workspace.notes, projectFilter, selectedNote, onSelectNote]);

  const persistDraft = useCallback(
    (note: Note) => {
      const changes = localEdits.current.get(note.id);
      const baseline = {
        ...note,
        ...Object.fromEntries(
          [...(changes?.entries() || [])].map(([key, change]) => [
            key,
            change.base,
          ]),
        ),
      } as Note;
      const result = writeDraft(draftScope, "notes", note.id, note, baseline);
      draftTokens.current.set(note.id, result.record.token);
      if (mounted.current) {
        setDraftStorageError(result.error || "");
        setLocalNoteValues((previous) => ({ ...previous, [note.id]: note }));
      }
      return result.record.token;
    },
    [draftScope, setDraftStorageError],
  );

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const note = pending.current;
    if (!note)
      return queue.current.then(
        () => !localEdits.current.get(selectedRef.current)?.size,
      );
    pending.current = null;
    const changes = localEdits.current.get(note.id);
    const sent =
      sentVersions.current.get(note.id) || new Map<EditableKey, number>();
    const captured = [...(changes?.entries() || [])].filter(
      ([key, change]) => change.version > (sent.get(key) || 0),
    );
    if (!captured.length)
      return queue.current.then(() => !localEdits.current.get(note.id)?.size);
    for (const [key, change] of captured) sent.set(key, change.version);
    sentVersions.current.set(note.id, sent);
    if (mounted.current && selectedRef.current === note.id)
      setSaveState("saving");
    // Send only fields edited here. The server merges them with current teammate edits
    // and owns timestamps and snapshots; those fields never come from a local draft.
    const patch = {
      id: note.id,
      ...Object.fromEntries(
        captured.map(([key, change]) => [key, change.value]),
      ),
    };
    let sentToken: string | undefined;
    queue.current = queue.current
      .catch(() => false)
      .then(() => {
        sentToken = draftTokens.current.get(note.id);
        const base = {
          id: note.id,
          ...Object.fromEntries(
            captured.map(([key, change]) => [key, change.base]),
          ),
        };
        return mutateRef.current({
          action: "upsert",
          entity: "notes",
          item: patch,
          base,
        });
      })
      .then((updated) => {
        const latestKnown =
          workspaceRef.current.revision > updated.revision
            ? workspaceRef.current
            : updated;
        const committed = latestKnown.notes.find((item) => item.id === note.id);
        if (!committed)
          throw new Error("The saved note is no longer available.");
        const remaining =
          localEdits.current.get(note.id) || new Map<EditableKey, LocalEdit>();
        for (const [key, change] of captured)
          if (remaining.get(key)?.version === change.version)
            remaining.delete(key);
        for (const [key, change] of remaining)
          if (captured.some(([sentKey]) => sentKey === key))
            change.base = committed[key];
        if (remaining.size) localEdits.current.set(note.id, remaining);
        else localEdits.current.delete(note.id);
        const rebased = {
          ...committed,
          ...Object.fromEntries(
            [...remaining.entries()].map(([key, change]) => [
              key,
              change.value,
            ]),
          ),
        } as Note;
        if (remaining.size) draftCache.current.set(note.id, rebased);
        else draftCache.current.delete(note.id);
        if (remaining.size) persistDraft(rebased);
        else {
          removeDraft(draftScope, "notes", note.id, sentToken);
          if (mounted.current)
            setLocalNoteValues((previous) => {
              const next = { ...previous };
              delete next[note.id];
              return next;
            });
          if (mounted.current && !draftCache.current.size)
            setRecoveryNotice(false);
        }
        if (draftRef.current?.id === note.id) {
          draftRef.current = rebased;
          if (mounted.current) {
            setDraft(rebased);
            const hasUnsent = [...remaining.entries()].some(
              ([key, change]) =>
                change.version >
                (sentVersions.current.get(note.id)?.get(key) || 0),
            );
            setSaveState(
              remaining.size ? (hasUnsent ? "pending" : "saving") : "saved",
            );
          }
        }
        return true;
      })
      .catch(() => {
        for (const [key, change] of captured)
          if (sentVersions.current.get(note.id)?.get(key) === change.version)
            sentVersions.current.get(note.id)?.set(key, 0);
        if (!draftCache.current.has(note.id))
          draftCache.current.set(note.id, note);
        if (!pending.current && draftRef.current?.id === note.id)
          pending.current = draftRef.current;
        if (mounted.current && selectedRef.current === note.id)
          setSaveState("error");
        else if (mounted.current)
          notify(
            "A note could not be saved. Open it again to retry; your edits are kept in this session.",
          );
        return false;
      });
    return queue.current;
  }, [draftScope, persistDraft, notify]);

  const edit = useCallback(
    (patch: Partial<Note>) => {
      if (!draftRef.current) return;
      const next = { ...draftRef.current, ...patch };
      version.current++;
      const changes =
        localEdits.current.get(next.id) || new Map<EditableKey, LocalEdit>();
      for (const key of editableKeys)
        if (
          key in patch &&
          JSON.stringify(patch[key]) !== JSON.stringify(draftRef.current[key])
        )
          changes.set(key, {
            value: next[key],
            base: changes.get(key)?.base ?? draftRef.current[key],
            version: version.current,
          });
      if (!changes.size) return;
      localEdits.current.set(next.id, changes);
      draftRef.current = next;
      draftCache.current.set(next.id, next);
      persistDraft(next);
      pending.current = next;
      setDraft(next);
      setSaveState("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, 650);
    },
    [flush, persistDraft],
  );

  useEffect(
    () =>
      registerDraftGuard(draftScope, "note-editor", {
        hasUnsaved: () =>
          [...localEdits.current.values()].some(
            (changes) => changes.size > 0,
          ) ||
          recorder.current?.state === "recording" ||
          uploadPending.current ||
          !!recordedFile.current,
        hasUnpersisted: () =>
          recorder.current?.state === "recording" ||
          uploadPending.current ||
          !!recordedFile.current,
        flush: async () => {
          if (recorder.current?.state === "recording") recorder.current.stop();
          await recordingResult.current;
          if (recordedFile.current || uploadPending.current) return false;
          let success = true;
          for (const note of draftCache.current.values()) {
            if (!localEdits.current.get(note.id)?.size) continue;
            pending.current = note;
            if (!(await flush())) success = false;
          }
          return (
            success &&
            ![...localEdits.current.values()].some(
              (changes) => changes.size > 0,
            )
          );
        },
      }),
    [draftScope, flush],
  );

  useEffect(() => {
    void flush();
    const cached = draftCache.current.get(selectedNote);
    const note =
      cached ||
      workspaceRef.current.notes.find((item) => item.id === selectedNote) ||
      null;
    draftRef.current = note;
    setDraft(note);
    setSaveState(cached ? "pending" : "saved");
    setMoreOpen(false);
    setMobileBrowser(false);
    setTagInput("");
    version.current++;
    if (cached) {
      pending.current = cached;
      timer.current = setTimeout(() => void flush(), 650);
    }
  }, [selectedNote, flush]);

  // Rebase local dirty fields on teammate updates while keeping committed history.
  useEffect(() => {
    const incoming = workspace.notes.find((note) => note.id === selectedNote);
    if (incoming && draftRef.current?.id === incoming.id) {
      const changes = localEdits.current.get(incoming.id);
      let reconciled = false;
      if (changes) {
        for (const [key, change] of changes) {
          if (JSON.stringify(incoming[key]) === JSON.stringify(change.value)) {
            changes.delete(key);
            reconciled = true;
          }
        }
        if (!changes.size) {
          localEdits.current.delete(incoming.id);
          draftCache.current.delete(incoming.id);
          removeDraft(
            draftScope,
            "notes",
            incoming.id,
            draftTokens.current.get(incoming.id),
          );
          if (pending.current?.id === incoming.id) pending.current = null;
          setLocalNoteValues((previous) => {
            const next = { ...previous };
            delete next[incoming.id];
            return next;
          });
          setSaveState("saved");
          if (!draftCache.current.size) setRecoveryNotice(false);
        }
      }
      const rebased = {
        ...incoming,
        ...Object.fromEntries(
          [...(changes?.entries() || [])].map(([key, change]) => [
            key,
            change.value,
          ]),
        ),
      } as Note;
      if (
        changes?.size &&
        (reconciled ||
          JSON.stringify(rebased) !== JSON.stringify(draftRef.current))
      ) {
        draftCache.current.set(incoming.id, rebased);
        persistDraft(rebased);
      }
      if (JSON.stringify(rebased) !== JSON.stringify(draftRef.current)) {
        draftRef.current = rebased;
        setDraft(rebased);
      }
    }
  }, [workspace.notes, selectedNote, persistDraft, draftScope]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      void flush();
      mounted.current = false;
      recorder.current?.stop();
      recordingStream.current?.getTracks().forEach((track) => track.stop());
    };
  }, [flush]);

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(
      () => setRecordSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void flush();
      }
      if (event.key === "Escape") {
        setSlides(false);
        setNewOpen(false);
        setMoreOpen(false);
        setLinkOpen(false);
        setMobileBrowser(false);
        if (mobileBrowser) browserButtonRef.current?.focus();
      }
      if (slides && event.key === "ArrowRight")
        setSlideIndex((index) =>
          Math.min(
            index + 1,
            (draftRef.current?.content.split(/^---\s*$/m).length || 1) - 1,
          ),
        );
      if (slides && event.key === "ArrowLeft")
        setSlideIndex((index) => Math.max(0, index - 1));
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [slides, flush, mobileBrowser]);

  const rememberNewNote = (
    patch: Partial<NewNoteDraft>,
    preservePersonal = false,
  ) => {
    const previous = newNoteForm.current;
    const personal =
      preservePersonal && previous.personalTemplateId && previous.candidate;
    newNoteForm.current = {
      ...previous,
      ...patch,
      candidate: personal
        ? {
            ...previous.candidate!,
            title: patch.title?.trim() || previous.candidate!.title,
          }
        : undefined,
      operationId: personal ? uid() : undefined,
      personalTemplateId: personal ? previous.personalTemplateId : undefined,
    };
    setPersonalCreation(!!personal);
    const result = writeDraft(
      draftScope,
      "note-forms",
      "new-note",
      newNoteForm.current,
      null,
    );
    setDraftStorageError(result.error || "");
  };
  const openNewNote = () => {
    if (
      !parseNewNoteDraft(
        readDraft<unknown>(draftScope, "note-forms", "new-note")?.value,
      )
    )
      setNewTemplateId(mode === "daily" ? "daily-journal" : "blank");
    setTemplateSearch("");
    setTemplateCategory("all");
    setNewOpen(true);
  };
  const selectedTemplate = templates.find((item) => item.id === newTemplateId)!;
  const visibleTemplates = templates.filter(
    (item) =>
      (templateCategory === "all" || item.category === templateCategory) &&
      `${item.label} ${item.description} ${item.category}`
        .toLowerCase()
        .includes(templateSearch.trim().toLowerCase()),
  );

  const create = async (
    templateId: TemplateId,
    title: string,
  ): Promise<boolean> => {
    if (creatingRef.current) return false;
    creatingRef.current = true;
    setCreating(true);
    try {
      if (!(await flush()))
        throw new Error(
          "Your current note has not saved yet. Retry it before creating another note.",
        );
      const template = templates.find((item) => item.id === templateId)!;
      const previous = newNoteForm.current;
      const sameForm =
        previous.templateId === templateId && previous.title === title;
      const note =
        (sameForm && previous.candidate) ||
        newNote(
          templateId,
          title.trim() ||
            (template.kind === "daily"
              ? today()
              : templateId === "blank"
                ? "Untitled note"
                : template.label),
          projectFilter === "all" ? "" : projectFilter,
        );
      const operationId = (sameForm && previous.operationId) || uid();
      newNoteForm.current = {
        title,
        templateId,
        candidate: note,
        operationId,
        ...(sameForm && previous.personalTemplateId
          ? { personalTemplateId: previous.personalTemplateId }
          : {}),
      };
      setPersonalCreation(!!newNoteForm.current.personalTemplateId);
      const savedForm = writeDraft(
        draftScope,
        "note-forms",
        "new-note",
        newNoteForm.current,
        null,
      );
      setDraftStorageError(savedForm.error || "");
      const updated = await mutate({
        action: "upsert",
        entity: "notes",
        item: note,
        base: null,
        operationId,
      });
      const committed =
        updated.notes.find((item) => item.id === note.id) || note;
      draftRef.current = committed;
      setDraft(committed);
      onSelectNote(note.id);
      setNewOpen(false);
      setNewTitle("");
      removeDraft(draftScope, "note-forms", "new-note", savedForm.record.token);
      newNoteForm.current = { title: "", templateId: "blank" };
      setPersonalCreation(false);
      notify(`${template.kind === "daily" ? "Daily journal" : "Note"} created`);
      return true;
    } catch (cause) {
      notify(
        cause instanceof Error
          ? cause.message
          : "Could not create the note. Please try again.",
      );
      return false;
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const dailyMode = useRef(false);
  const openDaily = useEffectEvent(() => {
    const note = workspaceRef.current.notes.find(
      (item) => item.kind === "daily" && item.title === today(),
    );
    if (note) onSelectNote(note.id);
    else void create("daily-journal", today());
  });
  useEffect(() => {
    if (tourActive || mode !== "daily") {
      dailyMode.current = false;
      return;
    }
    if (dailyMode.current) return;
    dailyMode.current = true;
    openDaily();
  }, [mode, tourActive]);

  const availableNotes = [
    ...workspace.notes.map((note) => localNoteValues[note.id] || note),
    ...Object.values(localNoteValues).filter(
      (note) => !workspace.notes.some((saved) => saved.id === note.id),
    ),
  ];
  const notes = availableNotes.filter(
    (note) =>
      (mode !== "daily" || note.kind === "daily") &&
      (projectFilter === "all" ||
        !projectFilter ||
        note.projectId === projectFilter),
  );
  const folders = [
    ...new Set(notes.map((note) => note.folder || "Notes")),
  ].sort();
  const tags = [...new Set(notes.flatMap((note) => note.tags))].sort();
  const visible = notes
    .filter(
      (note) =>
        (folder === "all" || (note.folder || "Notes") === folder) &&
        (tag === "all" || note.tags.includes(tag)) &&
        (!bookmarksOnly || note.bookmarked) &&
        `${note.title} ${note.content} ${note.tags.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const linkedTasks = draft
    ? workspace.tasks.filter((task) => task.noteIds.includes(draft.id))
    : [];
  const backlinks = draft
    ? workspace.notes.filter(
        (note) =>
          note.id !== draft.id &&
          new RegExp(
            `\\[\\[${draft.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[#|\\]])`,
            "i",
          ).test(note.content),
      )
    : [];
  const wordCount =
    draft?.content.trim().split(/\s+/).filter(Boolean).length || 0;

  function selectedNoteText(): string {
    const current = draftRef.current;
    if (!current) return "";
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      previewPane.current?.contains(selection.anchorNode) &&
      previewPane.current?.contains(selection.focusNode)
    ) {
      return selection.toString().trim();
    }
    const field = editor.current;
    const visibleEditor = field && field.getBoundingClientRect().width > 0;
    if (visibleEditor && field.selectionEnd > field.selectionStart) {
      return current.content
        .slice(field.selectionStart, field.selectionEnd)
        .trim();
    }
    return "";
  }

  function defaultTaskExcerpt(content: string): string {
    const checklist = content
      .split("\n")
      .find((line) => /^\s*[-*+]\s+\[[ xX]\]\s+\S/.test(line));
    if (checklist) return checklist.trim().slice(0, 8_000);
    const paragraphs = content
      .split(/\n\s*\n/)
      .map((text) => text.trim())
      .filter(Boolean);
    const paragraph = paragraphs.find(
      (text) => !/^#{1,6}\s+[^\n]+$/.test(text),
    );
    return (paragraph || paragraphs[0] || "").slice(0, 8_000);
  }

  async function prepareLinkedTask() {
    const note = draftRef.current;
    if (!note || preparingTask) return;
    const excerpt = (
      selectedTaskExcerpt.current ||
      selectedNoteText() ||
      defaultTaskExcerpt(note.content)
    ).slice(0, 8_000);
    selectedTaskExcerpt.current = "";
    if (!excerpt.trim()) {
      setTaskSourceError(
        "Write some note content before creating a linked task.",
      );
      return;
    }

    setPreparingTask(true);
    setTaskSourceError("");
    try {
      const savedSuccessfully = await flush();
      if (!savedSuccessfully || localEdits.current.get(note.id)?.size) {
        throw new Error(
          "Save this note successfully before creating its linked task. Your note edits are still here.",
        );
      }
      const saved = draftRef.current;
      if (mounted.current && saved?.id === note.id)
        setTaskSource({ note: saved, excerpt });
    } catch (cause) {
      if (mounted.current)
        setTaskSourceError(
          cause instanceof Error
            ? cause.message
            : "The note could not be saved. Please retry.",
        );
    } finally {
      if (mounted.current) setPreparingTask(false);
    }
  }

  const insert = (text: string) => {
    const current = draftRef.current;
    if (!current) return;
    const field = editor.current;
    const start = field?.selectionStart ?? current.content.length;
    const end = field?.selectionEnd ?? current.content.length;
    edit({
      content:
        current.content.slice(0, start) + text + current.content.slice(end),
    });
    setTimeout(() => {
      field?.focus();
      field?.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  };

  const upload = async (
    file: File,
    targetNoteId?: string,
  ): Promise<boolean> => {
    const target = targetNoteId || draftRef.current?.id;
    if (!target) return false;
    uploadPending.current = true;
    let binarySaved = false;
    if (mounted.current) {
      setUploading(true);
      setRecordError("");
    }
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await scopedFetch("/api/media", {
        method: "POST",
        body: data,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { media, workspace: updatedWorkspace } =
        (await response.json()) as {
          media?: Media;
          workspace?: Workspace;
          error?: string;
        };
      if (!media?.url) throw new Error("No file URL returned");
      binarySaved = true;
      // The upload route stores media in the shared workspace; upsert also refreshes clients.
      if (!updatedWorkspace)
        await mutate({ action: "upsert", entity: "media", item: media });
      const syntax = `\n![${file.name.replace(/[\[\]]/g, "")}](${media.url})\n`;
      if (draftRef.current?.id === target) insert(syntax);
      else {
        const note =
          draftCache.current.get(target) ||
          workspaceRef.current.notes.find((item) => item.id === target);
        if (note) {
          const content = note.content + syntax;
          const changes =
            localEdits.current.get(note.id) ||
            new Map<EditableKey, LocalEdit>();
          changes.set("content", {
            value: content,
            base: changes.get("content")?.base ?? note.content,
            version: ++version.current,
          });
          localEdits.current.set(note.id, changes);
          const next = { ...note, content };
          draftCache.current.set(note.id, next);
          persistDraft(next);
          pending.current = next;
          if (!(await flush()))
            throw new Error(
              "The upload is kept, but its note link still needs saving.",
            );
        }
      }
      if (mounted.current) notify("Attachment added");
      return true;
    } catch (cause) {
      if (mounted.current) {
        setRecordError(
          cause instanceof Error
            ? cause.message
            : "The attachment could not be uploaded. Please try again.",
        );
        notify(
          "The attachment could not be uploaded or linked. Keep this page open and retry.",
        );
      }
      return binarySaved;
    } finally {
      uploadPending.current = false;
      if (mounted.current) setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const startRecording = async () => {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    if (requestingMicrophone.current) return;
    if (recordedFile.current) {
      setRecordError(
        "Save or download the previous recording before starting another.",
      );
      return;
    }
    if (!draftRef.current) return;
    const intendedNoteId = draftRef.current.id;
    requestingMicrophone.current = true;
    setRecordError("");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || draftRef.current?.id !== intendedNoteId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      recordingStream.current = stream;
      const type = ["audio/webm", "audio/mp4", "audio/ogg"].find((format) =>
        MediaRecorder.isTypeSupported(format),
      );
      const device = new MediaRecorder(
        stream,
        type ? { mimeType: type } : undefined,
      );
      const chunks: BlobPart[] = [];
      const target = draftRef.current.id;
      recordingTarget.current = target;
      device.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recordingResult.current = new Promise((resolve) => {
        completeRecording.current = resolve;
      });
      device.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (mounted.current) {
          setRecording(false);
          setRecordSeconds(0);
        }
        let success = true;
        if (chunks.length) {
          const mime = device.mimeType || "audio/webm";
          const file = new File(
            chunks,
            `Voice note ${new Date().toISOString().slice(0, 16).replace(/:/g, "-")}.${mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"}`,
            { type: mime },
          );
          recordedFile.current = file;
          if (mounted.current) setRecordingRecovery(true);
          success = await upload(file, target);
          if (success) {
            recordedFile.current = null;
            if (mounted.current) setRecordingRecovery(false);
          }
        }
        completeRecording.current?.(success);
      };
      recorder.current = device;
      device.start();
      setRecording(true);
    } catch {
      if (mounted.current)
        setRecordError(
          "Microphone access is unavailable. Allow microphone access in your browser and try again.",
        );
    } finally {
      requestingMicrophone.current = false;
    }
  };

  const retryRecording = async () => {
    const file = recordedFile.current;
    if (file && (await upload(file, recordingTarget.current))) {
      recordedFile.current = null;
      recordingResult.current = Promise.resolve(true);
      setRecordingRecovery(false);
    }
  };
  const downloadRecording = () => {
    const file = recordedFile.current;
    if (!file) return;
    const url = URL.createObjectURL(file),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const discardRecording = () => {
    if (
      !window.confirm(
        "Discard the unsaved recording? Download it first if you want to keep a copy.",
      )
    )
      return;
    recordedFile.current = null;
    recordingResult.current = Promise.resolve(true);
    setRecordingRecovery(false);
    setRecordError("");
  };

  const exportNote = () => {
    if (!draft) return;
    const blob = new Blob([`# ${draft.title}\n\n${draft.content}`], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${draft.title.replace(/[^a-zA-Z0-9 _-]/g, "") || "note"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMoreOpen(false);
  };
  const splitSelection = async () => {
    const current = draftRef.current;
    const field = editor.current;
    if (!current || !field || field.selectionEnd === field.selectionStart) {
      notify("Select some text in the editor to move it into a new note.");
      setView("edit");
      setMoreOpen(false);
      return;
    }
    const start = field.selectionStart,
      end = field.selectionEnd;
    const text = current.content.slice(start, end);
    const title =
      text
        .split("\n")[0]
        .replace(/^#+\s*/, "")
        .slice(0, 70) || "Extracted idea";
    const note = {
      ...newNote("blank", title, current.projectId),
      folder: current.folder,
      content: text,
      tags: current.tags,
    };
    try {
      if (!(await flush()))
        throw new Error("Save this note successfully before extracting text.");
      await mutate({
        action: "upsert",
        entity: "notes",
        item: note,
        base: null,
      });
      const latest = draftRef.current;
      if (latest?.id !== current.id || latest.content !== current.content) {
        notify(
          "The extracted note was saved. Your original text was kept because the note changed during extraction.",
        );
      } else {
        edit({
          content:
            latest.content.slice(0, start) +
            `[[${note.title}]]` +
            latest.content.slice(end),
        });
        notify(
          (await flush())
            ? "Selection moved into a linked note"
            : "The extracted note was saved. Its original note still has unsaved changes.",
        );
      }
      setMoreOpen(false);
    } catch (cause) {
      notify(
        cause instanceof Error
          ? cause.message
          : "Could not split this note. Please try again.",
      );
    }
  };
  const merge = async () => {
    if (!draft || !mergeId) return;
    const other = workspace.notes.find((note) => note.id === mergeId);
    if (!other) return;
    edit({
      content: `${draft.content}\n\n---\n\n# ${other.title}\n\n${other.content}`,
    });
    if (await flush()) {
      setMergeOpen(false);
      notify("Note contents combined. Both original notes remain available.");
    } else {
      setMergeId("");
      notify(
        "The combined note is kept as an unsaved draft. Close this form and retry saving.",
      );
    }
  };
  const remove = async () => {
    if (!draft || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    try {
      await queue.current;
      const saved = workspaceRef.current.notes.find(
        (note) => note.id === draft.id,
      );
      await moveToTrash(
        mutate,
        notify,
        {
          entity: "notes",
          id: draft.id,
          base: saved ? { ...saved } : null,
        },
        "Note",
        draftScope,
      );
      localEdits.current.delete(draft.id);
      sentVersions.current.delete(draft.id);
      draftCache.current.delete(draft.id);
      removeDraft(draftScope, "notes", draft.id);
      onSelectNote(notes.find((note) => note.id !== draft.id)?.id || "");
      setDeleteOpen(false);
      requestAnimationFrame(() =>
        (moreButtonRef.current || emptyCreateRef.current)?.focus(),
      );
    } catch {
      notify("Could not delete the note.");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const loadHistory = useCallback(
    async (noteId: string, cursor?: string) => {
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const query = new URLSearchParams({
          note: noteId,
          ...(cursor ? { cursor } : {}),
        });
        const response = await scopedFetch(`/api/history?${query}`, {
          cache: "no-store",
        });
        const result = (await response.json()) as {
          snapshots?: NoteSnapshot[];
          nextCursor?: string | null;
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || "Note history could not be loaded.");
        if (mounted.current && draftRef.current?.id === noteId) {
          setHistory((previous) =>
            cursor
              ? [...previous, ...(result.snapshots || [])]
              : result.snapshots || [],
          );
          setHistoryCursor(result.nextCursor || null);
        }
      } catch (cause) {
        if (mounted.current)
          setHistoryError(
            cause instanceof Error
              ? cause.message
              : "Note history could not be loaded.",
          );
      } finally {
        if (mounted.current) setHistoryLoading(false);
      }
    },
    [scopedFetch],
  );

  const openHistory = () => {
    const note = draftRef.current;
    if (!note) return;
    setHistory([]);
    setHistoryCursor(null);
    setSnapshotsOpen(true);
    void loadHistory(note.id);
  };

  const restoreHistory = async (snapshot: NoteSnapshot) => {
    const note = draftRef.current;
    if (!note || restoringHistory) return;
    setRestoringHistory(true);
    setHistoryError("");
    try {
      if (!(await flush()) || localEdits.current.get(note.id)?.size)
        throw new Error("Save your current changes before restoring history.");
      const current = draftRef.current;
      if (!current || current.id !== note.id) return;
      const updated = await mutate({
        action: "upsert",
        entity: "notes",
        item: { id: note.id, content: snapshot.content },
        base: { id: note.id, content: current.content },
        restoreSnapshotId: snapshot.id,
      });
      const saved = updated.notes.find((item) => item.id === note.id);
      if (saved && draftRef.current?.id === note.id) {
        draftRef.current = saved;
        setDraft(saved);
      }
      setSnapshotsOpen(false);
      notify(
        "Earlier version restored. Your previous content remains in history.",
      );
    } catch (cause) {
      setHistoryError(
        cause instanceof Error
          ? cause.message
          : "The version could not be restored.",
      );
    } finally {
      setRestoringHistory(false);
    }
  };

  const discardDraft = async () => {
    const note = draftRef.current;
    if (
      !note ||
      !window.confirm(
        "Discard this note’s unsaved changes and use its latest saved version?",
      )
    )
      return;
    const capturedVersion = version.current;
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    await queue.current;
    let saved: Note | undefined;
    try {
      const response = await scopedFetch("/api/state", { cache: "no-store" });
      const result = (await response.json()) as {
        workspace?: Workspace;
        error?: string;
      };
      if (!response.ok || !result.workspace)
        throw new Error(
          result.error || "The latest version could not be loaded.",
        );
      saved = result.workspace.notes.find((item) => item.id === note.id);
    } catch (cause) {
      pending.current = draftRef.current;
      notify(
        cause instanceof Error
          ? cause.message
          : "The latest version could not be loaded. Your draft is kept.",
      );
      return;
    }
    if (
      version.current !== capturedVersion ||
      draftRef.current?.id !== note.id
    ) {
      notify("Your note changed while loading. Its draft was kept.");
      return;
    }
    localEdits.current.delete(note.id);
    sentVersions.current.delete(note.id);
    draftCache.current.delete(note.id);
    removeDraft(draftScope, "notes", note.id);
    discardDraftMutations(draftScope, "notes", note.id);
    setLocalNoteValues((previous) => {
      const next = { ...previous };
      delete next[note.id];
      return next;
    });
    draftRef.current = saved || null;
    setDraft(saved || null);
    setSaveState("saved");
    setDraftStorageError("");
    if (!saved)
      onSelectNote(notes.find((item) => item.id !== note.id)?.id || "");
  };

  const saveDraftAsNewNote = async () => {
    const note = draftRef.current;
    if (!note) return;
    const capturedVersion = version.current;
    const previous = parseNoteCopyDraft(
      readDraft<unknown>(draftScope, "note-copies", note.id)?.value,
    );
    const sameCopy =
      previous &&
      editableKeys.every(
        (key) =>
          JSON.stringify(previous.note[key]) === JSON.stringify(note[key]),
      );
    const now = new Date().toISOString();
    const copy = sameCopy
      ? previous
      : {
          note: {
            ...note,
            id: uid(),
            snapshots: [],
            createdAt: now,
            updatedAt: now,
          },
          operationId: uid(),
        };
    const persisted = writeDraft(
      draftScope,
      "note-copies",
      note.id,
      copy,
      null,
    );
    if (persisted.error) setDraftStorageError(persisted.error);
    try {
      const updated = await mutate({
        action: "upsert",
        entity: "notes",
        item: copy.note,
        base: null,
        operationId: copy.operationId,
      });
      removeDraft(draftScope, "note-copies", note.id, persisted.record.token);
      if (
        version.current !== capturedVersion ||
        draftRef.current?.id !== note.id
      ) {
        notify(
          "A new note was saved. Your newer draft is still kept in the original note.",
        );
        return;
      }
      localEdits.current.delete(note.id);
      sentVersions.current.delete(note.id);
      draftCache.current.delete(note.id);
      removeDraft(draftScope, "notes", note.id);
      discardDraftMutations(draftScope, "notes", note.id);
      setLocalNoteValues((previousValues) => {
        const next = { ...previousValues };
        delete next[note.id];
        return next;
      });
      const saved =
        updated.notes.find((item) => item.id === copy.note.id) || copy.note;
      draftRef.current = saved;
      setDraft(saved);
      setSaveState("saved");
      onSelectNote(saved.id);
      notify("Your draft was saved as a new note.");
    } catch (cause) {
      notify(
        cause instanceof Error
          ? cause.message
          : "The copy could not be saved. Your original draft is kept.",
      );
    }
  };
  const slidesContent = draft?.content.split(/^---\s*$/m) || [];

  return (
    <div className={`knowledge ${mode === "daily" ? "daily-knowledge" : ""}`}>
      <aside
        ref={browserRef}
        id={`${controlId}-browser`}
        className={`note-browser ${mobileBrowser ? "mobile-visible" : ""}`}
        role={browserDialogOpen ? "dialog" : undefined}
        aria-modal={browserDialogOpen ? true : undefined}
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
            onClick={openNewNote}
          >
            <Plus size={17} />
          </button>
          <button
            className="btn-icon note-browser-close"
            aria-label="Close notes browser"
            onClick={() => {
              setMobileBrowser(false);
              browserButtonRef.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        </div>
        <label className="note-search">
          <Search size={15} />
          <input
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
            <Bookmark
              size={13}
              fill={bookmarksOnly ? "currentColor" : "none"}
            />{" "}
            Bookmarked
          </button>
          <span>{notes.length} notes</span>
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
        <div className="note-list">
          {visible.length ? (
            visible.map((note) => (
              <button
                key={note.id}
                className={`note-list-item ${selectedNote === note.id ? "selected" : ""}`}
                aria-current={selectedNote === note.id ? "page" : undefined}
                onClick={() => onSelectNote(note.id)}
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
                <p>
                  {note.content
                    .replace(/[#*\[\]`>_=]/g, "")
                    .replace(/\s+/g, " ")
                    .slice(0, 90) || "A blank page, a new possibility."}
                </p>
                <div className="note-list-meta">
                  <span>{note.folder}</span>
                  <span>{shortDate(note.updatedAt)}</span>
                </div>
              </button>
            ))
          ) : (
            <div className="note-list-empty">
              <Search size={25} />
              <p>
                {notes.length
                  ? "No notes match these filters. Try another search, folder, tag, or bookmark filter."
                  : "No notes here yet. Create your first note to get started."}
              </p>
              <button className="btn" onClick={openNewNote}>
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
            onClick={openNewNote}
          >
            <Plus size={15} />
          </button>
        </div>
      </aside>

      <main className="note-workspace">
        {draftStorageError && (
          <div className="note-recovery-message" role="alert">
            {draftStorageError}
          </div>
        )}
        {recoveryNotice && (
          <div className="note-recovery-message" role="status">
            <span>
              Recovered unsaved note changes from this browser. Review the note
              and retry saving if needed.
            </span>
            <button
              type="button"
              onClick={() => setRecoveryNotice(false)}
              aria-label="Dismiss recovery message"
            >
              <X size={17} />
            </button>
          </div>
        )}
        {draft && saveState === "error" && (
          <div className="note-recovery-message" role="alert">
            <span>
              Your changes are kept as a browser draft. Download a copy, save a
              separate note, or discard this draft to load the latest version.
            </span>
            <button type="button" onClick={exportNote}>
              Download my draft
            </button>
            <button type="button" onClick={() => void saveDraftAsNewNote()}>
              Save as new note
            </button>
            <button type="button" onClick={() => void discardDraft()}>
              Use latest saved version
            </button>
          </div>
        )}
        {draft ? (
          <>
            <div className="note-toolbar">
              <div className="note-breadcrumb">
                <button
                  ref={browserButtonRef}
                  className="btn-icon mobile-note-toggle"
                  title="Browse notes"
                  aria-label="Browse notes"
                  aria-expanded={mobileBrowser}
                  aria-controls={`${controlId}-browser`}
                  onClick={() => setMobileBrowser((value) => !value)}
                >
                  <BookOpen size={17} />
                </button>
                <Folder size={14} />
                <span>{draft.folder || "Notes"}</span>
                <ChevronRight size={12} />
                <span className="note-breadcrumb-current">{draft.title}</span>
              </div>
              <div className="note-toolbar-actions">
                <span
                  className={`note-save-state ${saveState}`}
                  role="status"
                  aria-live="polite"
                >
                  {saveState === "saving" ? (
                    <LoaderCircle size={12} className="spin" />
                  ) : saveState === "error" ? (
                    <button onClick={() => void flush()}>Retry save</button>
                  ) : saveState === "pending" ? (
                    <span className="pending-dot" />
                  ) : (
                    <Check size={12} />
                  )}
                  <span>
                    {saveState === "saved"
                      ? "Saved"
                      : saveState === "saving"
                        ? "Saving…"
                        : saveState === "pending"
                          ? "Unsaved"
                          : "Save failed"}
                  </span>
                </span>
                <button
                  className={`btn-icon ${draft.bookmarked ? "bookmarked" : ""}`}
                  aria-label={
                    draft.bookmarked ? "Remove bookmark" : "Bookmark note"
                  }
                  title={draft.bookmarked ? "Remove bookmark" : "Bookmark note"}
                  aria-pressed={draft.bookmarked}
                  onClick={() => edit({ bookmarked: !draft.bookmarked })}
                >
                  <Bookmark
                    size={16}
                    fill={draft.bookmarked ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className={`btn note-details-toggle ${details ? "is-active" : ""}`}
                  aria-label="Toggle note details"
                  title="Note details"
                  aria-expanded={details}
                  aria-controls={`${controlId}-details`}
                  onClick={() => setDetails((value) => !value)}
                >
                  <Settings2 size={16} />
                  <span>Details</span>
                </button>
                <div className="note-more-wrap">
                  <button
                    ref={moreButtonRef}
                    className="btn-icon"
                    aria-label="More note actions"
                    title="More note actions"
                    aria-expanded={moreOpen}
                    aria-controls={`${controlId}-actions`}
                    onClick={() => setMoreOpen((value) => !value)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {moreOpen && (
                    <div
                      id={`${controlId}-actions`}
                      className="note-menu"
                      role="group"
                      aria-label="Note actions"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setMoreOpen(false);
                          moreButtonRef.current?.focus();
                        }
                      }}
                    >
                      <button
                        data-tour="note-templates"
                        onClick={() => {
                          setPersonalTemplatesOpen(true);
                          setMoreOpen(false);
                        }}
                      >
                        <Copy size={15} />
                        My note templates
                      </button>
                      <button
                        onClick={() => {
                          openHistory();
                          setMoreOpen(false);
                        }}
                      >
                        <History size={15} />
                        Version history
                      </button>
                      <button
                        onClick={() => {
                          setSlideIndex(0);
                          setSlides(true);
                          setMoreOpen(false);
                        }}
                      >
                        <Presentation size={15} />
                        Present as slides
                      </button>
                      <button
                        onClick={() => {
                          window.open(
                            `${window.location.pathname}?note=${encodeURIComponent(draft.id)}&focus=1`,
                            "_blank",
                            "noopener,noreferrer",
                          );
                          setMoreOpen(false);
                        }}
                      >
                        <ExternalLink size={15} />
                        Open in a new window
                      </button>
                      <button onClick={splitSelection}>
                        <Scissors size={15} />
                        Extract selected text
                      </button>
                      <button
                        onClick={() => {
                          setMergeOpen(true);
                          setMergeId("");
                          setMoreOpen(false);
                        }}
                      >
                        <GitMerge size={15} />
                        Combine with another note
                      </button>
                      <button onClick={exportNote}>
                        <ArrowDownToLine size={15} />
                        Export Markdown
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              `[[${draft.title}]]`,
                            );
                            notify("Note link copied");
                            setMoreOpen(false);
                          } catch {
                            notify("Clipboard is unavailable in this browser.");
                          }
                        }}
                      >
                        <Copy size={15} />
                        Copy note link
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          setDeleteOpen(true);
                          setMoreOpen(false);
                        }}
                      >
                        <Trash2 size={15} />
                        Move to Trash
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="note-content-shell">
              <div className="note-document">
                <div className="note-heading">
                  <div className="note-kind-label">
                    <span />
                    {kindLabel(draft.kind)}
                    <span className="note-heading-date">
                      Updated {shortDate(draft.updatedAt)}
                    </span>
                  </div>
                  <input
                    className="note-title-input"
                    aria-label="Note title"
                    value={draft.title}
                    placeholder="Untitled note"
                    onChange={(event) => edit({ title: event.target.value })}
                  />
                  <div className="note-tags">
                    {draft.tags.map((item) => (
                      <span className="note-tag" key={item}>
                        #{item}
                        <button
                          aria-label={`Remove tag ${item}`}
                          onClick={() =>
                            edit({
                              tags: draft.tags.filter(
                                (value) => value !== item,
                              ),
                            })
                          }
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    <input
                      aria-label="Add tag"
                      placeholder="+ Add tag"
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === ",") {
                          event.preventDefault();
                          const value = tagInput
                            .trim()
                            .replace(/^#/, "")
                            .replace(/,/g, "");
                          if (value && !draft.tags.includes(value))
                            edit({ tags: [...draft.tags, value] });
                          setTagInput("");
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="note-editor-toolbar">
                  <div
                    className="note-view-switch"
                    role="group"
                    aria-label="Note view"
                  >
                    <button
                      className={effectiveView === "edit" ? "active" : ""}
                      aria-pressed={effectiveView === "edit"}
                      onClick={() => setView("edit")}
                    >
                      Write
                    </button>
                    <button
                      className={effectiveView === "split" ? "active" : ""}
                      aria-pressed={effectiveView === "split"}
                      onClick={() => setView("split")}
                    >
                      <Columns2 size={13} />
                      Split
                    </button>
                    <button
                      className={effectiveView === "preview" ? "active" : ""}
                      aria-pressed={effectiveView === "preview"}
                      onClick={() => setView("preview")}
                    >
                      Read
                    </button>
                  </div>
                  <button
                    type="button"
                    className="note-task-trigger"
                    data-tour="note-to-task"
                    aria-label="Create linked task"
                    disabled={preparingTask || !draft.content.trim()}
                    onPointerDown={() => {
                      selectedTaskExcerpt.current = selectedNoteText();
                    }}
                    onClick={() => void prepareLinkedTask()}
                  >
                    {preparingTask ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <CheckSquare size={16} />
                    )}
                    <span>
                      {preparingTask ? "Saving source…" : "Create linked task"}
                    </span>
                  </button>
                  <div className="note-format-tools">
                    <button
                      title="Heading"
                      aria-label="Insert heading"
                      onClick={() => insert("\n## Heading\n")}
                    >
                      H₂
                    </button>
                    <button
                      title="Bold text"
                      aria-label="Insert bold text"
                      onClick={() => insert("**bold text**")}
                    >
                      <strong>B</strong>
                    </button>
                    <button
                      title="Checklist"
                      aria-label="Insert checklist"
                      onClick={() => insert("\n- [ ] ")}
                    >
                      ☑
                    </button>
                    <button
                      title="Link a note"
                      aria-label="Link a note"
                      aria-expanded={linkOpen}
                      onClick={() => setLinkOpen((value) => !value)}
                    >
                      <Link2 size={15} />
                    </button>
                    <button
                      title="Attach an image, PDF, audio, or video"
                      aria-label="Attach an image, PDF, audio, or video"
                      onClick={() => fileInput.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <ImagePlus size={15} />
                      )}
                    </button>
                    <button
                      className={recording ? "is-recording" : ""}
                      title={recording ? "Stop recording" : "Record audio"}
                      aria-label={recording ? "Stop recording" : "Record audio"}
                      aria-pressed={recording}
                      onClick={() => void startRecording()}
                    >
                      {recording ? (
                        <Square size={13} fill="currentColor" />
                      ) : (
                        <Mic size={15} />
                      )}
                    </button>
                    {recording && (
                      <span className="record-time">
                        {Math.floor(recordSeconds / 60)}:
                        {String(recordSeconds % 60).padStart(2, "0")}
                      </span>
                    )}
                  </div>
                </div>
                {taskSourceError && (
                  <p className="note-task-error" role="alert">
                    {taskSourceError}
                  </p>
                )}
                <LinkedNoteTasks tasks={linkedTasks} onOpenTask={openTask} />
                {linkOpen && (
                  <div className="note-link-picker">
                    <div>
                      <span>Link to a note</span>
                      <button
                        className="btn-icon"
                        aria-label="Close note picker"
                        onClick={() => setLinkOpen(false)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {workspace.notes
                      .filter((note) => note.id !== draft.id)
                      .map((note) => (
                        <button
                          key={note.id}
                          onClick={() => {
                            insert(`[[${note.title}]]`);
                            setLinkOpen(false);
                          }}
                        >
                          <FileText size={13} />
                          {note.title}
                          <span>{note.folder}</span>
                        </button>
                      ))}
                    {workspace.notes.length < 2 && (
                      <p>Create another note to connect it here.</p>
                    )}
                  </div>
                )}
                {recordError && (
                  <div className="note-inline-error" role="alert">
                    {recordError}
                    <button
                      onClick={() => setRecordError("")}
                      aria-label="Dismiss microphone message"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
                {recordingRecovery && (
                  <div className="note-recovery-message" role="status">
                    <span>
                      Your recording is kept on this page until it uploads. Keep
                      this page open.
                    </span>
                    <button
                      disabled={uploading}
                      onClick={() => void retryRecording()}
                    >
                      Retry upload
                    </button>
                    <button onClick={downloadRecording}>Download audio</button>
                    <button disabled={uploading} onClick={discardRecording}>
                      Discard recording
                    </button>
                  </div>
                )}
                <div
                  className={`note-editing-area view-${effectiveView}`}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes("Files"))
                      event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (event.dataTransfer.files.length) {
                      event.preventDefault();
                      void upload(event.dataTransfer.files[0]);
                    }
                  }}
                >
                  {effectiveView !== "preview" && (
                    <div className="note-source-pane">
                      <div className="note-pane-label">MARKDOWN</div>
                      <textarea
                        ref={editor}
                        aria-label="Note content"
                        spellCheck
                        value={draft.content}
                        placeholder="Start writing. Use [[note names]] to connect your ideas…"
                        onChange={(event) =>
                          edit({ content: event.target.value })
                        }
                      />
                    </div>
                  )}
                  {effectiveView !== "edit" && (
                    <div className="note-preview-pane" ref={previewPane}>
                      {effectiveView === "split" && (
                        <div className="note-pane-label">PREVIEW</div>
                      )}
                      <Markdown
                        content={draft.content}
                        workspace={workspace}
                        onNoteClick={openNote}
                      />
                      {!draft.content && (
                        <div className="note-preview-empty">
                          Your next great idea starts here.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="note-statusbar">
                  <span>
                    {wordCount} words <i>·</i>{" "}
                    {draft.content.length.toLocaleString()} characters
                  </span>
                  <span>
                    Markdown <i>·</i> {Math.max(1, Math.ceil(wordCount / 200))}{" "}
                    min read
                  </span>
                </div>
              </div>

              {details && (
                <aside
                  id={`${controlId}-details`}
                  className="note-details"
                  aria-label="Note details"
                >
                  <div className="note-details-title">
                    NOTE DETAILS
                    <button
                      className="btn-icon"
                      aria-label="Close note details"
                      onClick={() => setDetails(false)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="note-details-section">
                    <h3>Properties</h3>
                    <label className="note-property">
                      <span>Folder</span>
                      <input
                        value={draft.folder}
                        onChange={(event) =>
                          edit({ folder: event.target.value })
                        }
                      />
                    </label>
                    <label className="note-property">
                      <span>Project</span>
                      <select
                        value={draft.projectId}
                        onChange={(event) =>
                          edit({ projectId: event.target.value })
                        }
                      >
                        <option value="">No project</option>
                        {workspace.projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="note-property">
                      <span>Type</span>
                      <select
                        aria-label="Note type"
                        value={draft.kind}
                        onChange={(event) =>
                          edit({ kind: event.target.value as Kind })
                        }
                      >
                        {noteKinds.map((item) => (
                          <option key={item.kind} value={item.kind}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {Object.entries(draft.properties).map(([key, value]) => (
                      <label
                        className="note-property note-custom-property"
                        key={key}
                      >
                        <span title={key}>{key}</span>
                        <input
                          value={value}
                          placeholder="Empty"
                          onChange={(event) =>
                            edit({
                              properties: {
                                ...draft.properties,
                                [key]: event.target.value,
                              },
                            })
                          }
                        />
                        <button
                          aria-label={`Remove property ${key}`}
                          onClick={() => {
                            const properties = { ...draft.properties };
                            delete properties[key];
                            edit({ properties });
                          }}
                        >
                          <X size={10} />
                        </button>
                      </label>
                    ))}
                    <form
                      className="note-add-property"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const key = propertyName.trim();
                        if (key && !(key in draft.properties)) {
                          edit({
                            properties: { ...draft.properties, [key]: "" },
                          });
                          setPropertyName("");
                        }
                      }}
                    >
                      <Plus size={12} />
                      <input
                        value={propertyName}
                        onChange={(event) =>
                          setPropertyName(event.target.value)
                        }
                        placeholder="Add property"
                        aria-label="New property name"
                      />
                      {propertyName && (
                        <button type="submit" aria-label="Add property">
                          <Check size={12} />
                        </button>
                      )}
                    </form>
                  </div>
                  <div className="note-details-section">
                    <h3>
                      <Link2 size={13} />
                      Backlinks<span>{backlinks.length}</span>
                    </h3>
                    {backlinks.map((note) => (
                      <button
                        key={note.id}
                        className="note-related"
                        onClick={() => openNote(note.id)}
                      >
                        <FileText size={13} />
                        <div>
                          <strong>{note.title}</strong>
                          <small>{note.folder}</small>
                        </div>
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                    {!backlinks.length && (
                      <p className="note-details-empty">
                        Notes that link here will appear here. Connect an idea
                        with <code>[[{draft.title}]]</code>.
                      </p>
                    )}
                  </div>
                  <div className="note-details-section">
                    <h3>
                      Linked tasks<span>{linkedTasks.length}</span>
                    </h3>
                    {linkedTasks.map((task) => (
                      <button
                        key={task.id}
                        className="note-related"
                        onClick={() => openTask(task.id)}
                      >
                        <span className={`linked-task-dot ${task.status}`} />
                        <div>
                          <small>{task.key}</small>
                          <strong>{task.title}</strong>
                        </div>
                        <ArrowUpRight size={12} />
                      </button>
                    ))}
                    {!linkedTasks.length && (
                      <p className="note-details-empty">
                        Link this note from a task to keep the plan and the work
                        connected.
                      </p>
                    )}
                  </div>
                  <div className="note-details-section note-syntax-help">
                    <h3>A little writing magic</h3>
                    <p>
                      <code>[[Note title]]</code> connect ideas
                    </p>
                    <p>
                      <code>![[Note title]]</code> embed a note
                    </p>
                    <p>
                      <code>[[Note#Heading]]</code> link a section
                    </p>
                    <p>
                      <code>- [ ]</code> create a checklist
                    </p>
                    <p>
                      <code>$$ equation $$</code> write math
                    </p>
                    <button
                      onClick={() => {
                        openHistory();
                      }}
                    >
                      <History size={13} />
                      Version history <ChevronRight size={12} />
                    </button>
                  </div>
                </aside>
              )}
            </div>
          </>
        ) : (
          <div className="knowledge-empty">
            <div>
              <BookOpen size={32} />
            </div>
            <span className="eyebrow">IDEAS BECOME PLANS</span>
            <h2>A home for everything you know.</h2>
            <p>
              Capture a thought, plan a project, keep a routine, or explore a
              creative idea. Connect notes to each other and to the tasks that
              move them forward.
            </p>
            <button
              ref={emptyCreateRef}
              className="btn btn-primary"
              onClick={openNewNote}
            >
              <Plus size={16} />
              {workspace.notes.length
                ? "Create a note"
                : "Create your first note"}
            </button>
            <button
              ref={browserButtonRef}
              className="btn mobile-note-toggle"
              onClick={() => setMobileBrowser(true)}
            >
              Browse notes
            </button>
          </div>
        )}
      </main>
      <input
        ref={fileInput}
        type="file"
        className="note-hidden-input"
        accept="image/*,audio/*,video/*,application/pdf,.txt,.md"
        onChange={(event) => {
          if (event.target.files?.[0]) void upload(event.target.files[0]);
        }}
      />

      {taskSource && (
        <NoteTaskComposer
          note={taskSource.note}
          initialExcerpt={taskSource.excerpt}
          workspace={workspace}
          currentPerson={currentPerson}
          mutate={mutate}
          onClose={() => setTaskSource(null)}
          onCreated={() => {
            setTaskSource(null);
            notify("Task created and linked to this note");
          }}
          onOpenTask={openTask}
        />
      )}
      {newOpen && (
        <div
          className="knowledge-modal-backdrop"
          onClick={() => !creating && setNewOpen(false)}
        >
          <NoteDialog
            className="knowledge-modal new-note-modal"
            label="Create note"
            onClose={() => setNewOpen(false)}
            busy={creating}
          >
            <div className="knowledge-modal-heading">
              <div>
                <span className="eyebrow">MAKE SPACE FOR AN IDEA</span>
                <h2>Create a note</h2>
              </div>
              <button
                className="btn-icon"
                disabled={creating}
                aria-label="Close"
                onClick={() => setNewOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <label className="note-new-title">
              Note title
              <input
                className="field"
                autoFocus
                maxLength={300}
                value={newTitle}
                disabled={creating}
                onChange={(event) => {
                  setNewTitle(event.target.value);
                  rememberNewNote(
                    {
                      title: event.target.value,
                      templateId: newTemplateId,
                    },
                    true,
                  );
                }}
                placeholder={
                  selectedTemplate.kind === "daily"
                    ? today()
                    : newTemplateId === "blank"
                      ? "Give your idea a name…"
                      : selectedTemplate.label
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter")
                    void create(newTemplateId, newTitle);
                }}
              />
            </label>
            <div className="note-template-label">
              CHOOSE A STARTING POINT{" "}
              <span>{templates.length} built-in templates</span>
            </div>
            {personalCreation && (
              <p className="draft-recovery-note" role="status">
                Your personal template is ready. Review the title, then choose
                Create note. Its content stays with this form if you close it.
              </p>
            )}
            <button
              className="btn"
              data-tour="personal-note-templates"
              disabled={creating}
              onClick={() => setPersonalTemplatesOpen(true)}
            >
              <Copy size={16} />
              My note templates
            </button>
            <div className="note-template-filters">
              <label className="note-template-search">
                <Search size={17} />
                <input
                  aria-label="Search templates"
                  value={templateSearch}
                  onChange={(event) => setTemplateSearch(event.target.value)}
                  placeholder="Search templates…"
                />
              </label>
              <select
                aria-label="Template category"
                value={templateCategory}
                onChange={(event) =>
                  setTemplateCategory(
                    event.target.value as "all" | TemplateCategory,
                  )
                }
              >
                <option value="all">All categories</option>
                {templateCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div className="note-template-scroll">
              <div className="note-template-grid">
                {visibleTemplates.map((item) => (
                  <button
                    className={
                      !personalCreation && newTemplateId === item.id
                        ? "selected"
                        : ""
                    }
                    key={item.id}
                    aria-pressed={
                      !personalCreation && newTemplateId === item.id
                    }
                    disabled={creating}
                    onClick={() => {
                      setNewTemplateId(item.id);
                      rememberNewNote({ templateId: item.id, title: newTitle });
                    }}
                  >
                    <span className="note-template-icon">
                      {item.kind === "daily" ? (
                        <CalendarDays size={20} />
                      ) : (
                        <FileText size={20} />
                      )}
                      <small>{item.category}</small>
                    </span>
                    <strong>{item.label}</strong>
                    <p>{item.description}</p>
                    {!personalCreation && newTemplateId === item.id && (
                      <Check size={17} className="template-check" />
                    )}
                  </button>
                ))}
              </div>
              {!visibleTemplates.length && (
                <p className="note-template-no-results">
                  No templates match. Try another search or category.
                </p>
              )}
            </div>
            <div className="knowledge-modal-footer">
              <span className="note-template-selection">
                Selected:{" "}
                <strong>
                  {personalCreation
                    ? "Personal template"
                    : selectedTemplate.label}
                </strong>
              </span>
              <button
                className="btn"
                disabled={creating}
                onClick={() => setNewOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={creating}
                onClick={() => void create(newTemplateId, newTitle)}
              >
                {creating ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Plus size={16} />
                )}
                Create note
              </button>
            </div>
          </NoteDialog>
        </div>
      )}

      {snapshotsOpen && draft && (
        <div
          className="knowledge-modal-backdrop"
          onClick={() => !restoringHistory && setSnapshotsOpen(false)}
        >
          <NoteDialog
            className="knowledge-modal snapshots-modal"
            label="Version history"
            onClose={() => setSnapshotsOpen(false)}
            busy={restoringHistory}
          >
            <div className="knowledge-modal-heading">
              <div>
                <span className="eyebrow">YOUR EARLIER WORK</span>
                <h2>Version history</h2>
              </div>
              <button
                className="btn-icon"
                disabled={restoringHistory}
                aria-label="Close version history"
                onClick={() => setSnapshotsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="knowledge-modal-description">
              Earlier versions are stored separately from your current
              workspace. Restoring a version first saves your changes and
              preserves the content being replaced.
            </p>
            {historyError && (
              <p className="form-error" role="alert">
                {historyError}
                <button
                  className="btn"
                  disabled={historyLoading}
                  onClick={() => void loadHistory(draft.id)}
                >
                  Retry history
                </button>
              </p>
            )}
            {history.map((snapshot) => (
              <div className="note-snapshot" key={snapshot.id}>
                <div>
                  <strong>{new Date(snapshot.savedAt).toLocaleString()}</strong>
                  <pre>{snapshot.content.slice(0, 230) || "Empty note"}</pre>
                </div>
                <button
                  className="btn"
                  disabled={restoringHistory || historyLoading}
                  onClick={() => void restoreHistory(snapshot)}
                >
                  {restoringHistory ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))}
            {historyLoading && <p role="status">Loading earlier versions…</p>}
            {!history.length && !historyLoading && !historyError && (
              <div className="note-list-empty">
                <History size={28} />
                <p>Your earlier versions will appear as you edit this note.</p>
              </div>
            )}
            {historyCursor && (
              <button
                className="btn"
                disabled={historyLoading || restoringHistory}
                onClick={() => void loadHistory(draft.id, historyCursor)}
              >
                Load older versions
              </button>
            )}
          </NoteDialog>
        </div>
      )}

      {mergeOpen && draft && (
        <div
          className="knowledge-modal-backdrop"
          onClick={() => setMergeOpen(false)}
        >
          <NoteDialog
            className="knowledge-modal compact-modal"
            label="Combine notes"
            onClose={() => setMergeOpen(false)}
          >
            <div className="knowledge-modal-heading">
              <h2>Combine notes</h2>
              <button
                className="btn-icon"
                aria-label="Close"
                onClick={() => setMergeOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="knowledge-modal-description">
              Append another note to “{draft.title}”. Both original notes stay
              available.
            </p>
            <select
              className="field"
              value={mergeId}
              onChange={(event) => setMergeId(event.target.value)}
            >
              <option value="">Choose a note…</option>
              {workspace.notes
                .filter((note) => note.id !== draft.id)
                .map((note) => (
                  <option value={note.id} key={note.id}>
                    {note.title}
                  </option>
                ))}
            </select>
            <div className="knowledge-modal-footer">
              <button className="btn" onClick={() => setMergeOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!mergeId}
                onClick={() => void merge()}
              >
                <GitMerge size={15} />
                Combine
              </button>
            </div>
          </NoteDialog>
        </div>
      )}

      {deleteOpen && draft && (
        <div
          className="knowledge-modal-backdrop"
          onClick={() => !deleting && setDeleteOpen(false)}
        >
          <NoteDialog
            className="knowledge-modal compact-modal"
            label="Move note to Trash"
            onClose={() => setDeleteOpen(false)}
            busy={deleting}
          >
            <div className="knowledge-modal-heading">
              <h2>Move this note to Trash?</h2>
              <button
                className="btn-icon"
                aria-label="Close"
                disabled={deleting}
                onClick={() => setDeleteOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="knowledge-modal-description">
              “{draft.title}” will leave the active workspace. Its content,
              saved versions, and valid links can be restored from Trash.
            </p>
            <div className="knowledge-modal-footer">
              <button
                className="btn"
                disabled={deleting}
                onClick={() => setDeleteOpen(false)}
              >
                Keep note
              </button>
              <button
                className="btn note-delete-button"
                disabled={deleting}
                onClick={() => void remove()}
              >
                <Trash2 size={15} />
                {deleting ? "Moving…" : "Move to Trash"}
              </button>
            </div>
          </NoteDialog>
        </div>
      )}

      {personalTemplatesOpen && (
        <PersonalTemplates
          kind="note"
          source={draft ? noteTemplateContent(draft) : undefined}
          sourceTitle={draft?.title}
          onClose={() => setPersonalTemplatesOpen(false)}
          onUse={async (template) => {
            if (template.kind !== "note") return;
            const previous = newNoteForm.current;
            const unfinished = !!(
              previous.candidate ||
              previous.title.trim() ||
              previous.templateId !== "blank"
            );
            if (
              unfinished &&
              !window.confirm(
                "Use this template instead of the previously unfinished note creation?",
              )
            )
              throw new Error("The previous note form is kept.");
            const previousRecord = readDraft<NewNoteDraft>(
              draftScope,
              "note-forms",
              "new-note",
            );
            if (unfinished && previousRecord) {
              const copy = writeDraft(
                draftScope,
                "recovery-copies",
                `note-forms:new-note:${previousRecord.owner || previousRecord.token}`,
                {
                  entity: "note-forms",
                  id: "new-note",
                  record: previousRecord,
                },
                null,
              );
              if (copy.error) {
                setDraftStorageError(copy.error);
                throw new Error(
                  "Your previous form could not be kept in recovery. Free some browser storage and try again.",
                );
              }
            }
            const projectId = workspaceRef.current.projects.some(
              (project) => project.id === projectFilter,
            )
              ? projectFilter
              : "";
            const staged = stagePersonalNoteTemplate(
              template,
              workspaceRef.current.notes,
              projectId,
            );
            const result = writeDraft(
              draftScope,
              "note-forms",
              "new-note",
              staged,
              null,
            );
            setDraftStorageError(result.error || "");
            if (result.error) {
              // A failed browser write also updates its in-memory copy. Restore
              // the previous form there before leaving the library open.
              writeDraft(draftScope, "note-forms", "new-note", previous, null);
              throw new Error(
                "The template could not be kept in browser recovery. Free some browser storage and try again; your previous form is kept.",
              );
            }
            if (previous.candidate)
              discardDraftMutations(draftScope, "notes", previous.candidate.id);
            newNoteForm.current = staged;
            setNewTitle(staged.title);
            setNewTemplateId("blank");
            setPersonalCreation(true);
            setTemplateSearch("");
            setTemplateCategory("all");
            setNewOpen(true);
          }}
        />
      )}

      {slides && draft && (
        <NoteDialog
          className="knowledge-slides"
          label="Note presentation"
          onClose={() => setSlides(false)}
        >
          <div className="slides-toolbar">
            <span>
              <Presentation size={16} />
              {draft.title}
            </span>
            <button
              className="btn-icon"
              aria-label="Close presentation"
              onClick={() => setSlides(false)}
            >
              <X size={21} />
            </button>
          </div>
          <div className="slides-content">
            <Markdown
              content={slidesContent[slideIndex] || ""}
              workspace={workspace}
              onNoteClick={(id) => {
                setSlides(false);
                openNote(id);
              }}
            />
          </div>
          <div className="slides-footer">
            <span>
              Separate slides with <code>---</code> in your note.
            </span>
            <div>
              <button
                className="btn-icon"
                aria-label="Previous slide"
                disabled={slideIndex === 0}
                onClick={() => setSlideIndex((index) => index - 1)}
              >
                <ChevronLeft size={20} />
              </button>
              <span>
                {slideIndex + 1} / {slidesContent.length}
              </span>
              <button
                className="btn-icon"
                aria-label="Next slide"
                disabled={slideIndex >= slidesContent.length - 1}
                onClick={() => setSlideIndex((index) => index + 1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        </NoteDialog>
      )}
    </div>
  );
}
