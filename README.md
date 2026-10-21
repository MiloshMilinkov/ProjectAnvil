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
| **Projects & tasks** | Set project goals and target dates; create tasks, stories, bugs, and epics with assignees, priorities, statuses, due dates, effort estimates, tags, subtasks, dependencies, and discussions. |
| **Dashboards & planning views** | Follow progress from Overview and My work. Switch between task boards, lists, and timelines; filter by project, person, priority, or status and save useful views. |
| **Markdown notes** | Write with headings, checklists, tables, quotes, highlights, footnotes, and formatted code. Preview mathematical equations and Mermaid diagrams. |
| **Connected knowledge** | Link notes, headings, and blocks with `[[links]]`; embed their content and follow backlinks. Organize with folders, tags, bookmarks, projects, and custom properties. |
| **Relationship graph** | Explore global and local connections, search and filter nodes, adjust connection depth, and pan, zoom, or arrange the graph. Add meaningful relationships and review change impact. |
| **Visual canvases** | Arrange notes, tasks, text, images, PDFs, media, and web references on separate canvases. Move and resize cards, connect them with labeled arrows, and pan or zoom. |
| **Structured collections** | Browse notes as tables, lists, galleries, or Kanban boards. Filter, sort, group, rearrange columns, edit properties, and calculate counts, sums, and averages. |
| **Daily planning & templates** | Use dated journals and reusable starting points for projects, research, creative work, fitness, and everyday routines. |
| **Media & note history** | Upload images, PDFs, audio, and video; record audio in supported browsers. Autosave notes, restore recent versions, and export individual notes as Markdown. |
| **Personal & team workspaces** | Work as a guest, register an account, or join a team. Keep personal work private and share a team's projects, tasks, notes, canvases, and attachments with accepted members. |
| **Workspace tools** | Search across tasks, notes, and projects. Write beside a preview, extract or combine notes, present basic slides, open notes in another window, and use focus mode. |
| **Appearance & onboarding** | Choose Light, Dark, Warp, Focus, or Soft. Adjust spacing, save a startup view, customize the new-task shortcut, and replay the 27-step guided tour. Layouts adapt to desktop and mobile screens. |
| **Portable records** | Export and import workspace JSON. Preserve accounts, attachments, personal work rooms, and review state with a complete local backup. |

## Templates

**14 starting points**, searchable by category:

| Work & learning | Everyday & wellbeing | Creative & reference |
| --- | --- | --- |
| Project brief · Weekly plan · Study notes · Meeting | Daily journal · Habit tracker · Workout log · Meal plan · Personal budget · Trip planner | Worldbuilding · Character · Research · Blank note |

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
- Open tabs refresh about every ten seconds. Simultaneous text coediting, an offline editing queue, and automatic Markdown-folder sync are not implemented.
- Google sign-in, verification emails, password-reset emails, and invitation emails are not configured.
- Workspace JSON excludes personal rooms, uploaded files, and accounts. Importing resets relationship review markers against the imported content. See [backup options and storage limits](docs/LOCAL_SETUP.md#data-and-backups).

## Development

Built with **React, TypeScript, Vinext/Vite, Better Auth, and local D1/R2 emulation**.

```sh
npx tsc --noEmit
npm test
npm run build
```

Backend tests use temporary in-memory storage. Keep this README and the guided tour updated alongside user-facing feature changes; contributor instructions live in [AGENTS.md](AGENTS.md).
