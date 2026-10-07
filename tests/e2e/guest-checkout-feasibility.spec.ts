import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test.use({ trace: "off", video: "off" });

const RUNTIME_ID = "r_gshdrqaldna3r7sn";
const RUNTIME_PREPARE = `/_emdash/api/plugins/${RUNTIME_ID}/checkout/guest/prepare`;
const NATIVE_PREPARE = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare";

const syntheticProjection = (state: "pending" | "paid" | "released-retry", attemptId: string | null) => ({
  schema: "dinkuskit.commerce.guest-checkout-projection/v1",
  state,
  attemptId,
  lines: [{ catalogItemId: "fixture-shirt", name: "Synthetic fixture shirt", quantity: 1, unitPrice: { currency: "USD", minor: "2400" } }],
  total: { currency: "USD", minor: "2400" },
  pricing: { finalTotal: { currency: "USD", minor: "2400" } },
  redirectUrl: null,
  order: state === "paid" ? { orderId: "order:fixture", receiptId: "receipt:fixture" } : null,
  retryAfter: null,
  unavailable: null,
});

test("guest checkout stays closed and return pages never trust browser claims", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);

  const runtimePrepare = await request.post(RUNTIME_PREPARE, {
    data: {},
    headers: { "content-type": "application/json" },
  });
  expect(runtimePrepare.status()).toBe(503);

  const nativePrepare = await request.post(NATIVE_PREPARE, {
    data: {},
    headers: { "content-type": "application/json" },
  });
  expect(nativePrepare.status()).toBe(405);

  const context = await browser.newContext({
    viewport: testInfo.project.use.viewport,
  });
  try {
  const page = await context.newPage();
  await page.goto(
    "/checkout/success?success=true&session_id=forged&redirect_status=succeeded",
  );
  await expect(page.getByRole("heading", { name: "Checkout return" })).toBeVisible();
  await expect(page.locator("[data-guest-checkout-order]")).toBeHidden();
  await expect(page.locator("[data-guest-checkout-return-status]")).toContainText(
    /could not be matched|could not be confirmed|not confirmed/i,
  );

  await page.goto("/checkout/cancel?session_id=forged");
  await expect(page.getByRole("heading", { name: "Checkout canceled" })).toBeVisible();
  await expect(page.locator("[data-guest-checkout-order]")).toBeHidden();

  const runDir = resolve("runs/checkout-integration-runs/20261007/browser", testInfo.project.name);
  await mkdir(runDir, { recursive: true });
  await page.screenshot({
    path: resolve(runDir, "guest-checkout-cancel-closed.png"),
    fullPage: true,
    animations: "disabled",
  });
  } finally { await context.close(); }
});

test("synthetic admitted cart exercises controller recovery on desktop and mobile", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  try {
  const page = await context.newPage();
  let statusCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
      version: 1,
      lines: [{ id: "fixture-shirt", quantity: 1 }],
    }));
  });
  await page.route("**/cart", async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      'data-guest-checkout-admitted="false"',
      'data-guest-checkout-admitted="true"',
    );
    await route.fulfill({ response, body: html });
  });
  await page.route("**/api/guest-cart/snapshot**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      products: [{
        id: "fixture-shirt",
        found: true,
        name: "Synthetic fixture shirt",
        sku: "FIXTURE",
        price: { listable: true, regularText: "$24.00", saleText: null },
        availability: { status: "in-stock", sellable: true, listable: true },
      }],
    }),
  }));
  await page.route(`**${RUNTIME_PREPARE}`, async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: {
        ok: true,
        capabilityId: "fixture-cap",
        capability: {
          capabilityId: "fixture-cap",
          capability: "fixture-cap.secret",
          retention: "json-body",
          header: "x-commerce-guest-capability",
        },
        checkout: syntheticProjection("pending", null),
      },
    }),
  }));
  await page.route(`**${RUNTIME_PREPARE.replace("prepare", "start")}`, async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: { ok: true, capabilityId: "fixture-cap", checkout: syntheticProjection("pending", "fixture-attempt") },
    }),
  }));
  await page.route(`**${RUNTIME_PREPARE.replace("prepare", "status")}`, async (route) => {
    statusCalls += 1;
    const state = statusCalls > 1 ? "paid" : "pending";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { ok: true, capabilityId: "fixture-cap", checkout: syntheticProjection(state, "fixture-attempt") },
      }),
    });
  });
  await page.goto("/cart");
  await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled();
  await page.getByRole("button", { name: "Continue to secure checkout" }).click();
  await expect(page.locator("[data-guest-cart-recover]")).toBeVisible();
  await expect(page.locator("[data-guest-cart-status]")).toContainText(/pending|Contacting Commerce/i);
  await page.reload();
  await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
  await expect(page.locator("[data-guest-cart-recover]")).toBeVisible();
  await expect(page.locator("[data-guest-cart-qty]")).toBeDisabled();
  await page.goto("/checkout/success?success=true&session_id=synthetic-untrusted");
  await expect(page.locator("[data-guest-checkout-order]")).toBeHidden();
  await expect(page.locator("[data-guest-checkout-return-status]")).toContainText("pending");
  await page.getByRole("button", { name: "Check status again" }).click();
  await expect(page.locator("[data-guest-checkout-order]")).toContainText("order:fixture");
  await expect(page.locator("[data-guest-checkout-return-status]")).toContainText("confirmed");
  expect(statusCalls).toBe(2);
  await page.screenshot({
    path: resolve("runs/checkout-integration-runs/20261007/browser", testInfo.project.name, "guest-checkout-synthetic-paid.png"),
    fullPage: true,
    animations: "disabled",
  });
  } finally { await context.close(); }
});
