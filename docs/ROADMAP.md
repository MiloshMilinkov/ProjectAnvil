# ProjectAnvil roadmap

All phases follow the [interface standard](UI_STANDARDS.md): readable and accessible on desktop and mobile, all five themes, recoverable changes, clear errors, and current README/tour documentation. Future hosting work remains a plan, not an implemented service. The app remains [local only](../LOCAL_ONLY.md).

**Current milestone: Phases 1–5 implemented locally.** Phase 5 includes installation, offline work and synchronization, and Markdown-folder portability. AI was excluded from this implementation. Teamwork and installation do not publish the app or enable remote access.

| Phase                             | Scope                                                                                                                                                                                         | Short test plan                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **1. Everyday workflow**          | Duplicate tasks; personal note/task templates; saved-view layout, rename and update; Trash, restore, and Undo.                                                                                | Check fresh IDs and reset completion, template privacy/reuse, saved filters/sort/layout, restored links, and concurrent edits.      |
| **2. Project planning**           | Project home combining tasks, notes, and canvases; milestones and parent tasks; bulk updates; recurring tasks and reminders.                                                                  | Check progress totals, hierarchy cycles, partial failures, date boundaries, and duplicate reminders.                                |
| **3. Connected thinking**         | Custom note types/properties and relationship presets; decision records; brainstorming with grouping and voting.                                                                              | Check export/import, valid links, accessible visual interactions, and personal/team access.                                         |
| **4. Teamwork**                   | Viewer/editor/admin roles, restricted projects, and ownership transfer; activity, mentions, watchers, in-app notifications, live workspace updates, and opt-in simultaneous Markdown editing. | Test separate accounts, revoked project/membership access, concurrent edits, retries/reconnects, and notification duplication.      |
| **5. Installation & portability** | Installable app and safe updates; explicit offline workspace/file copies, queued edits and reviewed synchronization conflicts; Markdown-folder/ZIP import/export with attachments.            | Test offline reopening/recovery, queue ordering/retries, conflicts, revoked access, portable links/files, and safe additive import. |

## Reliability work before an online release

- Isolate anonymous visitors or require login; the current guest workspace is intended for one local installation.
- Add email verification, account recovery, and session management; review production origins and request limits.
- Prepare larger-workspace storage, pagination, quotas, and retention; measure realistic loads and rehearse migrations.
- Review runtime/dependencies, automated browser coverage, monitoring, backup restore, and rollback. Include offline copies, queued changes, and access changes in release rehearsals.

## Future hosting sequence

1. Explicitly approve online deployment and decide access, domain, budget, and guest behavior.
2. Prepare separate staging and production resources. The current architecture fits Workers, D1, private R2, and Better Auth with limited migration.
3. Configure secrets, email delivery, HTTPS, permissions, monitoring, and verified backups.
4. Rehearse data migration and rollback on staging; run functional, responsive, security, and multi-account checks.
5. Start an invite-only beta, confirm recovery and performance, then consider wider access.

No hosting, cloud synchronization, or remote push is authorized by this roadmap.
