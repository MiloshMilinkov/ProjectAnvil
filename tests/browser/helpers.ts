import { randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
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
  nativeExitErrors: string[];
}

export const fixtureId = () => randomUUID().replaceAll("-", "");
const exitingDocuments = new WeakSet<Page>();
const networkPolicies = new WeakMap<
  BrowserContext,
  { handler: (route: Route) => Promise<void>; suspended: boolean }
>();

/** Keep native offline networking without Firefox's interception/navigation race. */
export async function setActorOffline(actor: BrowserAccount, offline: boolean) {
  const { context } = actor;
  const policy = networkPolicies.get(context);
  if (!offline && policy?.suspended) {
    await context.route("**/*", policy.handler);
    policy.suspended = false;
  }
  await context.setOffline(offline);
  if (
    offline &&
    context.browser()?.browserType().name() === "firefox" &&
    policy &&
    !policy.suspended
  ) {
    // Firefox rejects even worker-generated offline navigations while a route
    // interceptor is installed. Native offline mode already blocks all network
    // traffic, so suspend only our external-request guard until reconnection.
    await context.unroute("**/*", policy.handler);
    policy.suspended = true;
  }
  if (offline)
    expect(
      await actor.page.evaluate(async () => ({
        online: navigator.onLine,
        reachedNetwork: await fetch(
          `/api/__projectanvil_offline_probe?check=${crypto.randomUUID()}`,
          { cache: "no-store" },
        ).then(
          () => true,
          () => false,
        ),
      })),
      "Native offline mode must block an uncached API request.",
    ).toEqual({ online: false, reachedNetwork: false });
}

export function isNativeDocumentExitError(
  page: Page,
  error: Error,
  browserName: string,
  origin: string,
): boolean {
  return (
    browserName === "webkit" &&
    exitingDocuments.has(page) &&
    error.name === "Fetch API cannot load http" &&
    !!error.stack?.startsWith(`Fetch API cannot load ${origin}/api/`) &&
    error.message.endsWith(" due to access control checks.")
  );
}

/** Marks only an intentional document exit, never ordinary in-app navigation. */
export async function withDocumentExit<T>(
  page: Page,
  action: () => Promise<T>,
): Promise<T> {
  exitingDocuments.add(page);
  try {
    return await action();
  } finally {
    exitingDocuments.delete(page);
  }
}

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
  const nativeExitErrors: string[] = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => {
      // Windows WebKit reports a caught pagehide fetch as a page error. Keep
      // this proven native event separately, only during an explicit exit.
      if (
        isNativeDocumentExitError(
          page,
          error,
          browser.browserType().name(),
          origin,
        )
      )
        nativeExitErrors.push(error.stack!);
      else pageErrors.push(error.message);
    }),
  );
  const guard = (route: Route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || ["blob:", "data:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  };
  networkPolicies.set(context, { handler: guard, suspended: false });
  await context.route("**/*", guard);
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
    nativeExitErrors,
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
    await expect(data).toBeVisible();
    if ((await data.getAttribute("open")) === null)
      await data.locator(":scope > summary").click();
  }
}

export async function selectWorkspace(
  actor: BrowserAccount,
  workspace: WorkspaceAccess,
  { reload = false }: { reload?: boolean } = {},
) {
  await actor.page.bringToFront();
  if (reload) await withDocumentExit(actor.page, () => actor.page.goto("/"));
  await appReady(actor.page);
  // Use the normal account refresh and workspace menu. Unnecessary hard
  // navigations can make WebKit report caught pagehide fetches as page errors.
  await actor.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const switcher = actor.page.getByRole("button", {
    name: /^Switch workspace:/,
  });
  if (!(await switcher.getAttribute("aria-label"))?.endsWith(workspace.name)) {
    await switcher.click();
    await expect(
      actor.page.getByRole("menuitemradio", { checked: true }),
    ).toBeFocused();
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
  await expect(dialog.getByLabel("Project name", { exact: true })).toHaveValue(
    name,
  );
  await dialog.getByLabel(/^Task prefix/).fill("TEST");
  await expect(dialog.getByLabel("Project name", { exact: true })).toHaveValue(
    name,
  );
  await expect(dialog.getByLabel(/^Task prefix/)).toHaveValue("TEST");
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
  const editor = actor.page.getByRole("textbox", {
    name: "Note content",
    exact: true,
  });
  await editor.focus();
  await expect(editor).toBeFocused();
  await editor.fill(content);
  await expect(editor).toHaveValue(content);
  await expect(editor).toBeFocused();
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
  await withDocumentExit(actor.page, () =>
    actor.page.goto(`/?note=${encodeURIComponent(id)}`),
  );
  await appReady(actor.page);
  await expect(
    actor.page.getByRole("textbox", { name: "Note content", exact: true }),
  ).toBeVisible();
}

export async function createTaskUi(page: Page, title: string) {
  await navigate(page, "Tasks");
  await page
    .locator(".page-heading .heading-actions")
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create task", exact: true });
  await dialog
    .getByPlaceholder("What needs to happen?", { exact: true })
    .fill(title);
  await dialog
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}
