import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { freshOfflineContext, installOfflineCheckoutHarness } from "./helpers/offline-checkout";

test.use({ trace: "off", video: "off", serviceWorkers: "block" });

for (const awaitingStart of [false, true]) {
  test(`unavailable advisory preserves ${awaitingStart ? "pending" : "prepared"} checkout recovery`, async ({ browser }, testInfo) => {
    test.setTimeout(60_000);
    const context = await freshOfflineContext(browser, testInfo.project.use.baseURL as string, testInfo.project.use.viewport);
    try {
      const page = await context.newPage();
      const harness = await installOfflineCheckoutHarness(page, {
        baseURL: testInfo.project.use.baseURL as string,
        mutateCart: false,
        digital: true,
        statusWithoutAttempt: !awaitingStart,
      });
      await page.addInitScript((pending) => {
        if (!localStorage.getItem("dinkus.guest-cart.v1")) {
          localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({ version: 1, lines: [{ id: "fixture-shirt", quantity: 1 }] }));
          localStorage.setItem("dinkus.guest-checkout.v1", JSON.stringify({
            capabilityId: "fixture-cap-1", capability: "fixture-cap-1.secret", attemptId: null,
            ...(pending ? { awaitingStart: true } : {}),
          }));
        }
      }, awaitingStart);
      await page.goto("/cart");
      await expect(page.locator("[data-guest-cart]")).toHaveAttribute("data-guest-checkout-admitted", "false");
      await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
      await page.getByRole("button", { name: "Check checkout status" }).click();
      if (awaitingStart) {
        await expect(page.locator("[data-guest-cart-status]")).toContainText("still pending");
        await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
        await page.getByRole("button", { name: "Check checkout status" }).click();
        await expect(page.locator("[data-guest-cart-status]")).toContainText("Order confirmed");
        await expect(page.locator("[data-guest-cart-empty]")).toBeVisible();
        expect(harness.counts()).toEqual({ prepareCalls: 0, startCalls: 0, statusCalls: 2 });
      } else {
        await expect(page.locator("[data-guest-cart-status]")).toContainText("No checkout has started");
        await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled({ timeout: 5_000 });
        await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
        await page.getByRole("button", { name: "Continue to secure checkout" }).click();
        await expect(page.locator("[data-guest-cart-status]")).toContainText("pending");
        expect(harness.counts()).toEqual({ prepareCalls: 0, startCalls: 1, statusCalls: 1 });
      }
      expect(harness.blocked).toEqual([]);
      const proof = resolve("runs/commerce-020-pairing-20261012", testInfo.project.name);
      await mkdir(proof, { recursive: true });
      await page.screenshot({ path: resolve(proof, awaitingStart ? "unavailable-paid-recovery.png" : "unavailable-prepared-resume.png"), fullPage: true });
    } finally { await context.close(); }
  });
}

for (const diagnostic of ["CHECKOUT_STATUS_CAPABILITY_DENIED", "untrusted-private-fixture", "CHECKOUT_STATUS_UPSTREAM_HTTP_403", "CHECKOUT_STATUS_UPSTREAM_HTTP_600"]) {
  test(`failed status remains locked and truthful: ${diagnostic}`, async ({ browser }, testInfo) => {
    test.setTimeout(60_000);
    const context = await freshOfflineContext(browser, testInfo.project.use.baseURL as string, testInfo.project.use.viewport);
    try {
      const page = await context.newPage();
      const harness = await installOfflineCheckoutHarness(page, {
        baseURL: testInfo.project.use.baseURL as string, mutateCart: false,
        digital: true, statusWithoutAttempt: true,
      });
      let failures = 0;
      await page.route("**/api/checkout/status", async (route) => {
        if (failures++ === 0) {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({
            ok: false, error: { code: diagnostic, message: "untrusted-private-message" },
          }) });
        } else await route.fallback();
      });
      await page.addInitScript(() => {
        localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({ version: 1, lines: [{ id: "fixture-shirt", quantity: 1 }] }));
        localStorage.setItem("dinkus.guest-checkout.v1", JSON.stringify({ capabilityId: "fixture-cap-1",
          capability: "fixture-cap-1.secret", attemptId: null, awaitingStart: true }));
      });
      await page.goto("/cart");
      const retained = await page.evaluate(() => localStorage.getItem("dinkus.guest-checkout.v1"));
      await page.getByRole("button", { name: "Check checkout status" }).click();
      const status = page.locator("[data-guest-cart-status]");
      await expect(status).toContainText("Checkout status is unavailable");
      await expect(status).not.toContainText("pending");
      await expect(status).not.toContainText("untrusted-private");
      await expect(status).toHaveAttribute("role", "alert");
      if (diagnostic === "CHECKOUT_STATUS_CAPABILITY_DENIED") await expect(status).toContainText("status-capability");
      else if (diagnostic === "CHECKOUT_STATUS_UPSTREAM_HTTP_403") await expect(status).toContainText("status-upstream-http-403");
      else await expect(status).not.toContainText("Reference:");
      await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
      await expect(page.locator("[data-guest-cart-qty]")).toBeDisabled();
      expect(await page.evaluate(() => localStorage.getItem("dinkus.guest-checkout.v1"))).toBe(retained);
      expect(harness.counts()).toEqual({ prepareCalls: 0, startCalls: 0, statusCalls: 0 });
      const proof = resolve("runs/status-diagnostics-20261014", testInfo.project.name);
      await mkdir(proof, { recursive: true });
      await page.screenshot({ path: resolve(proof, `${diagnostic.toLowerCase()}-unavailable.png`), fullPage: true });
      await page.getByRole("button", { name: "Check checkout status" }).click();
      await expect(status).toContainText("No checkout has started");
      await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled();
      expect(harness.counts()).toEqual({ prepareCalls: 0, startCalls: 0, statusCalls: 1 });
      expect(harness.blocked).toEqual([]);
    } finally { await context.close(); }
  });
}
