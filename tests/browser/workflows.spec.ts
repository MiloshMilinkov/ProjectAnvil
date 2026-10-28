import { readFile } from "node:fs/promises";
import {
  test,
  expect,
  type Request as BrowserRequest,
  type Route,
  type Page,
} from "@playwright/test";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { validateDisposableTarget } from "../../scripts/test-runtime.mjs";
import { readLocalAccountMail } from "../../scripts/account-mail.mjs";
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
  let stateDirectory: string;

  test.beforeAll(async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error("The disposable test origin is missing.");
    const marker = await validateDisposableTarget(
      baseURL,
      process.env.PROJECTANVIL_TEST_MANIFEST,
    );
    stateDirectory = marker.stateDirectory;
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

  test("account recovery and session controls keep credentials private and preserve workspace access", async ({
    browser,
  }, testInfo) => {
    const extra = await browser.newContext({ baseURL: base });
    extra.on("page", (page) =>
      page.on("pageerror", (error) => owner.pageErrors.push(error.message)),
    );
    const sibling = await owner.context.newPage();
    const releaseHeldRequests: (() => void)[] = [];
    const email = `${owner.username}@example.test`;
    const accountHeaders = { "X-Account-Id": owner.userId };
    const security = () =>
      owner.page.getByRole("dialog", { name: "Account security", exact: true });
    async function openSecurity() {
      await owner.page
        .getByRole("button", {
          name: `Account: ${owner.username}`,
          exact: true,
        })
        .click();
      await owner.page
        .getByRole("menuitem", { name: "Account security", exact: true })
        .click();
      await expect(security()).toBeVisible();
      await expect(
        security().getByText("This session", { exact: true }),
      ).toBeVisible();
    }
    async function signInExtra(password = owner.password) {
      return extra.request.post("/api/auth/sign-in/username", {
        headers: {
          "Content-Type": "application/json",
          "X-Account-Id": "guest",
          Origin: base,
        },
        data: { username: owner.username, password },
      });
    }
    async function mailLink(kind: "verification" | "reset") {
      await expect
        .poll(async () =>
          (await readLocalAccountMail({ stateDirectory, email })).some(
            (mail) => mail.kind === kind,
          ),
        )
        .toBeTruthy();
      const message = (
        await readLocalAccountMail({ stateDirectory, email })
      ).find((mail) => mail.kind === kind);
      if (typeof message?.url !== "string")
        throw new Error("The disposable account link is missing.");
      return message.url;
    }
    try {
      expect((await signInExtra()).ok()).toBeTruthy();
      const sessionResponse = await owner.context.request.get(
        "/api/account/sessions",
        { headers: accountHeaders },
      );
      expect(sessionResponse.ok()).toBeTruthy();
      const sessionText = await sessionResponse.text();
      expect(sessionText).not.toMatch(/"token"|"ipAddress"/);
      const listed = JSON.parse(sessionText);
      expect(
        listed.sessions.filter(
          (session: { current: boolean }) => session.current,
        ),
      ).toHaveLength(1);
      await openSecurity();
      await security()
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await expect(
        security().getByText("That session has been signed out.", {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (await (await extra.request.get("/api/account")).json()).user,
      ).toBeNull();

      await security()
        .getByRole("button", { name: "Request verification link", exact: true })
        .click();
      await expect(security().getByRole("status")).toContainText(
        "doesn't send email",
      );
      await owner.page.goto(await mailLink("verification"));
      const verification = owner.page.getByRole("dialog", {
        name: "Email verification",
        exact: true,
      });
      await expect(verification).toContainText("Your email has been verified");
      await expect
        .poll(() => new URL(owner.page.url()).searchParams.has("token"))
        .toBeFalsy();
      await verification
        .getByRole("button", { name: "Close account dialog", exact: true })
        .click();
      expect(
        (await (await owner.context.request.get("/api/account")).json()).user
          .emailVerified,
      ).toBeTruthy();

      expect((await signInExtra()).ok()).toBeTruthy();
      async function holdLive(page: Page, open: () => Promise<unknown>) {
        let heldRequest: BrowserRequest | undefined;
        let capturedLive = () => {};
        let finishedLive = () => {};
        let release = () => {};
        const captured = new Promise<void>((resolve) => {
          capturedLive = resolve;
        });
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        const finished = new Promise<void>((resolve) => {
          finishedLive = resolve;
        });
        releaseHeldRequests.push(release);
        const handler = async (route: Route) => {
          if (heldRequest) return route.continue();
          heldRequest = route.request();
          capturedLive();
          await released;
          try {
            await route.fulfill({
              status: 409,
              json: {
                error:
                  "The signed-in account changed. Reload before saving this workspace.",
              },
            });
          } catch (error) {
            if (!heldRequest.failure()) throw error;
          } finally {
            finishedLive();
          }
        };
        await page.route("**/api/live?*", handler);
        await open();
        await appReady(page);
        await captured;
        const aborted = page.waitForEvent("requestfailed", {
          predicate: (request) => request === heldRequest,
        });
        return {
          aborted,
          request: heldRequest!,
          release,
          finish: async () => {
            await finished;
            await page.unroute("**/api/live?*", handler);
          },
        };
      }
      const siblingLive = await holdLive(sibling, () => sibling.goto("/"));
      const primaryLive = await holdLive(owner.page, () => owner.page.reload());
      const siblingTrigger = await sibling
        .getByRole("button", {
          name: `Account: ${owner.username}`,
          exact: true,
        })
        .elementHandle();
      const originalTrigger = await owner.page
        .getByRole("button", {
          name: `Account: ${owner.username}`,
          exact: true,
        })
        .elementHandle();
      await openSecurity();
      await security().locator("summary").click();
      const previousPassword = owner.password;
      const changedPassword = `${previousPassword}-changed`;
      await security()
        .getByLabel("Current password", { exact: true })
        .fill(previousPassword);
      await security()
        .getByLabel(/^New password/)
        .fill(changedPassword);
      await security()
        .getByLabel("Confirm new password", { exact: true })
        .fill(changedPassword);
      expect(primaryLive.request.failure()).toBeNull();
      expect(siblingLive.request.failure()).toBeNull();
      await security()
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await expect(security().getByRole("status")).toContainText(
        "Password changed",
      );
      await Promise.all([primaryLive.aborted, siblingLive.aborted]);
      primaryLive.release();
      siblingLive.release();
      await Promise.all([primaryLive.finish(), siblingLive.finish()]);
      expect(
        await siblingTrigger?.evaluate((node) => node.isConnected),
      ).toBeTruthy();
      expect(
        await originalTrigger?.evaluate((node) => node.isConnected),
      ).toBeTruthy();
      await expect(security()).toBeVisible();
      owner.password = changedPassword;
      expect(
        (await (await extra.request.get("/api/account")).json()).user,
      ).toBeNull();
      expect((await signInExtra(previousPassword)).ok()).toBeFalsy();
      await security().locator("summary").click();
      await security()
        .getByRole("button", { name: "Close account dialog", exact: true })
        .click();
      for (const width of [1365, 320]) {
        await owner.page.setViewportSize({ width, height: 900 });
        for (const theme of ["Light", "Dark", "Warp", "Focus", "Soft"]) {
          await owner.page
            .getByRole("button", { name: /^Appearance:/ })
            .click();
          await owner.page
            .getByRole("menuitemradio", { name: new RegExp(`^${theme} `) })
            .click();
          await openSecurity();
          expect(
            await owner.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          const path = testInfo.outputPath(
            `account-security-${theme.toLowerCase()}-${width}.png`,
          );
          await owner.page.screenshot({ path, fullPage: false });
          await testInfo.attach(
            `account-security-${theme.toLowerCase()}-${width}`,
            { path, contentType: "image/png" },
          );
          await security().press("Escape");
          await expect(security()).toBeHidden();
          await expect(
            owner.page.getByRole("button", {
              name: `Account: ${owner.username}`,
              exact: true,
            }),
          ).toBeFocused();
        }
      }
      await owner.page.setViewportSize({ width: 1365, height: 900 });
      const recoveryPage = await extra.newPage();
      await recoveryPage.goto("/");
      await appReady(recoveryPage);
      await recoveryPage
        .getByRole("button", { name: "Sign in or create account", exact: true })
        .click();
      await recoveryPage
        .getByRole("button", { name: "Forgot password?", exact: true })
        .click();
      await recoveryPage
        .getByLabel("Email address", { exact: true })
        .fill(email);
      await recoveryPage
        .getByRole("button", { name: "Request reset link", exact: true })
        .click();
      await expect(
        recoveryPage
          .getByRole("dialog", { name: "Reset your password", exact: true })
          .getByRole("status"),
      ).toContainText("check for a link");
      const resetLink = await mailLink("reset");
      await owner.page.goto(resetLink);
      const reset = owner.page.getByRole("dialog", {
        name: "Choose a new password",
        exact: true,
      });
      await expect(reset).toBeVisible();
      await expect
        .poll(() => new URL(owner.page.url()).searchParams.has("token"))
        .toBeFalsy();
      const resetPassword = `${previousPassword}-reset`;
      await reset.getByLabel(/^New password/).fill(resetPassword);
      await reset
        .getByLabel("Confirm password", { exact: true })
        .fill(resetPassword);
      await reset
        .getByRole("button", { name: "Save new password", exact: true })
        .click();
      const login = owner.page.getByRole("dialog", {
        name: "Welcome back",
        exact: true,
      });
      await expect(login.getByRole("status")).toContainText("Password changed");
      await login.getByLabel("Username", { exact: true }).fill(owner.username);
      await login.getByLabel("Password", { exact: true }).fill(resetPassword);
      await login
        .locator("form")
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(
        owner.page.getByRole("button", {
          name: `Account: ${owner.username}`,
          exact: true,
        }),
      ).toBeVisible();
      owner.password = resetPassword;
      await owner.page.goto(resetLink);
      const expired = owner.page.getByRole("dialog", {
        name: "Choose a new password",
        exact: true,
      });
      await expect(expired.getByRole("alert")).toContainText(
        "invalid or has expired",
      );
      await expired
        .getByRole("button", { name: "Close account dialog", exact: true })
        .click();
      expect((await workspace(owner)).name).toBeTruthy();
      const gate = await extra.newPage();
      await gate.route("**/api/account", (route) =>
        route.fulfill({
          json: {
            user: null,
            workspaces: [],
            invitations: [],
            policy: {
              mode: "online",
              registration: "invite-only",
              verificationRequired: true,
              emailDelivery: "external",
            },
          },
        }),
      );
      await gate.addInitScript(() => {
        const theme = new URL(window.location.href).searchParams.get(
          "test_theme",
        );
        if (theme && ["light", "dark", "warp", "focus", "soft"].includes(theme))
          localStorage.setItem("projectanvil-appearance", theme);
      });
      for (const width of [1365, 320]) {
        await gate.setViewportSize({ width, height: 900 });
        for (const theme of ["light", "dark", "warp", "focus", "soft"]) {
          await gate.goto(`/?test_theme=${theme}`);
          await expect(
            gate.getByRole("heading", {
              name: "Welcome back",
              exact: true,
              level: 1,
            }),
          ).toBeVisible();
          await expect(gate.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          await expect(
            gate.getByRole("complementary", { name: "Workspace navigation" }),
          ).toHaveCount(0);
          await gate.getByLabel("Username", { exact: true }).focus();
          await gate.keyboard.press("Tab");
          await expect(
            gate.getByLabel("Password", { exact: true }),
          ).toBeFocused();
          await gate
            .getByRole("button", { name: "Register", exact: true })
            .click();
          await expect(
            gate.getByText(
              /Registration is limited to approved email addresses/,
            ),
          ).toBeVisible();
          await gate.keyboard.press("Escape");
          await expect(
            gate.getByRole("heading", {
              name: "Create your account",
              exact: true,
              level: 1,
            }),
          ).toBeVisible();
          expect(
            await gate.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          const path = testInfo.outputPath(
            `account-gate-${theme}-${width}.png`,
          );
          await gate.screenshot({ path, fullPage: false });
          await testInfo.attach(`account-gate-${theme}-${width}`, {
            path,
            contentType: "image/png",
          });
        }
      }
    } finally {
      for (const release of releaseHeldRequests) release();
      await sibling.close();
      await extra.close();
      await owner.page.setViewportSize({ width: 1365, height: 900 });
    }
  });

  test("team invitations, viewer/editor roles, and revoked project access update both accounts", async () => {
    const name = `Browser teamwork ${fixtureId().slice(0, 8)}`;
    await navigate(owner.page, /^Teams & workspaces/);
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
    await navigate(owner.page, /^Teams & workspaces/);
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
    await navigate(colleague.page, /^Teams & workspaces/);
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
    await owner.page
      .getByRole("button", { name: "Create project", exact: true })
      .first()
      .click();
    const newProject = owner.page.getByRole("dialog", {
      name: "New project",
      exact: true,
    });
    await newProject
      .getByLabel("Project name", { exact: true })
      .fill("Shared review project");
    await expect(
      newProject.getByLabel("Project name", { exact: true }),
    ).toHaveValue("Shared review project");
    const currentRole = owner.page.getByRole("combobox", {
      name: new RegExp(`^Role for ${colleague.username}`),
    });
    // A permission refresh can replace the workspace view while a form is open.
    // Observe the refreshed role before checking that its draft still contains the name.
    for (const [role, expectedRole] of [
      ["editor", "viewer"],
      ["viewer", "editor"],
    ] as const) {
      await api(owner, "/api/teams", {
        action: "set-role",
        workspaceId: team.id,
        userId: colleague.userId,
        role,
        expectedRole,
      });
      await expect(currentRole).toHaveValue(role, { timeout: 30_000 });
      await expect(
        newProject.getByLabel("Project name", { exact: true }),
      ).toHaveValue("Shared review project");
    }
    await newProject.getByLabel(/^Task prefix/).fill("TEST");
    await expect(
      newProject.getByLabel("Project name", { exact: true }),
    ).toHaveValue("Shared review project");
    await newProject
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(newProject).toBeHidden();
    const project = (await workspace(owner, team.id)).projects.find(
      (item) => item.name === "Shared review project",
    )!;
    await upsert(owner, team.id, "tasks", {
      id: `role_task_${fixtureId()}`,
      title: "Shared role-check task",
      projectId: project.id,
    });
    await navigate(colleague.page, "Tasks");
    await expect(
      colleague.page.getByRole("button", { name: /Shared role-check task/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      colleague.page.getByRole("button", { name: "Create task", exact: true }),
    ).toBeDisabled();
    await colleague.page.keyboard.press("Control+k");
    const viewerSearch = colleague.page.getByRole("dialog", {
      name: "Search workspace",
      exact: true,
    });
    await expect(
      viewerSearch.getByRole("button", { name: /^Create a task/ }),
    ).toBeDisabled();
    await colleague.page.keyboard.press("Escape");
    await expect(viewerSearch).toBeHidden();
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
    await navigate(colleague.page, "Tasks");

    await navigate(owner.page, /^Teams & workspaces/);
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
      await review.getByText("Compare changes", { exact: true }).click();
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
          await testInfo.attach(
            `note-filters-${theme.toLowerCase()}-${width}`,
            {
              path: screenshot,
              contentType: "image/png",
            },
          );

          await typeFilter.selectOption("decision");
          await expect(count).toHaveText("1 of 3 notes");
          await expect(items).toHaveCount(1);
          await expect(items.first()).toContainText(decisionTitle);
          await search.fill(`no matching note ${suffix}`);
          await expect(count).toHaveText("0 of 3 notes");
          await expect(items).toHaveCount(0);
          await expect(browser.locator(".note-list-empty")).toContainText(
            "No matching notes",
          );
          await clear.focus();
          await expect(clear).toBeFocused();
          await owner.page.keyboard.press("Enter");
          await expect(search).toHaveValue("");
          await expect(search).toBeFocused();
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

  test("settings reveal optional sections on request and note details return keyboard focus", async ({}, testInfo) => {
    await owner.page.setViewportSize({ width: 1365, height: 900 });
    await selectWorkspace(owner, owner.personal);
    // Select directly: the operational navigation helper intentionally opens Data.
    await owner.page
      .getByRole("button", { name: "Workspace settings", exact: true })
      .click();
    const groups = (name: string) =>
      owner.page.locator(`[data-settings-group="${name}"]`);
    await expect(groups("workspace")).toHaveAttribute("open", "");
    await expect(groups("appearance")).toHaveAttribute("open", "");
    await expect(groups("data")).not.toHaveAttribute("open");
    await expect(groups("people")).not.toHaveAttribute("open");
    const jump = owner.page.getByRole("navigation", {
      name: "Settings sections",
      exact: true,
    });
    for (const [name, label] of [
      ["data", "Data & offline"],
      ["people", "People & access"],
    ]) {
      await jump
        .getByRole("button", { name: label, exact: true })
        .press("Enter");
      await expect(groups(name)).toHaveAttribute("open", "");
      const summary = groups(name).locator(":scope > summary");
      await expect(summary).toBeFocused();
      await summary.press("Enter");
      await expect(groups(name)).not.toHaveAttribute("open");
    }
    try {
      for (const width of [1365, 320]) {
        await owner.page.setViewportSize({ width, height: 900 });
        for (const theme of ["Light", "Dark", "Warp", "Focus", "Soft"]) {
          await owner.page
            .getByRole("radio", { name: new RegExp(`^${theme} `) })
            .check();
          await expect(groups("data")).not.toHaveAttribute("open");
          await expect(groups("people")).not.toHaveAttribute("open");
          await jump.scrollIntoViewIfNeeded();
          expect(
            await owner.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          expect(
            await jump
              .getByRole("button")
              .evaluateAll(
                (buttons, minimum) =>
                  buttons.every(
                    (button) =>
                      button.getBoundingClientRect().height >= minimum,
                  ),
                width === 320 ? 44 : 40,
              ),
          ).toBeTruthy();
          const path = testInfo.outputPath(
            `settings-${theme.toLowerCase()}-${width}.png`,
          );
          await owner.page.screenshot({ path, fullPage: false });
          await testInfo.attach(`settings-${theme.toLowerCase()}-${width}`, {
            path,
            contentType: "image/png",
          });
        }
      }
      await owner.page.setViewportSize({ width: 1365, height: 900 });
      const beforeInvalidImport = await workspace(owner);
      const attemptedImports: string[] = [];
      const watchImport = (request: BrowserRequest) => {
        if (
          new URL(request.url()).pathname === "/api/state" &&
          request.method() === "POST"
        )
          attemptedImports.push(request.url());
      };
      owner.page.on("request", watchImport);
      try {
        await jump
          .getByRole("button", { name: "Data & offline", exact: true })
          .press("Enter");
        owner.page.once("dialog", (dialog) => dialog.accept());
        await groups("data")
          .locator('input[type="file"][accept="application/json,.json"]')
          .setInputFiles({
            name: "invalid-workspace.json",
            mimeType: "application/json",
            buffer: Buffer.from('{"notes":'),
          });
        await expect(groups("data").getByRole("alert")).toHaveText(
          "This file isn't valid JSON. Choose a ProjectAnvil workspace export.",
        );
        expect(attemptedImports).toEqual([]);
        expect((await workspace(owner)).revision).toBe(
          beforeInvalidImport.revision,
        );
      } finally {
        owner.page.off("request", watchImport);
      }
      const id = `calm_note_${fixtureId()}`;
      await upsert(owner, owner.personal.id, "notes", {
        id,
        title: "A focused writing surface",
        content: "Keep properties available without covering the writing area.",
      });
      await openNote(owner, id);
      const details = owner.page.getByRole("button", {
        name: "Toggle note details",
        exact: true,
      });
      await expect(details).toHaveAttribute("aria-expanded", "false");
      await expect(
        owner.page.getByRole("complementary", {
          name: "Note details",
          exact: true,
        }),
      ).toBeHidden();
      for (const width of [320, 1365]) {
        await owner.page.setViewportSize({ width, height: 900 });
        await details.press("Enter");
        await expect(details).toHaveAttribute("aria-expanded", "true");
        await owner.page
          .getByRole("button", { name: "Close note details", exact: true })
          .press("Enter");
        await expect(details).toHaveAttribute("aria-expanded", "false");
        await expect(details).toBeFocused();
      }
    } finally {
      await owner.page.setViewportSize({ width: 1365, height: 900 });
    }
  });

  test("task essentials stay visible and collapsed planning keeps saved values", async ({}, testInfo) => {
    await owner.page.setViewportSize({ width: 1365, height: 900 });
    await selectWorkspace(owner, owner.personal);
    await navigate(owner.page, "Tasks");
    const newTask = owner.page.locator(".page-heading .heading-actions").getByRole("button", {
      name: "Create task",
      exact: true,
    });
    const dialog = owner.page.getByRole("dialog", {
      name: "Create task",
      exact: true,
    });
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
          await newTask.click();
          await expect(
            dialog.getByLabel("Task title", { exact: true }),
          ).toBeVisible();
          await expect(
            dialog.getByLabel("Planned start date", { exact: true }),
          ).toBeVisible();
          await expect(
            dialog.getByLabel("Due date", { exact: true }),
          ).toBeVisible();
          const options = dialog.locator(".task-advanced-planning");
          await expect(options).not.toHaveAttribute("open");
          await expect(
            dialog.getByLabel("Effort points", { exact: true }),
          ).toBeHidden();
          expect(
            await owner.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          expect(
            await dialog.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          ).toBeTruthy();
          const path = testInfo.outputPath(
            `task-editor-${theme.toLowerCase()}-${width}.png`,
          );
          await owner.page.screenshot({ path, fullPage: false });
          await testInfo.attach(`task-editor-${theme.toLowerCase()}-${width}`, {
            path,
            contentType: "image/png",
          });
          await dialog
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          await expect(dialog).toBeHidden();
        }
      }
      await owner.page.setViewportSize({ width: 1365, height: 900 });
      await newTask.click();
      const title = `Planning stays saved ${fixtureId().slice(0, 8)}`;
      await dialog.getByLabel("Task title", { exact: true }).fill(title);
      await dialog
        .getByLabel("Planned start date", { exact: true })
        .fill("2026-11-02");
      await dialog.getByLabel("Due date", { exact: true }).fill("2026-11-05");
      const options = dialog.locator(".task-advanced-planning");
      const summary = options.locator(":scope > summary");
      await summary.press("Enter");
      await expect(options).toHaveAttribute("open", "");
      await dialog.getByLabel("Effort points", { exact: true }).fill("5");
      await dialog
        .getByRole("combobox", { name: "Type", exact: true })
        .selectOption("story");
      await dialog.getByLabel("Tags", { exact: true }).fill("review, weekly");
      await summary.press("Enter");
      await expect(options).not.toHaveAttribute("open");
      await dialog
        .getByRole("button", { name: "Create task", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      const saved = (await workspace(owner)).tasks.find(
        (task) => task.title === title,
      )!;
      expect(saved).toMatchObject({
        estimate: 5,
        type: "story",
        tags: ["review", "weekly"],
        startDate: "2026-11-02",
        dueDate: "2026-11-05",
      });
      await owner.page
        .getByRole("button", { name: new RegExp(title) })
        .first()
        .click();
      const editor = owner.page.getByRole("dialog", {
        name: "Edit task",
        exact: true,
      });
      const planning = editor.locator(".task-advanced-planning");
      await expect(planning).toHaveAttribute("open", "");
      await expect(
        editor.getByLabel("Effort points", { exact: true }),
      ).toHaveValue("5");
      await expect(editor.getByLabel("Tags", { exact: true })).toHaveValue(
        "review, weekly",
      );
      const repeat = editor.locator('[data-tour="recurrence"]');
      await repeat.locator(":scope > summary").press("Enter");
      await editor.getByLabel("Repeat this task", { exact: true }).check();
      await editor
        .getByLabel("Recurrence time zone", { exact: true })
        .fill("Invalid/Zone");
      await planning.locator(":scope > summary").press("Enter");
      await editor
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(editor.locator(".entity-editor-error")).toContainText(
        "Choose a valid schedule start",
      );
      await expect(planning).toHaveAttribute("open", "");
      await editor.getByLabel("Repeat this task", { exact: true }).uncheck();
      await editor
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(editor).toBeHidden();
      expect(
        (await workspace(owner)).tasks.find((task) => task.id === saved.id),
      ).toMatchObject({
        recurrence: null,
        estimate: 5,
        tags: ["review", "weekly"],
      });
    } finally {
      await owner.page.setViewportSize({ width: 1365, height: 900 });
    }
  });

  test("short guides and searchable destinations preserve orientation and keyboard control", async ({}, testInfo) => {
    await owner.page.setViewportSize({ width: 1365, height: 900 });
    await selectWorkspace(owner, owner.personal);
    const guideProjectId = `guide_scope_${fixtureId()}`;
    await upsert(owner, owner.personal.id, "projects", {
      id: guideProjectId,
      name: `Guide return project ${fixtureId().slice(0, 8)}`,
      key: "GUIDE",
    });
    await expect(
      owner.page.locator(".sidebar-projects .project-nav"),
    ).not.toHaveCount(0);
    const more = owner.page.locator(".navigation-more");
    await expect(more).not.toHaveAttribute("open");
    await expect(more.getByRole("button", { includeHidden: true })).toHaveCount(
      3,
    );
    const main = owner.page.getByRole("main");
    await expect(main).toHaveCount(1);
    const skip = owner.page.getByRole("link", {
      name: "Skip to workspace",
      exact: true,
    });
    await skip.focus();
    await skip.press("Enter");
    await expect(main).toBeFocused();
    await owner.page.keyboard.press("Control+k");
    const search = owner.page.getByRole("dialog", {
      name: "Search workspace",
      exact: true,
    });
    await search
      .getByRole("textbox", {
        name: "Search tasks, notes, and projects",
        exact: true,
      })
      .fill("Work rooms");
    await search.getByRole("button", { name: /^Work rooms/ }).press("Enter");
    await expect(search).toBeHidden();
    await expect(more).toHaveAttribute("open", "");
    await expect(
      more.getByRole("button", { name: "Work rooms", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(main).toHaveCount(1);
    await expect(
      main.getByRole("heading", { name: "Work rooms", exact: true }),
    ).toBeVisible();
    const trigger = owner.page.getByRole("button", {
      name: "Start guided tour",
      exact: true,
    });
    const beforeGuides = await workspace(owner);
    await trigger.click();
    const guide = owner.page.getByTestId("guided-tour");
    await expect(guide).toContainText("Step 1 of 8");
    for (let step = 2; step <= 8; step++) {
      await guide
        .getByRole("button", { name: "Next", exact: true })
        .press("Enter");
      await expect(guide).toContainText(`Step ${step} of 8`);
    }
    await guide
      .getByRole("button", { name: "Finish", exact: true })
      .press("Enter");
    await expect(guide).toBeHidden();
    await expect(
      main.getByRole("heading", { name: "Work rooms", exact: true }),
    ).toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await guide
      .getByRole("button", { name: "All guides", exact: true })
      .press("Enter");
    await expect(
      guide.getByRole("heading", { name: "Choose a guide", exact: true }),
    ).toBeVisible();
    await expect(guide.locator(".tour-guide-option")).toHaveCount(10);
    const guideSearch = guide.getByRole("textbox", {
      name: "Search guides",
      exact: true,
    });
    await guideSearch.fill("unmatched feature name");
    await expect(guide.locator(".tour-guide-option")).toHaveCount(0);
    await guide
      .getByRole("button", { name: "Clear search", exact: true })
      .press("Enter");
    await expect(guideSearch).toBeFocused();
    await guideSearch.fill("import");
    await guide
      .getByRole("button", { name: /^Markdown portability/ })
      .press("Enter");
    await expect(guide).toContainText("Step 1 of 2");
    await owner.page.keyboard.press("Escape");
    await expect(guide).toBeHidden();
    await expect(
      main.getByRole("heading", { name: "Work rooms", exact: true }),
    ).toBeVisible();
    await expect(trigger).toBeFocused();
    await navigate(owner.page, "Projects");
    const project = beforeGuides.projects.find(
      (item) => item.id === guideProjectId,
    )!;
    expect(project).toBeDefined();
    await owner.page
      .locator(".projects-grid")
      .getByRole("button", { name: project.name, exact: true })
      .click();
    const home = owner.page.locator('[data-tour="project-home"]');
    const scopedProject = owner.page
      .locator(".sidebar-projects")
      .getByRole("button", {
        name: project.name,
        exact: true,
      });
    await expect(
      home.getByRole("heading", { name: project.name, exact: true }),
    ).toBeVisible();
    await expect(scopedProject).toHaveAttribute("aria-pressed", "true");
    await trigger.click();
    await guide
      .getByRole("button", { name: "Next", exact: true })
      .press("Enter");
    await expect(guide).toContainText("Step 2 of 8");
    await owner.page.keyboard.press("Escape");
    await expect(guide).toBeHidden();
    await expect(
      home.getByRole("heading", { name: project.name, exact: true }),
    ).toBeVisible();
    await expect(scopedProject).toHaveAttribute("aria-pressed", "true");
    await expect(trigger).toBeFocused();
    expect(await workspace(owner)).toEqual(beforeGuides);
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
          await trigger.click();
          await guide
            .getByRole("button", { name: "All guides", exact: true })
            .press("Enter");
          const card = guide.getByRole("dialog");
          const input = guide.getByRole("textbox", {
            name: "Search guides",
            exact: true,
          });
          await expect(guide.locator(".tour-guide-option")).toHaveCount(10);
          await input.fill("milestones");
          await input.press("ArrowLeft");
          await expect(
            guide.getByRole("heading", { name: "Choose a guide", exact: true }),
          ).toBeVisible();
          await expect(input).toHaveValue("milestones");
          await input.fill("");
          await expect(guide.locator(".tour-guide-option")).toHaveCount(10);
          const bounds = await card.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
          expect(bounds!.y).toBeGreaterThanOrEqual(0);
          expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
          expect(
            await card.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          ).toBeTruthy();
          expect(
            await owner.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          if (width === 320) {
            expect(
              await input.evaluate((element) =>
                Number.parseFloat(getComputedStyle(element).fontSize),
              ),
            ).toBeGreaterThanOrEqual(16);
            expect(
              await guide
                .locator(".tour-guide-option")
                .evaluateAll((buttons) =>
                  buttons.every(
                    (button) => button.getBoundingClientRect().height >= 44,
                  ),
                ),
            ).toBeTruthy();
          }
          const path = testInfo.outputPath(
            `guide-library-${theme.toLowerCase()}-${width}.png`,
          );
          await owner.page.screenshot({ path, fullPage: false });
          await testInfo.attach(
            `guide-library-${theme.toLowerCase()}-${width}`,
            { path, contentType: "image/png" },
          );
          await owner.page.keyboard.press("Escape");
          await expect(guide).toBeHidden();
          await expect(trigger).toBeFocused();
        }
      }
      expect(await workspace(owner)).toEqual(beforeGuides);
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

  test("collections retain scoped grouping, four layouts, and edited properties", async ({}, testInfo) => {
    await owner.page.setViewportSize({ width: 1365, height: 900 });
    await selectWorkspace(owner, owner.personal);
    const suffix = fixtureId().slice(0, 8);
    const projectId = `collection_project_${suffix}`;
    const outsideId = `collection_outside_${suffix}`;
    const typeId = `collection_type_${suffix}`;
    const archivedTypeId = `collection_archived_${suffix}`;
    const projectName = `Collection review ${suffix}`;
    const title = (name: string) => `Collection ${name} ${suffix}`;
    await upsert(owner, owner.personal.id, "projects", {
      id: projectId,
      name: projectName,
      key: "CLX",
    });
    await upsert(owner, owner.personal.id, "projects", {
      id: outsideId,
      name: `Outside collection ${suffix}`,
      key: "CLY",
    });
    const field = {
      id: "confidence",
      name: "Confidence",
      type: "number",
      required: false,
      options: [],
    };
    await upsert(owner, owner.personal.id, "noteTypes", {
      id: typeId,
      name: "Research",
      fields: [field],
    });
    await upsert(owner, owner.personal.id, "noteTypes", {
      id: archivedTypeId,
      name: "Archived reference",
      archived: false,
      fields: [field],
    });
    const rows = [
      {
        id: `collection_alpha_${suffix}`,
        title: title("Alpha"),
        projectId,
        folder: "Planning",
        tags: [suffix],
        properties: { Status: "Draft", Category: "Alpha", Effort: "10" },
        customTypeId: typeId,
        propertyValues: { confidence: "2" },
        content: "A scoped planning reference and its next steps.",
      },
      {
        id: `collection_beta_${suffix}`,
        title: title("Beta"),
        projectId,
        folder: "Research",
        tags: [suffix],
        properties: { Status: "Review", Category: "Beta", Effort: "2" },
        content: "Another useful reference.",
      },
      {
        id: `collection_empty_${suffix}`,
        title: title("Empty"),
        projectId,
        folder: "",
        tags: [suffix],
        properties: { Status: "Draft", Category: "", Effort: "30" },
        customTypeId: archivedTypeId,
        propertyValues: { confidence: "8" },
        content: "An archived type keeps its values.",
      },
      {
        id: `collection_literal_${suffix}`,
        title: title("Literal"),
        projectId,
        folder: "Planning",
        tags: [suffix],
        properties: { Status: "Draft", Category: "Unspecified", Effort: "1" },
        content: "A literal empty-group label remains in the same bucket.",
      },
      {
        id: `collection_private_${suffix}`,
        title: title("Outside"),
        projectId: outsideId,
        folder: "Planning",
        tags: [suffix],
        properties: { Status: "Draft", Category: "Alpha", Effort: "1" },
        content: "A scoped planning reference and its next steps.",
      },
    ];
    for (const note of rows)
      await upsert(owner, owner.personal.id, "notes", note);
    await upsert(owner, owner.personal.id, "noteTypes", {
      id: archivedTypeId,
      name: "Archived reference",
      archived: true,
      fields: [field],
    });
    await owner.page.reload();
    await appReady(owner.page);
    await owner.page
      .locator(".sidebar-projects")
      .getByRole("button", { name: projectName, exact: true })
      .click();
    await navigate(owner.page, "Collections");
    const collection = owner.page.locator(".bases-page");
    const layout = collection.getByRole("group", {
      name: "Collection layout",
      exact: true,
    });
    const count = collection.locator(".base-result-count");
    await expect(count).toHaveText("4 notes");
    await expect(
      collection.getByRole("combobox", {
        name: "Filter collection by project",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(collection).not.toContainText(title("Outside"));
    await collection
      .getByRole("combobox", { name: "Sort collection", exact: true })
      .selectOption("prop:Effort");
    await collection
      .getByRole("combobox", { name: "Group collection", exact: true })
      .selectOption("prop:Category");
    await expect(collection.locator(".base-group-heading h2")).toHaveText([
      "Alpha",
      "Beta",
      "Unspecified",
    ]);
    const unspecified = collection.locator(".base-group").filter({
      has: owner.page.getByRole("heading", {
        name: "Unspecified",
        exact: true,
      }),
    });
    await expect(unspecified.locator(".base-note-link strong")).toHaveText([
      title("Literal"),
      title("Empty"),
    ]);
    for (const name of ["Table", "List", "Gallery", "Board"]) {
      await layout.getByRole("button", { name, exact: true }).click();
      await expect(count).toHaveText("4 notes");
      await expect(collection).toContainText(title("Alpha"));
      await expect(collection).not.toContainText(title("Outside"));
    }
    const betaCard = collection
      .locator(".base-board-card")
      .filter({ hasText: title("Beta") });
    await betaCard
      .getByRole("combobox", {
        name: `Status of ${title("Beta")}`,
        exact: true,
      })
      .selectOption("Complete");
    await expect
      .poll(
        async () =>
          (await workspace(owner)).notes.find((note) => note.id === rows[1].id)
            ?.properties.Status,
      )
      .toBe("Complete");
    const complete = collection.locator(".base-board-column").filter({
      has: owner.page.getByRole("heading", { name: "Complete", exact: true }),
    });
    await expect(complete).toContainText(title("Beta"));
    await layout.getByRole("button", { name: "Table", exact: true }).click();
    await collection
      .getByRole("button", { name: "Properties", exact: true })
      .click();
    await collection
      .getByRole("checkbox", {
        name: "Research (custom) · Confidence",
        exact: true,
      })
      .check();
    await collection
      .getByRole("button", { name: "Close collection properties", exact: true })
      .click();
    await collection
      .getByRole("button", {
        name: `Edit Research (custom) · Confidence for ${title("Alpha")}`,
        exact: true,
      })
      .click();
    const details = owner.page.getByRole("button", {
      name: "Toggle note details",
      exact: true,
    });
    if ((await details.getAttribute("aria-expanded")) !== "true")
      await details.click();
    await owner.page.getByLabel("Confidence", { exact: true }).fill("7");
    await expect
      .poll(
        async () =>
          (await workspace(owner)).notes.find((note) => note.id === rows[0].id)
            ?.propertyValues?.confidence,
      )
      .toBe("7");
    await navigate(owner.page, "Collections");
    await expect(
      collection.getByRole("button", {
        name: `Edit Research (custom) · Confidence for ${title("Alpha")}`,
        exact: true,
      }),
    ).toHaveText("7");
    const effort = collection.getByRole("textbox", {
      name: `Effort for ${title("Alpha")}`,
      exact: true,
    });
    await effort.fill("11");
    await effort.press("Enter");
    await expect
      .poll(
        async () =>
          (await workspace(owner)).notes.find((note) => note.id === rows[0].id)
            ?.properties.Effort,
      )
      .toBe("11");
    await expect(collection.locator(".base-saving")).toHaveText(
      "All changes saved",
    );
    const search = collection.getByRole("textbox", {
      name: "Search collection",
      exact: true,
    });
    await collection
      .getByRole("combobox", { name: "Filter collection by type", exact: true })
      .selectOption(`custom:${typeId}`);
    await search.fill("Research (custom)");
    await expect(count).toHaveText("1 note");
    await expect(collection).toContainText(title("Alpha"));
    await search.fill("");
    await collection
      .getByRole("combobox", { name: "Filter collection by type", exact: true })
      .selectOption(`custom:${archivedTypeId}`);
    await expect(count).toHaveText("1 note");
    await expect(collection).toContainText(title("Empty"));
    await collection
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(count).toHaveText("4 notes");
    await expect(
      collection.getByRole("combobox", {
        name: "Filter collection by project",
        exact: true,
      }),
    ).toHaveValue(projectId);
    await layout.getByRole("button", { name: "Gallery", exact: true }).click();
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
          expect(
            await owner.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          await expect(count).toHaveText("4 notes");
          const path = testInfo.outputPath(
            `collections-${theme.toLowerCase()}-${width}.png`,
          );
          await owner.page.screenshot({ path, fullPage: false });
          await testInfo.attach(`collections-${theme.toLowerCase()}-${width}`, {
            path,
            contentType: "image/png",
          });
        }
      }
    } finally {
      await owner.page.setViewportSize({ width: 1365, height: 900 });
    }
    const saved = (await workspace(owner)).notes.find(
      (note) => note.id === rows[0].id,
    )!;
    expect(saved.propertyValues?.confidence).toBe("7");
    expect(saved.properties).toMatchObject({
      Category: "Alpha",
      Effort: "11",
      Status: "Draft",
    });
    expect(saved.content).toBe(rows[0].content);
    expect(
      (await workspace(colleague)).notes.some((note) => note.id === rows[0].id),
    ).toBeFalsy();
  });

  test("a failed deferred feature can be retried without signing out or reloading", async ({
    browser,
  }, testInfo) => {
    // Reuse the same account with no existing service worker/cache interception.
    const context = await browser.newContext({
      baseURL: base,
      storageState: await owner.context.storageState(),
      serviceWorkers: "block",
      viewport: { width: 1365, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const manifest = JSON.parse(
      await readFile(
        new URL("../../dist/client/.vite/manifest.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, { file?: string }>;
    const file = manifest["app/components/Collections.tsx"]?.file;
    if (!file) throw new Error("The current build has no Collections entry.");
    const chunk = (url: URL) => url.pathname === `/${file}`;
    let blocked = 0;
    const blockChunk = async (route: import("@playwright/test").Route) => {
      // Module preload and its subsequent import can request the same chunk.
      // Keep the connection unavailable until the failure is visible.
      blocked++;
      await route.abort("failed");
    };
    await page.route(chunk, blockChunk);
    try {
      await page.goto("/");
      await appReady(page);
      await page.evaluate(() => {
        (
          window as unknown as { __deferredPageIdentity: string }
        ).__deferredPageIdentity = "same-page";
      });
      await navigate(page, "Collections");
      const failure = page
        .getByRole("alert")
        .filter({ hasText: "Could not open collections" });
      await expect(
        failure.getByRole("heading", {
          name: "Could not open collections",
          exact: true,
        }),
      ).toBeVisible();
      expect(blocked).toBeGreaterThanOrEqual(1);
      await expect(
        page.getByRole("button", {
          name: `Account: ${owner.username}`,
          exact: true,
        }),
      ).toBeVisible();
      await page.unroute(chunk, blockChunk);
      await failure
        .getByRole("button", { name: "Retry opening", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Collections", exact: true }),
      ).toBeVisible();
      await expect(failure).toBeHidden();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { __deferredPageIdentity: string })
              .__deferredPageIdentity,
        ),
      ).toBe("same-page");
      expect(errors).toEqual([]);
    } catch (error) {
      await testInfo.attach("deferred-failure-page", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await testInfo.attach("deferred-failure-details", {
        body: JSON.stringify({
          blocked,
          headings: await page.getByRole("heading").allTextContents(),
          errors,
        }),
        contentType: "application/json",
      });
      throw error;
    } finally {
      await context.close();
    }
  });
  test("technical Markdown loads formatting on demand and remains portable offline", async ({}, testInfo) => {
    await owner.page.setViewportSize({ width: 1365, height: 900 });
    await selectWorkspace(owner, owner.personal);
    const suffix = fixtureId();
    const plainId = `render_plain_${suffix}`;
    const technicalId = `render_technical_${suffix}`;
    const technical = [
      "# Technical reference",
      "",
      "Inline math: $a^2 + b^2 = c^2$.",
      "",
      "$$",
      "\\frac{1}{2} + \\frac{1}{2} = 1",
      "$$",
      "",
      "```math",
      "\\sqrt{16} = 4",
      "```",
      "",
      "```javascript",
      "const total = 2 + 3;",
      "```",
      "",
      "```ino",
      "void setup() { pinMode(13, OUTPUT); }",
      "```",
      "",
      "```projectanvil-unknown",
      "<mark>Keep me literal</mark>",
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      '  A["$$x^2 + y^2$$"] --> B["Review"]',
      "```",
      "",
      '<img data-unsafe="true" src="missing-image" onerror="window.__markdownUnsafe=true">',
    ].join("\n");
    await upsert(owner, owner.personal.id, "notes", {
      id: plainId,
      title: "Plain rendering reference",
      content:
        "# Plain reference\n\nOrdinary prose and a [safe link](https://example.test).",
    });
    await upsert(owner, owner.personal.id, "notes", {
      id: technicalId,
      title: "Technical rendering reference",
      content: technical,
    });

    // Inspect actual script responses, excluding service-worker precache fetches.
    // Package signatures avoid depending on generated chunk names or hashes.
    const trackedPage = owner.page;
    const inspections: Promise<void>[] = [];
    const formatterScripts: { phase: string; kind: string; url: string }[] = [];
    let phase = "plain";
    const inspectScript = (response: import("@playwright/test").Response) => {
      if (response.request().resourceType() !== "script") return;
      const startedIn = phase;
      inspections.push(
        response
          .text()
          .then((body) => {
            if (body.includes("KaTeX parse error"))
              formatterScripts.push({
                phase: startedIn,
                kind: "math",
                url: response.url(),
              });
            if (
              body.includes("highlightAll") &&
              body.includes("registerLanguage")
            )
              formatterScripts.push({
                phase: startedIn,
                kind: "syntax",
                url: response.url(),
              });
          })
          .catch(() => undefined),
      );
    };
    trackedPage.on("response", inspectScript);
    try {
      await openNote(owner, plainId);
      const preview = () => owner.page.locator(".note-preview-pane .markdown");
      await expect(
        preview().getByRole("heading", {
          name: "Plain reference",
          exact: true,
        }),
      ).toBeVisible();
      await Promise.all([...inspections]);
      expect(
        formatterScripts.filter((entry) => entry.phase === "plain"),
        "Ordinary prose must not fetch math or syntax engines as executable modules",
      ).toEqual([]);

      phase = "technical";
      await openNote(owner, technicalId);
      const assertFormatting = async () => {
        await expect(preview().locator(".markdown-math .katex")).toHaveCount(3);
        await expect(
          preview().locator(".markdown-math .katex-display"),
        ).toHaveCount(2);
        await expect(
          preview().locator("code.language-javascript.hljs .hljs-keyword"),
        ).toHaveCount(1);
        await expect(preview().locator("code.language-ino.hljs")).toContainText(
          "pinMode",
        );
        expect(
          await preview().locator("code.language-ino.hljs span").count(),
        ).toBeGreaterThan(0);
        const unknown = preview().locator("code.language-projectanvil-unknown");
        await expect(unknown).toHaveText("<mark>Keep me literal</mark>\n");
        await expect(unknown).not.toHaveClass(/hljs/);
        await expect(preview().locator(".mermaid-diagram svg")).toBeVisible();
        await expect(
          preview().locator(".mermaid-diagram svg .katex"),
        ).toHaveCount(1);
        await expect(preview().locator(".mermaid-diagram")).toContainText(
          "Review",
        );
        await expect(
          preview().locator("script, img[data-unsafe], mark"),
        ).toHaveCount(0);
        expect(
          await owner.page.evaluate(() => "__markdownUnsafe" in window),
        ).toBeFalsy();
      };
      await assertFormatting();
      await Promise.all([...inspections]);
      expect(
        new Set(
          formatterScripts
            .filter((entry) => entry.phase === "technical")
            .map((entry) => entry.kind),
        ),
      ).toEqual(new Set(["math", "syntax"]));
      await testInfo.attach("on-demand-formatters", {
        body: JSON.stringify(
          formatterScripts.map((entry) => ({
            ...entry,
            url: new URL(entry.url).pathname,
          })),
          null,
          2,
        ),
        contentType: "application/json",
      });
      trackedPage.off("response", inspectScript);
      await owner.page
        .getByRole("group", { name: "Note view", exact: true })
        .getByRole("button", { name: "Read", exact: true })
        .click();
      for (const width of [1365, 320]) {
        await owner.page.setViewportSize({ width, height: 900 });
        for (const theme of ["Light", "Dark", "Warp", "Focus", "Soft"]) {
          const beforeTheme = await owner.page
            .locator("html")
            .getAttribute("data-theme");
          const beforeDiagram = await preview()
            .locator(".mermaid-diagram svg")
            .getAttribute("id");
          await owner.page
            .getByRole("button", { name: /^Appearance:/ })
            .click();
          await owner.page
            .getByRole("menuitemradio", { name: new RegExp(`^${theme} `) })
            .click();
          if (beforeTheme !== theme.toLowerCase())
            await expect
              .poll(() =>
                preview().locator(".mermaid-diagram svg").getAttribute("id"),
              )
              .not.toBe(beforeDiagram);
          await assertFormatting();
          expect(
            await owner.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBeTruthy();
          const path = testInfo.outputPath(
            `technical-markdown-${theme.toLowerCase()}-${width}.png`,
          );
          await owner.page.screenshot({ path, fullPage: false });
          await testInfo.attach(
            `technical-markdown-${theme.toLowerCase()}-${width}`,
            { path, contentType: "image/png" },
          );
        }
      }
      await owner.page.setViewportSize({ width: 1365, height: 900 });
      await navigate(owner.page, "Workspace settings");
      await expect(
        owner.page.getByText(
          "Application files are ready for offline startup.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 30_000 });
      await owner.page
        .getByRole("button", {
          name: /^(Save workspace offline|Refresh offline copy)$/,
        })
        .click();
      await expect(
        owner.page.getByText("Offline workspace copy saved", { exact: true }),
      ).toBeVisible();
      await openNote(owner, technicalId);
      await assertFormatting();
      await owner.context.setOffline(true);
      await owner.page.close();
      owner.page = await owner.context.newPage();
      await owner.page.goto(`${base}/?note=${technicalId}`);
      await expect(
        owner.page.getByRole("textbox", { name: "Note content", exact: true }),
      ).toHaveValue(technical);
      await assertFormatting();
      await expect(owner.page.locator(".offline-banner")).toContainText(
        "Working offline",
      );
    } finally {
      trackedPage.off("response", inspectScript);
      await owner.context.setOffline(false);
      await owner.page.setViewportSize({ width: 1365, height: 900 });
    }
    expect(
      (await workspace(owner)).notes.find((note) => note.id === technicalId)
        ?.content,
    ).toBe(technical);
  });
});
