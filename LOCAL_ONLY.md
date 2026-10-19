# Local-only workspace

The user requested local-only operation on 2026-10-19. Do not publish, push source to hosting, create a site, or sync the active workspace with a cloud service unless the user explicitly requests it. Publishing this source repository to GitHub from VS Code is a separate, user-controlled action and does not authorize hosting the app.

Start with `Start Forgeboard.cmd`. App data and uploads are stored under `.wrangler/state`. Keep backups private and preserve that folder. `.openai/hosting.json` declares the local DB and BUCKET bindings; it has no hosted project identity and does not publish the app.
