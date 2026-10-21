# ProjectAnvil contributor instructions

## Keep documentation current

- Update `README.md` in the same change whenever a user-facing feature is added, changed, renamed, or removed. The README is the public GitHub feature overview.
- Keep the README concise, scannable, and accurate. Describe implemented behavior; label any future ideas clearly. Use broad project/task language while retaining creative and everyday template examples.
- Update the in-app guided tour for every new user-facing feature. Keep feature names, theme names, template lists, and any stated tour count consistent with the app.
- Keep detailed startup, backup, restore, storage-limit, and troubleshooting instructions in `docs/LOCAL_SETUP.md`; link to them from the README. Update `GITHUB.md` when source-control instructions change.
- Use repository-relative links in public Markdown. Exclude private workspace records, secrets, local backup locations, and machine-specific account information from public examples or screenshots.

## Local operation

Follow `LOCAL_ONLY.md`. Editing documentation or preparing Git commits does not authorize hosting, deployment, cloud synchronization, or pushing to a remote repository.

## Interface quality

- Follow [the interface standards](docs/UI_STANDARDS.md) for all UI and UX changes, including future features.
- Reuse the app's shared design tokens and controls. Preserve all five themes and readable, keyboard-accessible desktop and mobile layouts.
- Complete the responsive, keyboard, theme, affected-workflow, and documentation checks in that standard before treating an interface change as finished.
