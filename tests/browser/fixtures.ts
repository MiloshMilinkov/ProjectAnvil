import fs from "node:fs/promises";
import path from "node:path";
import {
  test as base,
  expect,
  type BrowserContext,
  type TestInfo,
} from "@playwright/test";
import {
  installTestCancellationHandlers,
  projectRoot,
  startDisposableServer,
  validateDisposableTarget,
} from "../../scripts/test-runtime.mjs";
import { captureBrowserFailureLog } from "../../scripts/run-browser-tests.mjs";
import { writeWorkerLease } from "../../scripts/test-worker-lease.mjs";
import { registerThroughUi, type BrowserAccount } from "./helpers";

type Scenario = {
  owner: BrowserAccount;
  colleague: BrowserAccount;
  baseURL: string;
  stateDirectory: string;
  runId: string;
};

async function removeInstallation(
  server: Awaited<ReturnType<typeof startDisposableServer>>,
) {
  await server.stop();
  const directory = await fs.realpath(server.directory);
  const ownedRoot = await fs.realpath(path.join(projectRoot, "work", "qa"));
  if (path.dirname(directory) !== ownedRoot)
    throw new Error("Cannot remove a test installation outside work/qa.");
  await fs.rm(directory, { recursive: true, force: true });
}

const contextCloseLimit = 20_000;

/**
 * Closes the contexts a test created without letting a wedged browser hang
 * the worker. A context that cannot close fails the test, so Playwright
 * replaces this worker and its browser before the next test.
 */
async function closeContexts(contexts: BrowserContext[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stuck = new Promise<"stuck">((resolve) => {
    timer = setTimeout(() => resolve("stuck"), contextCloseLimit);
  });
  try {
    const outcome = await Promise.race([
      Promise.allSettled(contexts.map((context) => context.close())),
      stuck,
    ]);
    if (outcome === "stuck")
      throw new Error(
        `Browser contexts did not close within ${contextCloseLimit / 1000}s; the browser is replaced before the next test.`,
      );
  } finally {
    clearTimeout(timer);
  }
}

async function capturePageDiagnostics(actors: BrowserAccount[], info: TestInfo) {
  const nativeExits = actors.flatMap((actor) => actor.nativeExitErrors.splice(0));
  if (nativeExits.length)
    await info.attach("native-document-exit-errors", {
      body: nativeExits.join("\n\n"),
      contentType: "text/plain",
    });
  const errors = actors.flatMap((actor) => actor.pageErrors.splice(0));
  if (errors.length)
    await info.attach("browser-runtime-errors", {
      body: errors.join("\n"),
      contentType: "text/plain",
    });
  if (info.status !== info.expectedStatus || errors.length) {
    for (const [index, actor] of actors.entries()) {
      if (actor.page.isClosed()) continue;
      const screenshot = await actor.page.screenshot().catch(() => null);
      if (screenshot)
        await info.attach(`${index === 0 ? "owner" : "colleague"}-failure`, {
          body: screenshot,
          contentType: "image/png",
        });
    }
  }
  return errors;
}

export const test = base.extend<
  { scenario: Scenario },
  { workerLease: void }
>({
  // Lets the runner's stall watchdog stop exactly this worker if it wedges.
  workerLease: [
    async ({}, provide, workerInfo) => {
      const release = writeWorkerLease(workerInfo.workerIndex);
      try {
        await provide();
      } finally {
        release();
      }
    },
    { scope: "worker", auto: true },
  ],
  scenario: [
    async ({ browser, browserName }, provide, info) => {
      const cancellation = installTestCancellationHandlers();
      const disconnected = new AbortController();
      const onDisconnect = () => disconnected.abort();
      process.once("disconnect", onDisconnect);
      const signal = AbortSignal.any([
        cancellation.signal,
        disconnected.signal,
      ]);
      const existingContexts = new Set(browser.contexts());
      const actors: BrowserAccount[] = [];
      let server: Awaited<ReturnType<typeof startDisposableServer>> | undefined;
      let capturedLog = false;
      try {
        server = await startDisposableServer({
          kind: `workflow-${browserName}`,
          signal,
          guardParent: true,
        });
        const marker = await validateDisposableTarget(
          server.baseURL,
          server.manifestPath,
          { signal },
        );
        const owner = await registerThroughUi(browser, server.baseURL, "owner");
        actors.push(owner);
        const colleague = await registerThroughUi(browser, server.baseURL, "peer");
        actors.push(colleague);
        await provide({
          owner,
          colleague,
          baseURL: server.baseURL,
          stateDirectory: marker.stateDirectory,
          runId: marker.runId,
        });
        const errors = await capturePageDiagnostics(actors, info);
        if (info.status !== info.expectedStatus || errors.length) {
          await captureBrowserFailureLog(server, browserName, {
            reportDirectory: info.outputPath("server"),
          });
          capturedLog = true;
        }
        if (info.status === info.expectedStatus)
          expect(
            errors,
            "Application pages must not raise uncaught JavaScript errors.",
          ).toEqual([]);
      } catch (error) {
        // Setup failures need their own server log too, before the fixture is removed.
        if (server && !capturedLog && !signal.aborted) {
          try {
            await captureBrowserFailureLog(server, browserName, {
              reportDirectory: info.outputPath("server"),
            });
          } catch {
            console.warn("Could not capture this workflow's disposable server log.");
          }
        }
        throw error;
      } finally {
        try {
          // Include contexts created by a test that failed before its own finally.
          try {
            await closeContexts(
              browser
                .contexts()
                .filter((context) => !existingContexts.has(context)),
            );
          } finally {
            if (server) await removeInstallation(server);
          }
        } finally {
          process.removeListener("disconnect", onDisconnect);
          cancellation.dispose();
        }
      }
    },
    { timeout: 60_000 },
  ],
});

export { expect };
