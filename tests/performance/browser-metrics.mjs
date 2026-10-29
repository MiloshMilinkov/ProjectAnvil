import assert from "node:assert/strict";
import path from "node:path";
import { chromium } from "@playwright/test";

const round = (value) => Math.round(value * 100) / 100;

async function nextPaint(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function timed(page, action, ready) {
  const started = performance.now();
  await action();
  await ready();
  await nextPaint(page);
  return round(performance.now() - started);
}

function browserCookies(session, baseURL) {
  return session.cookies.map((cookie) => {
    const first = cookie.split(";")[0],
      separator = first.indexOf("=");
    return {
      name: first.slice(0, separator),
      value: first.slice(separator + 1),
      url: baseURL,
      httpOnly: /;\s*HttpOnly/i.test(cookie),
      sameSite: "Lax",
    };
  });
}

/** Browser samples use two independent profiles and the real rendered controls. */
export async function measureBrowserProfile({
  baseURL,
  sessions,
  profile,
  outputDirectory,
}) {
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    for (const [index, session] of sessions.entries()) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        serviceWorkers: "block",
      });
      try {
        await context.route("**/*", (route) => {
          const address = new URL(route.request().url());
          return address.origin === new URL(baseURL).origin ||
            ["data:", "blob:"].includes(address.protocol)
            ? route.continue()
            : route.abort();
        });
        await context.addCookies(browserCookies(session, baseURL));
        await context.addInitScript(() => {
          window.__projectAnvilTestLongTasks = [];
          try {
            new PerformanceObserver((list) =>
              window.__projectAnvilTestLongTasks.push(
                ...list.getEntries().map((entry) => entry.duration),
              ),
            ).observe({ type: "longtask", buffered: true });
          } catch {
            /* Optional browser timing API. */
          }
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        const startup = performance.now();
        await page.goto(baseURL, { waitUntil: "domcontentloaded" });
        await page
          .getByRole("button", {
            name: `Account: ${session.username}`,
            exact: true,
          })
          .waitFor();
        await nextPaint(page);
        const closeGuide = page.getByRole("button", {
          name: "Close guide",
          exact: true,
        });
        if (await closeGuide.isVisible()) await closeGuide.click();
        await page
          .getByRole("heading", { name: "Workspace overview", exact: true })
          .waitFor();
        await nextPaint(page);
        const startupMs = round(performance.now() - startup);

        const taskOpenMs = await timed(
          page,
          () =>
            page.getByRole("button", { name: "Tasks", exact: true }).click(),
          () =>
            page
              .getByRole("textbox", { name: "Filter tasks", exact: true })
              .waitFor(),
        );
        const initialBoardCards = await page.locator(".task-card").count();
        const taskListOpenMs = await timed(
          page,
          () => page.getByRole("button", { name: "List", exact: true }).click(),
          () => page.locator(".task-table tbody tr").first().waitFor(),
        );
        const taskRows = await page.locator(".task-table tbody tr").count();
        assert.equal(taskRows, Math.min(profile.tasks, 50));
        if (profile.tasks > 50) {
          const firstTitle = await page
            .locator(".task-title-button")
            .first()
            .innerText();
          await page
            .getByRole("navigation", { name: "Task list pages" })
            .getByRole("button", { name: "Next", exact: true })
            .click();
          assert.notEqual(
            await page.locator(".task-title-button").first().innerText(),
            firstTitle,
          );
        }
        const namespace = index === 0 ? "alpha" : "beta";
        const needle = `${namespace} Task ${String(Math.floor(profile.tasks / 2) + 1).padStart(4, "0")}`;
        const filterMs = await timed(
          page,
          () =>
            page
              .getByRole("textbox", { name: "Filter tasks", exact: true })
              .fill(needle),
          () =>
            page.waitForFunction(
              () =>
                document.querySelectorAll(".task-table tbody tr").length === 1,
            ),
        );
        assert.equal(
          await page.locator(".task-table tbody tr").count(),
          1,
          "Filtering a known title must retain exactly its matching task.",
        );
        await page
          .getByRole("textbox", { name: "Filter tasks", exact: true })
          .fill("");

        const searchMs = await timed(
          page,
          async () => {
            await page.keyboard.press("Control+k");
            await page
              .getByRole("textbox", {
                name: "Search tasks, notes, and projects",
                exact: true,
              })
              .fill(`${namespace} Note 0001`);
          },
          () =>
            page
              .locator(".command-palette")
              .getByRole("button", { name: /Note 0001/ })
              .first()
              .waitFor(),
        );
        await page.keyboard.press("Escape");

        const notesMs = await timed(
          page,
          () =>
            page.getByRole("button", { name: "Notes", exact: true }).click(),
          () =>
            page
              .getByRole("textbox", { name: "Search notes", exact: true })
              .waitFor(),
        );
        const renderedNotes = await page.locator(".note-list-item").count();
        const noteFilterMs = await timed(
          page,
          () =>
            page
              .getByRole("textbox", { name: "Search notes", exact: true })
              .fill(`${namespace}_reference_0001`),
          () =>
            page.waitForFunction(
              () => document.querySelectorAll(".note-list-item").length === 1,
            ),
        );

        const graphMs = await timed(
          page,
          () =>
            page
              .getByRole("button", { name: "Relationship graph", exact: true })
              .click(),
          () =>
            page
              .locator("[data-graph-node]")
              .first()
              .waitFor({ state: "attached" }),
        );
        const graphNodes = await page.locator("[data-graph-node]").count();
        const graphSearchMs = await timed(
          page,
          () =>
            page
              .getByRole("textbox", { name: "Search graph", exact: true })
              .fill(`${namespace} Note 0001`),
          () =>
            page
              .getByRole("textbox", { name: "Search graph", exact: true })
              .waitFor(),
        );
        const canvasMs = await timed(
          page,
          () =>
            page.getByRole("button", { name: "Canvas", exact: true }).click(),
          () => page.locator(".canvas-card").first().waitFor(),
        );
        const renderedCanvasCards = await page.locator(".canvas-card").count();
        let idleUpdates;
        if (profile.name === "large" && index === 0) {
          await page.waitForTimeout(1_000);
          const idle = {
            accountReads: 0,
            stateReads: 0,
            conditionalStateReads: 0,
            liveRequests: 0,
            abortedLiveRequests: 0,
          };
          const countRequest = (request) => {
            const pathname = new URL(request.url()).pathname;
            if (pathname === "/api/account") idle.accountReads++;
            if (pathname === "/api/state") {
              idle.stateReads++;
              if (request.headers()["if-none-match"])
                idle.conditionalStateReads++;
            }
            if (pathname === "/api/live") idle.liveRequests++;
          };
          const countFailure = (request) => {
            if (new URL(request.url()).pathname === "/api/live")
              idle.abortedLiveRequests++;
          };
          page.on("request", countRequest);
          page.on("requestfailed", countFailure);
          const idleStart = performance.now();
          await page.waitForTimeout(21_000);
          page.off("request", countRequest);
          page.off("requestfailed", countFailure);
          idleUpdates = {
            ...idle,
            durationMs: round(performance.now() - idleStart),
          };
          assert(
            idle.accountReads >= 2,
            "The idle study must cross two normal account refreshes",
          );
          assert.equal(
            idle.abortedLiveRequests,
            0,
            "Unchanged account polls must not restart live subscriptions",
          );
          assert.equal(
            idle.conditionalStateReads,
            idle.stateReads,
            "Settled workspace polls must retain their cache validators",
          );
          assert(
            idle.stateReads <= 3,
            "Idle workspace reads should retain their normal polling cadence",
          );
          assert(
            idle.liveRequests <= 2,
            "Idle live updates should retain their long-poll cadence",
          );
        }
        const health = await page.evaluate(() => ({
          pageElements: document.querySelectorAll("*").length,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          longTasks: window.__projectAnvilTestLongTasks || [],
        }));
        assert.equal(
          health.horizontalOverflow,
          false,
          "A populated desktop workspace must not overflow its page.",
        );
        assert.deepEqual(
          pageErrors,
          [],
          "Populated workspace views must not cause browser exceptions.",
        );
        report.push({
          account: index ? "independentB" : "independentA",
          startupMs,
          taskOpenMs,
          taskListOpenMs,
          taskFilterMs: filterMs,
          globalSearchMs: searchMs,
          notesOpenMs: notesMs,
          noteFilterMs,
          graphOpenMs: graphMs,
          graphSearchMs,
          canvasOpenMs: canvasMs,
          renderedTaskRows: taskRows,
          initialBoardCards,
          renderedNotes,
          renderedGraphNodes: graphNodes,
          renderedCanvasCards,
          ...(idleUpdates ? { idleUpdates } : {}),
          pageElements: health.pageElements,
          longTaskCount: health.longTasks.length,
          longestTaskMs: round(Math.max(0, ...health.longTasks)),
          totalLongTaskMs: round(
            health.longTasks.reduce((sum, value) => sum + value, 0),
          ),
          browserErrors: pageErrors.length,
        });
        if (profile.name === "large" && index === 0)
          await page.screenshot({
            path: path.join(outputDirectory, "large-workspace-canvas.png"),
          });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return report;
}
