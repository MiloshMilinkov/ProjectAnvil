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

If an existing browser cache cannot launch, choose a fresh project-local cache using Playwright's supported `PLAYWRIGHT_BROWSERS_PATH` setting. Keep the same setting for installation and testing; `work/` is excluded from Git. For example, in PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'work/browser-runtimes'
node node_modules/@playwright/test/cli.js install chromium firefox webkit
npm run test:browser
```

A browser launch failure is a setup failure, not a passing application test. The original Windows Firefox cache produced a `mozglue` assembly-activation error; an unmodified copy in the project's test directory launched successfully without installing system software. This does not establish a missing Microsoft runtime as the cause.

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

Firefox's test request routing interferes with native offline worker navigation. A minimal worker returning constant HTML reproduces `NS_ERROR_OFFLINE` with the interceptor installed and succeeds without it, with no server requests; page-level interception can also remain active after removing its rule. The session-rotation race therefore uses origin-scoped context rules that match the intended page. `setActorOffline` enables real offline mode before suspending only the fixture's own external-request guard, then restores that guard before reconnecting. It verifies both `navigator.onLine === false` and failure of an uncached API request. Real service workers, cached startup, account copies, queued changes, and synchronization assertions remain unchanged.

Deferred-screen recovery uses a temporary JavaScript 503 response with `Cache-Control: no-store`. WebKit retained the failed entry preload even after a document reload; the production build now excludes only the imported entry from its own preload list, preserving its dependency preloads. Recovery checks keep queued edits safe, block an unsafe reload, synchronize the actual note, and retry the screen without discarding work. Actual offline and interrupted-transfer workflows still exercise transport failures.

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

### Browser verification

On **2026-10-30**, build **`966b9e2d414ef093eef8`** passed complete **23-workflow runs in Chromium, Firefox, and WebKit: 69 passed, zero failed, skipped, or retried**. After the final session-fixture adjustment, the affected account-security/offline sequence was also repeated successfully in Chromium and WebKit. Code verification passed strict types, zero-warning lint, backend/model checks, 38 native Node tests, and the production build; the final browser-only fixture change passed types and scoped lint again.

Both reported failures were reproduced and fixed without reducing assertions. The screen test now requires in-place retry without reloading, while Firefox retains the complete account-security sequence before real offline reopening. The full Windows WebKit run took about 25 minutes; allow extra time locally or use the supported focused selectors during development. This is test-suite duration, not a measurement of ordinary app response time.

Local engine checks do not establish physical-device Safari behavior, hosted HTTPS/email delivery, or online service capacity. The changed workflow must run again on GitHub after the fixes are pushed; a previous failed run does not change retroactively.

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
- Each engine's `summary.json` contains structured workflow results. Failed runs also retain a bounded, sanitized server-log tail; database files, private settings, and the account-email outbox are excluded.
- `outputs/performance/baseline.json` and `optimized.json`: measurements and data-safety assertions.
- `outputs/performance/note-edit-baseline.json` and `note-edit-optimized.json`: typing and save-feedback measurements.
- `work/qa/`: disposable server configurations, logs, and local test data from each run.

These directories are ignored by Git. Treat test traces and server run directories as private debugging material even though fixture accounts contain no real personal information. Never publish a full browser profile, active local database, or signing secret. Test run directories can be removed after their owned test server has stopped; preserve any reports needed for comparison first.

GitHub Actions runs the existing type/lint/backend/build checks, then separate Chromium, Firefox, and WebKit browser jobs with official browser prerequisites. Failed browser runs retain diagnostic artifacts for seven days. This workflow does not deploy the app. Some Windows installations require additional Firefox native runtime prerequisites; an engine launch failure is not a passing app test. Use the supported engine selector locally and run all engines in CI. Review both production and full toolchain findings in [Dependency security](DEPENDENCY_SECURITY.md) when updating packages.
