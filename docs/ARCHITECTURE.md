# Project structure

[Project overview](../README.md) · [Interface standards](UI_STANDARDS.md) · [Testing](TESTING.md) · [Local setup](LOCAL_SETUP.md)

ProjectAnvil uses React and Next-style app routes, built with Vinext and Vite. The local worker supplies the API, database binding, and file bucket. The browser calls the same API for guest, personal, and team workspaces.

## Where code belongs

| Location | Responsibility |
| --- | --- |
| `app/page.tsx`, `app/layout.tsx` | Entry point, metadata, global styles, themes, and installation support. |
| `app/components/AccountShell.tsx` | Account/session refresh and switching between accessible workspaces. |
| `app/components/ProjectAnvil.tsx` | Application navigation, project scope, and composing feature screens. Keep detailed feature rendering outside this file. |
| `app/components/dashboard/`, `tasks/`, `settings/`, `shell/` | Focused dashboard, task views, workspace settings, and navigation definitions. |
| `app/components/visuals/` | Graph and canvas views, their local models, canvas inspector/add dialog, media rendering, and surface sizing. |
| `app/components/notes/`, `app/lib/note-browser.ts`, `app/lib/note-template-catalog.ts` | Note browsing and dialog presentation, pure search/filter indexing, and the single built-in template catalogue. `Knowledge.tsx` retains editor persistence and collaboration coordination. |
| `app/components/` | Notes, projects, collections, teamwork, shared controls, dialogs, and cross-feature React hooks. Feature styles live alongside their components. |
| `app/lib/` | Domain types and validation, pure transformations, browser storage utilities, and server persistence modules. Their runtime boundaries are described below. |
| `app/api/` | Request handlers for workspaces, accounts, teams, media, collaboration, and portability. Delegate business rules and persistence to `app/lib/`. |
| `db/`, `drizzle/` | Database schemas and checked-in SQL migrations; preserve existing data when changing them. |
| `public/` | Static icons, install manifest, and service worker. Private workspace content does not belong here. |
| `scripts/`, `build/` | Maintained startup, build, backup, test-runner, and local worker integration code. `build/` contains source; `dist/` contains generated output. |
| `tests/` | Model/API regression checks, isolated browser workflows, and synthetic performance workloads. |
| `docs/` | Maintained contributor and operating guides; the README remains the public feature overview. |

## Keep responsibilities separate

- Put rendering and interaction state in the relevant feature component. Extract a cohesive dialog, panel, or view when it has a clear responsibility; avoid splitting solely to shorten a file.
- Keep React lifecycle work in hooks. `useWorkspaceData` owns workspace reads, acknowledged writes, queued changes, and offline reconciliation. Editor hooks own recoverable drafts; `useCanvasPersistence` owns canvas draft/save recovery. Reuse these paths instead of adding another save queue.
- Keep domain rules and transformations independent of React and network requests. Shared examples include `workspace-model`, `task-scheduling`, `relationships`, and `portable-markdown`. A pure helper used only by one feature may stay beside that feature, as the graph and canvas models do.
- Server modules such as `access-store`, `workspace-store`, `workspace-journal`, and `media-store` resolve access and persist data. Client components must not import their runtime code. Browser modules such as `draft-store`, `offline-store`, and `browser-preferences` serve a different purpose; a `store` suffix alone does not mean a module is server-only.
- Import shared types with `import type`. Keep dependencies flowing from screens to hooks/models and from API handlers to server stores/models. Models must not import components, and feature folders must not import the application shell. Move genuinely shared logic downward rather than creating circular imports or compatibility barrels.

## Data and access ownership

The local server is authoritative for saved work. Workspace mutations validate inputs, check account/workspace/project permissions, and use revisions and journal receipts to handle conflicts and retries. Browser permission controls improve the interface; they do not replace server checks.

Guest, personal, and team workspaces remain separate. Pass the current workspace/account scope through the existing fetch and draft helpers. Preserve that scope in caches, recovery records, queued writes, media requests, and simultaneous note editing. Never merge an old account's pending work into the newly selected workspace.

Explicit offline copies and pending browser drafts are recovery data, separate from server state and installation caches. Keep their conflict, revoked-access, and failed-save handling intact when reorganizing code. Database state, uploaded files, signing secrets, backups, and test output stay outside Git; see [Local setup](LOCAL_SETUP.md) for their operation and recovery.

## Making a change

1. Extend the owning feature and model instead of adding a parallel implementation. Keep persisted formats compatible or provide an explicit migration.
2. Add regression coverage for changed rules, permissions, recovery, or concurrency. Use isolated synthetic accounts and test storage; never point tests at everyday application data. See [Testing](TESTING.md) for commands and coverage.
3. Check affected desktop/mobile workflows, keyboard interaction, and all five themes against the [interface standards](UI_STANDARDS.md). Preserve existing tour anchors and automation selectors during structural refactors.
4. Update the README for user-facing changes and the guided tour for new features. Keep operational detail in the existing setup/testing guides instead of adding duplicate documents.

Development, testing, and repository cleanup remain subject to [Local-only operation](../LOCAL_ONLY.md). Build tooling and database bindings do not authorize deployment, cloud synchronization, or a Git push.
