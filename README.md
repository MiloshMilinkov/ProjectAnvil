# Forgeboard

A browser workspace for game development: plan tasks, build worlds, and connect the thinking behind the work.

## Start using it

For your team, open the **published Forgeboard website address**. Everyone who has website access shares the same projects, notes, people, tasks, and canvases. The person selector chooses whose tasks you want to see; it does not sign you in or restrict someone to their own tasks. Configure website sharing in the hosting platform.

For the copy on this PC, open `D:\Forgeboard` and double-click **Start Forgeboard.cmd**. Open the localhost address shown in the window, usually `http://localhost:5173`. Keep the window open while using it. Press Ctrl+C in that window to stop it. If the database has not been prepared, follow Local setup below.

The local copy and published website have **separate databases and attachment storage**. Editing one does not change the other. Teammates should use the published website address. A localhost address works only on this PC.

## What you can do

- **Tasks and planning:** create projects and tasks, assign people, set priorities/statuses/due dates, estimate story points, add tags, dependencies, subtasks, and discussion comments. Use the board, list, planning timeline, personal-work view, saved filters, and overview dashboard.
- **Linked knowledge:** write Markdown with headings, checklists, tables, quotes, highlights, footnotes, code, mathematical notation, and Mermaid diagrams. Organize notes by folders, tags, projects, and custom properties. Search notes and tasks, bookmark notes, and inspect backlinks.
- **Worldbuilding:** use note templates for places, characters, research, meetings, and daily planning. Connect notes with `[[Note title]]`, `[[Note title#Heading]]`, or `[[Note title#^block-id]]`. Add `^block-id` after a paragraph to name it. Embed a whole note, heading, or block with `![[...]]`.
- **Visual planning:** explore relationships in the graph. Create canvases, arrange note/task/text/media/web-reference cards, and connect cards with labeled arrows.
- **Collections and workspace:** inspect notes in tables, lists, galleries, or status boards, with grouping and numeric summaries, edit with a preview beside the source, split or merge notes, open notes in another browser window, and present notes as basic slides. Save a startup view, choose compact spacing, and customize the new-task shortcut.
- **Attachments and history:** upload images, PDFs, audio, and video. Audio recording needs microphone permission and a browser that supports recording. Note changes save automatically, and version history lets you restore earlier content.

Start with the editable Aetherfall and Moonlit Market examples, or create your own projects. All example records can be edited or removed. Move or delete a project's notes and tasks before deleting the project.

## Appearance

Choose **Light**, **Dark**, or **Current** from the appearance icon in the top bar, or **Workspace settings → Appearance**. Current preserves the original violet look. Your choice is saved on this device and follows notes, tasks, graph, canvas, and diagrams.

## Save, share, and back up

Changes are saved to the workspace database. Other open browsers refresh about every ten seconds. A save error means the change needs attention; use the retry/refresh control and check the message before closing the browser. This is shared planning with periodic refresh, rather than simultaneous Google Docs-style text editing. Coordinate before editing the same note or canvas at the same time.

Use **Workspace settings → Export workspace** regularly. JSON exports include notes, tasks, discussions, people, projects, canvas layouts, and attachment references. **They do not contain the attachment files.** Download important original files separately. Import replaces the current workspace records after confirmation; export a backup first. A stale import is rejected if another teammate has saved since you opened it.

Attachment references work when restored to the same website while the original stored files remain available. Moving a JSON export between local development and another published site does not transfer its files. Upload those files again in the destination and update their note/canvas references.

## Current limits

- One shared workspace per deployment. People are assignment labels. Website access is managed by the host; there are no separate project permissions or user roles inside Forgeboard.
- Workspace text and metadata are limited to **1.5 MB total** in this first version. Uploaded binary files are stored separately, up to **20 MB each**.
- Individual notes/descriptions support up to 100,000 characters. Maximum collections: 1,500 tasks, 1,000 notes, 200 people, 100 projects, 100 canvases, and 500 attachments, subject to the total text limit.
- Automatic history keeps up to **12 previous content versions**, normally spaced at least 30 seconds apart. Restoring an earlier version preserves the current content as another version. History uses the same text allowance; export backups for longer-term recovery.
- This is a browser app. There is no local Markdown-folder synchronization, offline editing queue, plugin marketplace, automated notifications, or real-time multiplayer text editor.

## Local setup

The project uses Node.js 22.13 or newer, React, Vinext, Cloudflare D1, and R2. The launcher uses the Node installation at `C:\Program Files\nodejs\node.exe`. Run the commands below from the project directory in a terminal.

1. Install dependencies if this checkout does not have them:

   ```powershell
   npm run install:ci
   ```

2. Check `.openai/hosting.json` declares `"d1": "DB"` and `"r2": "BUCKET"`. Generate migrations after schema changes, then build the local Worker configuration:

   ```powershell
   npm run db:generate
   npm run build
   ```

3. For a new local database, apply the generated initial SQL file. Replace the example filename with the actual file under `drizzle`. Run each migration once and apply later migrations in order:

   ```powershell
   node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_YOUR_GENERATED_NAME.sql
   ```

4. Double-click **Start Forgeboard.cmd**, or run:

   ```powershell
   npm run dev
   ```

Local data is stored under `.wrangler/state`; preserve that folder to keep the local database and uploaded files. The seed workspace is created only when the database has no workspace record. Generating or applying a local migration does not update the published website. Publishing through the Sites workflow applies the hosted migrations separately.

## Checks for development

```powershell
npx tsc --noEmit
node scripts/check-backend.mjs
npm run build
```

The backend check uses an in-memory SQLite database and a fake file bucket. It checks mutation validation, links and dependencies, deletion cleanup, snapshots, concurrent saves and task numbering, file-upload metadata, and safe download headers. It does not connect to or verify a published deployment. Test browser interactions and mobile layouts separately before releasing changes.


