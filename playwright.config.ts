import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    // Seed before the storefront is ever queried. Astro's live-content loader
    // can retain an initial not-found result for the lifetime of the dev server.
    url: "http://127.0.0.1:4321/_emdash/api/setup/dev-bypass",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  outputDir: "test-results/playwright",
});
