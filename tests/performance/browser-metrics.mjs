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
            page
              .getByRole("button", { name: "Task board", exact: true })
              .click(),
          () =>
            page
              .getByRole("textbox", { name: "Filter tasks", exact: true })
              .waitFor(),
        );
        await page.getByRole("button", { name: "List", exact: true }).click();
        await page.locator(".task-table tbody tr").first().waitFor();
        await nextPaint(page);
        const taskRows = await page.locator(".task-table tbody tr").count();
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
          taskFilterMs: filterMs,
          globalSearchMs: searchMs,
          notesOpenMs: notesMs,
          noteFilterMs,
          graphOpenMs: graphMs,
          graphSearchMs,
          canvasOpenMs: canvasMs,
          renderedTaskRows: taskRows,
          renderedNotes,
          renderedGraphNodes: graphNodes,
          renderedCanvasCards,
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
