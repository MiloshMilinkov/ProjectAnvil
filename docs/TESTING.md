# Browser checks and performance measurements

[Project overview](../README.md) · [Local setup and backups](LOCAL_SETUP.md)

The browser and performance commands launch a built app with a fresh local database, file bucket, signing secret, and test accounts. Each server copies the built server and browser files into its own run directory, keeping offline-cache fingerprints consistent if the main build later changes. Everyday ports and existing servers are never reused. Test servers use their own state and secret instead of the normal `.wrangler/state` and `.dev.vars`; your everyday installation data is not changed.

## Prepare once

Install project dependencies, then download the official browser test runtimes:

```sh
npm run install:ci
node node_modules/@playwright/test/cli.js install chromium firefox webkit
```

The browser suite uses [Playwright's isolated browser contexts](https://playwright.dev/docs/browser-contexts) for separate sign-ins. These are disposable test sessions, independent of your everyday browser profile.

## Run the checks

```sh
npm run check
npm run test:browser
npm run test:performance
```

Each browser/performance command builds the app if its source changed, starts its own loopback server on an available test port, and stops that server when finished. Run performance measurements by themselves for a cleaner comparison. Nothing is hosted or synchronized to a cloud service.

The browser suite runs each engine against a fresh installation with two UI-registered accounts. Workflows cover private/team access, revocation, conflicting and simultaneous editing, offline recovery, Undo, portability, keyboard/mobile controls, and all five themes. Recovery follows real local account links. Additional checks cover delayed save acknowledgements, interrupted uploads, a committed upload with a lost response, a 36-hour simulated offline interval, a real waiting service worker blocked by pending edits, and large-list/board controls. Clock simulation checks recovery across elapsed time; it is not a 36-hour hardware endurance test. Screenshots and traces help diagnose failures.

Chromium runs the full five-theme desktop/mobile matrix in detailed workflows. Firefox and WebKit use Focus at both widths in repeated capture loops, retaining every functional/security assertion; the dedicated appearance workflow still checks all five themes. This avoids duplicating the same visual matrix in every engine while retaining coverage of Focus's split surfaces and narrow layouts.

Controllable network-race fixtures temporarily suspend service-worker registration where necessary, then restore it. The session-rotation race holds real network requests, checks that ordinary account refreshes keep them active, then verifies cancellation after a password change and preservation of the current UI. Password changes, independent-session revocation, and saved content use the real server. Offline and update workflows retain the real worker; the WebKit update fixture injects a narrow failed save in the page. This accounts for [Playwright's documented service-worker interception limits](https://playwright.dev/docs/network#missing-network-events-and-service-workers) without skipping account or recovery assertions.

WebKit's deliberate unregister/reinstall fixtures also clear only `projectanvil-shell-v1-*` public caches in their isolated test profile. A minimal local worker reproduced lost cache writes after unregistering; resetting that public cache passed five consecutive reinstalls. Private IndexedDB, cookies, and workspace copies remain intact. Ordinary offline and update workflows keep their worker and caches.

Deferred-screen recovery uses a temporary JavaScript 503 response with `Cache-Control: no-store`. Native protocol cancellation left this Windows WebKit runtime reporting an internal resource error even after reload; actual offline and interrupted-transfer workflows still exercise transport failures. Recovery checks keep queued edits safe, verify the saved server content, and exercise the explicit reload choice when in-place retry cannot recover.

Shared-edit cleanup uses the ordinary workspace switcher, avoiding an unnecessary page reload. A separate minimal local reproduction showed that WebKit can report properly caught requests started during page exit as access-control errors. Required reloads and closes mark only their explicit document-exit interval: an exact native error name/stack for this disposable origin's API is recorded as a separate browser diagnostic during that interval. All other page errors remain fatal, and every saved-content, access, queue, and offline-recovery assertion remains enforced.

Backend release checks exercise local/online policy boundaries, private recovery mail, streamed request limits, sanitized session controls, and migration history/drift. Migration rehearsals upgrade legacy fixtures, inject a failed atomic migration, retry, verify online startup without schema writes, and restore a pre-upgrade SQLite backup. All databases and email transports are disposable or simulated; no real mail or cloud resources are used.

Interface checks use the current labels in navigation, search, dialogs, and guides. Invalid workspace JSON shows a readable error before any import request is sent, leaving the saved workspace unchanged. The copy/readability review also checked seven empty views across five themes at desktop and 320 px widths, including board text sizes, touch targets, consistent guest naming, and an empty canvas without a false Saved status. This visual matrix was a local review; the maintained browser command above runs the browser workflows.

Useful browser options:

```sh
npm run test:browser -- --grep "offline"
npm run test:browser -- --project=chromium
npm run test:browser -- --headed
```

Tests create only two accounts per run to stay within the application's normal registration limits. They do not weaken authentication, permission checks, or rate limits.

### Outstanding local verification

Chromium checks pass. WebKit's account, permission, offline, formatting, cleanup, paging, and update checks pass across focused runs, but one simulated deferred-screen recovery case remains unresolved: queued-work protection and synchronization pass, while Collections still cannot load after retry and an explicit reload. The runtime reports an internal module-resource error. Keep this failing assertion visible and investigate it before claiming complete cross-browser readiness. Firefox cannot launch on this Windows installation because a native runtime prerequisite is missing; its Linux CI job is configured but has not been run here.

## Performance profiles

`npm run release:check` validates the command environment without contacting services. `npm run release:rehearse` verifies migrations, complete backup/restore, and rollback using owned temporary fixtures. The normal test suite covers redacted configuration/health failures, mock email delivery, cleanup permissions/review expiry/races, attachment references, and retryable bucket-deletion failures. See [local release checks](LOCAL_SETUP.md#local-release-checks) for private settings and limitations.

Two synthetic accounts each receive a private workspace, and share a team workspace. All three workspaces receive each profile in turn:

| Profile | Projects per workspace | Tasks | Notes | Canvases | Relationships |
| ------- | ---------------------: | ----: | ----: | -------: | ------------: |
| Small   |                      5 |   100 |    25 |        3 |           100 |
| Medium  |                     20 |   500 |   100 |        6 |           400 |
| Large   |                     40 | 1,000 |   200 |       10 |           800 |

The large profile approaches the existing active-text allowance without increasing it. The benchmark measures full and conditional reads, parallel saves to different tasks at concurrency 2/5/10, conflicting edits, retry receipts, restricted project access, and rejected oversized imports. Browser measurements cover bounded task lists, page navigation, filtering, global search, notes, the relationship graph, and a populated canvas. A live-update study checks an idle long-poll window and wake-up after a real save, reporting request duration and response bytes. A separate 21-second browser observation crosses two ordinary account refreshes, checking that live requests remain connected and normal workspace polls retain their cache validators. Backend regressions count workspace-access queries and verify that the lighter marker path still rejects revoked membership.

```sh
npm run test:performance -- --mode baseline
npm run test:performance -- --mode optimized
npm run test:performance -- --study typing --mode baseline
npm run test:performance -- --study typing --mode optimized
```

Both modes execute the same workload; the label selects the report filename. Reusing a label overwrites its previous JSON report. Capture a baseline before changing app code, then compare another run after rebuilding. Reports include the public build version and source fingerprint; a build change during measurement fails the run. Run one study at a time without rebuilding concurrently. API read metrics report median and p95 from eight samples. Browser interaction timings are observations from two independent account sessions and include automation overhead; they are not browser p95 estimates. Hardware, background activity, and cache warm-up affect results. Correctness failures stop a run; absolute speed is not a machine-independent pass/fail threshold.

The separate typing study performs five edits per mode per account (30 total) with workspace copies off, on while connected, and disconnected. It verifies the final server text after reconnecting. Its input-to-save timing includes the intentional autosave delay.

## Practical local trial

Use one actual project for several ordinary work sessions before an online beta. Create a few tasks and linked notes, change dates and priorities, find older work, use a saved view, and resume a work room. Try the same work on a narrow screen and with the keyboard. Make a complete backup and verify it before any cleanup or update.

Record concrete friction: the action, what you expected, what happened, and whether work remained safe. Prioritize lost work, misleading save/access feedback, and repeated navigation or slowness before requesting new tools. Scripted tests cannot substitute for everyday use or a physical-device check; this trial does not create demo records automatically.

## Reports and privacy

- `outputs/browser/`: HTML report, failure screenshots/traces, and synthetic proof screenshots.
- `outputs/performance/baseline.json` and `optimized.json`: measurements and data-safety assertions.
- `outputs/performance/note-edit-baseline.json` and `note-edit-optimized.json`: typing and save-feedback measurements.
- `work/qa/`: disposable server configurations, logs, and local test data from each run.

These directories are ignored by Git. Treat test traces and server run directories as private debugging material even though fixture accounts contain no real personal information. Never publish a full browser profile, active local database, or signing secret. Test run directories can be removed after their owned test server has stopped; preserve any reports needed for comparison first.

GitHub Actions runs the existing type/lint/backend/build checks, then separate Chromium, Firefox, and WebKit browser jobs with official browser prerequisites. Failed browser runs retain diagnostic artifacts for seven days. This workflow does not deploy the app. Some Windows installations require additional Firefox native runtime prerequisites; an engine launch failure is not a passing app test. Use the supported engine selector locally and run all engines in CI. Review both production and full toolchain findings in [Dependency security](DEPENDENCY_SECURITY.md) when updating packages.
