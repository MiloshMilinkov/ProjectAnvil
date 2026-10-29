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
    title: "Overview",
    body: "Overview shows project progress, upcoming tasks, and recent notes. Create a task, open a project, or resume a work room.",
    tip: "More tools contains work rooms, collections, and activity. If a screen cannot open, reconnect and choose Retry opening; your workspace stays open. Reload app checks unfinished work before restarting.",
    anchors: [
      '[data-tour="overview"]',
      ".view-overview .page-heading",
      ".view-overview .stat-grid",
    ],
  },
  {
    id: "projects",
    page: "projects",
    title: "Create a project",
    body: "Create a project for a goal or shared plan. Add a description, goal, color, and target date, then organize its tasks and notes.",
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
    title: "Project home",
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
    title: "Milestones",
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
    title: "Create a task",
    body: "Enter a title, status, priority, assignee, and project. Dates holds the planned start and due date. Details contains the description and checklist; More planning options contains parent tasks, effort, type, tags, recurrence, and reminders. Connections links related work; Discussion holds comments.",
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
    title: "Parent and child tasks",
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
    title: "Bulk editing",
    body: "Filter Tasks, then open Bulk edit. Select up to 100 tasks and choose only the fields to change: status, priority, person, project, milestone, or dates. Keep existing leaves a field alone; blank enabled dates clear it.",
    tip: "Each task saves independently. Review saved, failed, and unprocessed results, retry remaining work, or open a task to resolve a conflict. Closing keeps the form and pending saves on this device. Moving projects clears the moved task's parent and milestone.",
    anchors: ['[data-tour="bulk-edit"]', ".task-view-toolbar"],
  },
  {
    id: "recurrence",
    page: "tasks",
    title: "Recurring tasks",
    body: "Open More planning options in a task and choose a daily, weekly, or monthly repeat. Set its interval, Schedule start, time zone, and optional end date. Completing the task creates the next occurrence with a new checklist and dates.",
    tip: "Missed dates are skipped. Shorter months use their last day, then return to the original day when possible. Completing the same occurrence again creates no duplicate. Tasks with children cannot repeat. Disable recurrence on the current open task to stop it.",
    anchors: [
      '[data-tour="recurrence"]',
      '[data-tour="new-task"]',
      ".view-tasks .page-heading",
    ],
  },
  {
    id: "reminders",
    page: "tasks",
    title: "Task reminders",
    body: "Set a reminder date, time, and time zone under More planning options. The reminder bell shows due reminders for your assigned tasks and unassigned work. Open a task, snooze it for an hour, or dismiss the reminder.",
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
    title: "Duplicate a task",
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
    title: "Personal templates",
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
    title: "Board, list, and timeline",
    body: "Board organizes tasks into status columns; drag a card to move work forward. List shows assignments and schedules together. Timeline draws planned start through due date as a range, or a marker when only one date is known. Choose Window starts, previous/next 28 days, or Today to explore the schedule.",
    tip: "Phones start with a readable List. Lists show 50 tasks per page; use Previous and Next for more. Board starts with 40 cards per status; Show more reveals the rest. Filters, totals, and bulk editing include all matches. Use the status field as an alternative to dragging.",
    anchors: ['[data-tour="task-layouts"]', ".task-view-toolbar .view-tabs"],
  },
  {
    id: "task-filters",
    page: "tasks",
    title: "Filters and dates",
    body: "Filter tasks by text, project, person, priority, status, or dates. Dates finds due today, overdue, due in the next seven days, starts today or soon, and missing dates. Sort by priority, due date, planned start, or recent changes.",
    tip: "Next seven days includes today and six more local calendar days. Overdue excludes completed tasks. Date sorting puts undated tasks last; recently updated puts the newest changes first. Clear filters keeps your chosen sort.",
    anchors: ['[data-tour="task-filters"]', ".view-tasks .filters"],
  },
  {
    id: "saved-views",
    page: "tasks",
    title: "Saved views",
    body: "Save current view remembers filters, sorting, and the Board, List, or Timeline layout. Choose a saved view to reopen it. Modified shows when your current settings differ; Update view replaces its saved settings, while Rename changes its name.",
    tip: "Views are shared in the current workspace. My work always keeps its assignment scope. Move an unwanted view to Trash; Undo or Trash can restore it.",
    anchors: ['[data-tour="saved-views"]', ".task-view-toolbar"],
  },
  {
    id: "trash",
    page: "overview",
    title: "Trash and Undo",
    body: "Move a task, note, project, assignment label, relationship, or saved view to Trash. The notification offers Undo; the sidebar's Trash opens older recovery copies with their deletion time and a Restore action.",
    tip: "Restoration recovers available links while preserving newer edits. Review any listed connections that could not be restored. Trash has no automatic expiry; replacing a workspace by import makes older copies unavailable to restore. Complete local backups include Trash; workspace JSON does not.",
    anchors: ['[data-tour="trash"]', '[data-tour="nav-settings"]'],
  },
  {
    id: "my-work",
    page: "my-work",
    title: "My work",
    body: "When signed in, My work shows tasks assigned to your account in the current workspace. In guest mode it shows unassigned work. Use the task filters to explore assignments, status, and priority.",
    tip: "Only accepted team members get access. Assigning a task does not share a workspace.",
    anchors: ['[data-tour="my-work"]', ".view-my-work .page-heading"],
  },
  {
    id: "work-rooms",
    page: "rooms",
    title: "Work rooms",
    body: "Save a project, focus task, pinned notes, canvas, and view as a work room. Create a room from your current work or choose what to include.",
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
    title: "Checkpoints",
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
    title: "Notes",
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
    title: "Markdown",
    body: "Use headings, lists, checkboxes, tables, quotes, highlights, footnotes, code, equations, and Mermaid diagrams. Write, Split, and Read change the view. Formatting loads as needed. If it fails, the source remains readable; reconnect or reopen the note to retry.",
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
    title: "Shared note editing",
    body: "Open a note and choose Edit together. Shared text edits merge as people write. Here now shows active participants. The title, project, and properties save separately and may need review if two people change the same field.",
    tip: "Shared editing is optional. Replacing text through the ordinary editor, import, or history ends the current shared session. Download unfinished text before loading a replacement. Interrupted edits stay in this browser for the same account and workspace.",
    anchors: [
      '[data-tour="simultaneous-editing"]',
      ".note-editor-toolbar",
      ".note-workspace",
    ],
  },
  {
    id: "note-to-task",
    page: "notes",
    title: "Create tasks from notes",
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
    title: "Linked tasks",
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
    title: "Note links and embeds",
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
    title: "Organizing notes",
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
    title: "Custom note types",
    body: "Open Manage note types to create a reusable structure for this workspace. Add named text, number, date, checkbox, or choice fields. Assign a type in a note's details, then fill its structured properties. Required fields guide completeness while unfinished notes can still save.",
    tip: "Renaming a field keeps its values. Archive a type to hide it from new notes without losing existing values. Collections can filter, sort, group, and summarize these fields; open a field to edit it in the note.",
    anchors: [
      '[data-tour="custom-note-types"]',
      ".note-details",
      ".note-workspace",
    ],
  },
  {
    id: "decision-records",
    page: "notes",
    title: "Decision records",
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
    title: "Attachments and audio",
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
    title: "Note tools",
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
    title: "Relationship graph",
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
    title: "Relationships",
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
    title: "Relationship presets",
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
    title: "Reviewing changes",
    body: "When a relevant source changes, rings distinguish the changed source, direct impact, and downstream impact. The review list explains which relationships need attention. Check the connected work, then Mark reviewed to accept the current source content for that workspace.",
    tip: "Highlighting shows possible effects of a change. Check the linked work before marking it reviewed. If the source changes again during review, refresh and check the new version.",
    anchors: ['[data-tour="impact-review"]', '[data-tour="graph-impact"]'],
  },
  {
    id: "canvas",
    page: "canvas",
    title: "Canvas",
    body: "Arrange notes, tasks, text cards, uploaded media, and web references as cards. Move and resize them, connect them with arrows, and label the relationships. Assign a canvas to a project using its Project control, or attach and open it from the project home.",
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
    title: "Brainstorming",
    body: "Create a brainstorming board for a project or the whole workspace. Add ideas with a title and description, arrange them into named groups, and link existing notes or tasks. Edit the board to rename groups or move ideas using ordinary controls.",
    tip: "Board edits have browser drafts and conflict checks. Removing a group keeps its ideas ungrouped. A board moved to Trash can be restored with available links.",
    anchors: ['[data-tour="brainstorming"]', '[data-tour="nav-brainstorm"]'],
  },
  {
    id: "brainstorm-voting",
    page: "brainstorm",
    title: "Voting",
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
    title: "Collections",
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
    title: "Daily notes",
    body: "Daily notes opens a dated journal for plans, a log, and reflection. These entries remain searchable and can link to your other notes.",
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
    title: "Accounts and teams",
    body: "Register with an email address, username, and a ProjectAnvil password. Your personal workspace is private. Create a team workspace, invite registered usernames with an access role, and let them accept. Team projects and their connected content follow workspace roles and project permissions. Account and workspace menus support arrow keys; Escape closes the menu and returns focus.",
    tip: "Account menu → Account security manages email verification, password changes, and sessions. Sign in also offers Forgot password? and Verify email. Local recovery links stay on this PC; see the setup guide. Online access needs an approved, verified account. Choose a team workspace before creating shared projects.",
    anchors: [
      '[data-tour="people"]',
      ".view-team .page-heading",
      ".view-team .info-note",
    ],
  },
  {
    id: "team-roles",
    page: "team",
    title: "Team roles",
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
    title: "Project permissions",
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
    title: "Transfer ownership",
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
    title: "Activity history",
    body: "Activity lists creations, updates, deletions, restores, and access changes in the active workspace. Use the project filter to focus the feed, Refresh for recent entries, or Load older activity for more history. Open an available linked item from its entry.",
    tip: "Activity records names and changed field labels, not copies of every edit. Ordinary text autosaves are summarized; note version history remains separate. The feed follows your current access, including older entries.",
    anchors: ['[data-tour="activity-history"]', '[data-tour="nav-activity"]'],
  },
  {
    id: "mentions",
    page: "notes",
    title: "Mentions",
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
    title: "Watch items",
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
    title: "Notifications",
    body: "Open Notifications in the header to see mentions and changes to watched work. Switch between unread and recent notifications, open an available item, mark an entry read, or mark all read. Your inbox follows the active workspace and current project access.",
    tip: "Notifications are in-app; no email, push, or operating-system delivery is configured. Guest mode has activity but no personal inbox. Task reminders remain available through their separate bell control.",
    anchors: ['[data-tour="notifications"]', ".topbar-actions"],
  },
  {
    id: "live-updates",
    page: "overview",
    title: "Live updates",
    body: "Live updates checks for workspace and permission changes while the app is open. Other people's saved changes appear automatically. Connecting and Reconnecting explain the local connection state; returning to the app refreshes the current view.",
    tip: "If the connection drops, keep useful drafts until they save or download a recovery copy. Local-only operation still requires this PC's server; these tools do not publish the app.",
    anchors: ['[data-tour="live-updates"]', ".topbar-actions"],
  },
  {
    id: "search",
    page: "overview",
    title: "Workspace search",
    body: "Search tasks, notes, projects, and tools with Ctrl K (⌘ K on Mac). Open a result or type a tool name such as Collections or Work rooms. Quick actions create a task, open today's note, or open guides.",
    tip: "On a phone, open navigation to find Search workspace.",
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
    title: "Workspace settings",
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
    title: "Exports and backups",
    body: "In Workspace settings → Data & offline, Storage & recovery reports the active workspace allowance, archived history, and attachment problems. Workspace records exports visible records or imports a replacement after confirmation, resetting relationship review markers. New imported ideas start without votes; matching ideas retain current trusted votes. JSON excludes personal rooms, archived versions, and uploaded files.",
    tip: "Owners and admins can open Clean up storage, choose unused uploads, Trash, or older note versions, and review items older than 30 days, 90 days, or a year. Removal is permanent, with no Undo. Current files, referenced attachments, and each note's newest saved version are kept. Finish pending saves and keep a complete backup first; browser drafts are separate.",
    anchors: [
      '[data-tour="storage-health"]',
      '[data-tour="backups"]',
      ".settings-data-actions",
    ],
  },
  {
    id: "install-app",
    page: "settings",
    title: "Install ProjectAnvil",
    body: "Open Workspace settings → Data & offline to install ProjectAnvil in a supported browser, or use the browser's install or Add to Home Screen command. The normal local launcher prepares the built app and its public application files for offline reopening. Installation keeps the same local server and workspace storage.",
    tip: "Use Check for updates when needed. Finish saving and close other ProjectAnvil windows before restarting to update. Development previews do not install an offline service worker.",
    anchors: ['[data-tour="install-app"]', ".settings-page .page-heading"],
  },
  {
    id: "offline-workspace",
    page: "settings",
    title: "Offline workspaces",
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
    title: "Offline attachments",
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
    title: "Offline changes",
    body: "With an offline copy enabled, task, note, and planning edits are kept in an ordered queue on this device. On device means the change is durable here and still needs synchronization. Reconnecting checks current access and retries the original changes without silently replacing a teammate's conflicting edit.",
    tip: "The status banner shows queued work. Synchronize now is also in Workspace settings → Data & offline. Recurring follow-up tasks and server history are created after synchronization; account changes, imports, and Trash restore need a connection.",
    anchors: ['[data-tour="offline-sync"]', '[data-tour="workspace-content"]'],
  },
  {
    id: "sync-conflicts",
    page: "overview",
    title: "Sync conflicts",
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
    title: "Export Markdown",
    body: "In Workspace settings → Data & offline, Markdown folders exports the notes visible in the selected scope as a ZIP containing folders, Markdown files, and available attachments. Relative links keep local references portable. Note properties and a ProjectAnvil manifest support richer round trips; inaccessible work is excluded.",
    tip: "This is note portability. Keep JSON exports and complete local backups for the rest of your workspace, account, history, and collaboration records.",
    anchors: ['[data-tour="markdown-folders"]', ".settings-page .page-heading"],
  },
  {
    id: "markdown-import",
    page: "settings",
    title: "Import Markdown",
    body: "In Workspace settings → Data & offline, choose a Markdown folder or ZIP, inspect the notes, attachments, and warnings, then select a project you can edit. Import adds fresh notes and files with safe names; it does not replace existing records. Links between imported notes and their attachments are adapted for this workspace.",
    tip: "A connection is required. Oversized archives, unsafe paths, and unsupported content are reported before import. The same import attempt can be retried safely if its response is interrupted.",
    anchors: ['[data-tour="markdown-folders"]', ".settings-page .page-heading"],
  },
  {
    id: "appearance",
    page: "overview",
    title: "Themes and guides",
    body: "Choose Light, Dark, Warp, Focus, or Soft from Appearance. The guide button opens the eight-step Quick start. All guides contains help for specific tools.",
    tip: "Use arrow keys and Home/End to choose a theme. Escape closes the menu and returns focus.",
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
      title: "Your workspace",
      body: "Overview shows project progress, upcoming tasks, and recent notes. Switch between guest, personal, and team workspaces using the workspace menu.",
      tip: "Use the sidebar to navigate. Work rooms, collections, and activity are under More tools.",
      anchors: ['[data-tour="overview"]', ".view-overview .page-heading"],
    },
    {
      id: "quick-project",
      page: "projects",
      title: "Create a project",
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
      title: "Create a task",
      body: "Create task starts with a title, status, priority, person, project, and optional dates. Add a description and checklist in Details. More planning options holds hierarchy, effort, type, tags, repeat, and reminders when needed.",
      tip: "Save confirms your changes. Closing an unfinished task keeps its recoverable draft in this browser.",
      anchors: ['[data-tour="new-task"]', ".view-tasks .page-heading"],
    },
    {
      id: "quick-task-view",
      page: "tasks",
      title: "Choose a task view",
      body: "Switch between the board, list, and timeline. Filter by person, status, priority, or dates, then save a useful view. My work brings your assignments together.",
      tip: "Clear filters resets the task filters without changing your sort order.",
      anchors: [
        ".task-view-toolbar",
        ".task-filters",
        ".view-tasks .page-heading",
      ],
    },
    {
      id: "quick-note",
      page: "notes",
      title: "Write a note",
      body: "Write a note from scratch or use a starting template for projects, everyday plans, fitness, learning, or worldbuilding. Link notes with [[a note title]].",
      tip: "Browse finds notes on a phone. Open Details when you need properties, backlinks, or related work; Clear note filters resets just the note list.",
      anchors: [".note-browser-title", ".knowledge-empty", ".note-workspace"],
    },
    {
      id: "quick-linked-task",
      page: "notes",
      title: "Create a linked task",
      body: "Select note text or a checklist item and choose Create linked task. Review the task before saving; it keeps a source link back to the idea.",
      tip: "Linked tasks appear beside the note with their current status.",
      anchors: [
        '[data-tour="note-to-task"]',
        ".note-workspace",
        ".knowledge-empty",
      ],
    },
    {
      id: "quick-visual",
      page: "canvas",
      title: "Visual tools",
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
      title: "Search and help",
      body: "Search finds notes, tasks, projects, and tools across the workspace. Choose Light, Dark, Warp, Focus, or Soft from Appearance. The guide button always brings help back.",
      tip: "All guides covers teamwork, offline copies, recovery, and imports. You can close a guide at any time.",
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
    title: "Create a project",
    description: "Projects, milestones, work rooms, and checkpoints.",
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
    title: "Notes & templates",
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
    description: "Note types, decision records, and collections.",
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
