# Local-only workspace

The user requested local-only operation on 2026-10-19. Do not publish, push source to hosting, create a site, or sync the active workspace with a cloud service unless the user explicitly requests it. Publishing this source repository to GitHub from VS Code is a separate, user-controlled action and does not authorize hosting the app.

Start with **Start ProjectAnvil.cmd** and open **http://127.0.0.1:5173**. This address is available only on this PC. Keep the console window open while using the app. Accounts and team workspaces do not change that network access or publish anything. No extra account setup or manual database step is needed when starting the app.

The original guest workspace remains separate and available without registration. Register with an email address, a username, and a separate ProjectAnvil password. Sign in with username and password. Each account has a private personal workspace. A team workspace shares its projects, tasks, notes, canvases, and media with accepted members. Create or select a team workspace before creating a project to be shared; project transfers are not implemented. Owners invite existing registered usernames inside the app. No invitation emails are sent, and an invitation must be accepted to grant access. People labels do not grant access. Signing out returns to the preserved guest workspace; nothing is copied automatically.

App data, accounts, team memberships, sessions, and uploads are stored under `.wrangler/state`. Keep backups private and preserve that folder. The launcher creates a private `.dev.vars` session signing secret if it is missing; preserve this file with the matching state backup and never commit secrets. Both are ignored by Git. Stop the app before backing up or restoring the complete state and secret.

Better Auth 1.7.11 and its username plugin handle registration, passwords, and sessions. Passwords use 12–128 characters. Usernames use 3–30 letters, numbers, underscores, or dots and are not case-sensitive. No Google sign-in, email verification, password-reset mailer, or mail service is configured. The runtime applies the idempotent schemas in `db/auth.sql` and `db/access.sql` automatically while preserving existing records.

`.openai/hosting.json` declares the local DB and BUCKET bindings; it has no hosted project identity and does not publish the app.
