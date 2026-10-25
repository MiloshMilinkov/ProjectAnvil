# Local-only workspace

The user requested local-only operation on 2026-10-19. Do not publish, push source to hosting, create a site, or sync the active workspace with a cloud service unless the user explicitly requests it. Publishing this source repository to GitHub from VS Code is a separate, user-controlled action and does not authorize hosting the app.

Start with **Start ProjectAnvil.cmd** and open **http://127.0.0.1:5173**. This address is available only on this PC. Keep the console window open while using the app. Accounts and team workspaces do not change that network access or publish anything. No extra account setup or manual database step is needed when starting the app.

The original guest workspace remains separate and available without registration. Register with an email address, a username, and a separate ProjectAnvil password. Sign in with username and password. Each account has a private personal workspace. Team workspaces use Viewer, Editor, Admin, and Owner roles, with optional restricted project access. Owners and Admins always retain project access; workspace Viewers remain read-only. Select a team workspace before creating shared projects; moving projects between workspaces is not implemented. Owners and Admins invite registered usernames inside the app, with role limits. An accepted member can receive ownership from the current Owner, who remains an Admin. No invitation emails are sent. People labels do not grant access. Signing out returns to the preserved guest workspace; nothing is copied automatically.

Activity, mentions, Watch preferences, Notifications, live updates, and optional simultaneous Markdown editing run through this same local server. Notifications are in-app, without email or operating-system push. Shared editing needs each editor to choose **Edit together**; interrupted changes keep browser recovery. See the [teamwork guide](docs/LOCAL_SETUP.md#teamwork-and-shared-editing) for access, limits, and recovery details.

App data, accounts, team memberships, sessions, and uploads are stored under `.wrangler/state`. Keep backups private and preserve that folder. The launcher creates a private `.dev.vars` session signing secret if it is missing; preserve this file with the matching state backup and never commit secrets. Both are ignored by Git. Stop the app before backing up or restoring the complete state and secret.

Better Auth 1.7.11 and its username plugin handle registration, passwords, and sessions. Passwords use 12–128 characters. Usernames use 3–30 letters, numbers, underscores, or dots and are not case-sensitive. No Google sign-in, email verification, password-reset mailer, or mail service is configured. Startup applies the account, access, recovery, collaboration, and shared-note schemas automatically while preserving existing records; no manual database step is required.

`.openai/hosting.json` declares the local DB and BUCKET bindings; it has no hosted project identity and does not publish the app.
