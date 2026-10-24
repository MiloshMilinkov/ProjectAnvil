# Local setup and data

[ProjectAnvil overview](../README.md) · [GitHub setup](../GITHUB.md)

## Start and stop

Requires Node.js 22.13+ and npm. From the repository folder, install dependencies once:

```sh
npm run install:ci
```

Start the app without opening a browser automatically:

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. To start and open the browser together, run:

```sh
node scripts/start-local.mjs
```

On Windows, **Start ProjectAnvil.cmd** provides the same startup flow. That launcher expects Node at `C:\Program Files\nodejs\node.exe`; use the terminal command if Node is installed elsewhere.

Keep the console open while using the app. Wait for pending saves, then press **Ctrl+C** to stop it. Confirm terminating the batch job if Windows asks. Closing a browser tab alone does not stop the server. The launcher checks for an existing ProjectAnvil instance and does not stop another program using port 5173.

The default address is available only on the host computer. Another browser on that computer can sign in to a different account. The local setup does not provide remote phone or team access, and it does not start automatically with Windows.

Once dependencies are installed, core local notes, tasks, media, graphs, and canvases can work without internet access while the local server is running. External websites and externally hosted media still require a connection. Browser drafts and pending saves can be recovered and retried after an interruption; background cloud synchronization is not provided.

## Accounts and workspace access

Register with an email address, username, and a separate ProjectAnvil password. Passwords use 12–128 characters; usernames use 3–30 letters, numbers, underscores, or dots and are not case-sensitive. Sign in with username and password. Google sign-in and email services are not configured.

Every account has a private personal workspace. Create or select a team workspace before creating shared projects. Owners invite existing registered usernames, and invitations must be accepted inside the app. All accepted members can access the team's workspace; owners manage membership and members can leave. People labels and task assignments do not grant access. Guest records are separate and return when you sign out; signing in does not copy them into an account.

Work rooms belong to the account and workspace where they were created, including team workspaces. Guest rooms belong to the local guest workspace. Relationships and their review state belong to the workspace and are shared with its accepted members.

Personal note/task templates belong to the account across its workspaces, including team workspaces, and are never shared with teammates. Guest templates use a separate local library. Reusing a template creates editable content with fresh IDs and reset completion; assignments, schedules, project links, history, and private attachment references are omitted. Manage them in **My task templates** or **My note templates**. The library's **Deleted** tab restores removed templates.

## Data and backups

ProjectAnvil stores its database and uploaded files under **`.wrangler/state`**. The private **`.dev.vars`** file contains the account session signing secret. Preserve both together. They and local backups are excluded from Git.

| Backup option | Includes | Excludes |
| --- | --- | --- |
| **Workspace settings → Export workspace** | Active workspace notes, tasks, discussions, labels, projects, saved views, relationships, and canvas layouts | Trash, personal templates, archived note history, attachment files, accounts, sessions, membership, invitations, and personal rooms/checkpoints |
| **Complete local backup** | Database including Trash and personal templates, archived note history, uploads, accounts, membership, sessions, room checkpoints, and relationship review state | Unsaved browser drafts, browser preferences, and source code; preserve the matching source version too |

### Make a complete backup

1. Finish pending saves and resolve conflicts, or download recovery copies of unfinished edits. Browser drafts are stored in this browser and are separate from the database.
2. Stop ProjectAnvil and wait for the server to exit.
3. Run `npm run backup:create`. It copies the state and matching secret to a dated directory under `backups`, checks SQLite integrity, and records file checksums. The command prints the exact backup path.
4. Copy the complete backup directory to another drive. Keep it private and preserve the matching source version.

To choose another location or verify an existing backup:

```sh
npm run backup:create -- --output "E:\ProjectAnvil-backups"
npm run backup:verify -- --backup "E:\ProjectAnvil-backups\projectanvil-DATE-ID"
```

Replace `projectanvil-DATE-ID` with the exact directory printed by create. `--output` chooses the parent directory; each backup gets its own dated subdirectory. Verification checks the manifest, file checksums, safe paths, and SQLite integrity. It does not restore data. A complete manual copy of `.wrangler/state` and `.dev.vars`, made while the server is stopped, also preserves confirmed data; the verified restore command requires its own generated manifest.

Git commits preserve source code. They do not preserve your app records, uploaded media, or private signing secret.

If Windows temporarily locks a backup file, create/restore retries the move briefly. A persistent lock stops the command and prints the retained staging path; no backup is silently deleted. Close the process holding the file before retrying, and keep the retained directory until a complete backup verifies.

### Restore a complete backup

1. Stop the app and keep the backup directory intact.
2. Run the restore command below, pointing to a generated complete backup.
3. Start the matching project version and check the restored workspace.

```sh
npm run backup:restore -- --backup "E:\ProjectAnvil-backups\projectanvil-DATE-ID"
```

Restore verifies the entire backup before replacing anything, stages its files, and preserves the previous state and secret under `backups/rollback-*`. A running local server blocks create/restore. Startup is blocked while `.projectanvil-maintenance.lock` exists. If a backup process was interrupted, confirm it has exited and inspect its backup/rollback directories before removing a stale lock; do not start the app midway through a restore.

Do not combine individual database files from different backups or reinitialize the database as a troubleshooting shortcut.

### Import a workspace export

Export the current workspace first. Import replaces records only in the active workspace after confirmation and rejects an outdated workspace revision. Imported relationships start reviewed against the imported content, clearing previous review markers. Personal work rooms are stored separately and are not restored from JSON; pins to removed records are pruned. Existing archived note history and unreferenced attachment bytes are retained. Attachment references in JSON need their corresponding files in storage.

Import also makes earlier workspace Trash entries unavailable to restore, avoiding stale recovery copies overwriting the imported workspace. Their archive is retained in complete backups. Import does not replace your personal template library.

## Trash, restore, and Undo

Deleted workspace records are retained in **Trash** in the sidebar. The latest deletion notification offers **Undo** until dismissed or replaced by another notification; older items can be restored from Trash. Trash lists deletion times and loads additional pages on demand. There is no permanent-delete control or automatic expiry in this version.

Restore checks current workspace access, preserves note history, and reconnects available note/task links, task dependencies, canvas cards/connections, and meaningful relationships. It preserves newer changes and reports connections needing review. Missing related items do not prevent recovery of the main content. Restoring a task whose key has been reused allocates another key. Work-room pins pruned during deletion are not restored automatically; re-pin them if needed.

Projects must have their tasks and notes moved elsewhere before they can be moved to Trash. Existing deletes from before this feature have no Trash copy. Repeated deletion/restore requests are safe to retry; an older Undo cannot replace a later deletion. Trash belongs to the workspace and its current accepted members. Personal templates recover separately in their **Deleted** tab.

## Project planning, recurring tasks, and reminders

Open a project's title to see its home, with tasks, notes, milestones, and attached canvases. A canvas belongs to at most one project; attaching it elsewhere changes that association while preserving its cards and connections. Moving notes/tasks between projects is still done through their editors.

Project and milestone progress count tasks without child tasks. Parents summarize their descendants instead of being counted again. A child inherits its nearest parent's milestone unless given its own. Parents and children must share a project, and parent/dependency links are checked together for cycles. Complete children before their parent; reopen a completed parent before reopening a child.

Milestones can be edited, archived, and restored from **Archived** in the project home. Archived milestones keep existing assignments and recurring-series context; they are hidden from new manual assignments. Archiving does not stop a recurring schedule. Milestone forms keep browser drafts and guarded saves; discarding one form cancels only that form's queued writes.

**Bulk edit** starts from the current task view. Select up to 100 tasks and choose the fields to change. Moving projects detaches the moved task's parent and milestone. Selected children finish/move before parents; reopening processes parents first. Each task is checked and saved independently. Successful tasks stay saved if another fails. Network or access errors stop the batch; use **Retry remaining** or open a failed task for review. **Stop after current task** waits for its current request to finish. Closing preserves choices and pending saves. Applying new choices explicitly replaces this batch's abandoned failed intents while keeping their recovery copies.

**Recurring tasks** use daily, weekly, or monthly calendar rules, an interval of 1–365, an anchor date, an IANA time zone, and an optional end date. Completing an occurrence creates its successor in the same guarded transaction, with fresh IDs, reset checklist/progress/discussion, preserved valid context, and shifted dates. Missed dates are skipped to the first occurrence strictly after both today in the selected zone and the completed occurrence's date. Monthly rules retain the original day, clamping shorter months (January 31 → February 28 → March 31). Planned start/due offsets are preserved.

Tasks with children cannot repeat. A completed occurrence keeps its successor link, so reopening/completing it again does not create another successor. Stop or change a routine on its current open occurrence. If the successor was moved to Trash, restore it there. Account removal clears an unavailable assignee on the next occurrence. Capacity or invalid-date failures leave both the original completion and the successor unchanged, with an error to review.

**Reminders** store a date, local clock time, and IANA time zone on the task. The bell includes tasks assigned to the current person and unassigned work in the active workspace. Completed tasks are excluded. It checks about every 30 seconds and on return to the app; missed reminders are shown on the next open. Due reminders can be snoozed for an hour or dismissed; use **Dismissed** to restore them. These choices are specific to this browser, account, and workspace, and are excluded from complete data backups. Task reminder schedules are included in workspace exports and complete backups.

A local time skipped by a daylight-saving change is rejected so you can choose a valid time; a repeated clock time uses its earlier occurrence once. If a recurring successor's reminder would land in a skipped clock period, completion is rolled back with a message to adjust the reminder before retrying. Calendar recurrence and hour-long snoozes use their respective calendar and elapsed-time rules across clock changes. Browser/server time-zone data and the computer's clock determine timing. Email, operating-system alarms, and background delivery while the app is closed are not configured.

## Drafts, conflicts, and save recovery

- Notes and canvases keep recovery drafts as you edit. Task, project, milestone, bulk-edit, assignment-label, linked-task, and room forms keep their own unfinished drafts. Recovery is scoped to the account and workspace in this browser.
- Close an unfinished form with **Keep draft** to return later, or explicitly discard it. A browser-storage failure is shown and blocks unsafe in-app navigation; keep the page open until saved or copy/download your text.
- **Saved**, **Saving**, and **Unsaved changes** describe the actual save state. A successful refresh does not dismiss a failed save. Use **Retry saves** for interrupted requests, or **Review unsaved changes** to download recovery data and discard individual pending saves.
- When another window replaces a browser draft, its displaced copy is kept separately. Use **Review recovery copies** to inspect, download, and manually merge useful text before discarding the copy.
- Editing different fields can merge safely. Conflicting changes to the same field are rejected with an explanation; local edits remain available. Review/copy your draft before choosing the latest saved version. A stale editor cannot recreate a deleted item.
- Failed recordings remain available for Retry, Download, or Discard while the page is open. Raw audio is not a durable browser draft; navigation is blocked until it is saved or explicitly discarded. Browser crash recovery cannot preserve an in-memory recording.

Drafts are device/browser recovery copies, not confirmed database saves. Save or download them before clearing browser data, changing browser profiles, or making a complete backup.

## Storage limits

| Item | Current limit |
| --- | --- |
| Workspace text and metadata | 1.5 MB total; uploads are separate |
| Uploaded file | 20 MB per file |
| Note content or task description | 100,000 characters, subject to total workspace size |
| Workspace collections | 1,500 tasks · 1,000 notes · 500 people · 100 projects · 100 canvases · 500 attachments · 2,000 meaningful relationships |
| Note history | Archived separately from active records; normal edits capture versions at least 30 seconds apart, with explicit restores and deletions also preserving replaced content |
| Linked task source quote | 8,000 characters |
| Work rooms | 30 per account/workspace; up to 20 pinned notes per room |
| Project milestones | 100 per project, including archived milestones |
| Bulk editing | Up to 100 tasks per batch; failures are reported per task |
| Personal templates | 200 entries including deleted templates, 2 MB per account library, 120 KB per template |
| Workspace Trash | Stored separately from the active workspace allowance; retained without automatic expiry |

Archived history, Trash, personal templates, and uploaded file bytes do not count toward the active workspace allowance. History, Trash, and unreferenced attachment files are retained without automatic deletion; complete backups preserve them. **Settings → Storage & recovery** checks active usage, retained files, and missing attachments without deleting files. History is loaded in pages of 20 versions. Change-impact markers indicate possible consequences; review the connected content before acknowledging them.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Browser did not open | Open `http://127.0.0.1:5173` after the console reports readiness. |
| Address will not load | Keep the server console open; check its error before restarting. |
| Port 5173 is occupied | Wait for a starting ProjectAnvil instance or close the program using that port. The launcher does not kill other programs. |
| Node is missing | Install Node.js 22.13+ and restart your terminal or VS Code. The Windows launcher expects the standard installation path. |
| Dependencies are missing | Run `npm run install:ci` from the repository folder. This needs internet access. |
| Saving failed | Read the error and use Retry saves; review conflicting edits in their editor. Download a recovery copy before discarding pending work. |
| Database or migration error | Back up the complete state and secret. Do not delete `.wrangler` or blindly rerun initial SQL. |

## Development notes

The portable execution profile is the default for a fresh checkout. `.openai/hosting.json` declares the local `DB` and `BUCKET` bindings; it does not publish the app. Preserve that tracked configuration when moving or updating the source.

Startup creates a signing secret if missing and applies the idempotent account, access, work-room, and reliability schemas without resetting existing records. Schema definitions live in `db/auth.sql`, `db/access.sql`, `db/workrooms.sql`, and `db/reliability.sql`. Legacy note snapshots migrate atomically into the archive alongside a successful workspace write. Other schema changes need a reviewed migration and a complete backup; generating SQL does not apply it.

Useful checks:

```sh
npm run check
```

Checks include TypeScript, lint, backend/draft regressions, temporary-fixture backup restoration, and a production build. Backend tests use in-memory SQLite and a fake file bucket; backup tests use temporary fixture directories. They do not modify saved workspaces. GitHub Actions runs the same checks on pushes and pull requests. Building the app does not publish it. See [GitHub setup](../GITHUB.md) for source control and [LOCAL_ONLY.md](../LOCAL_ONLY.md) for the current local-operation policy.
