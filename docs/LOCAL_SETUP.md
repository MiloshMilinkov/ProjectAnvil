# Local setup and data

[ProjectAnvil overview](../README.md) · [GitHub setup](../GITHUB.md)

## Start and stop

Requires Node.js 22.13+ and npm. From the repository folder, install dependencies once:

```sh
npm run install:ci
```

Start the app and open the browser:

```sh
node scripts/start-local.mjs
```

Open **http://127.0.0.1:5173**. The launcher builds the production app on first use and after relevant source changes, prepares its offline application files, and reuses a current build on later starts. A build does not publish anything.

To build and start without automatically opening a browser:

```sh
npm run build
npm start
```

On Windows, **Start ProjectAnvil.cmd** provides the same startup flow. That launcher expects Node at `C:\Program Files\nodejs\node.exe`; use the terminal command if Node is installed elsewhere.

Keep the console open for account access, uploads, and synchronization. Wait for pending saves, then press **Ctrl+C** to stop it. Confirm terminating the batch job if Windows asks. Closing a browser tab alone does not stop the server. The launcher checks for an existing ProjectAnvil instance and does not stop another program using port 5173.

The default address is available only on the host computer. Another browser on that computer can sign in to a different account. The local setup does not provide remote phone or team access, and it does not start automatically with Windows.

After dependencies are installed, the local server can run without internet access. External websites and externally hosted media still require a connection. Prepared offline copies also support work when the local server itself is unavailable. Synchronization returns to this local installation; background cloud synchronization is not provided.

For live source editing, use `npm run dev`. Development mode does not prepare or update the installable app cache. After changing source or pulling an update, stop the old server and run the normal launcher again. It builds the matching app when needed. An optional local test port is available with `npm start -- --port 5174`; use the usual address for everyday work because browser storage is origin-specific.

## Install and update the app

Open **Workspace settings → Install ProjectAnvil**. Wait for **Application files are ready for offline startup**, then choose **Install app** when the browser offers it. Browser menus may offer **Install app** or **Add to Home Screen** instead. Availability depends on the browser and a secure origin; the normal loopback address is supported by modern browsers. Installation adds a device shortcut/window and does not start the local server automatically.

The app cache contains only verified public application files and a generic startup shell. Account responses, workspace records, and uploaded files are never placed in that cache. Keeping private work offline is a separate choice below.

Use **Check for updates** to look for a prepared build. Finish pending work, close other ProjectAnvil windows, then choose **Restart to update**. Updates also activate after all older app windows close. A prepared shell keeps its HTML and scripts from the same build, so an interrupted reload cannot mix versions. Starting the server after a source update prepares the new build before browser installation.

Use the same browser profile and address each time. `127.0.0.1`, `localhost`, another port, and another browser profile have separate offline copies and recovery storage.

## Offline workspaces and synchronization

1. While connected, open a workspace and choose **Workspace settings → Offline workspace → Save workspace offline**.
2. Optionally choose **Save attachments offline**. Files are copied separately; **Stop downloads** keeps files already downloaded.
3. Wait for the copy to finish. The app can reopen that saved workspace in the same browser when the local server is unavailable. **Working offline** distinguishes device changes from server-confirmed saves.
4. Continue editing available notes, tasks, and project plans. Changes stay in an account/workspace-scoped queue. Reconnect to the same server to verify current access and synchronize; **Synchronize now** retries the queue explicitly.

Use a device you trust: the saved copy is readable browser data, not a new password-protected account session. Offline access resumes the last selected saved copy. It cannot verify remote role changes while disconnected. Reconnecting checks current account/project access and removes unavailable records and attachment copies before continuing synchronization. Signing out or changing account removes the previous account's offline workspace copies and prevents automatic resumption; separate unfinished editor drafts remain scoped to their original account. Sign-in, sign-out, and team administration need the local server.

**Conflicts:** queued changes keep their original comparison values and receipt IDs. Reconnection merges nonconflicting work and stops for conflicting or denied changes. Choose **Review queued changes**, open **Compare queued and saved values**, and compare device values with the last confirmed server record. After reconnecting, **Apply reviewed changes** or **Apply reviewed deletion** explicitly confirms the reviewed replacement. The app checks again if that record changes during review. New records and unavailable records may need review in their own editor. **Download recovery copy** preserves pending work before an explicit discard.

Undo can cancel an offline deletion that is known never to have reached the server. Tabs coordinate cancellation with a short browser lock before sending; if the browser cannot coordinate tabs, reconnect and synchronize the deletion before restoring it. If delivery is uncertain, reconnect before Undo or restore the confirmed deletion from Trash. Completing a recurring task offline queues its completion; the next occurrence appears after server acknowledgement. Archived history and other server-generated records also appear after synchronization.

**Attachments:** only saved local uploads are available offline. Unsaved files and external media show an unavailable state until reconnecting. **Refresh offline copy** refreshes available workspace records; files are verified against their saved metadata and must be downloaded again if changed. Copies are isolated by account/workspace, and account or project access changes invalidate unavailable cached content.

New uploads, account/team changes, archived history and Trash restore, personal room/template updates, folder transfers, and joining a new simultaneous editing session require the local server. Already-open shared editing keeps its own interruption recovery; review the [shared editing controls](#teamwork-and-shared-editing) before replacing recovered text.

**Remove offline copy** removes this workspace's device snapshot and files. Synchronize or download/review queued changes first; removal is blocked while that queue still needs attention. It does not delete server records. **Request persistent storage**, when available, asks the browser to retain site data more reliably; it is not a backup. Browser quotas, storage eviction, private browsing, or clearing site data can remove offline data. Keep complete backups and download unresolved drafts before clearing browser storage.

## Markdown folders and attachments

Open **Workspace settings → Markdown folders** while connected to the local server.

- **Export:** choose **Export scope** (all available notes/files or one project), then **Export Markdown ZIP**. The ZIP contains UTF-8 Markdown, folders, attachments, and a ProjectAnvil manifest for supported structured note data and relationships between included notes. Only work currently available to your account is exported; a project scope includes its available files and files referenced by its notes. Missing files or changed access stop the export.
- **Import:** choose **Choose folder** or **Choose ZIP**, review the notes, file counts, and warnings, then select **Import into project** and choose **Import as new notes**. Import adds fresh copies; existing notes stay in place. Matching titles receive distinct names. Import requires editing access to the target, and its project permissions apply to the new records. Viewers can export available work.

Simple frontmatter is supported. Advanced YAML stays in the note body with a warning. Available wiki links, relative Markdown links, and attachment references are remapped to imported copies; omitted targets can remain unresolved. A ProjectAnvil export preserves supported note properties, custom type structures, decision reasoning, and note-to-note relationships through its manifest. Keep that manifest with the folder for a fuller round trip.

Folder selection imports its included non-Markdown files as attachments too. Choose the intended folder and review the selection before importing into a team workspace. ZIP parsing rejects unsafe paths, symbolic links, duplicate names, damaged archives, and excessive expansion. Executable/webpage attachments download as files rather than running inside the app.

These are manual transfers, with up to **200 notes**, **400 files**, **24 MB** of expanded content, **20 MB** per attachment, and a **25 MB ZIP**. Each note remains subject to the 100,000-character and workspace storage limits. Narrow the export project or split a large folder if needed. No background folder watcher is configured.

If an import response is lost, reselect the same unchanged folder/ZIP and target project to retry without duplicate copies. Uncertain staged attachment uploads remain available for storage recovery. Folder imports do not restore tasks, discussions, account membership, project permissions, personal rooms, or archived history; use workspace JSON or a complete backup for the relevant records below.

## Accounts and workspace access

Register with an email address, username, and a separate ProjectAnvil password. Passwords use 12–128 characters; usernames use 3–30 letters, numbers, underscores, or dots and are not case-sensitive. Sign in with username and password. Google sign-in and email services are not configured.

Every account has a private personal workspace. Create or select a team workspace before creating shared projects. Owners and Admins invite existing registered usernames within their role limits; invitations must be accepted inside the app. Accepted members can open the workspace, with Viewer, Editor, or Admin access and optional project restrictions. Owners control ownership and Admin appointments. Members can leave; Owners must transfer first. People labels and task assignments do not grant access. Guest records are separate and return when you sign out; signing in does not copy them into an account.

Work rooms belong to the account and workspace where they were created, including team workspaces. Guest rooms belong to the local guest workspace. Relationships and their review state belong to the workspace and are visible to members who can open their connected items.

Personal note/task templates belong to the account across its workspaces, including team workspaces, and are never shared with teammates. Guest templates use a separate local library. Reusing a template creates editable content with fresh IDs and reset completion; assignments, schedules, project links, history, and private attachment references are omitted. Manage them in **My task templates** or **My note templates**. The library's **Deleted** tab restores removed templates.

## Data and backups

ProjectAnvil stores its database and uploaded files under **`.wrangler/state`**. The private **`.dev.vars`** file contains the account session signing secret. Preserve both together. They and local backups are excluded from Git.

| Backup option                              | Includes                                                                                                                                                                                                                                 | Excludes                                                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace settings → Export workspace**  | Current visible notes, tasks, discussions, labels, projects, saved views, relationships, canvases, note types, decisions, presets, and brainstorming boards                                                                              | Accounts, memberships, invitations, roles/project permissions, activity, watches, notifications, shared editing sessions, Trash, personal templates, archived note history, attachment files, and personal rooms/checkpoints |
| **Markdown folders → Export Markdown ZIP** | Available Markdown notes, folders, attachments, supported properties/types, decision reasoning, and relationships between included notes                                                                                                 | Tasks, discussions, accounts/team access, archived history, Trash, personal rooms/templates, and browser queues                                                                                                              |
| **Complete local backup**                  | Full database and uploads, including accounts, memberships, roles/project permissions, activity, watches, notifications, shared editing state, Trash, templates, note history, personal rooms, and review state; matching signing secret | Browser offline copies, cached app files, queued/unsaved browser drafts, browser preferences, and source code; preserve the matching source version too                                                                      |

### Make a complete backup

1. Reconnect and synchronize pending work, resolve conflicts, or download recovery copies of unfinished edits. Browser offline copies and queued/editor drafts are separate from the database and are not included in a file backup.
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

Import is Owner-only. It does not transfer or replace accounts, memberships, project permissions, activity, watches, notifications, or personal templates from JSON. Review project access after importing; in a team workspace, new projects without an existing policy start shared with the team. Import ends old shared editing sessions and makes earlier workspace Trash entries unavailable to restore, avoiding stale recovery copies overwriting imported records. Their archive is retained in complete backups. Unfinished shared text remains in browser recovery for review.

## Trash, restore, and Undo

Deleted workspace records are retained in **Trash** in the sidebar. The latest deletion notification offers **Undo** until dismissed or replaced by another notification; older items can be restored from Trash. Trash lists deletion times and loads additional pages on demand. There is no permanent-delete control or automatic expiry in this version.

Restore checks current editing access, preserves note history, and reconnects available note/task links, task dependencies, canvas cards/connections, and meaningful relationships. It preserves newer changes and reports connections needing review. Some records require a missing definition or project to be restored first, such as typed notes and scoped attachments. Restoring a task whose key has been reused allocates another key. Work-room pins pruned during deletion are not restored automatically; re-pin them if needed. Viewers can read permitted Trash metadata but cannot restore records.

Move or remove a project's tasks, notes, canvases, attachments, and brainstorming boards before moving the project to Trash. Existing deletes from before this feature have no Trash copy. Repeated deletion/restore requests are safe to retry; an older Undo cannot replace a later deletion. Trash follows current workspace and project access, including permission changes after deletion. Personal templates recover separately in their **Deleted** tab.

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

## Teamwork and shared editing

Teamwork remains local to the running installation. Accounts, roles, live updates, and shared editing do not expose the app to the internet. Existing team members keep their work and become **Editors**; the new access tables are applied automatically on startup.

| Role   | Access                                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewer | Read available work, history, and activity; Watch items, manage personal Notifications, and keep personal rooms/templates. Workspace records and voting are read-only. |
| Editor | Create and edit accessible work. Project permissions can reduce this access.                                                                                           |
| Admin  | Editor access plus managing project permissions and invitations/roles for Editors and Viewers. Admins cannot manage another Admin or the Owner.                        |
| Owner  | Admin access plus appointing Admins, renaming/replacing the workspace, and transferring ownership.                                                                     |

**Project access:** projects start shared with the team. In a project home, Owners and Admins can choose **Only selected members**, then assign Viewer or Editor access. Owners and Admins always retain access. A workspace Viewer stays read-only even if a project grant says Editor. Switching back to shared access restores the workspace role. Project permissions apply to tasks, notes, canvases, brainstorming boards, uploads, history, recovery metadata, activity, and notification links. Moving work between projects requires permission on both sides. The server rechecks access and the permission revision inside write transactions, including retries.

Hidden records and structured links are omitted from limited workspace reads and exports. Permissions cannot retract text someone already read, downloaded, or wrote into a visible note. Browser recovery copies of a person's previous edits remain on their device; inaccessible projects do not appear as normal notes. Complete local backups are private installation-level copies, not a team sharing mechanism. Task assignment labels do not grant access.

Files uploaded from a note or canvas retain its project scope. Project home lists these attachments and lets Editors move unused files to Trash. Moving a note or canvas does not automatically move its attachments; upload a reference in the destination project when its access must change. Remove the project's work and attachments before deleting a project. Restoring a scoped attachment requires its project to exist, preserving file access. Older unscoped files use current references to avoid disclosing files used only by an inaccessible project.

**Ownership:** the current Owner can choose **Make owner** beside an accepted team member and review the confirmation. Transfer is atomic; the recipient becomes Owner and the former Owner becomes Admin. Only the new Owner can transfer again. Owners must transfer before leaving. Personal workspaces cannot be transferred, and projects do not move between workspaces.

**Activity:** the Activity page records trusted actors, item names, and changed field labels, including access changes. It does not keep copies of every changed text value. Content-only note autosaves are summarized at most once per 30 seconds per actor/note; other changes and new mentions are recorded immediately. Note content history remains separate. Activity is scoped by the active project and current access, including older entries, with up to 10,000 recent workspace records.

**Mentions and watches:** use registered **@username** handles in note Markdown, task descriptions, or discussion. Only a newly introduced handle notifies an active member who can open that item. Retaining a handle does not repeatedly ping; code spans/fences, escapes, email addresses, and URLs are ignored. Imports suppress mass mentions. Choose **Watch** on a task, note, or project to receive changes from other people; watching a project includes its work. Preferences are personal, available to Viewers, and require an account. Deleted items stop being watched; restore does not silently resubscribe.

**Notifications:** the header's **Notifications** button opens in-app mentions and watched updates, with **All**/**Unread** filters, individual **Mark read** actions, and **Mark all read**. Watched updates for the same item are grouped; after one is marked read, further ordinary watch updates are quiet for five minutes. New mentions remain immediate. Notifications retain up to 1,000 recent records per account/workspace, and watch preferences support up to 500 items. Access revocation removes unavailable entries from current views. No email, operating-system push, or closed-app delivery is configured. Task reminders remain separate.

**Live updates:** the app checks for saved workspace and permission changes about once a second. The header shows **Live updates**, **Connecting…**, or **Reconnecting…**. It retries interruptions automatically and refreshes on focus. Personal account context also refreshes periodically. These updates use the same local server.

**Simultaneous Markdown:** each editor opens a note and chooses **Edit together**. Yjs merges concurrent Markdown inserts/deletions; shared changes synchronize about every 1.5 seconds and writes batch for 450 ms. Here now shows recent participants (up to four names in the compact display); presence expires after about 20 seconds without updates. Other note properties and other editors retain ordinary conflict checks. Shared mode is optional, and Viewers cannot edit text.

Shared edits keep account/workspace/note-scoped browser recovery, including across reconnects. Save status reflects acknowledgement from the server. Ordinary-editor content saves, Markdown restores, note deletion, and workspace imports replace the shared editing generation. An old session with unfinished text requires review; use **Download my text**, **Retry sync**, or explicitly **Load saved version**. Existing text is never silently merged across a replacement. Shared text is limited to 100,000 characters and a 1 MB editing-history state. At the history limit, save/download useful text and choose **Restart shared session** from the recovery controls; other sessions with pending work must review the new generation. Presence is bounded to 30 tabs per account/workspace.

Workspace JSON exports current visible records and Markdown; it excludes accounts, memberships, invitations, roles/project permissions, activity, watches, notifications, and shared editing sessions. It also excludes the other records listed in [Data and backups](#data-and-backups). A complete local backup preserves these database tables. Import remains Owner-only and ends old shared editing sessions. Back up and restore with the app stopped as described above.

## Connected thinking

**Custom note types:** open **Manage note types** in Notes. Define named text, number, date, checkbox, or choice properties, then select a custom type in a note's details. Required marks incomplete fields while allowing unfinished notes to save. Nonblank values must match their format. Existing freeform properties remain separate. Property IDs stay stable when names change; schema edits that invalidate existing values are rejected. Clear or migrate those values before changing the structure. Archive a type to hide it from new assignments while keeping existing notes readable; restore it to reuse it.

Collections filters by custom type and shows structured fields as columns. Structured values support sorting, grouping, and calculations; select their table value to open the note for editing. Fields from different types stay separate even if their names match. Note and collection searches include structured values and decision reasoning. Individual Markdown exports include readable structured data; workspace JSON preserves the full definitions and values.

**Decision records:** use the built-in **Decision record** template or choose the decision note kind. Capture the context, options, outcome, consequences, owner, and date. Proposed notes can remain unfinished; accepting needs an outcome and date. Superseding requires another decision in this workspace and cannot form a cycle. The replacement remains an ordinary note link; use an explicit **was decided because of** relationship for evidence and change-impact review. Deleting a replacement clears the link and returns the older record to Accepted if it still has an outcome/date, otherwise Proposed. Browser recovery includes structured reasoning; historical note snapshots continue to track Markdown content, not full property versions.

**Relationship presets:** manage presets below the graph. Save a name, one of the four existing relationship meanings, allowed endpoint types, and an optional suggested reason. Choose a preset in **Add relationship**, then review and save the actual connection. Presets fill new relationships; editing or archiving one does not rewrite existing connections or their review markers. Changes to a linked note's structured values, decision record, or assigned type structure can trigger the same impact checks as content changes.

**Brainstorming:** create a board for a project or leave its project blank. Add ideas, named groups, and optional links to existing notes/tasks. Move ideas with the group selector; removing a group leaves its ideas ungrouped. Compare original order or vote order within each group. Editing has an explicit save, recoverable browser draft, and conflict checks. Two simultaneous edits to the idea list need review; voting alone does not overwrite or conflict with an idea edit. Deleting a linked note/task clears its board references; Trash restoration reconnects available references without replacing newer edits. Move or remove associated boards before deleting a project.

Open voting allows each signed-in member with editing access one vote per idea. Each person may vote on multiple ideas and remove their votes while voting is open. Guest mode has one shared guest identity. Counts follow workspace and project visibility; votes use the server's signed-in identity, not assignment labels. Viewers and closed voting cannot change votes. Live updates refresh other open tabs; no remote access is enabled.

**Import and recovery:** workspace JSON includes type definitions, property values, decision records, presets, groups, and ideas. Import treats vote data as a snapshot rather than permission to impersonate members: matching board/idea IDs retain their current trusted votes; new imported ideas start at zero. To restore the full confirmed vote state on this installation, use a complete local backup. Import still requires the workspace owner and resets relationship review markers. Brainstorm boards can be moved to Trash and restored; archive reusable types and presets to keep their definitions available.

Personal templates retain reusable decision reasoning in Markdown and begin with fresh decision status, ownership, dates, and replacement links. Custom type IDs and values are workspace-specific and are excluded from personal templates. If a typed note is in Trash and its custom type is later deleted, restore the type first, then restore the note; its structured values remain in its recovery copy.

## Storage limits

| Item                             | Current limit                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace text and metadata      | 1.5 MB total; uploads are separate                                                                                                                                                      |
| Uploaded file                    | 20 MB per file                                                                                                                                                                          |
| Note content or task description | 100,000 characters, subject to total workspace size                                                                                                                                     |
| Workspace collections            | 1,500 tasks · 1,000 notes · 500 people · 100 projects · 100 canvases · 500 attachments · 2,000 meaningful relationships                                                                 |
| Note history                     | Archived separately from active records; normal edits capture versions at least 30 seconds apart, with explicit restores and deletions also preserving replaced content                 |
| Linked task source quote         | 8,000 characters                                                                                                                                                                        |
| Work rooms                       | 30 per account/workspace; up to 20 pinned notes per room                                                                                                                                |
| Project milestones               | 100 per project, including archived milestones                                                                                                                                          |
| Bulk editing                     | Up to 100 tasks per batch; failures are reported per task                                                                                                                               |
| Connected thinking               | 100 custom note types, 30 fields per type, 50 choices per choice field; 100 relationship presets; 100 brainstorming boards, 30 groups and 200 ideas per board                           |
| Personal templates               | 200 entries including deleted templates, 2 MB per account library, 120 KB per template                                                                                                  |
| Workspace Trash                  | Stored separately from the active workspace allowance; retained without automatic expiry                                                                                                |
| Teamwork                         | 200 members and pending invitations per team; 500 watched items per account/workspace; 10,000 recent activity events per workspace and 1,000 recent Notifications per account/workspace |
| Shared editing                   | 100,000 Markdown characters and 1 MB editing state per note; presence for up to 30 tabs per account/workspace                                                                           |
| Offline workspace copies         | 8 copies per browser origin, up to 2 MB of workspace text/metadata per copy                                                                                                             |
| Offline attachments              | 100 saved attachments per workspace, 25 MB per cached file, 100 MB total per browser origin; current uploads remain limited to 20 MB each                                               |
| Portable Markdown                | 200 notes, 400 files, 24 MB expanded content, 25 MB ZIP, 20 MB per attachment; normal note/workspace limits still apply                                                                 |
| Public app cache                 | Up to 50 MB per build; the current and one earlier shell build are retained                                                                                                             |

Archived note history, Trash, personal templates, and uploaded file bytes do not count toward the active workspace allowance. Team permissions, activity, watches, Notifications, and shared editing state are stored separately too, with the limits above. Archived note versions, Trash, and unreferenced attachment files are retained without automatic deletion; complete backups preserve confirmed data. Owners and Admins can use **Workspace settings → Storage & recovery** to check active usage, retained files, and missing attachments without deleting files. Note history loads in pages of 20 versions. Change-impact markers indicate possible consequences; review connected content before acknowledging them.

Browser storage limits can be lower than these allowances. Offline copies and application files use separate browser storage from the server's database and uploads. Complete backups restore confirmed server work; they cannot restore cleared browser copies or unsynchronized queued edits.

## Troubleshooting

| Problem                             | What to check                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser did not open                | Open `http://127.0.0.1:5173` after the console reports readiness.                                                                                                   |
| Address will not load               | Keep the server console open; check its error before restarting.                                                                                                    |
| Port 5173 is occupied               | Wait for a starting ProjectAnvil instance or close the program using that port. The launcher does not kill other programs.                                          |
| Node is missing                     | Install Node.js 22.13+ and restart your terminal or VS Code. The Windows launcher expects the standard installation path.                                           |
| Dependencies are missing            | Run `npm run install:ci` from the repository folder. This needs internet access.                                                                                    |
| Saving failed                       | Read the error and use Retry saves; review conflicting edits in their editor. Download a recovery copy before discarding pending work.                              |
| Old app version after source update | Stop the old server and relaunch normally; in Settings check for a prepared update, close other app windows, then restart to update.                                |
| Offline copy does not reopen        | Use the same browser profile and exact address. Prepare application files and save the workspace copy while connected first.                                        |
| Offline copy cleared after restore  | A restored server can have older access records. Reconnect to verify access, then explicitly save a fresh offline copy. Queued changes remain available for review. |
| Missing offline attachment          | Save attachments while connected; changed files or access rules can invalidate earlier copies. External media needs its own connection.                             |
| Queued changes need review          | Compare device and confirmed values in Review queued changes. Reconnect before applying reviewed replacements; download unresolved work first.                      |
| Browser storage is full             | Keep unresolved recovery downloads, synchronize, and remove unused offline copies. Request persistent storage when offered; keep backups.                           |
| Folder transfer fails               | Check UTF-8 notes, ZIP/path warnings, file sizes and counts, available storage, and current project access. Split a large transfer.                                 |
| Database or migration error         | Back up the complete state and secret. Do not delete `.wrangler` or blindly rerun initial SQL.                                                                      |

## Development notes

The portable execution profile is the default for a fresh checkout. `.openai/hosting.json` declares the local `DB` and `BUCKET` bindings; it does not publish the app. Preserve that tracked configuration when moving or updating the source.

Startup creates a signing secret if missing and applies the idempotent account, access, work-room, reliability, activity, notification, and shared-note schemas without resetting existing records. Schema definitions live in `db/auth.sql`, `db/access.sql`, `db/workrooms.sql`, `db/reliability.sql`, `db/collaboration.sql`, and `db/note-collaboration.sql`. Legacy members default to Editor through separate role tables, preserving the original membership records. Legacy note snapshots migrate atomically into the archive alongside a successful workspace write. Other schema changes need a reviewed migration and a complete backup; generating SQL does not apply it.

Useful checks:

```sh
npm run check
```

Checks include TypeScript, lint, backend/draft/offline/portability regressions, public-cache policy and update tests, temporary-fixture backup restoration, and a production build. Backend tests use in-memory SQLite and a fake file bucket; backup tests use temporary fixture directories. They do not modify saved workspaces. GitHub Actions runs the same checks on pushes and pull requests. Building the app does not publish it. See [GitHub setup](../GITHUB.md) for source control and [LOCAL_ONLY.md](../LOCAL_ONLY.md) for the current local-operation policy.
