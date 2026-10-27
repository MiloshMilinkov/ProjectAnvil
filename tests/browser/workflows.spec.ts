import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateDisposableTarget } from "../../scripts/test-runtime.mjs";
import type { AccountContext } from "../../app/lib/access-types";
import {
  api,
  appReady,
  createNoteUi,
  createProjectUi,
  createTaskUi,
  createTeam,
  fixtureId,
  navigate,
  openNote,
  registerThroughUi,
  selectWorkspace,
  upsert,
  workspace,
  type BrowserAccount,
} from "./helpers";

test.describe("Separate accounts and recoverable everyday work", () => {
  test.describe.configure({ mode: "serial" });
  let owner: BrowserAccount;
  let colleague: BrowserAccount;
  let base: string;

  test.beforeAll(async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("The disposable test origin is missing.");
    await validateDisposableTarget(
      baseURL,
      process.env.PROJECTANVIL_TEST_MANIFEST,
    );
    base = baseURL;
    owner = await registerThroughUi(browser, base, "owner");
    colleague = await registerThroughUi(browser, base, "peer");
  });

  test.afterAll(async () => {
    await Promise.allSettled([
      owner?.context.close(),
      colleague?.context.close(),
    ]);
  });

  test.afterEach(async ({}, testInfo) => {
    const errors = [owner, colleague]
      .filter(Boolean)
      .flatMap((actor) => actor.pageErrors.splice(0));
    if (errors.length)
      await testInfo.attach("browser-runtime-errors", {
        body: errors.join("\n"),
        contentType: "text/plain",
      });
    if (testInfo.status === testInfo.expectedStatus) {
      expect(
        errors,
        "Application pages must not raise uncaught JavaScript errors.",
      ).toEqual([]);
      return;
    }
    for (const [label, actor] of [
      ["owner", owner],
      ["colleague", colleague],
    ] as const) {
      if (!actor || actor.page.isClosed()) continue;
      const screenshot = await actor.page
        .screenshot({ fullPage: false })
        .catch(() => null);
      if (screenshot)
        await testInfo.attach(`${label}-failure`, {
          body: screenshot,
          contentType: "image/png",
        });
    }
  });

  test("personal projects stay private and username sign-in restores the right account", async ({}, testInfo) => {
    await createProjectUi(owner.page, "Owner personal planning");
    await createTaskUi(owner.page, "Owner private next step");
    await createNoteUi(
      owner,
      "Owner private reference",
      "Only this account can read the personal reference.",
    );
    await createProjectUi(colleague.page, "Colleague personal planning");
    await createTaskUi(colleague.page, "Colleague private next step");
    const mine = await workspace(owner);
    const theirs = await workspace(colleague);
    expect(
      mine.tasks.some((task) => task.title === "Owner private next step"),
    ).toBeTruthy();
    expect(
      theirs.tasks.some((task) => task.title === "Owner private next step"),
    ).toBeFalsy();
    expect(
      mine.projects.some(
        (project) => project.name === "Colleague personal planning",
      ),
    ).toBeFalsy();
    const denied = await colleague.context.request.get("/api/state", {
      headers: {
        "X-Account-Id": colleague.userId,
        "X-Workspace-Id": owner.personal.id,
      },
    });
    expect([403, 404]).toContain(denied.status());
    expect(await denied.text()).not.toContain("Owner private reference");

    await owner.page
      .getByRole("button", { name: `Account: ${owner.username}`, exact: true })
      .click();
    await owner.page
      .getByRole("menuitem", { name: "Sign out", exact: true })
      .click();
    await expect(
      owner.page.getByRole("button", {
        name: "Sign in or create account",
        exact: true,
      }),
    ).toBeVisible();
    await owner.page
      .getByRole("button", { name: "Sign in or create account", exact: true })
      .click();
    const form = owner.page.locator("form.account-auth-form");
    await form.getByLabel(/^Username/).fill(owner.username);
    await form.getByLabel(/^Password/).fill(owner.password);
    await form.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      owner.page.getByRole("button", {
        name: `Account: ${owner.username}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await workspace(owner)).notes.some(
          (note) => note.title === "Owner private reference",
        ),
      )
      .toBeTruthy();
    for (const [label, actor] of [
      ["owner", owner],
      ["colleague", colleague],
    ] as const) {
      const path = testInfo.outputPath(`${label}-account.png`);
      await actor.page.screenshot({ path, fullPage: false });
      await testInfo.attach(`${label}-account-proof`, {
        path,
        contentType: "image/png",
      });
    }
  });

  test("team invitations, viewer/editor roles, and revoked project access update both accounts", async () => {
    const name = `Browser teamwork ${fixtureId().slice(0, 8)}`;
    await navigate(owner.page, /^Teams & people/);
    await owner.page.getByLabel("Team name", { exact: true }).fill(name);
    await owner.page
      .getByRole("button", { name: "Create team workspace", exact: true })
      .click();
    await expect(
      owner.page.getByRole("button", {
        name: `Switch workspace: ${name}`,
        exact: true,
      }),
    ).toBeVisible();
    await navigate(owner.page, /^Teams & people/);
    const panel = owner.page.locator(".account-members-panel");
    await panel
      .getByLabel("Username", { exact: true })
      .fill(colleague.username);
    await panel
      .getByRole("combobox", { name: /^Invitation role/ })
      .selectOption("viewer");
    await panel
      .getByRole("button", { name: "Send invitation", exact: true })
      .click();
    await expect(
      owner.page.getByText("Invitation sent in ProjectAnvil", { exact: true }),
    ).toBeVisible();
    await colleague.page.reload();
    await appReady(colleague.page);
    await navigate(colleague.page, /^Teams & people/);
    await colleague.page
      .locator(".account-invitation-row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(
      colleague.page.getByRole("button", {
        name: `Switch workspace: ${name}`,
        exact: true,
      }),
    ).toBeVisible();
    const raw = await api(owner, "/api/account");
    const team = ((raw.account || raw) as AccountContext).workspaces.find(
      (item) => item.name === name,
    )!;
    await createProjectUi(owner.page, "Shared review project");
    const project = (await workspace(owner, team.id)).projects.find(
      (item) => item.name === "Shared review project",
    )!;
    await upsert(owner, team.id, "tasks", {
      id: `role_task_${fixtureId()}`,
      title: "Shared role-check task",
      projectId: project.id,
    });
    await navigate(colleague.page, "Task board");
    await expect(
      colleague.page.getByRole("button", { name: /Shared role-check task/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      colleague.page.getByRole("button", { name: "Create task", exact: true }),
    ).toBeDisabled();
    await navigate(colleague.page, "Notes");
    const viewerBrowser = colleague.page.locator(".note-browser");
    await expect(
      viewerBrowser.getByRole("button", { name: "New note", exact: true }),
    ).toBeDisabled();
    await expect(
      viewerBrowser.getByRole("button", {
        name: "New note from template",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      viewerBrowser.getByRole("button", {
        name: "Manage note types",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      viewerBrowser.getByRole("button", {
        name: "Create a note",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      colleague.page.locator(".knowledge-empty").getByRole("button", {
        name: "Create your first note",
        exact: true,
      }),
    ).toBeDisabled();
    await navigate(colleague.page, "Task board");

    await navigate(owner.page, /^Teams & people/);
    const roleEditor = owner.page.locator(".team-role-editor").filter({
      has: owner.page.getByRole("combobox", {
        name: new RegExp(`^Role for ${colleague.username}`),
      }),
    });
    await roleEditor.getByRole("combobox").selectOption("editor");
    await roleEditor
      .getByRole("button", { name: "Save role", exact: true })
      .click();
    await expect(
      colleague.page.getByRole("button", { name: "Create task", exact: true }),
    ).toBeEnabled({ timeout: 30_000 });
    await createTaskUi(colleague.page, "Task created by accepted editor");
    await expect
      .poll(async () =>
        (await workspace(owner, team.id)).tasks.some(
          (task) => task.title === "Task created by accepted editor",
        ),
      )
      .toBeTruthy();

    const details = await api(owner, `/api/teams?workspaceId=${team.id}`);
    await api(owner, "/api/teams", {
      action: "project-access",
      workspaceId: team.id,
      projectId: project.id,
      restricted: true,
      members: [],
      expectedRevision: details.securityRevision,
    });
    await expect(
      colleague.page.getByRole("button", { name: /Shared role-check task/ }),
    ).toBeHidden({ timeout: 30_000 });
    const limited = await workspace(colleague, team.id);
    expect(limited.projects.some((item) => item.id === project.id)).toBeFalsy();
    expect(
      limited.tasks.some((task) => task.title === "Shared role-check task"),
    ).toBeFalsy();
    await selectWorkspace(owner, owner.personal);
    await selectWorkspace(colleague, colleague.personal);
  });

  test("live note updates arrive and a genuine concurrent conflict stays reviewable", async () => {
    const team = await createTeam(
      owner,
      colleague,
      `Concurrent review ${fixtureId().slice(0, 8)}`,
    );
    const noteId = `concurrent_note_${fixtureId()}`;
    await upsert(owner, team.id, "notes", {
      id: noteId,
      title: "Concurrent planning note",
      content: "Initial shared plan.",
    });
    await selectWorkspace(owner, team);
    await selectWorkspace(colleague, team);
    await navigate(colleague.page, "Workspace settings");
    await colleague.page
      .getByRole("button", { name: "Save workspace offline", exact: true })
      .click();
    await expect(
      colleague.page.getByText("Offline workspace copy saved", { exact: true }),
    ).toBeVisible();
    await openNote(owner, noteId);
    await openNote(colleague, noteId);
    const ownerText = owner.page.getByRole("textbox", {
      name: "Note content",
      exact: true,
    });
    const colleagueText = colleague.page.getByRole("textbox", {
      name: "Note content",
      exact: true,
    });
    await ownerText.fill("A saved plan from the owner.");
    await expect
      .poll(
        async () =>
          (await workspace(owner, team.id)).notes.find(
            (item) => item.id === noteId,
          )?.content,
      )
      .toBe("A saved plan from the owner.");
    await expect(colleagueText).toHaveValue("A saved plan from the owner.", {
      timeout: 30_000,
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    await colleague.page.route("**/api/state", async (route) => {
      const request = route.request();
      const body = request.method() === "POST" ? request.postDataJSON() : null;
      if (
        !held &&
        body?.entity === "notes" &&
        body.item?.id === noteId &&
        body.item?.content === "The colleague's conflicting plan."
      ) {
        held = true;
        await gate;
      }
      await route.continue();
    });
    try {
      await colleagueText.fill("The colleague's conflicting plan.");
      await expect.poll(() => held).toBeTruthy();
      await ownerText.fill("The owner's newer confirmed plan.");
      await expect
        .poll(
          async () =>
            (await workspace(owner, team.id)).notes.find(
              (item) => item.id === noteId,
            )?.content,
        )
        .toBe("The owner's newer confirmed plan.");
      release();
      await expect(
        colleague.page.getByRole("button", {
          name: "Review changes",
          exact: true,
        }),
      ).toBeVisible();
      await colleague.page
        .getByRole("button", { name: "Review changes", exact: true })
        .click();
      const review = colleague.page.getByRole("dialog", {
        name: "Unsaved changes",
        exact: true,
      });
      await review
        .getByText("Compare queued and saved values", { exact: true })
        .click();
      await expect(review).toContainText("The colleague's conflicting plan.");
      await expect(review).toContainText("The owner's newer confirmed plan.");
      await review
        .getByRole("button", { name: "Apply reviewed changes", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await workspace(owner, team.id)).notes.find(
              (item) => item.id === noteId,
            )?.content,
        )
        .toBe("The colleague's conflicting plan.");
      await review.getByRole("button", { name: "Done", exact: true }).click();
    } finally {
      release();
      await colleague.page.unroute("**/api/state");
    }
    await selectWorkspace(owner, owner.personal);
    await selectWorkspace(colleague, colleague.personal);
  });

  test("simultaneous Markdown editing merges a disconnected participant's text", async () => {
    const team = await createTeam(
      owner,
      colleague,
      `Shared writing ${fixtureId().slice(0, 8)}`,
    );
    const noteId = `shared_writing_${fixtureId()}`;
    await upsert(owner, team.id, "notes", {
      id: noteId,
      title: "Shared writing exercise",
      content: "Shared writing baseline.\n",
    });
    await selectWorkspace(owner, team);
    await selectWorkspace(colleague, team);
    await openNote(owner, noteId);
    await openNote(colleague, noteId);
    const ownerText = owner.page.getByRole("textbox", {
      name: "Note content",
      exact: true,
    });
    const colleagueText = colleague.page.getByRole("textbox", {
      name: "Note content",
      exact: true,
    });
    await owner.page
      .getByRole("button", { name: "Edit together", exact: true })
      .click();
    await colleague.page
      .getByRole("button", { name: "Edit together", exact: true })
      .click();
    await expect(
      owner.page.getByRole("button", {
        name: "Leave shared editing",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      colleague.page.getByRole("button", {
        name: "Leave shared editing",
        exact: true,
      }),
    ).toBeVisible();
    await expect(ownerText).toBeEditable();
    await expect(colleagueText).toBeEditable();
    await colleague.context.setOffline(true);
    try {
      await colleagueText.press("Control+End");
      await colleagueText.pressSequentially(" Colleague offline addition.");
      await expect(colleagueText).toHaveValue(/Colleague offline addition\./);
      await ownerText.press("Control+Home");
      await ownerText.pressSequentially("Owner online addition. ");
      await expect
        .poll(
          async () =>
            (await workspace(owner, team.id)).notes.find(
              (note) => note.id === noteId,
            )?.content,
        )
        .toContain("Owner online addition.");
      expect(
        (await workspace(owner, team.id)).notes.find(
          (note) => note.id === noteId,
        )?.content,
      ).not.toContain("Colleague offline addition.");
    } finally {
      await colleague.context.setOffline(false);
    }
    await expect
      .poll(
        async () =>
          (await workspace(owner, team.id)).notes.find(
            (note) => note.id === noteId,
          )?.content,
        { timeout: 30_000 },
      )
      .toContain("Colleague offline addition.");
    const saved = (await workspace(owner, team.id)).notes.find(
      (note) => note.id === noteId,
    )!.content;
    expect(saved).toContain("Owner online addition.");
    await expect(ownerText).toHaveValue(saved);
    await expect(colleagueText).toHaveValue(saved);
    await owner.page
      .getByRole("button", { name: "Leave shared editing", exact: true })
      .click();
    await colleague.page
      .getByRole("button", { name: "Leave shared editing", exact: true })
      .click();
    await selectWorkspace(owner, owner.personal);
    await selectWorkspace(colleague, colleague.personal);
  });

  test("offline edits survive a new window, retain order, Undo safely, and synchronize once", async () => {
    const title = `Offline planning ${fixtureId().slice(0, 8)}`;
    const note = await createNoteUi(
      owner,
      title,
      "Confirmed before interruption.",
    );
    await navigate(owner.page, "Workspace settings");
    await expect(
      owner.page.getByText("Application files are ready for offline startup.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await owner.page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(owner.page.locator(".app-installation")).toContainText(
      "Update check finished.",
    );
    const enable = owner.page.getByRole("button", {
      name: /^(Save workspace offline|Refresh offline copy)$/,
    });
    await enable.click();
    await expect(
      owner.page.getByText("Offline workspace copy saved", { exact: true }),
    ).toBeVisible();
    await openNote(owner, note.id);
    await owner.context.setOffline(true);
    // Reload through the cached public shell also proves the account snapshot is usable.
    await owner.page.reload();
    await expect(
      owner.page.getByRole("textbox", { name: "Note content", exact: true }),
    ).toHaveValue("Confirmed before interruption.");
    await owner.page
      .getByRole("textbox", { name: "Note content", exact: true })
      .fill("First offline revision.");
    await expect(owner.page.locator(".note-save-state")).toHaveText(
      "On device",
    );
    await expect(owner.page.locator(".offline-banner")).toContainText(
      "1 change kept on this device",
    );
    await owner.page
      .getByRole("textbox", { name: "Note content", exact: true })
      .fill("Latest offline revision.");
    await expect(owner.page.locator(".offline-banner")).toContainText(
      "2 changes kept on this device",
    );
    await expect(owner.page.locator(".note-save-state")).toHaveText(
      "On device",
    );
    await owner.page.close();
    owner.page = await owner.context.newPage();
    await owner.page.goto(`${base}/?note=${note.id}`);
    await expect(
      owner.page.getByRole("textbox", { name: "Note content", exact: true }),
    ).toHaveValue("Latest offline revision.");
    const taskTitle = `Offline Undo ${fixtureId().slice(0, 8)}`;
    await createTaskUi(owner.page, taskTitle);
    await owner.page
      .getByRole("button", { name: new RegExp(taskTitle) })
      .click();
    owner.page.once("dialog", (dialog) => dialog.accept());
    await owner.page
      .getByRole("button", { name: "Move task to Trash", exact: true })
      .click();
    await expect(
      owner.page.getByText("Task moved to Trash", { exact: true }),
    ).toBeVisible();
    await owner.page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      owner.page.getByText("Item restored", { exact: true }),
    ).toBeVisible();
    await expect(
      owner.page.getByRole("button", { name: new RegExp(taskTitle) }),
    ).toBeVisible();
    await expect(owner.page.locator(".offline-banner")).toContainText(
      "3 changes kept on this device",
    );
    await owner.context.setOffline(false);
    await navigate(owner.page, "Workspace settings");
    const sync = owner.page.getByRole("button", {
      name: "Synchronize now",
      exact: true,
    });
    if (await sync.isEnabled()) await sync.click();
    await expect
      .poll(
        async () =>
          (await workspace(owner)).notes.find((item) => item.id === note.id)
            ?.content,
        { timeout: 30_000 },
      )
      .toBe("Latest offline revision.");
    await expect
      .poll(
        async () =>
          (await workspace(owner)).tasks.filter(
            (task) => task.title === taskTitle,
          ).length,
      )
      .toBe(1);
    await expect(owner.page.locator(".offline-banner")).toBeHidden({
      timeout: 30_000,
    });
    await owner.page.reload();
    await appReady(owner.page);
    expect(
      (await workspace(owner)).tasks.filter((task) => task.title === taskTitle),
    ).toHaveLength(1);
  });

  test("Markdown import preview and export preserve linked notes and an attachment", async ({}, testInfo) => {
    const prefix = fixtureId().slice(0, 8);
    const firstTitle = `Portable brief ${prefix}`;
    const secondTitle = `Portable checklist ${prefix}`;
    const image = await readFile(
      new URL("../../public/icons/projectanvil-192.png", import.meta.url),
    );
    const archive = zipSync({
      "Notes/Brief.md": strToU8(
        `---\ntitle: ${firstTitle}\n---\n# ${firstTitle}\n\n![Plan](../Attachments/plan.png)\n\nSee [[${secondTitle}]].\n`,
      ),
      "Notes/Checklist.md": strToU8(
        `---\ntitle: ${secondTitle}\n---\n# ${secondTitle}\n\n- [ ] Review the brief\n`,
      ),
      "Attachments/plan.png": image,
    });
    const before = await workspace(owner);
    await navigate(owner.page, "Workspace settings");
    const panel = owner.page.locator(".portable-panel");
    await panel
      .locator('input[type="file"][accept=".zip,application/zip"]')
      .setInputFiles({
        name: "portable-planning.zip",
        mimeType: "application/zip",
        buffer: Buffer.from(archive),
      });
    await expect(
      panel.getByRole("heading", { name: "Review import", exact: true }),
    ).toBeVisible();
    await expect(panel).toContainText("2 notes · 1 attachment");
    expect((await workspace(owner)).notes).toHaveLength(before.notes.length);
    await panel
      .getByRole("button", { name: "Import as new notes", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Import complete", exact: true }),
    ).toBeFocused();
    const after = await workspace(owner);
    expect(after.notes).toHaveLength(before.notes.length + 2);
    expect(after.media).toHaveLength(before.media.length + 1);
    const imported = after.notes.find((note) => note.title === firstTitle)!;
    expect(imported.content).toContain(
      `/api/media/${after.media.find((file) => file.name === "plan.png")!.id}`,
    );
    await openNote(owner, imported.id);
    await expect(
      owner.page.getByRole("img", { name: "Plan", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        owner.page
          .getByRole("img", { name: "Plan", exact: true })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBe(192);
    await navigate(owner.page, "Workspace settings");
    const downloadPromise = owner.page.waitForEvent("download");
    await owner.page
      .getByRole("button", { name: "Export Markdown ZIP", exact: true })
      .click();
    const download = await downloadPromise;
    const archivePath = testInfo.outputPath("portable-round-trip.zip");
    await download.saveAs(archivePath);
    const exported = unzipSync(await readFile(archivePath));
    const markdown = Object.entries(exported)
      .filter(([path]) => path.endsWith(".md"))
      .map(([, bytes]) => strFromU8(bytes));
    expect(
      markdown.some(
        (text) => text.includes(firstTitle) && text.includes(secondTitle),
      ),
    ).toBeTruthy();
    expect(
      Object.keys(exported).some((path) => path.endsWith("plan.png")),
    ).toBeTruthy();
    expect(Object.keys(exported)).toContain("projectanvil-manifest.json");
  });

  test("narrow layouts, all themes, search, and the guide remain keyboard usable", async () => {
    await selectWorkspace(owner, owner.personal);
    const searchTitle = `Keyboard reference ${fixtureId().slice(0, 8)}`;
    await upsert(owner, owner.personal.id, "notes", {
      id: `keyboard_note_${fixtureId()}`,
      title: searchTitle,
      content: "A small reference used only by this keyboard test.",
    });
    await owner.page.reload();
    await appReady(owner.page);
    await owner.page.setViewportSize({ width: 320, height: 900 });
    await navigate(owner.page, "Workspace settings");
    for (const theme of ["Light", "Dark", "Warp", "Focus", "Soft"]) {
      await owner.page
        .getByRole("radio", { name: new RegExp(`^${theme} `) })
        .check();
      await expect
        .poll(() =>
          owner.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBeTruthy();
      expect(
        await owner.page
          .locator(".offline-actions button")
          .evaluateAll((buttons) =>
            buttons.every(
              (button) => button.getBoundingClientRect().height >= 44,
            ),
          ),
      ).toBeTruthy();
    }
    await owner.page.keyboard.press("Control+k");
    const search = owner.page.getByRole("dialog", {
      name: "Search workspace",
      exact: true,
    });
    await expect(
      search.getByRole("textbox", {
        name: "Search tasks, notes, and projects",
        exact: true,
      }),
    ).toBeFocused();
    await search.getByRole("textbox").fill(searchTitle);
    await expect(
      search.getByRole("button", { name: new RegExp(searchTitle) }),
    ).toBeVisible();
    await owner.page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    const trigger = owner.page.getByRole("button", {
      name: "Start guided tour",
      exact: true,
    });
    await trigger.click();
    const guide = owner.page.getByTestId("guided-tour");
    await expect(guide).toContainText(/Step 1 of \d+/);
    await guide
      .getByRole("button", { name: "Next", exact: true })
      .press("Enter");
    await expect(guide).toContainText(/Step 2 of \d+/);
    await guide
      .getByRole("button", { name: "Previous", exact: true })
      .press("Enter");
    await expect(guide).toContainText(/Step 1 of \d+/);
    await owner.page.keyboard.press("Escape");
    await expect(guide).toBeHidden();
    await expect(trigger).toBeFocused();
    await owner.page.setViewportSize({ width: 1365, height: 900 });
  });

  test("note filters reset together without changing the project or current editor in any theme", async ({}, testInfo) => {
    await selectWorkspace(owner, owner.personal);
    const suffix = fixtureId().slice(0, 8);
    const projectId = `note_filter_project_${suffix}`;
    const otherProjectId = `note_filter_other_${suffix}`;
    const customTypeId = `note_filter_type_${suffix}`;
    const projectName = `Note filter review ${suffix}`;
    const query = `reference-${suffix}`;
    const folder = "Planning and useful everyday references";
    const tag = "next-review";
    const longTitle =
      `A deliberately long reference title for project planning, recurring routines, ` +
      `research, and ideas that need room to stay readable ${suffix}`;
    const noteId = `note_filter_selected_${suffix}`;
    const decisionTitle = `Planning decision ${suffix}`;
    const otherTitle = `Another project reference ${suffix}`;
    const editorContent =
      `# Current planning reference\n\n${query}\n\n` +
      "Keep this text and the current note selected while browsing filters.";
    await upsert(owner, owner.personal.id, "projects", {
      id: projectId,
      name: projectName,
      key: "NFB",
    });
    await upsert(owner, owner.personal.id, "projects", {
      id: otherProjectId,
      name: `Other note scope ${suffix}`,
      key: "NFX",
    });
    await upsert(owner, owner.personal.id, "noteTypes", {
      id: customTypeId,
      name: "Everyday reference collection",
    });
    for (const note of [
      {
        id: noteId,
        title: longTitle,
        content: editorContent,
        projectId,
        folder,
        tags: [tag, "reference"],
        bookmarked: true,
        customTypeId,
      },
      {
        id: `note_filter_decision_${suffix}`,
        title: decisionTitle,
        content: `${query}: compare the options before choosing the next step.`,
        projectId,
        folder,
        tags: [tag],
        bookmarked: true,
        kind: "decision",
      },
      {
        id: `note_filter_routine_${suffix}`,
        title: `Weekly routine ${suffix}`,
        content: "A separate, unbookmarked routine for the same project.",
        projectId,
        folder: "Routines",
        tags: ["weekly"],
        bookmarked: false,
      },
      {
        id: `note_filter_outside_${suffix}`,
        title: otherTitle,
        content: query,
        projectId: otherProjectId,
        folder,
        tags: [tag],
        bookmarked: true,
        customTypeId,
      },
    ])
      await upsert(owner, owner.personal.id, "notes", note);
    await owner.page.reload();
    await appReady(owner.page);
    await owner.page
      .locator(".sidebar-projects")
      .getByRole("button", { name: projectName, exact: true })
      .click();
    await navigate(owner.page, "Notes");
    const browser = owner.page.locator(".note-browser");
    const items = browser.locator(".note-list-item");
    await expect(items).toHaveCount(3);
    await items.filter({ hasText: longTitle }).click();
    await owner.page
      .getByRole("group", { name: "Note view", exact: true })
      .getByRole("button", { name: "Write", exact: true })
      .click();
    const content = owner.page.getByRole("textbox", {
      name: "Note content",
      exact: true,
    });
    const title = owner.page.getByRole("textbox", {
      name: "Note title",
      exact: true,
    });
    const projectScope = owner.page.getByRole("region", {
      name: "Project filter",
      exact: true,
    });
    const search = browser.getByRole("textbox", {
      name: "Search notes",
      exact: true,
    });
    const folderFilter = browser.getByRole("combobox", {
      name: "Filter notes by folder",
      exact: true,
    });
    const tagFilter = browser.getByRole("combobox", {
      name: "Filter notes by tag",
      exact: true,
    });
    const typeFilter = browser.getByRole("combobox", {
      name: "Filter by note type",
      exact: true,
    });
    const bookmarks = browser.getByRole("button", {
      name: "Bookmarked",
      exact: true,
    });
    const count = browser.getByRole("status");
    try {
      for (const width of [1365, 320]) {
        await owner.page.setViewportSize({ width, height: 900 });
        for (const theme of ["Light", "Dark", "Warp", "Focus", "Soft"]) {
          await owner.page
            .getByRole("button", { name: /^Appearance:/ })
            .click();
          await owner.page
            .getByRole("menuitemradio", { name: new RegExp(`^${theme} `) })
            .click();
          await expect(owner.page.locator("html")).toHaveAttribute(
            "data-theme",
            theme.toLowerCase(),
          );
          if (!(await browser.isVisible()))
            await owner.page
              .getByRole("button", { name: "Browse notes", exact: true })
              .click();
          await expect(count).toHaveText("3 notes");
          await search.fill(query);
          await folderFilter.selectOption(folder);
          await tagFilter.selectOption(tag);
          await typeFilter.selectOption(`custom:${customTypeId}`);
          await bookmarks.click();
          await expect(count).toHaveText("1 of 3 notes");
          await expect(items).toHaveCount(1);
          await expect(items.first()).toContainText(longTitle);
          await expect(items.first()).toHaveAttribute("aria-current", "page");
          const clear = browser.getByRole("button", {
            name: "Clear note filters",
            exact: true,
          });
          await expect(clear).toBeVisible();
          if (width === 320) {
            const bounds = await clear.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.height).toBeGreaterThanOrEqual(44);
            expect(bounds!.width).toBeGreaterThanOrEqual(44);
          }
          expect(
            await owner.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          expect(
            await browser.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          ).toBeTruthy();
          const screenshot = testInfo.outputPath(
            `note-filters-${theme.toLowerCase()}-${width}.png`,
          );
          await owner.page.screenshot({ path: screenshot, fullPage: false });
          await testInfo.attach(`note-filters-${theme.toLowerCase()}-${width}`, {
            path: screenshot,
            contentType: "image/png",
          });

          await typeFilter.selectOption("decision");
          await expect(count).toHaveText("1 of 3 notes");
          await expect(items).toHaveCount(1);
          await expect(items.first()).toContainText(decisionTitle);
          await search.fill(`no matching note ${suffix}`);
          await expect(count).toHaveText("0 of 3 notes");
          await expect(items).toHaveCount(0);
          await expect(browser.locator(".note-list-empty")).toContainText(
            "No notes match these filters",
          );
          await clear.focus();
          await expect(clear).toBeFocused();
          await owner.page.keyboard.press("Enter");
          await expect(search).toHaveValue("");
          await expect(folderFilter).toHaveValue("all");
          await expect(tagFilter).toHaveValue("all");
          await expect(typeFilter).toHaveValue("all");
          await expect(bookmarks).toHaveAttribute("aria-pressed", "false");
          await expect(clear).toBeHidden();
          await expect(count).toHaveText("3 notes");
          await expect(items).toHaveCount(3);
          await expect(items.filter({ hasText: otherTitle })).toHaveCount(0);
          await expect(items.filter({ hasText: longTitle })).toHaveAttribute(
            "aria-current",
            "page",
          );
          if (width === 320)
            await browser
              .getByRole("button", { name: "Close notes browser", exact: true })
              .click();
          await expect(projectScope).toContainText(projectName);
          await expect(title).toHaveValue(longTitle);
          await expect(content).toHaveValue(editorContent);
        }
      }
      expect(
        (await workspace(owner)).notes.find((note) => note.id === noteId)
          ?.content,
      ).toBe(editorContent);
    } finally {
      await owner.page.setViewportSize({ width: 1365, height: 900 });
    }
  });

  test("note details cannot cover account menus or note dialogs in any theme", async () => {
    await selectWorkspace(owner, owner.personal);
    const id = `layering_note_${fixtureId()}`;
    await upsert(owner, owner.personal.id, "notes", {
      id,
      title: "Notes layering check",
      content: "Keep header menus and dialogs reachable.",
    });
    await openNote(owner, id);
    try {
      for (const width of [1365, 320]) {
        await owner.page.setViewportSize({ width, height: 900 });
        const details = owner.page.getByRole("button", {
          name: "Toggle note details",
          exact: true,
        });
        if ((await details.getAttribute("aria-expanded")) !== "true")
          await details.click();
        for (const theme of ["Light", "Dark", "Warp", "Focus", "Soft"]) {
          await owner.page
            .getByRole("button", { name: /^Appearance:/ })
            .click();
          await owner.page
            .getByRole("menuitemradio", { name: new RegExp(`^${theme} `) })
            .click();
          await owner.page
            .getByRole("button", {
              name: `Account: ${owner.username}`,
              exact: true,
            })
            .click();
          // Trial performs normal pointer hit-testing without signing out ten times.
          await owner.page
            .getByRole("menuitem", { name: "Sign out", exact: true })
            .click({ trial: true });
          await owner.page.keyboard.press("Escape");
          const newNote = owner.page.getByRole("button", {
            name: "New note",
            exact: true,
          });
          if (!(await newNote.isVisible()))
            await owner.page
              .getByRole("button", { name: "Browse notes", exact: true })
              .click();
          await newNote.click();
          const dialog = owner.page.getByRole("dialog", {
            name: "Create note",
            exact: true,
          });
          await expect(dialog).toBeVisible();
          await dialog
            .getByRole("button", { name: "Close", exact: true })
            .click();
          await expect(dialog).toBeHidden();
          const closeBrowser = owner.page.getByRole("button", {
            name: "Close notes browser",
            exact: true,
          });
          if (await closeBrowser.isVisible()) await closeBrowser.click();
        }
      }
    } finally {
      await owner.page.setViewportSize({ width: 1365, height: 900 });
    }
  });
});
