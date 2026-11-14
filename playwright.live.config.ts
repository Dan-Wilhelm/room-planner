import { defineConfig, devices } from "@playwright/test";

// LIVE test against a deployed URL with real AI calls (costs money!). Never part of `npm test`.
// Usage: LIVE_URL=https://… E2E_PASSWORD=… LIVE_ASSETS=/path/to/photos npx playwright test -c playwright.live.config.ts
export default defineConfig({
  testDir: "tests/live",
  timeout: 75 * 60_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.LIVE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } } }],
});
