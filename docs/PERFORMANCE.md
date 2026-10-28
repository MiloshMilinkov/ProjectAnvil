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

## Remaining capacity work

1. **Storage granularity:** active records still share one workspace snapshot and revision. Larger teams would benefit from independently stored/queryable records and incremental updates. Design and rehearse that migration before increasing limits.
2. **Large lists:** the current task list renders all matching rows. Evaluate accessible pagination or virtualization with keyboard, touch, saved views, bulk selection, and mobile layout before changing that interaction.
3. **Notes and visual views:** profile long note lists, large relationship networks, and canvases beyond this workload; retain meaningful link/access checks while reducing repeated preview and impact calculations.
4. **Broader environments:** add Firefox/WebKit and physical mobile checks, slower CPU/network profiles, and longer offline queues. Chromium viewport testing does not represent every device.
5. **Hosted load:** repeat the workload in a future approved staging environment. Local timings do not establish online service capacity.

Raw reports remain under ignored `outputs/performance/`. See [Testing](TESTING.md) for the same workload and report labels when comparing another build.
