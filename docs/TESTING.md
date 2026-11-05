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

Formatting checks wait for highlighted markup after theme changes and other rerenders. The code text can appear before its lazy formatter finishes; an instantaneous element count is not a reliable completion check. Security assertions still verify that hostile note content creates no active nodes, unsafe URLs, or executed scripts, including after offline reopening.

First-use readiness waits for the actual guide when its saved preference is absent, dismisses it through **Skip guide**, and checks that the overlay is gone. Returning profiles no longer spend 1.5 seconds waiting for a guide they have already dismissed. A regression deliberately delays the onboarding animation frame beyond that old deadline.

Note-link startup waits for the initial workspace read when the requested note is absent from the saved offline copy. Previously, Notes could choose a cached fallback before the server returned the linked note, leaving the wrong note selected. A regression saves an older device copy, creates another note through the real API while the page is closed, and delays the next state read. It checks the requested title/content, keyboard Read controls, desktop/320 px layouts, absent-link fallback, and cached/absent links with native networking disabled. The real service worker and server response remain intact.

The external-request guard matches only disallowed origins, leaving local requests out of its route chain. This avoids a second continuation when Playwright removes a page fixture while a local request is in flight. A regression checks local fixture removal, blocked external navigation, and allowed blob/data reads. The storage layout check polls the measured document width after viewport changes, retaining the strict desktop/320 px limits and reporting the failing theme and usage case; it does not hide overflow or retry the entire test.

Chromium runs the full five-theme desktop/mobile matrix in detailed workflows. Firefox and WebKit use Focus at both widths in repeated capture loops, retaining every functional/security assertion; the dedicated appearance workflow still checks all five themes. This avoids duplicating the same visual matrix in every engine while retaining coverage of Focus's split surfaces and narrow layouts.

Controllable network-race fixtures temporarily suspend service-worker registration where necessary, then restore it. The session-rotation race holds real network requests, checks that ordinary account refreshes keep them active, then verifies cancellation after a password change and preservation of the current UI. Password changes, independent-session revocation, and saved content use the real server. Offline and update workflows retain the real worker; the WebKit update fixture injects a narrow failed save in the page. This accounts for [Playwright's documented service-worker interception limits](https://playwright.dev/docs/network#missing-network-events-and-service-workers) without skipping account or recovery assertions.

WebKit's deliberate unregister/reinstall fixtures also clear only `projectanvil-shell-v1-*` public caches in their isolated test profile. A minimal local worker reproduced lost cache writes after unregistering; resetting that public cache passed five consecutive reinstalls. Private IndexedDB, cookies, and workspace copies remain intact. Ordinary offline and update workflows keep their worker and caches.

Firefox's test request routing interferes with native offline worker navigation. A minimal worker returning constant HTML reproduces `NS_ERROR_OFFLINE` with the interceptor installed and succeeds without it, with no server requests; page-level interception can also remain active after removing its rule. The session-rotation race therefore uses origin-scoped context rules that match the intended page. `setActorOffline` enables real offline mode before suspending only the fixture's own external-request guard, then restores that guard before reconnecting. It verifies both `navigator.onLine === false` and failure of an uncached API request. Real service workers, cached startup, account copies, queued changes, and synchronization assertions remain unchanged.

Deferred-screen recovery uses a temporary JavaScript 503 response with `Cache-Control: no-store`. WebKit retained the failed entry preload even after a document reload; the production build now excludes only the imported entry from its own preload list, preserving its dependency preloads. Recovery checks keep queued edits safe, block an unsafe reload, synchronize the actual note, and retry the screen without discarding work. Actual offline and interrupted-transfer workflows still exercise transport failures.

Shared-edit cleanup uses the ordinary workspace switcher, avoiding an unnecessary page reload. A separate minimal local reproduction showed that WebKit can report properly caught requests started during page exit as access-control errors. Required reloads and closes mark only their explicit document-exit interval: an exact native error name/stack for this disposable origin's API is recorded as a separate browser diagnostic during that interval. All other page errors remain fatal, and every saved-content, access, queue, and offline-recovery assertion remains enforced.

Backend release checks exercise local/online policy boundaries, private recovery mail, streamed request limits, sanitized session controls, and migration history/drift. Real SQLite injection regressions verify prepared bindings and unchanged schema, memberships, and other accounts' records. Native Better Auth tests check throttled policy refusals and matching unknown/withdrawn-account responses, including malformed optional fields. Hostile Markdown, math, diagrams, archive paths, and attachment metadata also have concrete rejection or safe-rendering assertions. Migration rehearsals upgrade legacy fixtures, inject a failed atomic migration, retry, verify online startup without schema writes, and restore a pre-upgrade SQLite backup. All databases and email transports are disposable or simulated; no real mail or cloud resources are used.

Interface checks use the current labels in navigation, search, dialogs, and guides. Invalid workspace JSON shows a readable error before any import request is sent, leaving the saved workspace unchanged. The copy/readability review also checked seven empty views across five themes at desktop and 320 px widths, including board text sizes, touch targets, consistent guest naming, and an empty canvas without a false Saved status. This visual matrix was a local review; the maintained browser command above runs the browser workflows.

Useful browser options:

```sh
npm run test:browser -- --grep "offline"
npm run test:browser -- --project=chromium
npm run test:browser -- --headed
```

Tests create only two accounts per run to stay within the application's normal registration limits. They do not weaken authentication, permission checks, or rate limits.

For repeated workflow verification, start a fresh `npm run test:browser` invocation each time. Playwright's `--repeat-each` reuses the run's database and can exhaust registration limits.

### Browser verification

The later **5 November 2026 PR #2 follow-up** fixes the application startup race described above. The CI media failure showed a newly created note in the list while the previous recovery note remained selected; it was distinct from the earlier full-run WebKit deadline below. The delayed-state regression failed against the original application with the cached note's title, then passed with the fix.

Build **`a4447091e20dcac61550`** passed types, zero-warning lint, backend/security checks, **45 native Node tests**, the production build, and startup/offline size budgets. Chromium and Firefox each passed **28/28** cases. Six affected WebKit workflows passed together: offline recovery, all-theme keyboard navigation, deferred-screen recovery, linked-note startup, CSP/media, and the queued-edit app update. All ten linked-note desktop/320 px captures across the five themes were reviewed. Application and test fingerprints matched the isolated validation copy. Firefox used a temporary copy matching all 63 original runtime hashes. This was **62 passing engine/test cases**, with focused WebKit coverage; the complete WebKit suite was not rerun. Dependencies, CSP assertions, retries, and action deadlines were unchanged. GitHub's Windows Chromium and Linux Firefox/WebKit jobs still need to verify the published fix.

The **5 November 2026 CI follow-up** changes browser helpers/assertions and documentation only. The complete code check passed, including **45 native Node tests**, types, zero-warning lint, backend/security regressions, and the production build. The delayed-onboarding regression failed against the old helper and passed with the fix.

Chromium and Firefox each passed **27/27** cases. The full Windows WebKit run passed **21**, then exhausted the media workflow's 180-second deadline as an assertion began; five later workflows did not run. The unchanged media workflow and those five workflows passed together on a fresh installation (**6/6**), including the storage-width and queued-edit update checks. This verifies **81 distinct engine/test cases with a focused WebKit follow-up**, not a completely clean full matrix. Both WebKit reports are retained. No test retry setting, action deadline, security assertion, or application behavior was relaxed.

Firefox initially failed to launch from its existing Windows cache. Its complete run used a temporary copy with matching SHA256 hashes for all 63 runtime files; the original cache was untouched and the copy was removed afterward. Verification used an isolated source copy because the running local app held its build output open; application and test fingerprints matched the working tree. GitHub's Windows Chromium and Linux Firefox/WebKit jobs still need to run on the published follow-up commit.

On **2026-10-31**, final build **`333981ce96b637fdd8ca`** passed strict types, zero-warning lint, backend/model/security checks, **39 native Node tests**, and the production build. Application sources and verification configuration were fingerprinted before the remaining checks and rechecked afterward.

Chromium and Firefox each passed all **23 workflows**. The full Windows WebKit run passed **22**, then hit a 15-second actionability timeout before its final workflow could create a note. The unchanged final workflow passed on a fresh installation of the same frozen build. This verifies **69 distinct engine/workflow cases with one focused follow-up**, rather than a completely clean first full run. Both reports are retained. The failure trace shows a visible, enabled button and long gaps in browser frames, without a click or save request; the exact cause remains unproven. No forced click, extra automatic retry, or longer action deadline was introduced.

The final Windows WebKit full run took about 22 minutes. Allow extra time locally or use focused selectors during development. This is test-suite duration, not ordinary app response time. The existing in-place screen-recovery and genuine Firefox offline assertions remain intact; highlighted-code assertions now wait for the asynchronously rendered markup.

The same candidate passed local configuration checks and version-9 migration, backup, restore, failed-migration rollback, and previous-state recovery rehearsals. Production dependency findings are zero; the full tree has no high/critical findings and retains the reviewed moderate tooling entries described in [Dependency security](DEPENDENCY_SECURITY.md). Populated-workspace and typing measurements are recorded in the [capacity review](PERFORMANCE.md).

Local engine checks do not establish physical-device Safari behavior, hosted HTTPS/email delivery, or online service capacity. The changed workflow must run again on GitHub after the fixes are pushed; a previous failed run does not change retroactively.

## Browser policy checks

The production build's CSP is checked through real document headers and browser-parsed probes that inherit the application's policy. These verify fresh server-selected nonces, blocked untrusted inline/external scripts, blocked inline event handlers, and blocked string evaluation. The probes run outside debugger evaluation, which can bypass script restrictions. Offline checks open a new window and reload again, requiring a new matching header/markup nonce each time.

The same workflow uploads a small image, WAV recording, and PDF, renders an ELK diagram, opens note slides and a separate note window, and checks sandboxed Canvas references. PDF cards keep a keyboard-accessible Open link across the desktop/mobile theme matrix. Saved attachments must reopen as device-local blob URLs while disconnected. Existing technical Markdown and worker-update workflows check math, syntax formatting, safe rendering, and queued-edit recovery alongside this coverage.

Audio decoding is compared with an independent, unrestricted copy of the same fixture. Windows WebKit reports WAV support but rejects this fixture with media error 4 even without CSP. In that runtime, tests require the same native result, accessible uploaded bytes, offline blob sources, and no `media-src` violation; they do not claim successful playback. Chromium and Firefox require loaded metadata. Platform codec support still needs a real-device check; see [Playwright's browser limitations](https://playwright.dev/docs/browsers#webkit). Blocked evaluation is verified through its actual `EvalError`, since WebKit does not also emit the evaluation violation event in this fixture.

A separate local reproduction found that this WebKit runtime rejects IndexedDB Blob writes while accepting byte buffers. New attachment copies use typed buffers, with regression checks for existing Blob records, damaged copies, and access revocation during binary preparation. Browser assertions still require real downloaded attachments to survive offline reopening; this storage failure is not skipped.

On **5 November 2026**, build **`c956d094b9209273136f`** passed the complete code check, including backend/security regressions, **45 native Node tests**, and the production build. Final runs passed all four affected workflows in Chromium, Firefox, and WebKit: **12 passed, no failures or skips**. Source and browser-test fingerprints were recorded, all five themes and desktop/mobile captures were reviewed, and existing startup/offline size budgets passed without new dependencies or maintained source files. This was focused verification; the complete 25-workflow browser suite and broad performance studies were not rerun.

Earlier diagnostic runs corrected debugger-driven probes, documented native audio limits, and exposed the attachment-storage issue above. One earlier Chromium update run hit a request-interceptor error; its isolated and subsequent combined checks passed without changing that workflow. The new multi-window fixture explicitly restores its original window and waits for desktop navigation after its mobile captures. No forced clicks, automatic retries, or longer action deadlines were introduced.

```sh
npm run test:browser -- --grep "browser policy blocks|technical Markdown loads|offline edits survive a new window|a prepared app update"
```

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

## Upload allowance and feedback checks

`npm test` includes real SQLite and route regressions for shared account/workspace throttles, concurrent quota reservations, legacy files, retained/pending bytes, incomplete inventory and lease recovery, revoked access, confirmed-deletion accounting, and interrupted/import retry receipts. A virtual provider size exercises the 500 MiB boundary without allocating a large file; actual small uploads still pass through the normal routes and bucket fixture. Shared feedback tests check valid and malformed retry waits.

The focused browser workflow checks a real small upload and its reported usage, then uses controlled report responses for normal, near-full, over-limit, unavailable, and failed-refresh states. It checks keyboard refresh, all five themes on desktop and narrow Chromium layouts, and Focus at both widths in Firefox/WebKit. Failed note uploads preserve text and create no broken links; a throttled Markdown import keeps its selection and a manual retry reuses its operation reference without duplicates.

```sh
npm run test:browser -- --grep "attachment allowance and upload feedback|storage cleanup requires|interrupted attachments|Markdown import preview"
```

On **3 November 2026**, build **`593cff2276972ebef2bb`** passed the complete code check, including types, zero-warning lint, backend/security regressions, 39 native Node tests, and the production build. The four affected workflows passed in Chromium, Firefox, and WebKit: **12 passed, no failures or skips**. Representative desktop/mobile screenshots were inspected, and existing startup/offline size budgets passed. This was affected-workflow verification; the complete 24-workflow browser suite and broad performance studies were not rerun for this change.

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
