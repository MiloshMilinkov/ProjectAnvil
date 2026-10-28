export type TourPage =
  | "overview"
  | "my-work"
  | "tasks"
  | "projects"
  | "rooms"
  | "notes"
  | "brainstorm"
  | "activity"
  | "graph"
  | "canvas"
  | "collections"
  | "daily"
  | "team"
  | "settings";
export type TourStep = {
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
    tip: "More tools holds work rooms, collections, and activity. Teams & people and Workspace settings stay below; the project strip clears your scope. If a screen cannot open, reconnect and choose Retry opening. Your saved work stays available.",
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
    body: "Open a project's title to see its home: goal, target date, progress, tasks, notes, attached canvases, and project attachments. Open any item from here, or create a task directly in the project when you have editing access. Files uploaded from the project keep its permissions; unused files can be moved to Trash.",
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
    body: "Create task starts with a title, status, priority, assignee, and project. Dates keeps optional planned start and due dates visible. In Details, write a description and checklist; More planning options reveals hierarchy, effort, type, tags, repeat, and reminders. A planned start cannot fall after its due date. Connections holds linked work; Discussion holds comments.",
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
    body: "My note templates and My task templates save reusable structures from the current editor. Name, rename, update, and reuse a template to begin a new editable task or a note creation form. For notes, review the suggested unique title, then choose Create note. The 15 built-in note templates remain available too.",
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
    tip: "Search and combine folder, tag, type, and bookmark filters in the note list. The count shows how many match; Clear note filters resets the list while keeping your project and current note. Templates stay editable.",
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
    body: "Write headings, lists, checkboxes, tables, quotes, highlights, footnotes, and code. Write, Split, and Read switch views. Equations, Mermaid diagrams, and syntax colors prepare automatically when used. If formatting is unavailable, its source stays readable; reconnect or reopen the note to retry.",
    tip: "Drafts recover in this browser for the same account and workspace. Review unsaved changes lets you inspect and retry failed saves, or download displaced drafts from other windows for manual merging. Same-field conflicts keep your text for review.",
    anchors: [
      '[data-tour="note-editor"]',
      ".note-editor-toolbar",
      ".knowledge-empty",
      ".note-workspace",
    ],
  },
  {
    id: "simultaneous-editing",
    page: "notes",
    title: "Write a note together",
    body: "Open a note and choose Edit together. Each editor joins the same saved Markdown session, and concurrent text edits merge. Here now shows active participants. Other properties, such as title, project, and structured fields, keep their normal conflict checks.",
    tip: "Shared editing is optional. Saving text through the ordinary editor, importing, or restoring a version starts a new session boundary. If an older session has unfinished text, download or review it before loading the saved version. Interrupted changes stay in this browser for the same account and workspace.",
    anchors: [
      '[data-tour="simultaneous-editing"]',
      ".note-editor-toolbar",
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
    body: "Use folders, tags, bookmarks, and project links to find your notes again. Open Details for properties, backlinks, and linked work. Note search includes titles, text, tags, and structured values. Clear note filters resets the list and returns focus to search while keeping your project and selected note.",
    anchors: [
      '[data-tour="note-organize"]',
      ".note-filter-row",
      ".note-search",
      ".knowledge-empty",
    ],
  },
  {
    id: "custom-note-types",
    page: "notes",
    title: "Give your notes a useful structure",
    body: "Open Manage note types to create a reusable structure for this workspace. Add named text, number, date, checkbox, or choice fields. Assign a type in a note's details, then fill its structured properties. Required fields guide completeness while unfinished notes can still save.",
    tip: "Field IDs keep values connected when labels change. Archive a type to hide it from new assignments. Existing notes keep their values. Collections can filter by type and show, sort, group, and summarize structured fields; open a field to edit it in the note.",
    anchors: [
      '[data-tour="custom-note-types"]',
      ".note-details",
      ".note-workspace",
    ],
  },
  {
    id: "decision-records",
    page: "notes",
    title: "Keep the reason behind a decision",
    body: "Choose the Decision record template, or select Decision record under Type in a note's details. Capture context, options, outcome, consequences, a responsible person, and decision date. Use Proposed while exploring; Accepted needs an outcome and date. Rejected and Superseded keep the reasoning available.",
    tip: "Link a replacement decision when superseding an older one. Connect supporting notes through the graph's was decided because of relationship. Changes to the reasoning or structured values can highlight connected work for review.",
    anchors: [
      '[data-tour="decision-records"]',
      '[data-tour="new-note"]',
      ".note-workspace",
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
    id: "relationship-presets",
    page: "graph",
    title: "Reuse connections with a clear meaning",
    body: "Open Relationship presets to save a name, meaning, allowed item types, and suggested explanation. In Add relationship, choose a preset, select two matching items, and review the connection before saving.",
    tip: "A preset fills a new connection. Editing or archiving it leaves existing relationships and their review history intact. Presets belong to the active workspace.",
    anchors: [
      '[data-tour="relationship-presets"]',
      '[data-tour="meaningful-relationships"]',
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
    id: "brainstorming",
    page: "brainstorm",
    title: "Explore ideas before turning them into work",
    body: "Create a brainstorming board for a project or the whole workspace. Add ideas with a title and description, arrange them into named groups, and link existing notes or tasks. Edit the board to rename groups or move ideas using ordinary controls.",
    tip: "Board edits have browser drafts and conflict checks. Removing a group keeps its ideas ungrouped. A board moved to Trash can be restored with available links.",
    anchors: ['[data-tour="brainstorming"]', '[data-tour="nav-brainstorm"]'],
  },
  {
    id: "brainstorm-voting",
    page: "brainstorm",
    title: "Find the ideas people want to pursue",
    body: "Open voting on a board to let workspace members vote once on each idea. Vote again to remove your vote, and sort by votes to compare the results. Close voting when the group is ready to move forward.",
    tip: "Counts are shared with the workspace. Guest mode has one shared guest vote. Account votes use the signed-in identity; assignment labels cannot cast votes. JSON import preserves current trusted votes on matching ideas and starts new imported ideas at zero.",
    anchors: [
      '[data-tour="brainstorm-voting"]',
      '[data-tour="brainstorming"]',
      '[data-tour="nav-brainstorm"]',
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
    body: "Register with an email address, username, and a ProjectAnvil password. Your personal workspace is private. Create a team workspace, invite registered usernames with an access role, and let them accept. Team projects and their connected content follow workspace roles and project permissions.",
    tip: "Choose the team workspace before creating shared projects. Optional assignment labels live in Workspace settings → People & access.",
    anchors: [
      '[data-tour="people"]',
      ".view-team .page-heading",
      ".view-team .info-note",
    ],
  },
  {
    id: "team-roles",
    page: "team",
    title: "Give each teammate the right access",
    body: "Viewers read available work. Editors create and change work. Admins also manage project permissions and invite or manage Editors and Viewers. The Owner can appoint Admins, rename or replace the workspace, and transfer ownership. Change a member's role in Teams & workspaces and choose Save role.",
    tip: "Existing team members become Editors. A task assignment label does not grant access. Viewers can still follow items, read activity, and manage their own notifications and work rooms.",
    anchors: [
      '[data-tour="team-roles"]',
      ".account-members-panel",
      '[data-tour="nav-team"]',
    ],
  },
  {
    id: "project-permissions",
    page: "projects",
    title: "Choose who can open a project",
    body: "In a team project's home, an Owner or Admin can open Project access. Keep Shared with the team, or choose Only selected members and assign Viewer or Editor access. Owners and Admins always retain access. A workspace Viewer cannot gain editing access through a project.",
    tip: "Tasks, notes, canvases, boards, and project uploads follow the project's access. Unavailable items and their structured links are hidden. Changing an item between projects requires editing access to both. Text already written into another visible item is still that item's content.",
    anchors: [
      '[data-tour="project-permissions"]',
      '[data-tour="project-home"]',
      ".projects-grid",
    ],
  },
  {
    id: "ownership-transfer",
    page: "team",
    title: "Hand over ownership with a clear result",
    body: "The current Owner can choose Make owner beside an accepted team member. Review the confirmation before transferring. The selected member becomes Owner, and the former Owner remains an Admin. Personal workspaces cannot be transferred.",
    tip: "Only the new Owner can transfer ownership again. Owners must transfer ownership before leaving their team. This does not move projects between workspaces.",
    anchors: [
      '[data-tour="ownership-transfer"]',
      '[data-tour="team-roles"]',
      ".account-team-page",
    ],
  },
  {
    id: "activity-history",
    page: "activity",
    title: "See what changed and who changed it",
    body: "Activity lists creations, updates, deletions, restores, and access changes in the active workspace. Use the project filter to focus the feed, Refresh for recent entries, or Load older activity for more history. Open an available linked item from its entry.",
    tip: "Activity records names and changed field labels, not copies of every edit. Ordinary text autosaves are summarized; note version history remains separate. The feed follows your current access, including older entries.",
    anchors: ['[data-tour="activity-history"]', '[data-tour="nav-activity"]'],
  },
  {
    id: "mentions",
    page: "notes",
    title: "Bring a teammate into the conversation",
    body: "Write @username in note Markdown, a task description, or discussion to mention a registered workspace member. A newly introduced mention creates an in-app notification if that person can open the item. Use the registered username rather than a planning label.",
    tip: "Keeping the same mention does not repeatedly notify someone. Email addresses, escaped handles, and code examples do not send mentions. Imports do not send a batch of mention alerts.",
    anchors: [
      '[data-tour="mentions"]',
      '[data-tour="note-editor"]',
      ".note-workspace",
    ],
  },
  {
    id: "watchers",
    page: "projects",
    title: "Follow work you want to keep up with",
    body: "Choose Watch on a task, note, or project to receive updates in your inbox. Watching a project includes changes to its work. Choose Watching to stop. This preference belongs to your account and does not change anyone else's subscription.",
    tip: "You receive updates from other people. Watched changes are grouped to keep the inbox useful. Deleted items stop being followed; restoring one does not subscribe you again. Following requires a signed-in account.",
    anchors: [
      '[data-tour="watchers"]',
      '[data-tour="project-home"]',
      ".projects-grid",
    ],
  },
  {
    id: "notifications",
    page: "overview",
    title: "Keep mentions and followed updates together",
    body: "Open Notifications in the header to see mentions and changes to watched work. Switch between unread and recent notifications, open an available item, mark an entry read, or mark all read. Your inbox follows the active workspace and current project access.",
    tip: "Notifications are in-app; no email, push, or operating-system delivery is configured. Guest mode has activity but no personal inbox. Task reminders remain available through their separate bell control.",
    anchors: ['[data-tour="notifications"]', ".topbar-actions"],
  },
  {
    id: "live-updates",
    page: "overview",
    title: "Keep shared work current",
    body: "Live updates checks for workspace and permission changes while the app is open. Other people's saved changes appear automatically. Connecting and Reconnecting explain the local connection state; returning to the app refreshes the current view.",
    tip: "If the connection drops, keep useful drafts until they save or download a recovery copy. Local-only operation still requires this PC's server; these tools do not publish the app.",
    anchors: ['[data-tour="live-updates"]', ".topbar-actions"],
  },
  {
    id: "search",
    page: "overview",
    title: "Jump to anything",
    body: "Search finds tasks, notes, projects, and tools across the workspace. Open it with Ctrl K (⌘ K on Mac), then select a result. Type a tool name such as Collections or Work rooms to go there directly. Quick actions create a task when you have access, open today’s planner, or open guides.",
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
    tip: "Settings groups Workspace, Appearance & workflow, Data & offline, and People & access. Open a group only when needed. Preferences and appearance are saved in this browser.",
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
    body: "In Workspace settings → Data & offline, Storage & recovery reports the active workspace allowance, archived history, and attachment problems. Workspace records exports visible records or imports a replacement after confirmation, resetting relationship review markers. New imported ideas start without votes; matching ideas retain current trusted votes. JSON excludes personal rooms, archived versions, and uploaded files.",
    tip: "Finish pending saves first. Complete backups need .wrangler/state and the matching .dev.vars file while the app is stopped. Browser drafts stay separate; download conflicted text you need to keep.",
    anchors: [
      '[data-tour="storage-health"]',
      '[data-tour="backups"]',
      ".settings-data-actions",
    ],
  },
  {
    id: "install-app",
    page: "settings",
    title: "Keep ProjectAnvil within reach",
    body: "Open Workspace settings → Data & offline to install ProjectAnvil in a supported browser, or use the browser's install or Add to Home Screen command. The normal local launcher prepares the built app and its public application files for offline reopening. Installation keeps the same local server and workspace storage.",
    tip: "Use Check for updates when needed. Finish saving and close other ProjectAnvil windows before restarting to update. Development previews do not install an offline service worker.",
    anchors: ['[data-tour="install-app"]', ".settings-page .page-heading"],
  },
  {
    id: "offline-workspace",
    page: "settings",
    title: "Choose what stays on this device",
    body: "In Workspace settings → Data & offline, Save workspace offline keeps a private copy of the records currently available to this account. Open that saved workspace while disconnected to keep planning and writing. Offline copies are separate for each account and workspace; no offline registration or password sign-in is provided.",
    tip: "Use a trusted device. Access changes can only be checked after reconnecting. Open Storage and privacy for persistent storage options. Browser storage can be cleared or evicted, so keep regular backups.",
    anchors: [
      '[data-tour="offline-workspace"]',
      ".settings-page .page-heading",
    ],
  },
  {
    id: "offline-attachments",
    page: "settings",
    title: "Bring reference files with you",
    body: "In Workspace settings → Data & offline, save the workspace, then choose Save attachments offline to download its available local files. Progress and saved-file counts are shown, and Stop downloads keeps files already downloaded. Notes and canvases use these private copies while disconnected; unavailable files explain that a connection is needed.",
    tip: "Remote webpages and external files remain online. New uploads and recordings need the local server. Remove an offline copy to remove its cached attachments from this device.",
    anchors: [
      '[data-tour="offline-attachments"]',
      '[data-tour="offline-workspace"]',
    ],
  },
  {
    id: "offline-sync",
    page: "overview",
    title: "Keep working through an interruption",
    body: "With an offline copy enabled, task, note, and planning edits are kept in an ordered queue on this device. On device means the change is durable here and still needs synchronization. Reconnecting checks current access and retries the original changes without silently replacing a teammate's conflicting edit.",
    tip: "The status banner shows queued work. Synchronize now is also in Workspace settings → Data & offline. Recurring follow-up tasks and server history are created after synchronization; account changes, imports, and Trash restore need a connection.",
    anchors: ['[data-tour="offline-sync"]', '[data-tour="workspace-content"]'],
  },
  {
    id: "sync-conflicts",
    page: "overview",
    title: "Resolve a conflict with both versions visible",
    body: "Open Review changes to compare queued values with the last confirmed record. Apply reviewed changes only after checking both versions; a newer change asks you to review again. You can also download recovery copies or discard a pending save. Restricted work stays protected when access is checked again.",
    tip: "Undo cancels a queued deletion that was never sent. If a deletion's server outcome is uncertain, reconnect before restoring it. Separate editor recovery drafts are retained until you save or explicitly discard them.",
    anchors: [
      '[data-tour="sync-conflicts"]',
      '[data-tour="offline-sync"]',
      '[data-tour="workspace-content"]',
    ],
  },
  {
    id: "markdown-export",
    page: "settings",
    title: "Take your notes as ordinary files",
    body: "In Workspace settings → Data & offline, Markdown folders exports the notes visible in the selected scope as a ZIP containing folders, Markdown files, and available attachments. Relative links keep local references portable. Note properties and a ProjectAnvil manifest support richer round trips; inaccessible work is excluded.",
    tip: "This is note portability. Keep JSON exports and complete local backups for the rest of your workspace, account, history, and collaboration records.",
    anchors: ['[data-tour="markdown-folders"]', ".settings-page .page-heading"],
  },
  {
    id: "markdown-import",
    page: "settings",
    title: "Review a folder before bringing it in",
    body: "In Workspace settings → Data & offline, choose a Markdown folder or ZIP, inspect the notes, attachments, and warnings, then select a project you can edit. Import adds fresh notes and files with safe names; it does not replace existing records. Links between imported notes and their attachments are adapted for this workspace.",
    tip: "A connection is required. Oversized archives, unsafe paths, and unsupported content are reported before import. The same import attempt can be retried safely if its response is interrupted.",
    anchors: ['[data-tour="markdown-folders"]', ".settings-page .page-heading"],
  },
  {
    id: "appearance",
    page: "overview",
    title: "A familiar place to return",
    body: "The appearance button offers Light, Dark, Warp, Focus, and Soft. Warp is the original violet look; Focus mixes light surfaces with dark framing; Soft uses gentle pink and mauve pastels. The guide button starts the eight-step Quick start; All guides lets you find a focused topic whenever you need help.",
    tip: "Use arrow keys and Home/End to choose an appearance; Escape closes the menu and returns focus. Next steps: create a project, write an idea, then make your first task.",
    anchors: [
      '[data-tour="tour-button"]',
      '[data-tour="appearance"]',
      ".appearance-menu",
    ],
  },
];

export interface Guide {
  id: string;
  title: string;
  description: string;
  steps: TourStep[];
}

const featureSteps = new Map(tourSteps.map((step) => [step.id, step]));
function steps(ids: string[]): TourStep[] {
  return ids.map((id) => {
    const step = featureSteps.get(id);
    if (!step) throw new Error(`Unknown guide topic: ${id}`);
    return step;
  });
}

/** A short first journey; detailed feature help remains available by topic. */
export const quickStartGuide: Guide = {
  id: "quick-start",
  title: "Quick start",
  description: "Learn the essentials in eight short steps.",
  steps: [
    {
      id: "quick-workspace",
      page: "overview",
      title: "Start with what matters today",
      body: "Overview brings project progress, upcoming tasks, and recent notes together. Your workspace menu keeps guest, personal, and team work separate.",
      tip: "The sidebar groups planning and ideas. More tools holds work rooms, collections, and activity whenever you need them.",
      anchors: ['[data-tour="overview"]', ".view-overview .page-heading"],
    },
    {
      id: "quick-project",
      page: "projects",
      title: "Give related work a project",
      body: "Create a project for a goal or shared plan. Its home brings tasks, notes, canvases, milestones, and files together.",
      tip: "Select a project in the sidebar to filter your work. Clear project filter returns to the whole workspace.",
      anchors: [
        '[data-tour="new-project"]',
        ".projects-grid",
        '[data-tour="nav-projects"]',
      ],
    },
    {
      id: "quick-task",
      page: "tasks",
      title: "Capture a clear next step",
      body: "Create task starts with a title, status, priority, person, project, and optional dates. Add a description and checklist in Details. More planning options holds hierarchy, effort, type, tags, repeat, and reminders when needed.",
      tip: "Save confirms your changes. Closing an unfinished task keeps its recoverable draft in this browser.",
      anchors: ['[data-tour="new-task"]', ".view-tasks .page-heading"],
    },
    {
      id: "quick-task-view",
      page: "tasks",
      title: "See only the work you need",
      body: "Switch between the board, list, and timeline. Filter by person, status, priority, or dates, then save a useful view. My work brings your assignments together.",
      tip: "Clear filters widens your view again. Advanced task tools remain available when your plan needs them.",
      anchors: [
        ".task-view-toolbar",
        ".task-filters",
        ".view-tasks .page-heading",
      ],
    },
    {
      id: "quick-note",
      page: "notes",
      title: "Keep ideas and references nearby",
      body: "Write a note from scratch or use a starting template for projects, everyday plans, fitness, learning, or worldbuilding. Link notes with [[a note title]].",
      tip: "Browse finds notes on a phone. Open Details when you need properties, backlinks, or related work; Clear note filters resets just the note list.",
      anchors: [".note-browser-title", ".knowledge-empty", ".note-workspace"],
    },
    {
      id: "quick-linked-task",
      page: "notes",
      title: "Turn an idea into action",
      body: "Select note text or a checklist item and choose Create linked task. Review the task before saving; it keeps a source link back to the idea.",
      tip: "Linked task progress stays beside the note, so planning and doing remain connected.",
      anchors: [
        '[data-tour="note-to-task"]',
        ".note-workspace",
        ".knowledge-empty",
      ],
    },
    {
      id: "quick-visual",
      page: "canvas",
      title: "Make room to think visually",
      body: "Canvas arranges notes, tasks, files, and ideas on an open surface. Use Brainstorming to gather ideas and Relationship graph to explore connections and their impact.",
      tip: "Collections and work rooms are in More tools. Explore their focused guides when you need a structured view or a place to resume work.",
      anchors: [
        '[data-tour="canvas"]',
        ".canvas-toolbar",
        '[data-tour="nav-canvas"]',
      ],
    },
    {
      id: "quick-find-help",
      page: "overview",
      title: "Find your way back, anytime",
      body: "Search finds notes, tasks, projects, and tools across the workspace. Choose Light, Dark, Warp, Focus, or Soft from Appearance. The guide button always brings help back.",
      tip: "All guides offers focused help for each area, including teamwork, offline copies, recovery, and portability. You can leave a guide at any time.",
      anchors: [
        '[data-tour="tour-button"]',
        '[data-tour="appearance"]',
        '[data-tour="search"]',
      ],
    },
  ],
};

/** Each detailed explanation belongs to one topic, avoiding a single long tour. */
export const topicGuides: Guide[] = [
  {
    id: "workspace",
    title: "Workspace & recovery",
    description:
      "Find your work, adjust preferences, and recover deleted items.",
    steps: steps([
      "welcome",
      "my-work",
      "search",
      "preferences",
      "appearance",
      "trash",
    ]),
  },
  {
    id: "projects",
    title: "Projects & work rooms",
    description:
      "Bring a project together, plan milestones, and resume with context.",
    steps: steps([
      "projects",
      "project-home",
      "milestones",
      "work-rooms",
      "room-checkpoint",
    ]),
  },
  {
    id: "tasks",
    title: "Tasks & planning",
    description:
      "Task details, dates, routines, filters, saved views, and bulk changes.",
    steps: steps([
      "new-task",
      "task-hierarchy",
      "bulk-edit",
      "recurrence",
      "reminders",
      "duplicate-task",
      "task-layouts",
      "task-filters",
      "saved-views",
    ]),
  },
  {
    id: "notes",
    title: "Notes & daily planning",
    description:
      "Write, connect, organize, reuse, and turn note content into tasks.",
    steps: steps([
      "knowledge",
      "markdown",
      "note-to-task",
      "linked-task-progress",
      "note-links",
      "note-organize",
      "personal-templates",
      "media",
      "note-tools",
      "daily",
    ]),
  },
  {
    id: "structured-notes",
    title: "Structured notes",
    description: "Custom note types, decision records, and useful collections.",
    steps: steps(["custom-note-types", "decision-records", "collections"]),
  },
  {
    id: "visual-thinking",
    title: "Visual thinking",
    description:
      "Connections, change impact, canvas, brainstorming, and voting.",
    steps: steps([
      "graph",
      "meaningful-relationships",
      "relationship-presets",
      "change-impact",
      "canvas",
      "brainstorming",
      "brainstorm-voting",
    ]),
  },
  {
    id: "teamwork",
    title: "Teamwork",
    description:
      "Roles, project access, shared writing, mentions, and updates.",
    steps: steps([
      "people",
      "team-roles",
      "project-permissions",
      "ownership-transfer",
      "activity-history",
      "mentions",
      "watchers",
      "notifications",
      "live-updates",
      "simultaneous-editing",
    ]),
  },
  {
    id: "offline",
    title: "Offline work & backups",
    description:
      "Install the app, save device copies, synchronize, and protect work.",
    steps: steps([
      "install-app",
      "offline-workspace",
      "offline-attachments",
      "offline-sync",
      "sync-conflicts",
      "backups",
    ]),
  },
  {
    id: "portability",
    title: "Markdown portability",
    description:
      "Export notes and files, or review and import a Markdown folder.",
    steps: steps(["markdown-export", "markdown-import"]),
  },
];

export const guideCatalog: Guide[] = [quickStartGuide, ...topicGuides];

export function findGuides(query: string): Guide[] {
  const search = query.trim().toLowerCase();
  if (!search) return guideCatalog;
  return guideCatalog.filter((guide) =>
    `${guide.title} ${guide.description} ${guide.steps.map((step) => `${step.title} ${step.body} ${step.tip || ""}`).join(" ")}`
      .toLowerCase()
      .includes(search),
  );
}
