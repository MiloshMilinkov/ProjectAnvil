import { randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type {
  AccountContext,
  WorkspaceAccess,
} from "../../app/lib/access-types";
import type { Mutation, Workspace } from "../../app/lib/types";

export interface BrowserAccount {
  context: BrowserContext;
  page: Page;
  username: string;
  password: string;
  userId: string;
  personal: WorkspaceAccess;
  pageErrors: string[];
}

export const fixtureId = () => randomUUID().replaceAll("-", "");

/** Each actor gets its own cookies, storage, cache, and offline queue. */
export async function registerThroughUi(
  browser: Browser,
  baseURL: string,
  label: string,
): Promise<BrowserAccount> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1365, height: 900 },
    reducedMotion: "reduce",
    serviceWorkers: "allow",
  });
  const origin = new URL(baseURL).origin;
  const pageErrors: string[] = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => pageErrors.push(error.message)),
  );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || ["blob:", "data:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  const username = `browser_${label}_${fixtureId().slice(0, 10)}`;
  const password = `Fixture-${randomBytes(18).toString("base64url")}!`;
  await page.goto("/");
  await appReady(page);
  await page
    .getByRole("button", { name: "Sign in or create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  const form = page.locator("form.account-auth-form");
  await form.getByLabel(/^Email address/).fill(`${username}@example.test`);
  await form.getByLabel(/^Username/).fill(username);
  await form.getByLabel(/^Password/).fill(password);
  await form.getByLabel(/^Confirm password/).fill(password);
  await form
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Account: ${username}`, exact: true }),
  ).toBeVisible();
  await dismissGuide(page);
  const response = await context.request.get("/api/account");
  expect(response.ok()).toBeTruthy();
  const raw = await response.json();
  const account = (raw.account || raw) as AccountContext;
  const personal = account.workspaces.find(
    (workspace) => workspace.kind === "personal",
  );
  if (!account.user || !personal)
    throw new Error(
      "A registered test account must have a personal workspace.",
    );
  return {
    context,
    page,
    username,
    password,
    userId: account.user.id,
    personal,
    pageErrors,
  };
}

export async function dismissGuide(page: Page) {
  const guide = page.getByTestId("guided-tour");
  if (await guide.isVisible())
    await guide
      .getByRole("button", { name: "Skip guide", exact: true })
      .click();
}

export async function appReady(page: Page) {
  await expect(
    page.getByRole("button", {
      name: /^(Sign in or create account|Account: )/,
    }),
  ).toBeVisible({ timeout: 30_000 });
  // First-use onboarding is a real UI workflow, rather than a storage override.
  await page
    .getByTestId("guided-tour")
    .waitFor({ state: "visible", timeout: 1500 })
    .catch(() => undefined);
  await dismissGuide(page);
}

export async function navigate(page: Page, name: string | RegExp) {
  await dismissGuide(page);
  const menu = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  const destination = page.getByRole("button", { name, exact: true });
  if (!(await destination.isVisible())) {
    const more = page.locator(".navigation-more");
    if ((await more.getAttribute("open")) === null)
      await more.locator("summary").click();
  }
  await destination.click();
  if (name === "Workspace settings") {
    // Operational workflows explicitly choose the optional storage section.
    // Default disclosure state has dedicated UX regression coverage.
    const data = page.locator('[data-settings-group="data"]');
    if (await data.count()) {
      if ((await data.getAttribute("open")) === null)
        await data.locator(":scope > summary").click();
    }
  }
}

export async function selectWorkspace(
  actor: BrowserAccount,
  workspace: WorkspaceAccess,
) {
  await actor.page.goto("/");
  await appReady(actor.page);
  const switcher = actor.page.getByRole("button", {
    name: /^Switch workspace:/,
  });
  if (!(await switcher.getAttribute("aria-label"))?.endsWith(workspace.name)) {
    await switcher.click();
    await actor.page
      .getByRole("menuitemradio", {
        name: `${workspace.name} ${workspace.kind === "team" ? "Team workspace" : "Private personal workspace"}`,
        exact: true,
      })
      .click();
  }
  await expect(switcher).toHaveAttribute(
    "aria-label",
    `Switch workspace: ${workspace.name}`,
  );
  await expect(actor.page.locator(".sidebar-footer")).not.toContainText(
    "Opening",
  );
}

export async function api(
  actor: BrowserAccount,
  path: string,
  body?: unknown,
  workspaceId?: string,
) {
  const response = await actor.context.request.fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: new URL(actor.page.url()).origin,
      "X-Account-Id": actor.userId,
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    },
    data: body,
  });
  if (!response.ok())
    throw new Error(
      `Synthetic ${path} request failed (${response.status()}): ${await response.text()}`,
    );
  return response.json();
}

export async function workspace(
  actor: BrowserAccount,
  workspaceId = actor.personal.id,
): Promise<Workspace> {
  return (await api(actor, "/api/state", undefined, workspaceId)).workspace;
}

export async function upsert(
  actor: BrowserAccount,
  workspaceId: string,
  entity: Mutation["entity"],
  item: Record<string, unknown>,
) {
  const current = await workspace(actor, workspaceId);
  const previous = entity
    ? current[entity]?.find((value) => value.id === item.id)
    : null;
  return api(
    actor,
    "/api/state",
    {
      action: "upsert",
      entity,
      item,
      base: previous || null,
      operationId: randomUUID(),
    },
    workspaceId,
  );
}

export async function createTeam(
  actor: BrowserAccount,
  teammate: BrowserAccount,
  name: string,
  role: "editor" | "viewer" = "editor",
): Promise<WorkspaceAccess> {
  const result = await api(actor, "/api/teams", { action: "create", name });
  const team = ((result.account || result) as AccountContext).workspaces.find(
    (item) => item.name === name,
  );
  if (!team) throw new Error("The synthetic team was not created.");
  await api(actor, "/api/teams", {
    action: "invite",
    workspaceId: team.id,
    username: teammate.username,
    role,
  });
  const mine = await api(teammate, "/api/account");
  const invitation = (
    (mine.account || mine) as AccountContext
  ).invitations.find((item) => item.workspaceId === team.id);
  if (!invitation)
    throw new Error("The synthetic invitation was not available.");
  await api(teammate, "/api/teams", {
    action: "accept",
    invitationId: invitation.id,
  });
  return team;
}

export async function createProjectUi(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "New project", exact: true });
  await dialog.getByLabel("Project name", { exact: true }).fill(name);
  await dialog.getByLabel(/^Task prefix/).fill("TEST");
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

export async function createNoteUi(
  actor: BrowserAccount,
  title: string,
  content: string,
  workspaceId = actor.personal.id,
) {
  await navigate(actor.page, "Notes");
  await actor.page
    .getByRole("button", { name: "New note", exact: true })
    .click();
  const dialog = actor.page.getByRole("dialog", {
    name: "Create note",
    exact: true,
  });
  await dialog.getByLabel("Note title", { exact: true }).fill(title);
  await dialog
    .getByRole("button", { name: "Create note", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await actor.page
    .getByRole("textbox", { name: "Note content", exact: true })
    .fill(content);
  await expect
    .poll(
      async () =>
        (await workspace(actor, workspaceId)).notes.find(
          (note) => note.title === title,
        )?.content,
    )
    .toBe(content);
  const note = (await workspace(actor, workspaceId)).notes.find(
    (note) => note.title === title,
  );
  if (!note) throw new Error("The UI-created synthetic note is missing.");
  return note;
}

export async function openNote(actor: BrowserAccount, id: string) {
  await actor.page.goto(`/?note=${encodeURIComponent(id)}`);
  await appReady(actor.page);
  await expect(
    actor.page.getByRole("textbox", { name: "Note content", exact: true }),
  ).toBeVisible();
}

export async function createTaskUi(page: Page, title: string) {
  await navigate(page, "Task board");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create task", exact: true });
  await dialog
    .getByPlaceholder("What needs to happen?", { exact: true })
    .fill(title);
  await dialog
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}
