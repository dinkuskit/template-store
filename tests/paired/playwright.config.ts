import { defineConfig, devices } from "@playwright/test";

// Started by scripts/verify-paired-product-on-sale.mjs, which builds Commerce and passes its folder.
const port = process.env.DINKUS_PAIRED_PORT ?? "4651";

export default defineConfig({
  testDir: ".",
  workers: 1,
  retries: 0,
  expect: { timeout: 30_000 },
  reporter: [["line"]],
  use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure", screenshot: "only-on-failure",
    ...(process.env.DINKUS_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.DINKUS_CHROMIUM_PATH } } : {}) },
  webServer: {
    command: `pnpm exec astro dev --host 127.0.0.1 --port ${port} --ignore-lock`,
    env: { ASTRO_DEV_BACKGROUND: "0" },
    cwd: "../..",
    url: `http://127.0.0.1:${port}/_emdash/api/setup/dev-bypass`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
