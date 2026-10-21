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

Once dependencies are installed, core local notes, tasks, media, graphs, and canvases can work without internet access. External websites and externally hosted media still require a connection. This is not an offline editing queue or a synchronization service.

## Accounts and workspace access

Register with an email address, username, and a separate ProjectAnvil password. Passwords use 12–128 characters; usernames use 3–30 letters, numbers, underscores, or dots and are not case-sensitive. Sign in with username and password. Google sign-in and email services are not configured.

Every account has a private personal workspace. Create or select a team workspace before creating shared projects. Owners invite existing registered usernames, and invitations must be accepted inside the app. All accepted members can access the team's workspace; owners manage membership and members can leave. People labels and task assignments do not grant access. Guest records are separate and return when you sign out; signing in does not copy them into an account.

Work rooms belong to the account and workspace where they were created, including team workspaces. Guest rooms belong to the local guest workspace. Relationships and their review state belong to the workspace and are shared with its accepted members.

## Data and backups

ProjectAnvil stores its database and uploaded files under **`.wrangler/state`**. The private **`.dev.vars`** file contains the account session signing secret. Preserve both together. They and local backups are excluded from Git.

| Backup option | Includes | Excludes |
| --- | --- | --- |
| **Workspace settings → Export workspace** | Active workspace notes, tasks, discussions, labels, projects, saved views, relationships, and canvas layouts | Attachment files, accounts, sessions, membership, invitations, and personal rooms/checkpoints |
| **Complete local backup** | Database, uploads, accounts, membership, sessions, room checkpoints, and relationship review state | Nothing in the copied state; preserve the matching source version and signing secret too |

### Make a complete backup

1. Stop ProjectAnvil and wait for the server to exit.
2. Copy the entire **`.wrangler/state`** folder and **`.dev.vars`** file to a dated backup on another drive.
3. Keep the matching project source version with it. Preserve hidden files when copying the entire project folder, and keep the backup private.

Git commits preserve source code. They do not preserve your app records, uploaded media, or private signing secret.

### Restore a complete backup

1. Stop the app.
2. Preserve a separate copy of the current state and `.dev.vars`.
3. Replace them with the matching backed-up state and secret, then start the matching project version.

Do not combine individual database files from different backups or reinitialize the database as a troubleshooting shortcut.

### Import a workspace export

Export the current workspace first. Import replaces records only in the active workspace after confirmation. Imported relationships start reviewed against the imported content, clearing previous review markers. Personal work rooms are stored separately and are not restored from JSON; pins to removed records are pruned. Attachment references in JSON need their corresponding files in storage.

## Storage limits

| Item | Current limit |
| --- | --- |
| Workspace text and metadata | 1.5 MB total; uploads are separate |
| Uploaded file | 20 MB per file |
| Note content or task description | 100,000 characters, subject to total workspace size |
| Workspace collections | 1,500 tasks · 1,000 notes · 500 people · 100 projects · 100 canvases · 500 attachments · 2,000 meaningful relationships |
| Note history | Up to 12 earlier content versions, normally spaced at least 30 seconds apart |
| Linked task source quote | 8,000 characters |
| Work rooms | 30 per account/workspace; up to 20 pinned notes per room |

History counts toward the workspace text allowance. Use exports or complete backups for longer-term recovery. Change-impact markers indicate possible consequences; review the connected content before acknowledging them.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Browser did not open | Open `http://127.0.0.1:5173` after the console reports readiness. |
| Address will not load | Keep the server console open; check its error before restarting. |
| Port 5173 is occupied | Wait for a starting ProjectAnvil instance or close the program using that port. The launcher does not kill other programs. |
| Node is missing | Install Node.js 22.13+ and restart your terminal or VS Code. The Windows launcher expects the standard installation path. |
| Dependencies are missing | Run `npm run install:ci` from the repository folder. This needs internet access. |
| Saving failed | Keep the tab open, read the error, and retry before closing the app. |
| Database or migration error | Back up the complete state and secret. Do not delete `.wrangler` or blindly rerun initial SQL. |

## Development notes

The portable execution profile is the default for a fresh checkout. `.openai/hosting.json` declares the local `DB` and `BUCKET` bindings; it does not publish the app. Preserve that tracked configuration when moving or updating the source.

Startup creates a signing secret if missing and applies the idempotent account, access, and work-room schemas without resetting existing records. Schema definitions live in `db/auth.sql`, `db/access.sql`, and `db/workrooms.sql`. Other schema changes need a reviewed migration and a complete backup; generating SQL does not apply it.

Useful checks:

```sh
npx tsc --noEmit
npm test
npm run build
```

Backend checks use an in-memory SQLite database and a fake file bucket; they do not modify saved workspaces. Building the app does not publish it. See [GitHub setup](../GITHUB.md) for source control and [LOCAL_ONLY.md](../LOCAL_ONLY.md) for the current local-operation policy.
