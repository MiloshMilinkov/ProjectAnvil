# Forgeboard — local workspace

A browser workspace for game development: plan tasks, build worlds, and connect the thinking behind the work. This copy runs on your PC at **http://127.0.0.1:5173**.

## Open Forgeboard

1. Open `D:\Forgeboard` in File Explorer.
2. Double-click **Start Forgeboard.cmd**.
3. Wait for your browser to open at **http://127.0.0.1:5173**. You can also type that address into your browser.
4. Keep the Forgeboard console window open while using the app.

To stop Forgeboard, save your work, wait for any saving indicator to finish, then press **Ctrl+C** in the console window. Confirm terminating the batch job if Windows asks. Closing the browser tab alone does not stop the app. Double-click the launcher again whenever you want to reopen it. It is not configured to start with Windows.

The launcher checks whether Forgeboard is already running before starting another copy. It uses a fixed port and will not stop a different application using that port.

**This address works on this PC only.** Other people and other devices cannot connect to it. You can use every feature as a guest. Add optional people labels to assign tasks, and filter assignments from the task board. No user accounts are required. You can use another browser on this PC to open the same workspace. Preferences such as appearance and tour completion are saved separately in each browser.

Installed dependencies are already present on this PC. Normal use does not need a package installation or a hosting account. Core notes, tasks, local attachments, graphs, and canvases work without an internet connection. Links and media that you point to external websites still need that website to be reachable.

## Your data and backups

The local database and uploaded attachment files are kept together under:

```text
D:\Forgeboard\.wrangler\state
```

**Do not delete `.wrangler` when cleaning or moving the project.** Do not delete or reinitialize the local database to fix a startup issue.

To make a complete backup:

1. Stop Forgeboard with Ctrl+C and wait for the server to exit.
2. Copy the entire `.wrangler\state` folder to a dated backup folder on another drive.
3. Preserve the `D:\Forgeboard` project files too if you want a ready-to-run backup, including its hidden folders. Keep the copy of `.wrangler\state` with the matching project version.

To restore a backup, first stop the app. Preserve a copy of the current state before replacing it with the backed-up `.wrangler\state` folder, then start Forgeboard again. Do not merge individual database files between backups.

You can also use **Workspace settings → Export workspace** for a readable JSON backup of notes, tasks, discussions, people, projects, and canvas layouts. **That JSON does not contain uploaded files.** A full `.wrangler\state` backup preserves the files too. Import replaces the workspace records after confirmation, so export before importing.

The former hosted app and this local copy used separate databases and attachment stores. A JSON downloaded from the hosted app is a snapshot of its records; it does not automatically transfer its attachments. Preserve downloaded original attachments as well before removing the hosted storage. Import a hosted snapshot only if you intend to replace the current local workspace.

The transition backups are kept in:

- `D:\Forgeboard\backups\online-2026-10-19`: the online workspace snapshot and downloaded media files.
- `D:\Forgeboard\backups\local-before-online-import-2026-10-19`: a copy of the earlier local state preserved before restoring online records locally.

Keep these backups. The online archive is separate from the active local database; subsequent edits do not update it.

## What you can do

- **Tasks and planning:** create projects and tasks, assign people, set priorities, statuses, due dates, estimates, tags, dependencies, subtasks, and comments. Use the board, task list, timeline, personal-work view, saved filters, and dashboard.
- **Linked knowledge:** write Markdown with headings, checklists, tables, quotes, highlights, footnotes, code, mathematical notation, and Mermaid diagrams. Organize notes by folders, tags, projects, and custom properties. Search notes and tasks, bookmark notes, and inspect backlinks.
- **Worldbuilding:** use templates for places, characters, research, meetings, and daily planning. Link with `[[Note title]]`, `[[Note title#Heading]]`, or `[[Note title#^block-id]]`. Add `^block-id` after a paragraph to name it. Embed a note, heading, or block with `![[...]]`.
- **Visual planning:** explore the graph and arrange note, task, text, media, and web-reference cards on canvases connected by labeled arrows.
- **Collections and workspace:** view notes as tables, lists, galleries, or status boards; group and summarize properties; write beside a preview; split or merge notes; open another browser window; and present notes as basic slides. Save a startup view, adjust spacing, and customize the new-task shortcut.
- **Attachments and history:** upload images, PDFs, audio, and video. Record audio with microphone permission and a supported browser. Note changes save automatically, and history can restore earlier content.

New workspaces start empty: no example projects, people, tasks, notes, saved filters, or canvases. Create only what you need. Move or delete a project's notes and tasks before deleting the project.

## Guest mode and guide

All features are available as a guest. My work shows unassigned tasks. People are optional assignment labels, not login accounts; use the task board’s person filter to view their work. Discussion updates written now appear as Guest.

The **? guide button beside the appearance button** starts a 21-step tour. It highlights each area and navigates between pages with Previous and Next. You can Skip, close with Escape, or Finish. The guide opens automatically once per browser and can be replayed at any time. It does not add notes, tasks, or other content.

## Git and VS Code

Open this folder in VS Code and use Source Control to review changes. A local checkpoint commit preserves the current source. See [GITHUB.md](GITHUB.md) for publishing it to your GitHub account. Publishing source does not host the app or upload saved workspace records. The included VS Code tasks run the app, check types, test storage, and build it.

## Appearance

Choose **Light**, **Dark**, or **Current** from the top-bar appearance icon or **Workspace settings → Appearance**. Current retains the original violet look. The preference is stored in your browser on this PC.

## Troubleshooting

- **Browser did not open:** type `http://127.0.0.1:5173` into your browser after the console reports that Forgeboard is ready.
- **Address will not load:** make sure the console is still open. Restart the launcher if it has stopped, and check its error message.
- **Port 5173 already in use:** if another Forgeboard window is starting, wait for it. Otherwise close the program using that port before retrying. The launcher never kills other programs.
- **Missing Node.js:** the launcher uses `C:\Program Files\nodejs\node.exe` and requires Node.js 22.13 or newer. Reinstalling Node does not require deleting your Forgeboard data.
- **Saving failed:** leave the tab open, read the error, and retry. Avoid closing the app until saving succeeds.
- **Database or migration error:** preserve `.wrangler\state` and ask for help. Do not blindly rerun initial migrations against an existing database.

## Current limits

- One workspace. People are assignment labels, with no separate login accounts or project permissions.
- Workspace text and metadata are limited to **1.5 MB total**. Binary uploads are separate and support **20 MB per file**.
- Notes and descriptions support up to 100,000 characters. Collection limits: 1,500 tasks, 1,000 notes, 200 people, 100 projects, 100 canvases, and 500 attachments, subject to the total text allowance.
- Note history keeps up to **12 earlier content versions**, normally spaced at least 30 seconds apart. History uses the same text allowance. Export for longer-term recovery.
- Open tabs refresh changes about every ten seconds. Coordinate when editing the same note or canvas in multiple windows.
- There is no automatic local Markdown-folder synchronization, offline editing queue, plugin marketplace, automated notification system, or simultaneous text coediting.

## Developer setup

The app uses Node.js 22.13+, React, Vinext, and local emulation of D1 and R2. Those database and file services run on this PC for this setup. Its local database is already prepared; normal use does not require building or applying migrations.

From `D:\Forgeboard` in a terminal, the manual equivalent of the launcher is:

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts\start-local.mjs
```

To start without automatically opening a browser:

```powershell
npm run dev
```

If recreating a checkout and dependencies are missing, first install them (this needs internet):

```powershell
npm run install:ci
```

Preserve `.openai/hosting.json` because it declares the local `DB` and `BUCKET` bindings. It does not publish or host the app by itself. Preserve the portable `.sites-runtime/execution-profile.json` configuration if present. Generating SQL is not the same as applying it: apply only migrations that have not already run, after backing up `.wrangler\state`. Schema changes need a reviewed migration rather than rerunning the initial SQL.

Useful checks after source changes:

```powershell
npx tsc --noEmit
node scripts/check-backend.mjs
npm run build
```

The backend check uses an in-memory SQLite database and a fake file bucket. It does not modify the saved local workspace. A successful build does not publish the app.
