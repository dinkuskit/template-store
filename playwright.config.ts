import { defineConfig, devices } from "@playwright/test";

const port = process.env.DINKUS_E2E_PORT ?? "4321";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
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
    url: `http://127.0.0.1:${port}/_emdash/api/setup/dev-bypass`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  outputDir: "test-results/playwright",
});
