import { expect, test } from "@playwright/test";
import { SHOPPER_SESSION_STORAGE_KEY, type ShopperOrderItem } from "../../src/features/shopper-account/index.js";

// Consumer HTTP fixtures, not payment, delivery, OTP or backend fulfillment proof.
// The real SDK/Commerce merchant-completion reproduction is recorded separately.
test("account preserves recorded shipment text through catalog enrichment and clears it after reopening", async ({ page }) => {
  const email = "shipment@example.test";
  await page.addInitScript(({ key, email }) => {
    localStorage.setItem(key, JSON.stringify({
      sessionId: "csess_synthetic_shipment",
      sessionToken: "csess_synthetic_shipment.0123456789abcdef0123456789abcdef",
      email,
      expiresAt: 4_102_444_800,
    }));
  }, { key: SHOPPER_SESSION_STORAGE_KEY, email });
  // Commerce accepts up to 64 characters; preserve an unbroken value on phones.
  const tracking = "9".repeat(64);
  let order: ShopperOrderItem = {
    orderId: "ord_synthetic_shipment",
    receiptId: "rcpt_synthetic_shipment",
    number: 1001,
    status: "completed",
    paidAt: "2026-10-31T12:00:00.000Z",
    total: { currency: "USD", minor: "1200" },
    lines: [{ catalogItemId: "synthetic-notebook", name: "Synthetic notebook", quantity: 1, unitPrice: { currency: "USD", minor: "1200" } }],
    choices: [],
    delivery: null,
    phone: null,
    completed: { at: "2026-11-02T02:00:00.000Z", carrier: "USPS <synthetic> & test", tracking },
  };
  await page.route("**/account/orders", route => route.fulfill({ json: {
    success: true, data: { ok: true, profile: { email, phone: null, delivery: null }, orders: [order] },
  } }));
  await page.route("**/api/guest-cart/snapshot**", route => route.fulfill({ json: {
    products: [{ id: "synthetic-notebook", found: true, name: "Synthetic notebook", sku: "SYNTHETIC-NOTEBOOK", fulfillment: "physical", thumbnail: null }],
  } }));
  await page.goto("/account");
  const card = page.locator('[data-account-order="ord_synthetic_shipment"]');
  // Wait for the second render, after the asynchronous catalog snapshot arrives.
  await expect(card.locator("[data-account-order-line-sku]")).toHaveText("SKU: SYNTHETIC-NOTEBOOK");
  await expect(card.locator("[data-account-order-status]")).toHaveText("Completed");
  await expect(card.locator("[data-account-order-carrier]")).toHaveText("Carrier: USPS <synthetic> & test");
  await expect(card.locator("[data-account-order-tracking]")).toHaveText(`Tracking number: ${tracking}`);
  await expect(card.locator("[data-account-order-shipment] a, [data-account-order-shipment] img, [data-account-order-shipment] synthetic")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  order = { ...order, status: "processing", completed: null };
  await page.reload();
  await expect(card.locator("[data-account-order-line-sku]")).toHaveText("SKU: SYNTHETIC-NOTEBOOK");
  await expect(card.locator("[data-account-order-status]")).toHaveText("Processing");
  await expect(card.locator("[data-account-order-shipment]")).toHaveCount(0);
  await expect(card.locator("[data-account-order-total]")).toHaveText("$12.00");
});
