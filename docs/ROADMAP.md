# ProjectAnvil roadmap

All phases follow the [interface standard](UI_STANDARDS.md): readable and accessible on desktop and mobile, all five themes, recoverable changes, clear errors, and current README/tour documentation. Later phases are plans, not implemented promises. The app remains [local only](../LOCAL_ONLY.md).

**Current milestone: Phases 1–3 implemented.** Phases 4–5 are future work.

| Phase                     | Scope                                                                                                                                                    | Short test plan                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **1. Everyday workflow**  | Duplicate tasks; personal note/task templates; saved-view layout, rename and update; Trash, restore, and Undo.                                           | Check fresh IDs and reset completion, template privacy/reuse, saved filters/sort/layout, restored links, and concurrent edits. |
| **2. Project planning**   | Project home combining tasks, notes, and canvases; milestones and parent tasks; bulk updates; recurring tasks and reminders.                             | Check progress totals, hierarchy cycles, partial failures, date boundaries, and duplicate reminders.                           |
| **3. Connected thinking** | Custom note types/properties and relationship presets; decision records; brainstorming with grouping and voting.                                         | Check export/import, valid links, accessible visual interactions, and personal/team access.                                    |
| **4. Online teamwork**    | Viewer/editor/admin roles, project permissions and ownership transfer; activity, mentions/watchers/notifications; live updates/presence, then coediting. | Test separate accounts, denied/revoked access, concurrent edits, reconnects, and notification duplication.                     |
| **5. Later expansion**    | Installable app, offline editing/sync, Markdown-folder import/export with media; optional source-backed AI search and suggestions.                       | Test offline conflicts/reconnects, portable files/attachments, and suggestions requiring review.                               |

## Reliability work before an online release

- Isolate anonymous visitors or require login; the current guest workspace is intended for one local installation.
- Add email verification, account recovery, and session management; review production origins and request limits.
- Prepare larger-workspace storage, pagination, quotas, and retention; measure realistic loads and rehearse migrations.
- Review runtime/dependencies, automated browser coverage, monitoring, backup restore, and rollback.

## Future hosting sequence

1. Explicitly approve online deployment and decide access, domain, budget, and guest behavior.
2. Prepare separate staging and production resources. The current architecture fits Workers, D1, private R2, and Better Auth with limited migration.
3. Configure secrets, email delivery, HTTPS, permissions, monitoring, and verified backups.
4. Rehearse data migration and rollback on staging; run functional, responsive, security, and multi-account checks.
5. Start an invite-only beta, confirm recovery and performance, then consider wider access.

No hosting, cloud synchronization, or remote push is authorized by this roadmap.
