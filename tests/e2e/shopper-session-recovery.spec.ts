import { expect, test, type Page } from "@playwright/test";
import { SHOPPER_SESSION_STORAGE_KEY } from "../../src/features/shopper-account/index.js";

// These are consumer/UI contract tests with explicit HTTP fixtures. The
// installed-Commerce reproduction is separate; no provider or mail proof here.
const oldSession = {
  sessionId: "csess_synthetic_old",
  sessionToken: "csess_synthetic_old.0123456789abcdef0123456789abcdef",
  email: "synthetic@example.test",
  expiresAt: 4_102_444_800,
};
const newSession = {
  ...oldSession,
  sessionId: "csess_synthetic_new",
  sessionToken: "csess_synthetic_new.abcdef0123456789abcdef0123456789",
};
const profile = { email: oldSession.email, phone: "+15555550123", delivery: null };
const success = { success: true, data: { ok: true, profile, orders: [] } };
const denied = { success: true, data: { ok: false, error: { code: "SESSION_DENIED", message: "This customer session is not valid." } } };
const expiredMessage = "Your session has expired. Sign in again.";
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), SHOPPER_SESSION_STORAGE_KEY);

async function seed(page: Page) {
  await page.addInitScript(({ key, session }) => {
    if (!localStorage.getItem("synthetic-session-test-seeded")) {
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem("synthetic-session-test-seeded", "1");
    }
  }, { key: SHOPPER_SESSION_STORAGE_KEY, session: oldSession });
}

for (const action of ["load", "save", "clear"] as const) {
  for (const failure of ["business-denial", "http-401", "server-error", "other-business-error", "network-error"] as const) {
    test(`${action}: ${failure} only discards a definitively denied session`, async ({ page }) => {
      await seed(page);
      const invalidates = failure === "business-denial" || failure === "http-401";
      let failures = 0;
      const endpoint = action === "load" ? "orders" : "profile";
      if (action !== "load") await page.route("**/account/orders", route => route.fulfill({ json: success }));
      await page.route(`**/account/${endpoint}`, async route => {
        failures++;
        if (failure === "network-error") return route.abort("failed");
        const status = failure === "http-401" ? 401 : failure === "server-error" ? 503 : 200;
        const json = failure === "business-denial" ? denied : { success: true, data: { ok: false, error: { code: "SERVICE_UNAVAILABLE" } } };
        await route.fulfill({ status, json });
      });
      await page.goto("/account");
      if (action !== "load") {
        await expect(page.locator("[data-account-signed-in]")).toBeVisible();
        await page.locator(`[data-account-profile-${action}]`).click();
      }
      await expect(page.locator("[data-account-status]")).toBeVisible();
      expect(failures).toBe(1);
      if (invalidates) {
        await expect(page.locator("[data-account-status]")).toHaveText(expiredMessage);
        await expect(page.locator("[data-account-signed-out]")).toBeVisible();
        await expect(page.locator("[data-account-signed-in]")).toBeHidden();
        expect(await stored(page)).toBeNull();
        await page.reload();
        await expect(page.locator("[data-account-signed-out]")).toBeVisible();
        await expect(page.locator("[data-account-status]")).toBeHidden();
        expect(await stored(page)).toBeNull();
        expect(failures).toBe(1); // No stale capability is retried on reload.
      } else {
        await expect(page.locator("[data-account-status]")).not.toHaveText(expiredMessage);
        expect(await stored(page)).toEqual(oldSession);
        if (action !== "load") {
          await expect(page.locator("[data-account-signed-in]")).toBeVisible();
          await expect(page.locator("[data-account-profile-phone]")).toHaveValue(profile.phone);
        }
        // The same still-valid browser record recovers when the service does.
        await page.unroute(`**/account/${endpoint}`);
        await page.route(`**/account/${endpoint}`, route => route.fulfill({ json: success }));
        if (action === "load") await page.reload();
        else await page.locator(`[data-account-profile-${action}]`).click();
        await expect(page.locator("[data-account-signed-in]")).toBeVisible();
        if (action !== "load") await expect(page.locator("[data-account-status]")).toContainText(action === "save" ? "Saved" : "Cleared");
        expect(await stored(page)).toEqual(oldSession);
      }
    });
  }
}

test("revocation clears shared storage, another tab recovers, and a new sign-in persists", async ({ page, context }) => {
  await seed(page);
  let revoked = false;
  await context.route("**/account/orders", route => route.fulfill({ json: revoked && route.request().headers()["x-commerce-customer-session"] === oldSession.sessionToken ? denied : success }));
  await context.route("**/account/profile", route => route.fulfill({ json: denied }));
  await page.goto("/account");
  await expect(page.locator("[data-account-signed-in]")).toBeVisible();
  const tab = await context.newPage();
  await tab.goto("/account");
  await expect(tab.locator("[data-account-signed-in]")).toBeVisible();
  revoked = true;
  await page.reload();
  await expect(page.locator("[data-account-status]")).toHaveText(expiredMessage);
  expect(await stored(tab)).toBeNull();
  // An already-rendered tab must recover on either profile action, not silently
  // keep showing an account after the shared capability has been removed.
  await tab.locator("[data-account-profile-clear]").click();
  await expect(tab.locator("[data-account-signed-out]")).toBeVisible();
  await expect(tab.locator("[data-account-status]")).toHaveText(expiredMessage);
  await tab.reload();
  await expect(tab.locator("[data-account-status]")).toBeHidden();
  await page.route("**/account/sign-in/start", route => route.fulfill({ json: { success: true, data: { ok: true } } }));
  await page.route("**/account/sign-in/verify", route => route.fulfill({ json: { success: true, data: { ok: true, profile, capability: {
    sessionId: newSession.sessionId, session: newSession.sessionToken, expiresAt: new Date(newSession.expiresAt * 1000).toISOString(),
  } } } }));
  await page.locator("[data-account-email]").fill(oldSession.email);
  const optIn = page.locator("[data-account-opt-in]");
  if (await optIn.isVisible()) await optIn.check();
  await page.locator("[data-account-start]").click();
  await expect(page.locator("[data-account-verify-form]")).toBeVisible();
  await page.locator("[data-account-code]").fill("123456");
  await page.locator("[data-account-verify]").click();
  await expect(page.locator("[data-account-signed-in]")).toBeVisible();
  await expect.poll(() => stored(page)).toEqual(newSession);
  await page.reload();
  await expect(page.locator("[data-account-signed-in]")).toBeVisible();
  await tab.reload();
  await expect(tab.locator("[data-account-signed-in]")).toBeVisible();
});

test("a late denial for an old capability cannot erase another tab's new sign-in", async ({ page, context }) => {
  await seed(page);
  let release!: () => void;
  let received!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { received = resolve; });
  await context.route("**/account/orders", route => route.fulfill({ json: success }));
  await page.route("**/account/orders", async route => {
    if (route.request().headers()["x-commerce-customer-session"] === oldSession.sessionToken) {
      received();
      await pending;
      await route.fulfill({ json: denied });
    } else await route.fulfill({ json: success });
  });
  await page.goto("/account");
  await requested;
  const tab = await context.newPage();
  await tab.goto("/account");
  await tab.evaluate(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: SHOPPER_SESSION_STORAGE_KEY, session: newSession });
  const response = page.waitForResponse("**/account/orders");
  release();
  await response;
  // Let the response handler finish before checking storage and retrying.
  await expect(page.locator("[data-account-status]")).toBeHidden();
  expect(await stored(page)).toEqual(newSession);
  await page.reload();
  await expect(page.locator("[data-account-signed-in]")).toBeVisible();
  expect(await stored(page)).toEqual(newSession);
});
