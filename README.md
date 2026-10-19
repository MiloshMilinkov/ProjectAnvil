# ProjectAnvil — local workspace

A browser workspace for projects, tasks, notes, and everyday planning. Connect ideas, organize responsibilities, and keep track of progress. This copy runs on your PC at **http://127.0.0.1:5173**.

## Open ProjectAnvil

1. Open `D:\ProjectAnvil` in File Explorer.
2. Double-click **Start ProjectAnvil.cmd**.
3. Wait for your browser to open at **http://127.0.0.1:5173**. You can also type that address into your browser.
4. Keep the ProjectAnvil console window open while using the app.

To stop ProjectAnvil, save your work, wait for any saving indicator to finish, then press **Ctrl+C** in the console window. Confirm terminating the batch job if Windows asks. Closing the browser tab alone does not stop the app. Double-click the launcher again whenever you want to reopen it. It is not configured to start with Windows.

The launcher checks whether ProjectAnvil is already running before starting another copy. It uses a fixed port and will not stop a different application using that port.

**This address works on this PC only.** Other people and other devices cannot connect to it. Accounts and team workspaces work locally, but do not make the app available online. You can keep using the existing guest workspace without an account. Sign in to open your private personal workspace and any teams you have joined. A different browser on this PC can sign in to another account. Preferences such as appearance and tour completion are saved separately in each browser.

Installed dependencies are already present on this PC. Normal use does not need a package installation or a hosting account. Core notes, tasks, local attachments, graphs, and canvases work without an internet connection. Links and media that you point to external websites still need that website to be reachable.

## Your data and backups

The local database and uploaded attachment files are kept together under:

```text
D:\ProjectAnvil\.wrangler\state
```

**Do not delete `.wrangler` when cleaning or moving the project.** It contains guest and account workspace records, accounts, team membership, sessions, and uploaded files. Do not delete or reinitialize the local database to fix a startup issue.

The launcher also creates a private `.dev.vars` file containing the account session signing secret (`BETTER_AUTH_SECRET`). Keep it with the matching database backup, keep backups private, and never commit this file or its contents to GitHub. The secret file, database state, uploads, and local backups are excluded by `.gitignore`.

To make a complete backup:

1. Stop ProjectAnvil with Ctrl+C and wait for the server to exit.
2. Copy the entire `.wrangler\state` folder and the private `.dev.vars` file to a dated backup folder on another drive.
3. Preserve the `D:\ProjectAnvil` project files too if you want a ready-to-run backup, including its hidden folders. Keep the data, signing secret, and matching project version together.

To restore a backup, first stop the app. Preserve a copy of the current state and `.dev.vars` before replacing them with their matching backup, then start ProjectAnvil again. Do not merge individual database files between backups.

You can also use **Workspace settings → Export workspace** for a readable JSON backup of the active workspace’s notes, tasks, discussions, people labels, projects, and canvas layouts. **That JSON does not contain uploaded files, accounts, sessions, team memberships, or invitations.** A complete state-and-secret backup preserves the local account system and files too. Import replaces records only in the active workspace after confirmation, so export before importing.

The former hosted app and this local copy used separate databases and attachment stores. A JSON downloaded from the hosted app is a snapshot of its records; it does not automatically transfer its attachments. Preserve downloaded original attachments as well before removing the hosted storage. Import a hosted snapshot only if you intend to replace the current local workspace.

The transition backups are kept in:

- `D:\ProjectAnvil\backups\online-2026-10-19`: the online workspace snapshot and downloaded media files.
- `D:\ProjectAnvil\backups\local-before-online-import-2026-10-19`: a copy of the earlier local state preserved before restoring online records locally.

Keep these backups. The online archive is separate from the active local database; subsequent edits do not update it.

## What you can do

- **Tasks and planning:** create projects and tasks, assign people, set priorities, statuses, due dates, estimates, tags, dependencies, subtasks, and comments. Use the board, task list, timeline, personal-work view, saved filters, and dashboard.
- **Linked knowledge:** write Markdown with headings, checklists, tables, quotes, highlights, footnotes, code, mathematical notation, and Mermaid diagrams. Organize notes by folders, tags, projects, and custom properties. Search notes and tasks, bookmark notes, and inspect backlinks.
- **Worldbuilding:** use templates for places, characters, research, meetings, and daily planning. Link with `[[Note title]]`, `[[Note title#Heading]]`, or `[[Note title#^block-id]]`. Add `^block-id` after a paragraph to name it. Embed a note, heading, or block with `![[...]]`.
- **Visual planning:** explore the graph and arrange note, task, text, media, and web-reference cards on canvases connected by labeled arrows.
- **Collections and workspace:** view notes as tables, lists, galleries, or status boards; group and summarize properties; write beside a preview; split or merge notes; open another browser window; and present notes as basic slides. Save a startup view, adjust spacing, and customize the new-task shortcut.
- **Attachments and history:** upload images, PDFs, audio, and video. Record audio with microphone permission and a supported browser. Note changes save automatically, and history can restore earlier content.

New workspaces start empty: no example projects, people, tasks, notes, saved filters, or canvases. Create only what you need. Move or delete a project's notes and tasks before deleting the project.

## Templates for work and everyday life

Choose from 14 templates: Blank note, Project brief, Weekly plan, Daily journal, Habit tracker, Workout log, Meal plan, Study notes, Personal budget, Trip planner, Worldbuilding, Character, Research, and Meeting. Search or filter by category when creating a note. Creative templates remain available alongside practical ones.

## Accounts and team workspaces

Choose **Sign in** in the top bar, then **Register** to create an account. Register with an email address (including Gmail), a username, and a separate ProjectAnvil password. Use 12–128 characters for your password; do not enter your Gmail password. Usernames use 3–30 letters, numbers, underscores, or dots and are not case-sensitive. Your username is how you appear in the app. Sign in with your **username and ProjectAnvil password**.

Every account gets an empty **personal workspace** that only that account can access. Use the workspace switcher in the sidebar to change between your personal workspace and teams. Projects belong to one workspace. The active workspace determines which projects, tasks, notes, media, canvases, and other records you see.

To share work:

1. Open **Teams & workspaces** and create a team workspace.
2. Open that team workspace before creating its projects, tasks, or notes.
3. Invite an existing registered user by their username.
4. The invitation appears inside their ProjectAnvil account. They must accept it before they can access the team workspace.

All accepted team members can work with everything in that team workspace. The owner manages invitations and can remove members; members can leave. An invitation does not send an email. Task assignees control who is responsible for work, while team membership controls access. People labels in Workspace settings do not create accounts, invite users, or grant access.

When signed in, **My work** shows tasks assigned to your account in the active workspace. New comments use your signed-in username, with the author set by the server. Assigning a task to someone does not share your private workspace with them.

To share a new project, select or create its team workspace first. Moving an existing project between workspaces is not implemented yet. Personal work is never automatically copied into a team.

The original **guest workspace** is preserved separately. It remains available without registration, and signing out returns you to it. Creating or signing into an account does not automatically copy guest records into the account or a team. In guest mode, My work shows unassigned tasks and new comments appear as Guest.

Registration and login use **Better Auth 1.7.11** with its username plugin. Google sign-in, email verification, password-reset email, and a mail service are not configured in this local version.

## Guide

You can use the workspace features as a guest without creating an account. Accounts add private personal workspaces and team access.

The **? guide button beside the appearance button** starts a 21-step tour. It highlights each area and navigates between pages with Previous and Next. You can Skip, close with Escape, or Finish. The guide opens automatically once per browser and can be replayed at any time. It does not add notes, tasks, or other content.

## Git and VS Code

Open this folder in VS Code and use Source Control to review changes. A local checkpoint commit preserves the current source. See [GITHUB.md](GITHUB.md) for publishing it to your GitHub account. Publishing source does not host the app or upload saved workspace records. The included VS Code tasks run the app, check types, test storage, and build it.

## Appearance

Choose **Light**, **Dark**, **Warp**, **Focus**, or **Soft** from the top-bar appearance icon or **Workspace settings → Appearance**. Warp retains the original violet look. Focus combines light slate surfaces with a dark sidebar and header. Soft uses blush pink, mauve, and dusty rose accents. The preference is stored in your browser, and the former Current selection carries over to Warp.

## Troubleshooting

- **Browser did not open:** type `http://127.0.0.1:5173` into your browser after the console reports that ProjectAnvil is ready.
- **Address will not load:** make sure the console is still open. Restart the launcher if it has stopped, and check its error message.
- **Port 5173 already in use:** if another ProjectAnvil window is starting, wait for it. Otherwise close the program using that port before retrying. The launcher never kills other programs.
- **Missing Node.js:** the launcher uses `C:\Program Files\nodejs\node.exe` and requires Node.js 22.13 or newer. Reinstalling Node does not require deleting your ProjectAnvil data.
- **Saving failed:** leave the tab open, read the error, and retry. Avoid closing the app until saving succeeds.
- **Database or migration error:** preserve `.wrangler\state` and ask for help. Do not blindly rerun initial migrations against an existing database.

## Current limits

- Access is managed at the workspace level. All accepted team members share the team workspace; separate per-project permissions, workspace transfers, and project transfers are not implemented.
- There is no Google sign-in, configured email verification, password-reset mailer, or invitation email delivery. Registration uses an email address and a separate ProjectAnvil password.
- The local address remains available only on this PC. Accounts do not publish the app or make remote team access available.
- Each workspace’s text and metadata are limited to **1.5 MB total**. Binary uploads are separate and support **20 MB per file**.
- Notes and descriptions support up to 100,000 characters. Collection limits: 1,500 tasks, 1,000 notes, 200 people, 100 projects, 100 canvases, and 500 attachments, subject to the total text allowance.
- Note history keeps up to **12 earlier content versions**, normally spaced at least 30 seconds apart. History uses the same text allowance. Export for longer-term recovery.
- Open tabs refresh changes about every ten seconds. Coordinate when editing the same note or canvas in multiple windows.
- There is no automatic local Markdown-folder synchronization, offline editing queue, plugin marketplace, automated notification system, or simultaneous text coediting.

## Developer setup

The app uses Node.js 22.13+, React, Vinext, Better Auth 1.7.11, and local emulation of D1 and R2. Those database and file services run on this PC for this setup. Normal startup prepares the local signing secret if missing and applies the idempotent account and access schema automatically. Normal use requires no extra setup, build, or manual SQL step.

From `D:\ProjectAnvil` in a terminal, the manual equivalent of the launcher is:

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

Preserve `.openai/hosting.json` because it declares the local `DB` and `BUCKET` bindings. It does not publish or host the app by itself. Preserve the portable `.sites-runtime/execution-profile.json` configuration if present. The account and workspace schema definitions are in `db/auth.sql` and `db/access.sql`; the runtime ensures these tables exist without resetting existing data. Preserve `.dev.vars` and `.wrangler\state` when updating the source. For other schema changes, generating SQL is not the same as applying it: apply only migrations that have not already run, after backing up the complete state and secret. Schema changes need a reviewed migration rather than rerunning the initial SQL.

Useful checks after source changes:

```powershell
npx tsc --noEmit
node scripts/check-backend.mjs
npm run build
```

The backend check uses an in-memory SQLite database and a fake file bucket. It does not modify the saved local workspace. A successful build does not publish the app.
