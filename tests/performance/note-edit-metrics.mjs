import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readBuildInfo } from "./build-info.mjs";
import { validateDisposableTarget } from "../../scripts/test-runtime.mjs";
import {
  activeBytes,
  createApiClient,
  createSyntheticWorkspace,
  performanceProfiles,
} from "./fixtures.mjs";

const round = (value) => Math.round(value * 100) / 100;
function summary(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    medianMs: round(sorted[Math.floor((sorted.length - 1) / 2)]),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
  };
}
async function paint(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function editOnce(page, content, expectedLabel) {
  const field = page.getByRole("textbox", {
    name: "Note content",
    exact: true,
  });
  await field.evaluate((element, savedLabel) => {
    const state = document.querySelector(".note-save-state");
    if (!state) throw new Error("Note save feedback is unavailable.");
    const metric = { inputAt: 0, paintAt: 0, savedAt: 0, sawPending: false };
    window.__projectAnvilNoteEditMetric = metric;
    const observer = new MutationObserver(() => {
      if (!metric.inputAt) return;
      const feedback = state.textContent.trim();
      if (!["Saved", "On device"].includes(feedback)) metric.sawPending = true;
      if (metric.sawPending && feedback === savedLabel && !metric.savedAt) {
        metric.savedAt = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(state, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    element.addEventListener(
      "input",
      () => {
        metric.inputAt = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            metric.paintAt = performance.now();
          }),
        );
      },
      { once: true },
    );
  }, expectedLabel);
  await field.fill(content);
  await page.waitForFunction(
    () =>
      window.__projectAnvilNoteEditMetric?.savedAt > 0 &&
      window.__projectAnvilNoteEditMetric?.paintAt > 0,
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(() => {
    const value = window.__projectAnvilNoteEditMetric;
    return {
      inputToPaintMs: Math.round((value.paintAt - value.inputAt) * 100) / 100,
      inputToSaveMs: Math.round((value.savedAt - value.inputAt) * 100) / 100,
    };
  });
}

function cookiesFor(session, baseURL) {
  return session.cookies.map((value) => {
    const first = value.split(";")[0],
      separator = first.indexOf("=");
    return {
      name: first.slice(0, separator),
      value: first.slice(separator + 1),
      url: baseURL,
      httpOnly: /;\s*HttpOnly/i.test(value),
      sameSite: "Lax",
    };
  });
}

/** A separate study: it does not change the existing comparative stress protocol. */
export async function runNoteEditStudy({
  baseURL,
  manifestPath,
  outputPath,
  mode = "baseline",
}) {
  await validateDisposableTarget(baseURL, manifestPath);
  const client = createApiClient(baseURL);
  const suffix = randomBytes(5).toString("hex");
  const profile = performanceProfiles.find((value) => value.name === "large");
  const sessions = [];
  for (const [label, namespace] of [
    ["notea", "alpha"],
    ["noteb", "beta"],
  ]) {
    const session = await client.register(label, suffix);
    const accountResponse = (await client.request(session, "/api/account"))
      .data;
    session.workspaceId = (
      accountResponse.account || accountResponse
    ).workspaces.find((value) => value.kind === "personal").id;
    const current = (
      await client.request(session, "/api/state", {
        workspaceId: session.workspaceId,
      })
    ).data.workspace;
    const seeded = createSyntheticWorkspace(
      profile,
      namespace,
      current.revision,
    );
    const imported = await client.request(session, "/api/state", {
      workspaceId: session.workspaceId,
      body: { action: "import", workspace: seeded, operationId: randomUUID() },
    });
    session.note = imported.data.workspace.notes[0];
    session.fixtureBytes = activeBytes(imported.data.workspace);
    sessions.push(session);
  }
  const report = {
    schemaVersion: 1,
    mode,
    build: await readBuildInfo(),
    generatedAt: new Date().toISOString(),
    environment: {
      accounts: 2,
      projectsPerAccount: profile.projects,
      tasksPerAccount: profile.tasks,
      notesPerAccount: profile.notes,
      samplesPerMode: 5,
      viewport: "1440x1000",
      timing:
        "DOM input event to the second animation frame, and to Saved/On device feedback; save includes the intentional 650 ms autosave delay",
      appCache: "blocked to isolate workspace-copy costs",
    },
    accounts: [],
  };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [index, session] of sessions.entries()) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: "block",
      });
      try {
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          return url.origin === new URL(baseURL).origin ||
            ["blob:", "data:"].includes(url.protocol)
            ? route.continue()
            : route.abort();
        });
        await context.addCookies(cookiesFor(session, baseURL));
        const page = await context.newPage();
        const failures = [];
        page.on("pageerror", (error) => failures.push(error.message));
        await page.goto(baseURL, { waitUntil: "domcontentloaded" });
        await page
          .getByRole("button", {
            name: `Account: ${session.username}`,
            exact: true,
          })
          .waitFor();
        await paint(page);
        const guide = page.getByRole("button", {
          name: "Close guide",
          exact: true,
        });
        if (await guide.isVisible()) await guide.click();
        await page.getByRole("button", { name: "Notes", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Note content", exact: true })
          .waitFor();
        // Select the seeded note explicitly instead of relying on saved sort order.
        await page
          .locator(".note-list-item")
          .filter({
            has: page.locator(".note-list-name", {
              hasText: session.note.title,
            }),
          })
          .first()
          .click();
        await paint(page);
        let content = await page
          .getByRole("textbox", { name: "Note content", exact: true })
          .inputValue();
        assert.equal(content, session.note.content);
        const modes = [];
        for (const phase of [
          "copyOffConnected",
          "copyOnConnected",
          "copyOnDisconnected",
        ]) {
          if (phase === "copyOnConnected") {
            await page
              .getByRole("button", { name: "Workspace settings", exact: true })
              .click();
            await page
              .getByRole("navigation", {
                name: "Settings sections",
                exact: true,
              })
              .getByRole("button", { name: "Data & offline", exact: true })
              .click();
            await page
              .getByRole("button", {
                name: "Save workspace offline",
                exact: true,
              })
              .click();
            await page
              .getByRole("button", {
                name: "Refresh offline copy",
                exact: true,
              })
              .waitFor();
            await page
              .getByRole("button", { name: "Notes", exact: true })
              .click();
            await page
              .getByRole("textbox", { name: "Note content", exact: true })
              .waitFor();
          }
          if (phase === "copyOnDisconnected") await context.setOffline(true);
          const samples = [];
          for (let sample = 0; sample < 5; sample++) {
            content += `\nMeasured ${phase} sample ${sample + 1}.`;
            samples.push(
              await editOnce(
                page,
                content,
                phase === "copyOnDisconnected" ? "On device" : "Saved",
              ),
            );
          }
          modes.push({
            mode: phase,
            inputToPaint: summary(
              samples.map((sample) => sample.inputToPaintMs),
            ),
            inputToSave: summary(samples.map((sample) => sample.inputToSaveMs)),
            observations: samples,
          });
          if (phase !== "copyOnDisconnected") {
            const confirmed = (
              await client.request(session, "/api/state", {
                workspaceId: session.workspaceId,
              })
            ).data.workspace;
            assert.equal(
              confirmed.notes.find((note) => note.id === session.note.id)
                ?.content,
              content,
              "Saved feedback must match the confirmed local server record.",
            );
          }
        }
        await context.setOffline(false);
        await page.waitForFunction(
          () =>
            document.querySelector(".note-save-state")?.textContent.trim() ===
            "Saved",
          undefined,
          { timeout: 30_000 },
        );
        const confirmed = (
          await client.request(session, "/api/state", {
            workspaceId: session.workspaceId,
          })
        ).data.workspace;
        assert.equal(
          confirmed.notes.find((note) => note.id === session.note.id)?.content,
          content,
          "All disconnected edits must reach the server in order.",
        );
        assert.deepEqual(
          failures,
          [],
          "The edit study must not hide browser exceptions.",
        );
        report.accounts.push({
          account: index ? "independentB" : "independentA",
          activeBytes: session.fixtureBytes,
          initialNoteCharacters: session.note.content.length,
          modes,
          finalServerContentVerified: true,
          browserErrors: failures.length,
        });
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(
    await readBuildInfo(),
    report.build,
    "The built app changed during the typing study. Rerun without a concurrent build.",
  );
  report.completed = true;
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const baseURL = process.env.PROJECTANVIL_TEST_BASE_URL;
  const manifestPath = process.env.PROJECTANVIL_TEST_MANIFEST;
  if (
    process.env.PROJECTANVIL_TEST_DISPOSABLE !== "1" ||
    !baseURL ||
    !manifestPath
  )
    throw new Error(
      "Use the disposable performance runner for the typing study.",
    );
  await runNoteEditStudy({
    baseURL,
    manifestPath,
    outputPath:
      process.env.PROJECTANVIL_PERFORMANCE_OUTPUT ||
      path.join(path.dirname(manifestPath), "note-edit.json"),
    mode: process.env.PROJECTANVIL_PERFORMANCE_MODE || "baseline",
  });
}
