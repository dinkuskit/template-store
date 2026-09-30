import { defineConfig, devices } from "@playwright/test";

const proofPort = process.env.DINKUS_E2E_PORT ?? "4637";
const shippingPort = process.env.DINKUS_SHIPPING_E2E_PORT ?? "4638";

function childEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Cold EmDash admin navigation can remain in Loading EmDash beyond 5s in CI.
  expect: { timeout: 30_000 },
  // A failed stateful editor test can corrupt the shared disposable fixture.
  // Passing CI still exercises every test; failures stop before cascades.
  maxFailures: process.env.CI ? 1 : 0,
  reporter: [["line"]],
  use: {
    baseURL: `http://127.0.0.1:${proofPort}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      testIgnore: /shipping-storefront-profile\.spec\.ts$|guest-cart\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      testIgnore: /shipping-storefront-profile\.spec\.ts$|guest-cart\.spec\.ts$/,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "shipping-chromium-desktop",
      testMatch: /(?:shipping-storefront-profile|guest-cart)\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${shippingPort}`,
      },
    },
    {
      name: "shipping-chromium-mobile",
      testMatch: /(?:shipping-storefront-profile|guest-cart)\.spec\.ts$/,
      use: {
        ...devices["Pixel 7"],
        baseURL: `http://127.0.0.1:${shippingPort}`,
      },
    },
  ],
  webServer: [
    {
      command: "node scripts/start-e2e-server.mjs",
      // Seed before the storefront is ever queried. Astro's live-content loader
      // can retain an initial not-found result for the lifetime of the dev server.
      url: `http://127.0.0.1:${proofPort}/_emdash/api/setup/dev-bypass`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: childEnv({
        DINKUS_E2E_PORT: proofPort,
        DINKUS_STOREFRONT_PROFILE: "proof",
        DINKUS_PROOF_MODE: "1",
      }),
    },
    {
      command: "node scripts/start-shipping-e2e-server.mjs",
      url: `http://127.0.0.1:${shippingPort}/_emdash/api/setup/dev-bypass`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: childEnv({
        DINKUS_SHIPPING_E2E_PORT: shippingPort,
      }),
    },
  ],
  outputDir: "test-results/playwright",
});
