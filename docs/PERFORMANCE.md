# Capacity and performance review

[Project overview](../README.md) · [Run the measurements](TESTING.md)

## Scope

The local review on 27 October 2026 uses a production build, two synthetic accounts with separate private workspaces, and an accepted shared team workspace. No everyday installation data is used. Each of the three workspaces reaches 40 projects, 1,000 tasks, 200 notes, 10 canvases, and 800 relationships, with about 1.36 MB of active records.

The repeatable workload includes smaller profiles, owner and restricted-editor reads, unchanged conditional reads, parallel writes at concurrency 2/5/10, same-field conflicts, idempotent retries, and rejection of an oversized import. A separate typing study performs five edits per mode per account (30 total) with offline copies off, on while connected, and disconnected.

Timings describe this local run. HTTP read median/p95 use eight samples. Parallel-write p95 describes each bounded batch. Browser navigation timings include automation overhead and are two independent-account observations, not browser p95 estimates. Typing-to-save includes the application's intentional 650 ms autosave delay.

## Initial observations

| Large-workspace operation                   |                       Initial observation |
| ------------------------------------------- | ----------------------------------------: |
| Owner full read, median / p95               |                                73 / 80 ms |
| Restricted editor full read, median / p95   |                                83 / 96 ms |
| Ten parallel distinct-task saves, batch p95 |                                  1,505 ms |
| Open task view                              |                                816–884 ms |
| Open global search and find a note          |                                611–619 ms |
| Open notes                                  |                            1,156–1,175 ms |
| Open relationship graph                     |                                400–416 ms |
| Open populated canvas                       |                                392–415 ms |
| Note input to paint, connected              | 19–24 ms median across the two copy modes |

All ten parallel saves to different tasks succeeded at every profile. Conflicting same-field edits produced one saved result and one explicit conflict; retrying the saved receipt did not create another revision. Personal and restricted-project boundaries held. The oversized import was rejected without changing confirmed records. The browser workload produced no JavaScript exceptions, and the typing study verified all 30 edits and final synchronized content.

## Focused improvements

- Keep the task view stable while shell menus and global search change; use indexed task-status and assignee lookups.
- Skip offline snapshot serialization and validation when the workspace has not been selected for offline use. The storage transaction still rechecks removal and access changes.
- Reuse an already verified, correctly scoped workspace when there are no queued offline changes, avoiding unnecessary deep copies and redraws.
- Keep note-detail overlays below global header menus while preserving note dialogs above the application.
- Update the pinned framework and URI dependencies to clear the audit findings ([Next.js advisory](https://github.com/advisories/GHSA-673q-mjm6-r5xr), [fast-uri advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)). The final measured build includes these dependency updates too.

## Comparison after the changes

Both builds completed the same three-profile workload with all access, conflict, retry, quota, and successful-write assertions passing. All ten distinct-task saves succeeded in every tested batch. Both browser runs had zero JavaScript exceptions.

| Large-workspace operation                   |         Before |          After |
| ------------------------------------------- | -------------: | -------------: |
| Global search and note result               |     611–619 ms |     219–242 ms |
| Open task view                              |     816–884 ms |   834–1,016 ms |
| Open notes                                  | 1,156–1,175 ms | 1,146–1,161 ms |
| Owner read, median                          |          73 ms |          73 ms |
| Restricted editor read, median              |          83 ms |          84 ms |
| Ten parallel distinct-task saves, batch p95 |       1,505 ms |       1,696 ms |

Global search improved by about 63% using the mean of the two account observations. The other operations did not show a consistent improvement; initial large-list rendering and whole-workspace saves remain priorities. These are local observations with automation overhead and host variation, rather than isolated microbenchmarks or a general speed guarantee.

The browser regression run before the structure cleanup passed all eight workflows, including two actual UI sign-ins, project access changes, conflicting and simultaneous edits, offline recovery, import/export, and pointer/keyboard controls across the five themes. The existing type, lint, backend, backup, cache-policy, and build checks passed; the production dependency audit reported zero vulnerabilities.

The repeated typing study verified another 30 edits and their final server content. Median input-to-paint remained 18–33 ms across the tested account/mode combinations. Median save feedback remained 848–933 ms including the intentional 650 ms delay; it did not demonstrate a consistent save-speed improvement.

## Structure cleanup verification

The same three-profile workload passed after separating the task, dashboard, settings, note-browser, graph, and canvas modules and removing unused starter packages. All access, conflict, retry, quota, and write-retention assertions passed again, with no browser JavaScript errors. At the large profile, task opening measured 817 ms for both accounts, note opening 1,130–1,131 ms, note filtering 48 ms, global search 224–259 ms, and ten concurrent saves had a batch p95 of 1,528 ms. These observations support workflow preservation; they do not establish a general speed improvement from restructuring alone.

The expanded browser suite passed **nine workflows**, including combined note filters, clear/reset counts, preserved project/editor scope, viewer controls, and ten theme/viewport screenshots. Type, lint, model/API, backup, offline-cache, migration-fingerprint, and production-build checks passed. Production audit findings remain zero; the outstanding development-tool advisory is recorded in [Dependency security](DEPENDENCY_SECURITY.md).

The earlier reports are preserved in ignored `outputs/performance/before-structure-cleanup/`. The structure-cleanup report, build `f36206324109b908b691`, is also retained in `outputs/performance/before-debloat/optimized.json` before the latest rerun.

## Size and maintenance review

The 28 October 2026 review separates Git source, installed development dependencies, and generated browser files. The original checkout had **330 source/configuration/test/documentation files** totaling **3,406,588 bytes**. Dependencies occupied **1,100,175,437 bytes** across **51,862 files**; these are ignored by Git. Existing private data, backups, and debugging records were preserved.

The cleanup removes unused connector integration and orphan helpers, consolidates note styles while separating renderer-only CSS, and replaces redundant framework/formatting packages with the existing Vinext runtime and direct formatters. Optional screens have one loading/retry boundary; syntax and math load only for parsed content that needs them. WOFF2 retains all math font families while avoiding two obsolete copies of each font.

| Measurement | Before | After |
| --- | ---: | ---: |
| Reviewable source/configuration/test/documentation files | 330 | 317 |
| Installed dependency files | 51,862 | 40,986 |
| Installed dependency bytes | 1,100,175,437 | 776,930,197 |
| Startup JavaScript, raw | 1,762,940 | 1,047,317 |
| Startup JavaScript, gzip | 518,544 | 314,732 |
| Complete offline app bytes | 8,505,175 | 7,436,909 |
| Math font files | 60 | 20 |
| Generated offline app files | 185 | 198 |

Installed dependency bytes decreased **29.4%**, raw startup JavaScript **40.6%**, and complete offline bytes **12.6%**. Generated file count increased because optional screens now have independent chunks; reviewed source file count decreased by 13. Useful slides, pop-out notes, structured properties, and workspace tools remain because their removal would save little or complicate existing work. Reports are retained under ignored `outputs/size/`; the initial source count is from the clean Git checkout, while the baseline runtime report was captured before rebuilding.

Collections now builds groups in one pass and caches snapshot-derived indexes. A regression with 1,000 distinct groups checks 1,000 group-value reads instead of the former 1,001,000. Its property writer also includes the required record ID in revision comparisons, fixing rejected property saves. Backup verification retains both the original failure and a cleanup failure rather than losing one error.

Use `npm run size:report -- --disk --out outputs/size/review.json` after a current production build. Reports include raw/gzip bytes for the browser entry and static dependency closure of AccountShell, ThemeControls, and AppInstallation. They exclude optional dynamic imports; this is a build footprint measure, not a network timing or browser-memory benchmark. Offline bytes include optional features so prepared offline work retains them. Code splitting may increase generated JavaScript file counts even when source files and byte totals decrease.

The finished build passed type/lint/API/model checks, 29 Node regressions, 15 two-account browser workflows, the new size budgets, and all three existing capacity profiles. At the large profile, all ten distinct-task writes succeeded, full owner reads measured 67 ms median, and task opening measured 816 ms for both account observations. Search measured 269–279 ms; it did not show a consistent improvement over the prior 224–259 ms. Access, conflict, retry, and quota assertions passed with no browser JavaScript exceptions. These local results support capacity preservation; the demonstrated improvement is payload size, not a general latency guarantee.

## Local release preparation

The account/recovery and migration preparation retains the existing size budgets: startup JavaScript stays below **1,250,000 bytes**, the complete offline app below **8,000,000 bytes**, and math fonts remain WOFF2-only. The verified release-preparation build uses **1,115,951 startup JavaScript bytes** and **7,497,201 offline bytes**. Compared with the preceding cleanup build, the additional controls and compatible framework update add about 69 KB to startup and 60 KB to the offline package. No account or email SDK was added; Better Auth remains the account implementation.

Account UI is separated into reusable access/recovery forms and menus instead of duplicating a second sign-in implementation. A session generation restarts requests carrying a previous cookie after password changes, preserving the unchanged workspace and dialog while normal revoked-access clearing remains in place. Same-browser tabs can receive a token-free session-change signal. Database upgrades reuse the existing SQL sources with a checksum ledger; offline review commands do not connect to cloud resources. Security/migration coverage uses disposable data and simulated email delivery.

Final verification passed strict types, zero-warning lint, backend/model and native Better Auth integration checks, 31 Node tests, and all 16 browser workflows. Twenty account security/gate screenshots cover five themes at desktop and 320 px widths. Held pre-rotation live requests are retired in both same-cookie tabs; separate sessions are revoked, and a project draft survives two permission refreshes. Both dependency audits report zero findings. Online gate visuals use a mocked local response; actual email delivery, HTTPS/proxy behavior, and hosted load still require future staging checks.

## Copy and readability review

The interface copy review retains **328 source files** and adds no dependencies. Navigation, search, forms, and guides share the same tool names; existing field/entity labels are reused in activity, conflicts, and recovery. Promotional headings, repeated badges, and the generic empty-state graphic were removed. Task-board supporting text and controls now use the shared readable type and height tokens.

The finished build passed the project checks, 31 Node tests, and all 16 browser workflows, including invalid-import feedback without changing saved data. A disposable visual review checked 70 page/theme/viewport cases and captured 95 screenshots; representative images were inspected after correcting guest naming, empty-canvas status, and board readability. Startup JavaScript is **1,114,607 bytes** and the complete offline app **7,495,301 bytes**, within the existing budgets. These measurements describe size and workflow preservation, not a latency improvement.

## Local readiness and bounded task rendering

The fresh comparison uses baseline build `8ff3c3b2a6d786a0aa5e` and final measured build `7d7e30b6abd57ea47769`. Both completed the same three populated profiles, with every access, conflict, retry, quota, and acknowledged-write assertion passing and no browser exceptions. Earlier reports are preserved in ignored `outputs/performance/before-readiness/`.

Task lists now render **50 rows per page** instead of every match. Boards start with **40 cards per status**, revealing more on request. Filtering, saved-view settings, totals, and bulk editing still use the complete result. Live revision checks skip unrelated personal-workspace initialization and project-grant loading; only marker fields leave this resolver. Normal record reads still load all grants, and each live tick rechecks sessions and consistent membership.

| Large-workspace operation | Before this batch | After |
| --- | ---: | ---: |
| Open Tasks | 1,067–1,134 ms | 233–234 ms |
| Filter a known task | 196–212 ms | 50–57 ms |
| Open global search and find a note | 305–307 ms | 50–101 ms |
| Owner full read, median | 101 ms | 60 ms |
| Ten concurrent saves, batch p95 | 1,950 ms | 1,368 ms |
| Initial list rows | 1,000 | 50 |

The new list-open measurement was 212–213 ms; the previous report did not time that action separately. These observations include automation overhead, host variation, and the other readiness changes, so they do not isolate every cause or establish online capacity. The rendering reduction is directly verified, including page navigation, matching counts, filters, all five themes, and keyboard/mobile controls.

The live study held **one unchanged request for 18.02 seconds**, returned a **73-byte marker**, and observed an actual save in **1.02 seconds** from the beginning of its held request. No workspace records were included. A separate **21.01-second browser observation** recorded two account refreshes, two conditional workspace reads, one live request, and no aborted live requests. A backend regression verifies two consistent membership/security queries for the marker path, compared with four workspace-access queries in the previous team path; session verification and revision reads remain separate and enforced.

Broader browser checks also exposed an account-refresh problem: a fresh but unchanged account object restarted read/live effects every ten seconds. `AccountShell` now retains identical complete payloads while still applying actual account/access changes. Session rotation retains its separate cancellation generation. Workspace responses also verify their captured request and permission scope before updating cache markers or recovery state; a late access denial cannot clear a newly authorized view. Owner/Admin project-map updates preserve open editors and guides because those roles already have every project; actual role, security, and member-grant changes still invalidate the scope. Regressions cover unchanged refreshes, changed verification/policy/permissions/invitations, explicit password/session cancellation, late responses across role changes, and creating a project while a guide is open.

Menu checks also found that WebKit pointer clicks can leave focus outside an opened account menu. Account/workspace menus now focus their selected or first enabled item; Escape closes the menu, restores its trigger, and leaves underlying editor panels alone. Pointer, keyboard, layering, theme, and narrow-layout regressions cover this behavior.

Cleanup focus now follows the committed review panel and re-enabled controls, avoiding a race with asynchronous rendering. Failed optional screens retain in-place retry and offer an explicit Reload app fallback when retry cannot recover. The shared reload guard flushes saves and rechecks newer edits, failed device writes, and queued operations before either feature recovery or an app update; reload is never automatic.

No dependencies were added. The final size check reports **336 maintained source files**, **1,118,091 startup JavaScript bytes**, **7,504,434 offline bytes**, and the same **20 WOFF2 math fonts**. The eight additional files contain cohesive cleanup/release code, its additive migration, and regression coverage; the existing size budgets remain unchanged.

At the end of that batch, strict types, zero-warning lint, backend/model/recovery checks, 34 native Node tests, and the production build passed. Browser verification still had a WebKit recovery failure and a Firefox launch failure; the follow-up below supersedes those temporary gaps.

## Browser-readiness follow-up

Build **`966b9e2d414ef093eef8`** excludes a dynamic entry from its own redundant preload while retaining transitive JavaScript and stylesheet preloads. This restores interrupted-screen retry in WebKit without adding runtime recovery code, dependencies, or cache-busting URLs. Collections retains 14 JavaScript and two stylesheet dependency preloads. The screen recovery regression now requires retry in the same document while preserving and synchronizing a real queued note edit.

Firefox's failure was reproduced in a minimal service-worker fixture: request interception prevented native offline navigation. Context-scoped session-race fixtures and a narrowly suspended test allowlist preserve genuine offline networking without weakening cache, account, Undo, or synchronization assertions. An unmodified Firefox runtime copy also resolved the local launch issue without an operating-system installation; the earlier missing-runtime diagnosis was not established.

The app remains at **336 maintained files**, **210 offline files**, and **20 WOFF2 math fonts**. Startup JavaScript is **1,117,739 bytes** (**337,187 gzip**); the complete offline package is **7,501,576 bytes**. Both existing size budgets pass. Full Chromium, Firefox, and WebKit runs pass **23 workflows each**, with no failures or skips; affected account/offline follow-ups also pass after the final fixture adjustment. Performance workloads were not rerun for this browser fix, so the preceding timings remain measurements of their stated build. See [browser verification](TESTING.md#browser-verification) for current coverage and remaining deployment checks.

## Remaining capacity work

1. **Storage granularity:** active records still share one workspace snapshot and revision. Larger teams would benefit from independently stored/queryable records and incremental updates. Design and rehearse that migration before increasing limits.
2. **Large lists:** task lists now render 50 rows per page and boards initially render 40 cards per status. Continue profiling long note lists, bulk-selection dialogs, and larger timelines before increasing record limits. Filters and bulk editing retain every match.
3. **Notes and visual views:** profile long note lists, large relationship networks, and canvases beyond this workload; retain meaningful link/access checks while reducing repeated preview and impact calculations.
4. **Broader environments:** browser projects and CI now include Chromium, Firefox, and WebKit, with delayed-save, upload interruption, and simulated long-offline recovery checks. Physical mobile devices, hardware endurance, and slower CPU profiles still need review; viewport and clock simulation do not establish those results.
5. **Hosted load:** repeat the workload in a future approved staging environment. Local timings do not establish online service capacity.

Raw reports remain under ignored `outputs/performance/`. See [Testing](TESTING.md) for the same workload and report labels when comparing another build.
