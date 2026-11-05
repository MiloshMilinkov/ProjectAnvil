import { test, expect } from "./fixtures";
import {
  api,
  createProjectUi,
  createTeam,
  fixtureId,
  navigate,
  selectWorkspace,
  upsert,
  workspace,
} from "./helpers";

test("workspace navigation preserves its open menu while refreshed permissions hide protected content", async ({ scenario }, testInfo) => {
  const { owner, colleague } = scenario;
  const team = await createTeam(owner, colleague, `Navigation ${fixtureId().slice(0, 8)}`);
  await selectWorkspace(owner, team, { reload: true });
  await createProjectUi(owner.page, "Private navigation project");
  const project = (await workspace(owner, team.id)).projects.find(
    (item) => item.name === "Private navigation project",
  )!;
  await upsert(owner, team.id, "tasks", {
    id: fixtureId(),
    title: "Protected task before access refresh",
    projectId: project.id,
  });
  await upsert(owner, team.id, "tasks", {
    id: fixtureId(),
    title: "Available task after access refresh",
  });
  const protectedTask = colleague.page.getByRole("button", {
    name: /Protected task before access refresh/,
  });
  const themes = testInfo.project.name === "chromium"
    ? ["Light", "Dark", "Warp", "Focus", "Soft"]
    : ["Focus"];
  for (const theme of themes) {
    for (const width of [1365, 320]) {
      await colleague.page.setViewportSize({ width: 1365, height: 900 });
      await colleague.page.getByRole("button", { name: /^Appearance:/ }).click();
      await colleague.page.getByRole("menuitemradio", {
        name: new RegExp(`^${theme} `),
      }).click();
      const current = await api(owner, `/api/teams?workspaceId=${team.id}`);
      await api(owner, "/api/teams", {
        action: "project-access",
        workspaceId: team.id,
        projectId: project.id,
        restricted: false,
        members: [],
        expectedRevision: current.securityRevision,
      });
      await selectWorkspace(colleague, team);
      await navigate(colleague.page, "Tasks");
      await expect(protectedTask).toBeVisible();
      await colleague.page.setViewportSize({ width, height: 900 });
      if (width === 320)
        await colleague.page.getByRole("button", {
          name: "Open navigation", exact: true,
        }).click();
      await refreshWithMenuOpen(theme, width);
    }
  }

  async function refreshWithMenuOpen(theme: string, width: number) {

    // Hold real account/state reads, preserving their native responses, signals,
    // and service workers. Release the new grants while the menu owns focus.
    await colleague.page.evaluate(() => {
      const original = window.fetch;
      const gates = {
        accountHeld: false,
        releaseAccount: () => { },
        releaseWorkspace: () => { },
        restore: () => { window.fetch = original; },
      };
      const account = new Promise<void>((resolve) => { gates.releaseAccount = resolve; });
      const state = new Promise<void>((resolve) => { gates.releaseWorkspace = resolve; });
      Reflect.set(window, Symbol.for("projectanvil-navigation-refresh"), gates);
      window.fetch = async (input, init) => {
        const address = input instanceof Request ? input.url : String(input);
        const method = init?.method || (input instanceof Request ? input.method : "GET");
        if (method.toUpperCase() === "GET") {
          const pathname = new URL(address, location.href).pathname;
          if (pathname === "/api/account") {
            gates.accountHeld = true;
            await account;
          }
          if (pathname === "/api/state") await state;
        }
        return original.call(window, input, init);
      };
    });
    try {
      const switcher = colleague.page.getByRole("button", { name: /^Switch workspace:/ });
      const menu = colleague.page.getByRole("menu", { name: "Your workspaces", exact: true });
      const selected = menu.getByRole("menuitemradio", { checked: true });
      await switcher.click();
      await expect(selected).toBeFocused();
      const originalTrigger = await switcher.elementHandle();
      const details = await api(owner, `/api/teams?workspaceId=${team.id}`);
      await api(owner, "/api/teams", {
        action: "project-access",
        workspaceId: team.id,
        projectId: project.id,
        restricted: true,
        members: [],
        expectedRevision: details.securityRevision,
      });
      await colleague.page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => colleague.page.evaluate(() =>
        !!Reflect.get(window, Symbol.for("projectanvil-navigation-refresh"))?.accountHeld,
      )).toBe(true);
      await colleague.page.evaluate(() => Reflect.get(
        window, Symbol.for("projectanvil-navigation-refresh"),
      )?.releaseAccount());
      const opening = colleague.page.getByText("Opening your workspace…", { exact: true });
      await expect(opening).toBeVisible();
      await expect(protectedTask).toBeHidden();
      await expect(menu).toBeVisible();
      await expect(selected).toBeFocused();
      expect(await originalTrigger!.evaluate((node) => node.isConnected)).toBe(true);
      await expect.poll(() => colleague.page.evaluate(
        () => document.documentElement.scrollWidth,
      )).toBeLessThanOrEqual(width);
      await colleague.page.screenshot({
        path: testInfo.outputPath(`workspace-refresh-${theme.toLowerCase()}-${width}.png`),
      });
      await colleague.page.evaluate(() => Reflect.get(
        window, Symbol.for("projectanvil-navigation-refresh"),
      )?.releaseWorkspace());
      await expect(opening).toBeHidden();
      await expect(menu).toBeVisible();
      await expect(selected).toBeFocused();
      await expect(protectedTask).toBeHidden();
      await expect.poll(() => colleague.page.evaluate(
        () => document.documentElement.scrollWidth,
      )).toBeLessThanOrEqual(width);
      await expect(colleague.page.getByRole("button", {
        name: /Available task after access refresh/,
      })).toBeVisible();
      await menu.getByRole("menuitemradio", {
        name: `${colleague.personal.name} Private personal workspace`, exact: true,
      }).press("Enter");
      await colleague.page.setViewportSize({ width: 1365, height: 900 });
      await expect(switcher).toHaveAttribute("aria-label", `Switch workspace: ${colleague.personal.name}`);
      await expect(menu).toBeHidden();
    } finally {
      await colleague.page.evaluate(() => {
        const key = Symbol.for("projectanvil-navigation-refresh");
        const gates = Reflect.get(window, key);
        gates?.releaseAccount();
        gates?.releaseWorkspace();
        gates?.restore();
        Reflect.deleteProperty(window, key);
      });
    }
  }
});
