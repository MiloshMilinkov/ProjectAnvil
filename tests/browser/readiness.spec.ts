import { test, expect } from "./fixtures";
import { appReady, restrictToLocalOrigin } from "./helpers";

test("readiness waits for delayed first-use onboarding and dismisses it through the UI", async ({
  page,
}) => {
  // Reproduce a background/loaded runner delaying the first onboarding frame
  // beyond the former 1.5-second optional wait. Do not seed the seen preference.
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => callback(performance.now()), 2200);
    window.cancelAnimationFrame = window.clearTimeout.bind(window);
  });
  await page.goto("/");
  await appReady(page);
  expect(
    await page.evaluate(() => localStorage.getItem("projectanvil-tour-v1")),
  ).toBe("seen");
  await expect(page.getByTestId("guided-tour")).toBeHidden();
  await page
    .getByRole("button", { name: "Sign in or create account", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Register", exact: true }),
  ).toBeVisible();
});

test("the external guard preserves local route fixtures and blocks other origins", async ({
  context,
  page,
  baseURL,
}) => {
  const probe = new URL("/__projectanvil_network_probe", baseURL!).href;
  const external = "https://projectanvil.invalid/";
  let escaped = false;
  // An earlier local fixture must remain reachable through later guard rules.
  await context.route(probe, (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: "local probe" }),
  );
  // Catch a broken guard locally so this regression never sends external traffic.
  await context.route(external, (route) => {
    escaped = true;
    return route.fulfill({ status: 200, body: "external request escaped" });
  });
  await restrictToLocalOrigin(context, baseURL!);
  expect((await page.goto(probe))?.status()).toBe(200);
  await expect(page.locator("body")).toHaveText("local probe");
  await page.route(probe, (route) => route.abort("failed"));
  expect(
    await page.evaluate(
      (url) => fetch(url).then(() => false, () => true),
      probe,
    ),
  ).toBe(true);
  await page.unroute(probe);
  expect(
    await page.evaluate(
      (url) => fetch(url).then((response) => response.text()),
      probe,
    ),
  ).toBe("local probe");
  expect(
    await page.evaluate(async () => {
      const blob = URL.createObjectURL(new Blob(["blob probe"]));
      try {
        return await Promise.all(
          [blob, "data:text/plain,data probe"].map(async (url) =>
            (await fetch(url)).text(),
          ),
        );
      } finally {
        URL.revokeObjectURL(blob);
      }
    }),
  ).toEqual(["blob probe", "data probe"]);
  await expect(page.goto(external)).rejects.toThrow();
  expect(escaped).toBe(false);
});
