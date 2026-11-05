import fs from "node:fs/promises";
import path from "node:path";
import { test as base, expect, type TestInfo } from "@playwright/test";
import {
  installTestCancellationHandlers,
  projectRoot,
  startDisposableServer,
  validateDisposableTarget,
} from "../../scripts/test-runtime.mjs";
import { captureBrowserFailureLog } from "../../scripts/run-browser-tests.mjs";
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

export const test = base.extend<{ scenario: Scenario }>({
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
          await Promise.allSettled(
            browser.contexts()
              .filter((context) => !existingContexts.has(context))
              .map((context) => context.close()),
          );
          if (server) await removeInstallation(server);
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
