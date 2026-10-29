import { defineConfig, devices } from "@playwright/test";

if (
  !process.env.PLAYWRIGHT_TEST_BASE_URL ||
  process.env.PROJECTANVIL_TEST_DISPOSABLE !== "1" ||
  !process.env.PROJECTANVIL_TEST_MANIFEST
)
  throw new Error(
    "Use npm run test:browser to start a fresh isolated test installation.",
  );

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: `outputs/browser/${process.env.PROJECTANVIL_TEST_BROWSER || "all"}/results`,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: `outputs/browser/${process.env.PROJECTANVIL_TEST_BROWSER || "all"}/summary.json`,
      },
    ],
    ...(process.env.CI ? [["github"] as const] : []),
    [
      "html",
      {
        outputFolder: `outputs/browser/${process.env.PROJECTANVIL_TEST_BROWSER || "all"}/report`,
        open: "never",
      },
    ],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: "en-GB",
    timezoneId: "Europe/Belgrade",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "webkit",
      // Windows WebKit's native automation is slower across the multi-theme
      // workflows; action/readiness deadlines remain unchanged.
      timeout: 180_000,
      use: {
        ...devices["Desktop Safari"],
        deviceScaleFactor: 1,
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
