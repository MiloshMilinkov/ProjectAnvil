# Browser checks and performance measurements

[Project overview](../README.md) · [Local setup and backups](LOCAL_SETUP.md)

The browser and performance commands launch a built app with a fresh local database, file bucket, signing secret, and test accounts. Everyday ports and existing servers are never reused. Test servers use their own state and secret instead of the normal `.wrangler/state` and `.dev.vars`; your everyday installation data is not changed.

## Prepare once

Install project dependencies, then download the official Chromium test runtime:

```sh
npm run install:ci
node node_modules/@playwright/test/cli.js install chromium
```

The browser suite uses [Playwright's isolated browser contexts](https://playwright.dev/docs/browser-contexts) for separate sign-ins. These are disposable test sessions, independent of your everyday browser profile.

## Run the checks

```sh
npm run check
npm run test:browser
npm run test:performance
```

Each browser/performance command builds the app if its source changed, starts its own loopback server on an available test port, and stops that server when finished. Run performance measurements by themselves for a cleaner comparison. Nothing is hosted or synchronized to a cloud service.

Nine browser workflows cover two UI-registered accounts, private workspaces, accepted team access, Viewer/Editor permissions and revocation, live changes and conflicting saves, simultaneous Markdown editing with a disconnected participant, offline reopening and ordered synchronization, Undo, Markdown files and attachments, keyboard navigation, mobile layout, and all five themes. Note-browser checks combine and reset filters, verify matching counts and project scope, preserve current writing, and check read-only creation controls. The suite also checks the current-build update control and offline preparation; new-version cache activation has separate service-worker regression tests in `npm run check`. Screenshots and traces help diagnose failures.

Useful browser options:

```sh
npm run test:browser -- --grep "offline"
npm run test:browser -- --headed
```

Tests create only two accounts per run to stay within the application's normal registration limits. They do not weaken authentication, permission checks, or rate limits.

## Performance profiles

Two synthetic accounts each receive a private workspace, and share a team workspace. All three workspaces receive each profile in turn:

| Profile | Projects per workspace | Tasks | Notes | Canvases | Relationships |
| ------- | ---------------------: | ----: | ----: | -------: | ------------: |
| Small   |                      5 |   100 |    25 |        3 |           100 |
| Medium  |                     20 |   500 |   100 |        6 |           400 |
| Large   |                     40 | 1,000 |   200 |       10 |           800 |

The large profile approaches the existing active-text allowance without increasing it. The benchmark measures full and conditional reads, parallel saves to different tasks at concurrency 2/5/10, conflicting edits, retry receipts, restricted project access, and rejected oversized imports. Browser measurements cover task lists, filtering, global search, notes, the relationship graph, and a populated canvas.

```sh
npm run test:performance -- --mode baseline
npm run test:performance -- --mode optimized
npm run test:performance -- --study typing --mode baseline
npm run test:performance -- --study typing --mode optimized
```

Both modes execute the same workload; the label selects the report filename. Reusing a label overwrites its previous JSON report. Capture a baseline before changing app code, then compare another run after rebuilding. Reports include the public build version and source fingerprint; a build change during measurement fails the run. Run one study at a time without rebuilding concurrently. API read metrics report median and p95 from eight samples. Browser interaction timings are observations from two independent account sessions and include automation overhead; they are not browser p95 estimates. Hardware, background activity, and cache warm-up affect results. Correctness failures stop a run; absolute speed is not a machine-independent pass/fail threshold.

The separate typing study performs five edits per mode per account (30 total) with workspace copies off, on while connected, and disconnected. It verifies the final server text after reconnecting. Its input-to-save timing includes the intentional autosave delay.

## Reports and privacy

- `outputs/browser/`: HTML report, failure screenshots/traces, and synthetic proof screenshots.
- `outputs/performance/baseline.json` and `optimized.json`: measurements and data-safety assertions.
- `outputs/performance/note-edit-baseline.json` and `note-edit-optimized.json`: typing and save-feedback measurements.
- `work/qa/`: disposable server configurations, logs, and local test data from each run.

These directories are ignored by Git. Treat test traces and server run directories as private debugging material even though fixture accounts contain no real personal information. Never publish a full browser profile, active local database, or signing secret. Test run directories can be removed after their owned test server has stopped; preserve any reports needed for comparison first.

GitHub Actions runs the existing type/lint/backend/build checks, then a separate Chromium browser job. Failed browser runs retain diagnostic artifacts for seven days. This workflow does not deploy the app. Review both production and full toolchain findings in [Dependency security](DEPENDENCY_SECURITY.md) when updating packages.
