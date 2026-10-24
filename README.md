<p align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="ProjectAnvil logo">
</p>

<h1 align="center">ProjectAnvil</h1>

<p align="center">
  <strong>Your ideas, plans, and progress. Connected.</strong><br>
  A browser workspace for project planning, task management, notes, and visual thinking.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#templates">Templates</a> ·
  <a href="#developer-setup">Get started</a> ·
  <a href="docs/LOCAL_SETUP.md">Setup &amp; backups</a>
</p>

---

## From an idea to the next step

- **Turn notes into work.** Create linked tasks from selected text, paragraphs, or checklist items, with duplicate detection, source quotes, and live progress beside the note.
- **Return with context.** Work rooms pin a project, focus task, notes, and canvas. Save what changed, your next step, and an open question; resume the working view and canvas position.
- **See what a change affects.** Connect items with **depends on**, **supports**, **contradicts**, or **was decided because of**. Highlight direct and downstream effects, then acknowledge reviewed connections.

## Features

| Area | What you can do |
| --- | --- |
| **Projects & tasks** | Set project goals and target dates; create tasks, stories, bugs, and epics with assignees, priorities, statuses, optional planned start and due dates, effort estimates, tags, subtasks, dependencies, and discussions. Duplicate a task into an editable copy with a fresh key and checklist; completion, assignments, dates, and discussion reset. Date ranges are checked before saving. |
| **Dashboards & planning views** | See progress, upcoming work, and recent notes in Overview. Switch between boards, lists, and timelines; filter by project, person, priority, status, or dates, and sort by priority, due date, planned start, or recent changes. Save filters, sorting, and layout together; rename or update saved views when plans change. Timeline shows real date ranges or single-date markers with a movable 28-day window. Phones start with readable task cards in List. |
| **Markdown notes** | Write with headings, checklists, tables, quotes, highlights, footnotes, and formatted code. Preview mathematical equations and Mermaid diagrams. |
| **Connected knowledge** | Link notes, headings, and blocks with `[[links]]`; embed their content and follow backlinks. Organize with folders, tags, bookmarks, projects, and custom properties. |
| **Relationship graph** | Explore global and local connections, search and filter nodes, adjust connection depth, and pan, zoom, or arrange the graph. Add meaningful relationships and review change impact. |
| **Visual canvases** | Arrange notes, tasks, text, images, PDFs, media, and web references on separate canvases. Move and resize cards, connect them with labeled arrows, and pan or zoom. |
| **Structured collections** | Browse notes as tables, lists, galleries, or Kanban boards. Filter, sort, group, rearrange columns, edit properties, and calculate counts, sums, and averages. |
| **Daily planning & templates** | Use dated journals and 14 starting points for projects, research, creative work, fitness, and everyday routines. Save personal note and task templates, reuse their editable structure, rename or update them, and restore removed templates. |
| **Media & note history** | Upload images, PDFs, audio, and video; record audio in supported browsers. Autosave notes, browse paginated version history, restore saved versions, and export individual notes as Markdown. |
| **Recovery & reliable saves** | Move deleted records to workspace Trash, use Undo, or restore later with available links. Newer edits are preserved and skipped connections are reported. Recover browser drafts, retry failed saves, and review conflicts; check workspace storage and missing attachments. |
| **Personal & team workspaces** | Work as a guest, register an account, or join a team. Keep personal work private and share a team's projects, tasks, notes, canvases, and attachments with accepted members. |
| **Workspace tools** | Search across tasks, notes, and projects. Write beside a preview, extract or combine notes, present basic slides, open notes in another window, and use focus mode. |
| **Appearance & onboarding** | Choose Light, Dark, Warp, Focus, or Soft. Readable typography, consistent controls, visible keyboard focus, and touch-friendly layouts support desktop and mobile work. Adjust spacing, save a startup view, customize the new-task shortcut, and replay the 31-step guided tour. |
| **Portable records & backups** | Export and import workspace JSON. Create and verify complete local backups of accounts, attachments, archived history, personal work rooms, and review state; restore with a rollback copy. |

## Templates

**14 starting points**, searchable by category:

| Work & learning | Everyday & wellbeing | Creative & reference |
| --- | --- | --- |
| Project brief · Weekly plan · Study notes · Meeting | Daily journal · Habit tracker · Workout log · Meal plan · Personal budget · Trip planner | Worldbuilding · Character · Research · Blank note |

**Your own library:** open **My task templates** in the task editor or **My note templates** when creating a note or from its More menu. Reuse opens an editable task or a note creation form with a suggested unique title; review it before saving. Templates keep reusable content and checklist structure, omitting assignments, schedules, project links, history, and private attachments. Your library follows your account across its workspaces; guest templates stay in a separate local library.

## Accounts and collaboration

Register with an **email address, username, and ProjectAnvil password**; sign in with your **username and password**.

Each account has a private personal workspace. Team owners invite registered users by username through the app; access begins after acceptance. All accepted members share the team's workspace. **Work rooms and checkpoints remain personal**, including inside a team workspace. Assigning a task or adding a person label does not grant access.

New workspaces start empty. Guest work stays separate from account and team workspaces.

## Developer setup

Requires **Node.js 22.13+** and npm. Clone or download the repository, open its folder, then run:

```sh
npm run install:ci
npm run dev
```

Open **http://127.0.0.1:5173**. On Windows, after installing dependencies, **Start ProjectAnvil.cmd** starts the app and opens the browser. Keep the console running; press **Ctrl+C** to stop.

**The current version runs locally on one computer.** Accounts and team workspaces do not enable remote access; mobile layouts are available when the app is served in a reachable environment. Initial dependency installation requires internet access.

For storage, backup, restore, and troubleshooting, see the [local setup guide](docs/LOCAL_SETUP.md). For publishing the source from VS Code, see [GitHub setup](GITHUB.md).

## Current limitations

- Sharing is managed per workspace; separate project permissions and transfers between workspaces are not available yet.
- Open tabs refresh about every ten seconds. Interrupted edits have browser recovery copies and manual save retries; simultaneous text coediting, background cloud sync, and automatic Markdown-folder sync are not implemented.
- Google sign-in, verification emails, password-reset emails, and invitation emails are not configured.
- Workspace JSON excludes Trash, personal templates, archived note history, personal rooms, uploaded files, and accounts. Complete backups preserve confirmed local data; unsaved browser drafts must be saved or downloaded separately. Importing resets relationship review markers and invalidates older Trash restores. Trash has no automatic expiry. See [backup options and storage limits](docs/LOCAL_SETUP.md#data-and-backups).

## Development

Built with **React, TypeScript, Vinext/Vite, Better Auth, and local D1/R2 emulation**.

Interface changes follow the [UI and UX standard](docs/UI_STANDARDS.md), including readability, navigation, accessibility, all five themes, and responsive review.

See the [agreed roadmap](docs/ROADMAP.md) for completed work, upcoming phases, and the future hosting checklist. The app remains local until online deployment is explicitly approved.

```sh
npm run check
```

