"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, Compass, X } from "lucide-react";
import "./guided-tour.css";

export type TourPage =
  | "overview"
  | "my-work"
  | "tasks"
  | "projects"
  | "rooms"
  | "notes"
  | "graph"
  | "canvas"
  | "collections"
  | "daily"
  | "team"
  | "settings";
type TourStep = {
  id: string;
  page: TourPage;
  title: string;
  body: string;
  tip?: string;
  anchors: string[];
};

// Each step explains existing controls. Visiting the tour never creates records.
export const tourSteps: TourStep[] = [
  {
    id: "welcome",
    page: "overview",
    title: "Your ideas and your work, together",
    body: "Overview puts project progress, upcoming tasks, and recent notes first. Create a task from the top of the page or resume your latest work room. Use Notes to capture information and turn next steps into tasks.",
    tip: "The sidebar keeps Teams & people and Workspace settings at the bottom. The project filter strip shows your scope and lets you clear it.",
    anchors: [
      '[data-tour="overview"]',
      ".view-overview .page-heading",
      ".view-overview .stat-grid",
    ],
  },
  {
    id: "projects",
    page: "projects",
    title: "Give each project a home",
    body: "Create a project for work, a personal goal, or a shared plan. Add a description, goal, accent color, and target date. Projects connect their tasks and notes so you can follow progress in one place.",
    tip: "The project list in the sidebar also filters your work.",
    anchors: [
      '[data-tour="new-project"]',
      ".view-projects .heading-actions",
      ".project-add",
    ],
  },
  {
    id: "project-home",
    page: "projects",
    title: "Bring a project's work together",
    body: "Open a project's title to see its home: goal, target date, progress, tasks, notes, and attached canvases. Open any item from here, or create a task directly in the project. Edit project changes its basic details.",
    tip: "Progress counts tasks without child tasks. Parent tasks summarize that work, so their children are counted once.",
    anchors: [
      '[data-tour="project-home"]',
      ".projects-grid",
      '[data-tour="nav-projects"]',
    ],
  },
  {
    id: "milestones",
    page: "projects",
    title: "Break the project into milestones",
    body: "A project can have several milestones, each with a title, description, and target date. Assign tasks to a milestone in the task editor. A child task inherits its parent's milestone unless you choose another. Each milestone shows its own task progress.",
    tip: "Archive a milestone to hide it from new assignments. Its history and existing assignments remain; restore it from Archived. Archiving keeps existing recurring schedules running.",
    anchors: [
      '[data-tour="milestones"]',
      '[data-tour="project-home"]',
      ".projects-grid",
      '[data-tour="nav-projects"]',
    ],
  },
  {
    id: "new-task",
    page: "tasks",
    title: "Turn the plan into a task",
    body: "Create task starts with a title, status, priority, assignee, and project. In Details, write a description and checklist. Planning holds optional planned start and due dates, effort, type, and tags. Either date can stay blank; a planned start cannot fall after its due date. Connections holds linked work; Discussion holds comments.",
    tip: "Closing keeps a browser draft for this account and workspace. Save confirms the changes; conflicting teammate edits need review.",
    anchors: [
      '[data-tour="new-task"]',
      ".view-tasks .heading-actions",
      ".view-tasks .page-heading",
    ],
  },
  {
    id: "task-hierarchy",
    page: "tasks",
    title: "Group larger tasks into clear steps",
    body: "Choose a Parent task from the same project to build a task hierarchy. The parent shows its child tasks and their progress. Open a linked parent or child after saving your current edits. Checklists remain available for smaller steps inside one task.",
    tip: "Finish the children before completing their parent. Parent and dependency links are checked together to prevent cycles. Reopen a completed parent before reopening one of its children.",
    anchors: [
      '[data-tour="task-hierarchy"]',
      '[data-tour="new-task"]',
      ".view-tasks .page-heading",
    ],
  },
  {
    id: "bulk-edit",
    page: "tasks",
    title: "Update several tasks with a clear result",
    body: "Filter the task board, then open Bulk edit. Select up to 100 tasks and choose only the fields to change: status, priority, person, project, milestone, or dates. Keep existing leaves a field alone; blank enabled dates clear it.",
    tip: "Each task saves independently. Review saved, failed, and unprocessed results, retry remaining work, or open a task to resolve a conflict. Closing keeps the form and pending saves on this device. Moving projects clears the moved task's parent and milestone.",
    anchors: ['[data-tour="bulk-edit"]', ".task-view-toolbar"],
  },
  {
    id: "recurrence",
    page: "tasks",
    title: "Keep a routine moving",
    body: "In a task's Planning details, enable a daily, weekly, or monthly recurrence. Choose an interval, anchor date, time zone, and optional end date. Completing the task creates its next occurrence with a fresh checklist and schedule.",
    tip: "Missed dates are skipped. Monthly routines retain their original day, clamping shorter months. Reopening and completing the same occurrence again creates no duplicate. Tasks with children cannot repeat; stop a routine by disabling recurrence on its current open occurrence.",
    anchors: [
      '[data-tour="recurrence"]',
      '[data-tour="new-task"]',
      ".view-tasks .page-heading",
    ],
  },
  {
    id: "reminders",
    page: "tasks",
    title: "Keep the next action in sight",
    body: "Set a reminder date, time, and time zone in a task's Planning details. The bell shows due reminders for your assigned tasks and unassigned work in this workspace. Open a task, snooze a due reminder for an hour, or dismiss it.",
    tip: "Reminders are checked while ProjectAnvil is open and when you return. Dismissed reminders can be restored. Snoozes and dismissals belong to this browser, account, and workspace; the task's schedule is saved with its records.",
    anchors: [
      '[data-tour="reminder-center"]',
      '[data-tour="task-reminder"]',
      '[data-tour="new-task"]',
    ],
  },
  {
    id: "duplicate-task",
    page: "tasks",
    title: "Start from a task that already works",
    body: "Open a saved task and choose Duplicate. Review its new editable copy, then save when ready. The title, description, type, priority, effort, tags, checklist structure, and available project and note links are copied.",
    tip: "Copies get fresh IDs and a new task key. Completion, assignee, dates, parent, recurrence, reminder, dependencies, discussion, and source quote are reset. An available active milestone is kept. Your original stays intact; unsaved original edits are saved before copying.",
    anchors: [
      '[data-tour="duplicate-task"]',
      '[data-tour="new-task"]',
      ".view-tasks .page-heading",
    ],
  },
  {
    id: "personal-templates",
    page: "notes",
    title: "Make your own reusable starting points",
    body: "My note templates and My task templates save reusable structures from the current editor. Name, rename, update, and reuse a template to begin a new editable task or a note creation form. For notes, review the suggested unique title, then choose Create note. The 14 built-in note templates remain available too.",
    tip: "Your library belongs to your account across its workspaces. Guest templates have a separate local library. Templates omit assignments, project links, history, dates, and private attachments. Removed templates can be restored in the library's Deleted tab.",
    anchors: [
      '[data-tour="personal-note-templates"]',
      '[data-tour="note-templates"]',
      '[data-tour="new-note"]',
      ".knowledge-empty",
    ],
  },
  {
    id: "task-layouts",
    page: "tasks",
    title: "Choose how to see the work",
    body: "Board organizes tasks into status columns; drag a card to move work forward. List shows assignments and schedules together. Timeline draws planned start through due date as a range, or a marker when only one date is known. Choose Window starts, previous/next 28 days, or Today to explore the schedule.",
    tip: "Phones start with a readable List. Board and Timeline remain available. Use the status field as an alternative to dragging.",
    anchors: ['[data-tour="task-layouts"]', ".task-view-toolbar .view-tabs"],
  },
  {
    id: "task-filters",
    page: "tasks",
    title: "Find exactly what matters",
    body: "Filter tasks by text, project, person, priority, status, or dates. Dates finds due today, overdue, due in the next seven days, starts today or soon, and missing dates. Sort by priority, due date, planned start, or recent changes.",
    tip: "Next seven days includes today and six more local calendar days. Overdue excludes completed tasks. Date sorting puts undated tasks last; recently updated puts the newest changes first. Clear filters keeps your chosen sort.",
    anchors: ['[data-tour="task-filters"]', ".view-tasks .filters"],
  },
  {
    id: "saved-views",
    page: "tasks",
    title: "Keep the view you use every day",
    body: "Save current view remembers filters, sorting, and the Board, List, or Timeline layout. Choose a saved view to reopen it. Modified shows when your current settings differ; Update view replaces its saved settings, while Rename changes its name.",
    tip: "Views are shared in the current workspace. My work always keeps its assignment scope. Move an unwanted view to Trash; Undo or Trash can restore it.",
    anchors: ['[data-tour="saved-views"]', ".task-view-toolbar"],
  },
  {
    id: "trash",
    page: "overview",
    title: "Recover a deletion with confidence",
    body: "Move a task, note, project, assignment label, relationship, or saved view to Trash. The notification offers Undo; the sidebar's Trash opens older recovery copies with their deletion time and a Restore action.",
    tip: "Restoration recovers available links while preserving newer edits. Review any listed connections that could not be restored. Trash has no automatic expiry; replacing a workspace by import makes older copies unavailable to restore. Complete local backups include Trash; workspace JSON does not.",
    anchors: ['[data-tour="trash"]', '[data-tour="nav-settings"]'],
  },
  {
    id: "my-work",
    page: "my-work",
    title: "Focus on your next steps",
    body: "When signed in, My work shows tasks assigned to your account in the current workspace. In guest mode it shows unassigned work. Use the task board filters to explore assignments, status, and priority.",
    tip: "Only accepted team members get access. Assigning a task does not share a workspace.",
    anchors: ['[data-tour="my-work"]', ".view-my-work .page-heading"],
  },
  {
    id: "work-rooms",
    page: "rooms",
    title: "Keep a place for each piece of work",
    body: "Work rooms remember a working view with a project, focus task, pinned notes, and a canvas. Open Work rooms after working on a note or canvas, then create a room from that context. You can also choose the pins and resume view yourself.",
    tip: "Rooms are personal to your account, even inside a shared team workspace. Unsaved room forms stay as browser drafts; the guest workspace has its own rooms.",
    anchors: [
      '[data-tour="work-rooms"]',
      ".work-rooms-page",
      '[data-tour="nav-rooms"]',
    ],
  },
  {
    id: "room-checkpoint",
    page: "rooms",
    title: "Leave a clear next step",
    body: "Save a checkpoint with what changed, the next step, and any open question. Resume restores the saved view and pinned context, including a captured canvas position. The active room strip keeps references nearby while you work; its Checkpoint button returns here to update the room.",
    tip: "Save room confirms your checkpoint. Closing an unfinished form lets you keep editing, keep its browser draft, or discard it. Overview resumes your latest saved room.",
    anchors: [
      '[data-tour="room-checkpoint"]',
      '[data-tour="resume-room"]',
      '[data-tour="work-rooms"]',
      ".work-rooms-page",
    ],
  },
  {
    id: "knowledge",
    page: "notes",
    title: "Keep useful information connected",
    body: "Notes holds research, plans, and reference material. Choose templates for projects, routines, fitness, learning, travel, meetings, or creative worldbuilding. On a phone, Browse opens the note list; Close notes returns to your writing.",
    tip: "Templates are starting structures; every part stays editable.",
    anchors: [
      '[data-tour="new-note"]',
      ".note-browser-title button",
      ".knowledge-empty .btn-primary",
      ".note-workspace",
    ],
  },
  {
    id: "markdown",
    page: "notes",
    title: "Write with Markdown",
    body: "Write headings, lists, checkboxes, tables, quotes, highlighted text, footnotes, and code. Write, Split, and Read switch between editing and preview. Equations and Mermaid diagrams also render in notes.",
    tip: "Drafts recover in this browser for the same account and workspace. Review unsaved changes lets you inspect and retry failed saves, or download displaced drafts from other windows for manual merging. Same-field conflicts keep your text for review.",
    anchors: [
      '[data-tour="note-editor"]',
      ".note-editor-toolbar",
      ".knowledge-empty",
      ".note-workspace",
    ],
  },
  {
    id: "note-to-task",
    page: "notes",
    title: "Turn part of a note into a task",
    body: "Select text in the editor or preview, then choose Create linked task. On a phone, use the paragraph and checklist picker instead of precise text selection. Review the task title, project, priority, and assignee. The note is saved first and its original text stays in place.",
    tip: "The task keeps its source quote and note link. Duplicate quotes offer the existing task. Closing the form keeps its draft; Discard draft removes it.",
    anchors: [
      '[data-tour="note-to-task"]',
      ".note-editor-toolbar",
      ".knowledge-empty",
    ],
  },
  {
    id: "linked-task-progress",
    page: "notes",
    title: "See the work beside the idea",
    body: "Linked tasks show their live status inside the note. Open a task to see its saved source quote and return to the original note. Creating a linked task also adds a depends-on relationship, so later changes to the note can highlight the task for review.",
    tip: "The source quote records what you acted on; the task status reflects the current work.",
    anchors: [
      '[data-tour="linked-note-tasks"]',
      ".note-details",
      ".knowledge-empty",
    ],
  },
  {
    id: "note-links",
    page: "notes",
    title: "Connect an idea to another",
    body: "Type [[Note title]] to link a note, [[Note#Heading]] for a section, or ![[Note title]] to embed it. Backlinks show notes that refer here; linked tasks keep the idea attached to the work.",
    tip: "These connections also appear in the relationship graph.",
    anchors: [
      '[data-tour="note-links"]',
      ".note-details",
      ".note-editor-toolbar",
      ".knowledge-empty",
    ],
  },
  {
    id: "note-organize",
    page: "notes",
    title: "Organize without losing the connections",
    body: "Use folders, tags, bookmarks, and project links to find your notes again. Custom properties hold structured details such as category, status, or estimated effort. Note search searches titles, text, and tags.",
    anchors: [
      '[data-tour="note-organize"]',
      ".note-filter-row",
      ".note-search",
      ".knowledge-empty",
    ],
  },
  {
    id: "media",
    page: "notes",
    title: "Keep references beside your notes",
    body: "The attachment button adds images, PDFs, audio, video, or text files. The microphone records audio when you allow access. Uploaded references can be displayed in notes and used as cards on a canvas.",
    tip: "Uploads support 20 MB per file. Navigation finishes recording and uploads it first. If upload fails, keep the page open to retry or download the audio.",
    anchors: [
      '[data-tour="note-media"]',
      ".note-format-tools",
      ".knowledge-empty",
    ],
  },
  {
    id: "note-tools",
    page: "notes",
    title: "Revisit, reshape, and present",
    body: "A note’s More menu opens version history, Markdown export, and a separate window. Extract selected text splits part of a note into another; Combine with another note joins their content. Present as slides turns sections separated by --- into a simple presentation.",
    tip: "Earlier versions are archived separately from the workspace text limit. Load older versions in history; restoring first saves your draft and preserves the content being replaced.",
    anchors: [
      '[data-tour="note-tools"]',
      ".note-toolbar-actions",
      ".knowledge-empty",
    ],
  },
  {
    id: "graph",
    page: "graph",
    title: "Explore the relationships",
    body: "The graph connects notes, tasks, and projects. Select a node to inspect its neighbors; double-click to open it. Filter node types, search for an idea, or use Local graph to explore one or two connections away.",
    tip: "Drag to pan, scroll to zoom, and use Fit graph to bring everything into view. On phones, a selected node’s details appear below the graph.",
    anchors: [
      '[data-tour="graph-controls"]',
      ".graph-toolbar",
      ".visual-heading",
    ],
  },
  {
    id: "meaningful-relationships",
    page: "graph",
    title: "Explain why two items are connected",
    body: "Below the graph, Add relationship connects two notes, tasks, or projects with depends on, supports, contradicts, or was decided because of. Add a short reason if useful. The form explains which direction a change can affect the other item.",
    tip: "These connections stay inside the active workspace. Removing a connection keeps both items.",
    anchors: [
      '[data-tour="meaningful-relationships"]',
      ".relationship-heading",
    ],
  },
  {
    id: "change-impact",
    page: "graph",
    title: "Review the consequences of a change",
    body: "When a relevant source changes, rings distinguish the changed source, direct impact, and downstream impact. The review list explains which relationships need attention. Check the connected work, then Mark reviewed to accept the current source content for that workspace.",
    tip: "Highlighting means possible impact, not an automatic error. Changes arriving during a review require a refresh before they can be acknowledged.",
    anchors: ['[data-tour="impact-review"]', '[data-tour="graph-impact"]'],
  },
  {
    id: "canvas",
    page: "canvas",
    title: "Plan on an open canvas",
    body: "Arrange notes, tasks, loose thoughts, uploaded media, and web references as cards. Move and resize them, connect them with arrows, and label the relationships. Assign a canvas to a project using its Project control, or attach and open it from the project home.",
    tip: "Select a card to edit its Details; the resize handle also accepts arrow keys. Unsaved changes recover in this browser. Save now retries saving; Discard local changes loads the saved version after confirmation.",
    anchors: [
      '[data-tour="canvas-controls"]',
      ".canvas-toolbar",
      ".visual-heading",
    ],
  },
  {
    id: "collections",
    page: "collections",
    title: "Give your notes a structured view",
    body: "Collections shows the same notes as a table, list, gallery, or Kanban board. Filter, sort, and group them by their properties. Edit table values directly; Properties adds columns and calculations such as sums and averages.",
    tip: "Enter or Tab saves an edited property; Escape cancels. A project index, reading list, habit log, or research tracker can all use your existing notes.",
    anchors: [
      '[data-tour="collection-layouts"]',
      ".base-view-tabs",
      ".base-topline",
    ],
  },
  {
    id: "daily",
    page: "daily",
    title: "Make a small plan for today",
    body: "Daily planner opens a dated journal for your focus, activity log, discoveries, and reflection. Your daily notes stay searchable and connected to the rest of your notes.",
    tip: "The guide previews this page without creating a journal entry.",
    anchors: [
      '[data-tour="daily-planner"]',
      ".daily-knowledge .note-browser-title",
      ".daily-knowledge .knowledge-empty",
      ".note-workspace",
    ],
  },
  {
    id: "people",
    page: "team",
    title: "Bring your team together",
    body: "Register with an email address, username, and a ProjectAnvil password. Your personal workspace is private. Create a team workspace, invite registered usernames, and let them accept. Projects and connected content inside that workspace are shared with the team.",
    tip: "Choose the team workspace before creating shared projects. Optional assignment labels live in Workspace settings.",
    anchors: [
      '[data-tour="people"]',
      ".view-team .page-heading",
      ".view-team .info-note",
    ],
  },
  {
    id: "search",
    page: "overview",
    title: "Jump to anything",
    body: "Search finds tasks, notes, and projects across the workspace. Open it with Ctrl K (⌘ K on Mac), then select a result. The same search panel offers quick actions for creating a task and opening today’s planner.",
    tip: "On a small screen, open the navigation menu to find Search anything.",
    anchors: [
      '[data-tour="search"]',
      ".top-search",
      ".sidebar-search",
      ".mobile-menu",
    ],
  },
  {
    id: "preferences",
    page: "settings",
    title: "Make the workspace yours",
    body: "Settings lets you rename the workspace, adjust spacing, choose a new-task shortcut, and save the view to open on startup. Use the keyboard shortcuts button for a reminder of the available keys.",
    tip: "Preferences and appearance are saved in this browser.",
    anchors: [
      '[data-tour="preferences"]',
      ".settings-section:has(.shortcut-field)",
      ".settings-page .page-heading",
    ],
  },
  {
    id: "backups",
    page: "settings",
    title: "Keep a copy of your work",
    body: "Storage & recovery reports the active workspace allowance, archived history, and attachment problems. Export downloads confirmed records as JSON; Import replaces records after confirmation and resets relationship review markers. JSON excludes personal rooms, archived versions, and uploaded files.",
    tip: "Finish pending saves first. Complete backups need .wrangler/state and the matching .dev.vars file while the app is stopped. Browser drafts stay separate; download conflicted text you need to keep.",
    anchors: [
      '[data-tour="storage-health"]',
      '[data-tour="backups"]',
      ".settings-data-actions",
    ],
  },
  {
    id: "appearance",
    page: "overview",
    title: "A familiar place to return",
    body: "The appearance button offers Light, Dark, Warp, Focus, and Soft. Warp is the original violet look; Focus mixes light surfaces with dark framing; Soft uses gentle pink and mauve pastels. The guide button beside it restarts this tour whenever you need a reminder. You are ready to make the workspace your own.",
    tip: "Use arrow keys and Home/End to choose an appearance; Escape closes the menu and returns focus. Next steps: create a project, write an idea, then make your first task.",
    anchors: [
      '[data-tour="tour-button"]',
      '[data-tour="appearance"]',
      ".appearance-menu",
    ],
  },
];

type Box = { left: number; top: number; width: number; height: number };
type Placement = "left" | "right" | "above" | "below" | "center";
type Layout = {
  anchor: Box | null;
  left: number;
  top: number;
  placement: Placement;
};
const clamp = (number: number, min: number, max: number) =>
  Math.max(min, Math.min(number, max));
const subscribeToClient = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function locateAnchor(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const candidates = document.querySelectorAll<HTMLElement>(selector);
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect(),
        style = getComputedStyle(candidate);
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      )
        return candidate;
    }
  }
  return null;
}

function positionCard(
  anchor: Box | null,
  width: number,
  height: number,
): Layout {
  const viewportWidth = window.innerWidth,
    viewportHeight = window.innerHeight,
    padding = 14,
    gap = 17;
  const centered = {
    anchor,
    left: Math.max(padding, (viewportWidth - width) / 2),
    top: Math.max(padding, (viewportHeight - height) / 2),
    placement: "center" as const,
  };
  if (!anchor) return centered;
  const right = anchor.left + anchor.width,
    bottom = anchor.top + anchor.height;
  const verticalCenter = clamp(
    anchor.top + anchor.height / 2 - height / 2,
    padding,
    viewportHeight - height - padding,
  );
  if (viewportWidth > 680 && right + gap + width <= viewportWidth - padding)
    return {
      anchor,
      left: right + gap,
      top: verticalCenter,
      placement: "right",
    };
  if (viewportWidth > 680 && anchor.left - gap - width >= padding)
    return {
      anchor,
      left: anchor.left - gap - width,
      top: verticalCenter,
      placement: "left",
    };
  const left = clamp(
    anchor.left + anchor.width / 2 - width / 2,
    padding,
    viewportWidth - width - padding,
  );
  if (bottom + gap + height <= viewportHeight - padding)
    return { anchor, left, top: bottom + gap, placement: "below" };
  if (anchor.top - gap - height >= padding)
    return { anchor, left, top: anchor.top - gap - height, placement: "above" };
  // Large surfaces need a bottom sheet; the highlighted control remains visible above it.
  return {
    anchor,
    left: Math.max(padding, (viewportWidth - width) / 2),
    top: Math.max(padding, viewportHeight - height - padding),
    placement: "center",
  };
}

export default function GuidedTour({
  onNavigate,
  onClose,
}: {
  onNavigate: (page: TourPage) => void;
  onClose: () => void;
}) {
  const mounted = useSyncExternalStore(
    subscribeToClient,
    clientSnapshot,
    serverSnapshot,
  );
  const [index, setIndex] = useState(0),
    [layout, setLayout] = useState<Layout>({
      anchor: null,
      left: 14,
      top: 14,
      placement: "center",
    });
  const card = useRef<HTMLElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    navigate = useRef(onNavigate),
    close = useRef(onClose);
  const step = tourSteps[index],
    last = index === tourSteps.length - 1;
  useLayoutEffect(() => {
    navigate.current = onNavigate;
    close.current = onClose;
  }, [onNavigate, onClose]);

  useEffect(() => {
    const focused = document.activeElement as HTMLElement | null,
      bodyOverflow = document.body.style.overflow;
    const shell = document.querySelector<HTMLElement>(".app-shell"),
      wasInert = shell?.hasAttribute("inert");
    document.body.style.overflow = "hidden";
    shell?.setAttribute("inert", "");
    return () => {
      document.body.style.overflow = bodyOverflow;
      if (!wasInert) shell?.removeAttribute("inert");
      if (focused?.isConnected && focused !== document.body)
        focused.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>('[data-tour="tour-button"]')
          ?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    navigate.current(step.page);
    let frame = 0,
      scrolled = false,
      cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const element = locateAnchor(step.anchors);
      if (element && !scrolled) {
        const box = element.getBoundingClientRect();
        if (box.top < 10 || box.bottom > window.innerHeight - 10)
          element.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
        scrolled = true;
      }
      const rect = element?.getBoundingClientRect(),
        margin = 6;
      let anchor: Box | null = null;
      if (
        rect &&
        rect.bottom > margin &&
        rect.top < window.innerHeight - margin
      ) {
        const left = clamp(
            rect.left - margin,
            margin,
            window.innerWidth - margin,
          ),
          top = clamp(rect.top - margin, margin, window.innerHeight - margin);
        anchor = {
          left,
          top,
          width: Math.max(
            0,
            Math.min(rect.right + margin, window.innerWidth - margin) - left,
          ),
          height: Math.max(
            0,
            Math.min(rect.bottom + margin, window.innerHeight - margin) - top,
          ),
        };
      }
      const cardBox = card.current?.getBoundingClientRect(),
        width = cardBox?.width || Math.min(378, window.innerWidth - 28),
        height = cardBox?.height || 330;
      const next = positionCard(anchor, width, height);
      setLayout((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    const retry = window.setTimeout(schedule, 90);
    const focusFrame = requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
    const observer = new ResizeObserver(schedule);
    if (card.current) observer.observe(card.current);
    const shell = document.querySelector(".app-shell");
    if (shell) observer.observe(shell);
    const mutations = new MutationObserver(schedule);
    if (shell) mutations.observe(shell, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      clearTimeout(retry);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [index, mounted, step]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIndex((value) =>
          clamp(
            value + (event.key === "ArrowRight" ? 1 : -1),
            0,
            tourSteps.length - 1,
          ),
        );
        return;
      }
      if (event.key === "Tab") {
        const controls = card.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),[href],input,select,textarea,[tabindex="0"]',
        );
        if (!controls?.length) return;
        const first = controls[0],
          final = controls[controls.length - 1],
          active = document.activeElement;
        if (
          event.shiftKey &&
          (active === first ||
            !card.current?.contains(active) ||
            active === heading.current)
        ) {
          event.preventDefault();
          final.focus();
        } else if (
          !event.shiftKey &&
          (active === final || !card.current?.contains(active))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => document.removeEventListener("keydown", keyboard, true);
  }, []);

  if (!mounted) return null;
  const anchor = layout.anchor;
  return createPortal(
    <div className="guided-tour" data-testid="guided-tour">
      {anchor ? (
        <>
          <div
            className="tour-shade"
            style={{ top: 0, left: 0, right: 0, height: anchor.top }}
          />
          <div
            className="tour-shade"
            style={{
              top: anchor.top + anchor.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <div
            className="tour-shade"
            style={{
              top: anchor.top,
              left: 0,
              width: anchor.left,
              height: anchor.height,
            }}
          />
          <div
            className="tour-shade"
            style={{
              top: anchor.top,
              left: anchor.left + anchor.width,
              right: 0,
              height: anchor.height,
            }}
          />
          <div aria-hidden="true" className="tour-spotlight" style={anchor} />
        </>
      ) : (
        <div className="tour-shade tour-shade-full" />
      )}
      <section
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="tour-card"
        data-placement={layout.placement}
        data-step={step.id}
        style={{ left: layout.left, top: layout.top }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="tour-card-top">
          <span className="tour-label">
            <Compass size={14} />
            PROJECTANVIL GUIDE
          </span>
          <button
            type="button"
            className="tour-close"
            aria-label="Close guide"
            title="Close guide (Esc)"
            onClick={() => close.current()}
          >
            <X size={18} />
          </button>
        </div>
        <div className="tour-progress" aria-hidden="true">
          <span
            style={{ width: `${((index + 1) / tourSteps.length) * 100}%` }}
          />
        </div>
        <span className="tour-step-count" role="status" aria-live="polite">
          Step {index + 1} of {tourSteps.length}
        </span>
        <h2 ref={heading} tabIndex={-1} id="tour-title">
          {step.title}
        </h2>
        <p id="tour-body">{step.body}</p>
        {step.tip && <p className="tour-tip">{step.tip}</p>}
        <div className="tour-navigation">
          <button
            type="button"
            className="tour-skip"
            onClick={() => close.current()}
          >
            Skip guide
          </button>
          <button
            type="button"
            className="tour-previous"
            disabled={index === 0}
            onClick={() => setIndex((value) => value - 1)}
          >
            <ArrowLeft size={14} />
            <span>Previous</span>
          </button>
          <button
            type="button"
            className="tour-next"
            onClick={() =>
              last ? close.current() : setIndex((value) => value + 1)
            }
          >
            {last ? (
              <>
                <span>Finish</span>
                <Check size={15} />
              </>
            ) : (
              <>
                <span>Next</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
        <p className="tour-key-hint">
          ← → to move · Esc to close · Replay from the guide button
        </p>
      </section>
    </div>,
    document.body,
  );
}
