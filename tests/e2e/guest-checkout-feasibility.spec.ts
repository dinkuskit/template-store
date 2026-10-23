import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { POST as storeCheckoutStatus } from "../../src/pages/api/checkout/status";
import {
  NATIVE_PREPARE,
  RUNTIME_PREPARE,
  freshOfflineContext,
  installOfflineCheckoutHarness,
} from "./helpers/offline-checkout";

test.use({ trace: "off", video: "off", serviceWorkers: "block" });

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
  const context = await freshOfflineContext(
    browser,
    testInfo.project.use.baseURL as string,
    testInfo.project.use.viewport,
  );
  try {
  const page = await context.newPage();
  await mkdir(resolve("runs/checkout-success-commerce"), { recursive: true });
  await installOfflineCheckoutHarness(page, { baseURL: testInfo.project.use.baseURL as string, synthetic: false });
  await page.goto("/checkout/success");
  await expect(page.getByRole("heading", { name: "We couldn't confirm your order" })).toBeVisible();
  await expect(page.getByText("We couldn't confirm your order just now. Check your email.")).toBeVisible();
  await page.screenshot({
    path: resolve("runs/checkout-success-commerce", `${testInfo.project.name}-no-token.png`),
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/checkout?session_id=forged");
  await expect(page).toHaveURL(/\/checkout\?session_id=forged$/);
  await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();

  const runDir = resolve("runs/offline-harness-tests-runs/20261008", testInfo.project.name);
  await mkdir(runDir, { recursive: true });
  await page.screenshot({
    path: resolve(runDir, "guest-checkout-cancel-closed.png"),
    fullPage: true,
    animations: "disabled",
  });
  } finally { await context.close(); }
});

test("Commerce checkout token renders the paid order and clears the cart", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const context = await freshOfflineContext(
    browser,
    testInfo.project.use.baseURL as string,
    testInfo.project.use.viewport,
  );
  try {
  const page = await context.newPage();
  const harness = await installOfflineCheckoutHarness(page, {
    baseURL: testInfo.project.use.baseURL as string,
    gateInitialPrepare: true,
  });
  await page.addInitScript(() => {
    if (localStorage.getItem("dinkus.guest-cart.v1")) return;
    localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
      version: 1,
      lines: [{ id: "fixture-shirt", quantity: 1 }],
    }));
  });
  await page.goto("/checkout");
  await expect.poll(() => harness.counts().prepareCalls).toBe(1);
  const line = page.locator('[data-guest-cart-line="fixture-shirt"]');
  await expect(line).toBeVisible();
  await expect(line).not.toHaveAttribute("aria-busy", "true");
  // Assert before the controller's eight-second timeout can close admission.
  await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled({ timeout: 1_000 });
  await expect(page.locator("[data-guest-cart-coupon]")).toBeDisabled();
  await expect(page.locator("[data-guest-cart-qty]")).toBeDisabled();
  expect(harness.counts()).toMatchObject({ prepareCalls: 1, startCalls: 0 });
  await page.screenshot({
    path: resolve("runs/offline-harness-tests-runs/20261008", testInfo.project.name, "guest-checkout-prepare-pending.png"),
    fullPage: true,
    animations: "disabled",
  });
  harness.releaseInitialPrepare();
  await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled();
  // Coupons are coming soon: the box stays greyed even once checkout opens.
  await expect(page.locator("[data-guest-cart-coupon]")).toBeDisabled();
  await expect(page.locator("[data-guest-cart-coupon]")).toHaveAttribute("placeholder", "Coupons coming soon");
  expect(harness.counts()).toMatchObject({ prepareCalls: 1, startCalls: 0 });
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByLabel("Recipient", { exact: true }).fill("Ada Lovelace");
  await page.getByLabel("Address line 1", { exact: true }).fill("12 Analytical Way");
  await page.getByLabel("City", { exact: true }).fill("Portland");
  await page.getByLabel("State or region (required for United States delivery)", { exact: true }).fill("OR");
  await page.getByLabel("Postal code", { exact: true }).fill("97201");
  await page.getByLabel("Country", { exact: true }).selectOption("US");
  await page.getByRole("button", { name: "Continue to secure checkout" }).click();
  await expect(page.locator("[data-guest-cart-recover]")).toBeVisible();
  await expect(page.locator("[data-guest-cart-status]")).toContainText(/pending|Contacting Commerce/i);
  await page.reload();
  await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
  await expect(page.locator("[data-guest-cart-recover]")).toBeVisible();
  await expect(page.locator("[data-guest-cart-qty]")).toBeDisabled();
  await page.goto("/checkout/success");
  await expect(page.locator("[data-guest-checkout-order]")).toBeHidden();
  await expect(page.locator("[data-guest-checkout-return-status]")).toContainText("pending");
  await page.getByRole("button", { name: "Check status again" }).click();
  await expect(page.locator("[data-guest-checkout-order]")).toBeVisible();
  await expect(page.locator("[data-guest-checkout-order-number]")).toContainText("fixture");
  await expect(page.locator("[data-guest-checkout-order-items]")).toContainText("Synthetic fixture shirt");
  await expect(page.locator("[data-guest-checkout-item-thumbnail]")).toHaveAttribute("src", "/images/products/shirt.svg");
  await expect(page.locator("[data-guest-checkout-destination]")).toBeVisible();
  await expect(page.locator("[data-guest-checkout-email]")).toHaveText("synthetic@example.test");
  await expect(page.locator("[data-guest-checkout-recipient]")).toHaveText("Ada Lovelace");
  await expect(page.locator("[data-guest-checkout-address]")).toHaveText("12 Analytical Way, Portland OR 97201, US");
  await expect(page.locator("[data-guest-checkout-shipping-method]")).toHaveText("Free shipping");
  await expect(page.locator("[data-guest-checkout-account]")).toHaveAttribute("href", "/account");
  await expect(page.locator("[data-guest-checkout-return-status]")).toContainText("confirmed");
  expect(harness.counts().statusCalls).toBe(2);
  await page.screenshot({
    path: resolve("runs/checkout-success-commerce", `${testInfo.project.name}-paid.png`),
    fullPage: true,
    animations: "disabled",
  });
  await expect(page.locator("[data-guest-cart-count]")).toBeHidden();
  await page.screenshot({
    path: resolve("runs/offline-harness-tests-runs/20261008", testInfo.project.name, "guest-checkout-synthetic-paid.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/cart");
  await expect(page.locator("[data-guest-cart-empty]")).toBeVisible();
  await expect(page.locator("[data-guest-cart-status]")).toContainText("Order confirmed");
  await page.evaluate(() => localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
    version: 1, lines: [{ id: "fixture-shirt", quantity: 1 }],
  })));
  await page.goto("/checkout");
  await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled();
  await expect(page.locator("[data-guest-cart-qty]")).toBeEnabled();
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByRole("button", { name: "Continue to secure checkout" }).click();
  await expect(page.locator("[data-guest-cart-recover]")).toBeVisible();
  expect(harness.counts().prepareCalls).toBe(2);
  expect(harness.counts().startCalls).toBe(2);
  } finally { await context.close(); }
});

test("the store's status route relays Commerce's paid answer to the thank-you page", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const baseURL = testInfo.project.use.baseURL as string;
  const usd = (minor: string) => ({ currency: "USD", minor });
  const line = { catalogItemId: "fixture-shirt", name: "Synthetic fixture shirt", quantity: 1, unitPrice: usd("2400") };
  const dispatched: string[] = [];
  // Only Commerce's answer is stood in. The store's /api/checkout/status route runs as it ships,
  // so the page reads exactly what the route relays, which the stubbed-status tests above skip.
  const commerce = {
    getPluginRouteMeta: () => ({ public: true, methods: ["POST"] }),
    async handlePublicPluginApiRoute(pluginId: string, method: string, path: string, forwarded: Request) {
      dispatched.push(`${pluginId} ${method} ${path}`);
      const capabilityId = forwarded.headers.get("x-commerce-guest-capability")?.replace(/\.secret$/u, "");
      return { success: true, data: { ok: true, capabilityId, checkout: {
        schema: "dinkuskit.commerce.guest-checkout-projection/v1",
        state: "paid",
        attemptId: "fixture-attempt-1",
        lines: [line],
        total: usd("2900"),
        pricing: {
          merchandiseSubtotal: usd("2400"),
          couponDiscount: usd("0"),
          netMerchandise: usd("2400"),
          shipping: { mode: "flat", charge: usd("500") },
          finalTotal: usd("2900"),
        },
        redirectUrl: null,
        order: { orderId: "order:fixture", receiptId: "receipt:fixture", lines: [line], total: usd("2900") },
        retryAfter: null,
        unavailable: null,
      } } };
    },
  };
  // The route reads the store origin and catalog profile from its environment, as the shipping server does.
  const savedEnv = { site: process.env.EMDASH_SITE_URL, profile: process.env.DINKUS_CATALOG_PROFILE };
  process.env.EMDASH_SITE_URL = new URL(baseURL).origin;
  delete process.env.DINKUS_CATALOG_PROFILE;
  const context = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  try {
    const page = await context.newPage();
    const harness = await installOfflineCheckoutHarness(page, {
      baseURL,
      statusRoute: (request) => storeCheckoutStatus({ request, locals: { emdash: commerce } } as never),
    });
    await page.addInitScript(() => {
      if (localStorage.getItem("dinkus.guest-cart.v1")) return;
      localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
        version: 1,
        lines: [{ id: "fixture-shirt", quantity: 1 }],
      }));
    });
    await page.goto("/checkout");
    await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled();
    await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect(page.locator("[data-guest-cart-recover]")).toBeVisible();
    await page.goto("/checkout/success");
    await expect(page.locator("[data-guest-checkout-order]")).toBeVisible();
    await expect(page.locator("[data-guest-checkout-return-status]")).toContainText("confirmed");
    await expect(page.locator("[data-guest-checkout-order-number]")).toHaveText("Order fixture");
    await expect(page.locator("[data-guest-checkout-order-items] li")).toContainText(["Synthetic fixture shirt \u00d7 1$24.00"]);
    await expect(page.locator("[data-guest-checkout-item-thumb-placeholder]")).toHaveText("No image");
    await expect(page.locator("[data-guest-checkout-item-thumbnail]")).toHaveCount(0);
    await expect(page.locator("[data-guest-checkout-order-totals] dt")).toHaveText(["Subtotal", "Shipping", "Total"]);
    await expect(page.locator("[data-guest-checkout-order-totals] dd")).toHaveText(["$24.00", "$5.00", "$29.00"]);
    await expect(page.locator("[data-guest-checkout-destination]")).toBeVisible();
    await expect(page.locator("[data-guest-checkout-email]")).toHaveText("synthetic@example.test");
    await expect(page.locator("[data-guest-checkout-shipping-method]")).toHaveText("Flat rate ($5.00)");
    await expect(page.locator("[data-guest-checkout-account]")).toHaveAttribute("href", "/account");
    await expect(page.locator(".guest-checkout-continue")).toHaveAttribute("href", "/");
    await expect(page.locator("[data-guest-cart-count]")).toBeHidden();
    await expect(page.locator("[data-ephemera-stamp-text]")).toHaveText(/^(PAID · STRIPE TEST|SETTLED · COMMERCE)$/u);
    await expect(page.locator("[data-ephemera-barcode] svg")).toHaveAttribute("aria-label", "Order barcode DK-FIXTURE");
    // The receipt decoration settles: once the order shows, nothing keeps rewriting it.
    const receiptWrites = await page.evaluate(() => new Promise<number>((done) => {
      const order = document.querySelector("[data-guest-checkout-order]");
      if (!order) return done(-1);
      let writes = 0;
      const watch = new MutationObserver((records) => { writes += records.length; });
      watch.observe(order, { attributes: true, childList: true, characterData: true, subtree: true });
      setTimeout(() => { watch.disconnect(); done(writes); }, 750);
    }));
    expect(receiptWrites).toBe(0);
    expect(dispatched).toEqual(["r_gshdrqaldna3r7sn POST checkout/guest/status"]);
    expect(harness.counts().statusCalls).toBe(1);
    await mkdir(resolve("runs/checkout-success-commerce"), { recursive: true });
    await page.screenshot({
      path: resolve("runs/checkout-success-commerce", `${testInfo.project.name}-paid-through-store-route.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/cart");
    await expect(page.locator("[data-guest-cart-empty]")).toBeVisible();
    await expect(page.locator("[data-guest-cart-status]")).toContainText("Order confirmed");
    expect(harness.blocked).toEqual([]);
  } finally {
    await context.close();
    if (savedEnv.site === undefined) delete process.env.EMDASH_SITE_URL;
    else process.env.EMDASH_SITE_URL = savedEnv.site;
    if (savedEnv.profile !== undefined) process.env.DINKUS_CATALOG_PROFILE = savedEnv.profile;
  }
});

test("unknown checkout token gives a safe status-failure message", async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const context = await freshOfflineContext(
    browser,
    testInfo.project.use.baseURL as string,
    testInfo.project.use.viewport,
  );
  try {
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await installOfflineCheckoutHarness(page, {
      baseURL: testInfo.project.use.baseURL as string,
      statusUnknown: true,
    });
    await page.addInitScript(() => {
      localStorage.setItem("dinkus.guest-checkout.v1", JSON.stringify({
        capabilityId: "fixture-cap-unknown",
        capability: "fixture-cap-unknown.secret",
        attemptId: "fixture-attempt-unknown",
      }));
    });
    await page.goto("/checkout/success?session_id=well-formed-but-unknown");
    await expect(page.getByText("We couldn't confirm your order just now. Check your email.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check status again" })).toBeHidden();
    expect(consoleErrors).toEqual([]);
    await page.screenshot({
      path: resolve("runs/checkout-success-commerce", `${testInfo.project.name}-unknown-token.png`),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
});

test("corrupt stored checkout data does not imply a completed order", async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const context = await freshOfflineContext(
    browser,
    testInfo.project.use.baseURL as string,
    testInfo.project.use.viewport,
  );
  try {
    const page = await context.newPage();
    const harness = await installOfflineCheckoutHarness(page, {
      baseURL: testInfo.project.use.baseURL as string,
    });
    await page.addInitScript(() => {
      localStorage.setItem("dinkus.guest-checkout.v1", "{corrupt");
    });
    await page.goto("/checkout/success");
    await expect(page.getByRole("heading", { name: "We couldn't confirm your order" })).toBeVisible();
    await expect(page.getByText("We couldn't confirm your order just now. Check your email.")).toBeVisible();
    expect(harness.counts().statusCalls).toBe(0);
  } finally {
    await context.close();
  }
});

test.skip("legacy browser return status polling is superseded by the server receipt page", async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const context = await freshOfflineContext(
    browser,
    testInfo.project.use.baseURL as string,
    testInfo.project.use.viewport,
  );
  try {
    const page = await context.newPage();
    const harness = await installOfflineCheckoutHarness(page, {
      baseURL: testInfo.project.use.baseURL as string,
      statusAlwaysPending: true,
    });
    await page.addInitScript(() => {
      localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
        version: 1,
        lines: [{ id: "fixture-shirt", quantity: 1 }],
      }));
    });
    await page.goto("/checkout");
    await expect(page.getByRole("button", { name: "Continue to secure checkout" })).toBeEnabled();
    await page.getByLabel("Email", { exact: true }).fill("pending@example.test");
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect(page.locator("[data-guest-cart-recover]")).toBeVisible();
    await page.goto("/checkout/success?success=true&session_id=synthetic-untrusted");
    await expect(page.locator("[data-guest-checkout-return-status]")).toContainText("pending");
    await expect.poll(() => harness.counts().statusCalls).toBe(1);

    for (let retry = 0; retry < 4; retry += 1) {
      await page.getByRole("button", { name: "Check status again" }).click();
      await expect.poll(() => harness.counts().statusCalls).toBe(retry + 2);
    }
    await expect(page.getByRole("button", { name: "Check status again" })).toBeDisabled();
    await expect(page.locator("[data-guest-checkout-return-status]")).toContainText("temporarily limited");
    await page.screenshot({
      path: resolve("runs/offline-harness-tests-runs/20261008", testInfo.project.name, "guest-checkout-status-budget.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Check status again" }).click({ force: true });
    expect(harness.counts().statusCalls).toBe(5);
  } finally {
    await context.close();
  }
});

test("offline checkout blocks external payment and unregistered local checkout paths before delivery", async ({
  browser,
}, testInfo) => {
  let delivered = 0;
  const server = createServer((_request, response) => {
    delivered += 1;
    response.end("local sentinel");
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("sentinel did not bind");
  const baseURL = `http://127.0.0.1:${address.port}`;
  const context = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  try {
    const page = await context.newPage();
    const harness = await installOfflineCheckoutHarness(page, { baseURL });
    const failures: string[] = [];
    page.on("requestfailed", (request) => failures.push(request.failure()?.errorText ?? ""));
    await page.goto("/");
    expect(delivered).toBe(1); // The sentinel is reachable; rejection is not a network outage.
    const rejected = [
      harness.paymentURL,
      `${baseURL}/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/unregistered`,
      `${baseURL}${RUNTIME_PREPARE}`, // Wrong method must never fall through.
      `${baseURL}/api/payment/session`,
    ];
    for (const url of rejected) await expect(page.goto(url)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    expect(harness.blocked).toEqual(rejected);
    expect(failures).toEqual(rejected.map(() => "net::ERR_BLOCKED_BY_CLIENT"));
    expect(delivered).toBe(1);
    expect(harness.counts()).toEqual({ prepareCalls: 0, startCalls: 0, statusCalls: 0 });
  } finally {
    await context.close();
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
});

test("offline browser contexts cannot reuse cart state or cookies", async ({ browser }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL as string;
  const first = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  try {
    const page = await first.newPage();
    await installOfflineCheckoutHarness(page, { baseURL, synthetic: false });
    await page.goto("/cart");
    await page.evaluate(() => {
      localStorage.setItem("offline-isolation-sentinel", "previous shopper");
      sessionStorage.setItem("offline-isolation-sentinel", "previous tab");
    });
    await first.addCookies([{ name: "offline-isolation-sentinel", value: "previous shopper", url: baseURL }]);
  } finally { await first.close(); }
  const second = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  try {
    const page = await second.newPage();
    await installOfflineCheckoutHarness(page, { baseURL, synthetic: false });
    await page.goto("/cart");
    expect(await page.evaluate(() => ({
      local: localStorage.getItem("offline-isolation-sentinel"),
      session: sessionStorage.getItem("offline-isolation-sentinel"),
    }))).toEqual({ local: null, session: null });
    expect((await second.cookies()).some((cookie) => cookie.name === "offline-isolation-sentinel")).toBe(false);
  } finally { await second.close(); }
});

test("checkout contact proof covers physical validation, Commerce refusal, filled address, and digital omission", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const root = resolve("runs/checkout-contact-proof", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const context = await freshOfflineContext(
    browser,
    testInfo.project.use.baseURL as string,
    testInfo.project.use.viewport,
  );
  try {
    const physical = await context.newPage();
    await installOfflineCheckoutHarness(physical, {
      baseURL: testInfo.project.use.baseURL as string,
      refuseDelivery: true,
      statusWithoutAttempt: true,
    });
    await physical.addInitScript(() => {
      localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
        version: 1,
        lines: [{ id: "fixture-shirt", quantity: 1 }],
      }));
    });
    await physical.goto("/cart");
    await expect(physical.locator("[data-guest-cart-contact]")).toHaveCount(0);
    await expect(physical.locator("[data-guest-cart-coupon-box]")).toHaveCount(0);
    await expect(physical.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$24.00");
    const proceedButton = physical.getByRole("button", { name: "Proceed to Checkout" });
    await expect(proceedButton).toBeEnabled();
    await physical.screenshot({ path: resolve(root, "cart-proceed.png"), fullPage: true, animations: "disabled" });
    await proceedButton.click();
    await expect(physical).toHaveURL(/\/checkout$/);
    await expect(physical.locator("[data-checkout-vault]")).toBeVisible();
    await expect(physical.locator("[data-checkout-payment-handoff]")).toBeVisible();
    await expect(physical.locator("[data-checkout-manifest]")).toBeVisible();
    await expect(physical.locator("[data-checkout-breakdown]")).toBeVisible();
    await expect(physical.getByRole("heading", { name: "Delivery address" })).toBeVisible();
    await physical.screenshot({ path: resolve(root, "physical-empty.png"), fullPage: true, animations: "disabled" });

    await physical.getByLabel("Email", { exact: true }).fill("proof@example.test");
    await physical.getByLabel("Recipient", { exact: true }).fill("Proof shopper");
    await physical.getByLabel("Address line 1", { exact: true }).fill("1 Example Way");
    await physical.getByLabel("City", { exact: true }).fill("Testville");
    await physical.getByLabel("State or region (required for United States delivery)", { exact: true }).fill("NY");
    await physical.getByLabel("Postal code", { exact: true }).fill("00000");
    await physical.getByLabel("Country", { exact: true }).selectOption("US");
    await expect(physical.getByRole("option", { name: "Canada (coming soon)" })).toBeDisabled();
    await physical.screenshot({ path: resolve(root, "physical-filled.png"), fullPage: true, animations: "disabled" });

    await physical.getByLabel("City", { exact: true }).fill("");
    await physical.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect(physical.locator("[data-guest-cart-status]")).toContainText("Complete the recipient");
    await physical.screenshot({ path: resolve(root, "physical-validation-error.png"), fullPage: true, animations: "disabled" });

    await physical.getByLabel("Recipient", { exact: true }).fill("");
    await physical.getByLabel("Address line 1", { exact: true }).fill("");
    await physical.getByLabel("State or region (required for United States delivery)", { exact: true }).fill("");
    await physical.getByLabel("Postal code", { exact: true }).fill("");
    await physical.getByLabel("Country", { exact: true }).selectOption("");
    await physical.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect(physical.locator("[data-guest-cart-status]")).toContainText("Delivery address is required");
    await physical.screenshot({ path: resolve(root, "physical-commerce-refusal.png"), fullPage: true, animations: "disabled" });

    const digital = await context.newPage();
    await installOfflineCheckoutHarness(digital, {
      baseURL: testInfo.project.use.baseURL as string,
      digital: true,
    });
    await digital.addInitScript(() => {
      localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
        version: 1,
        lines: [{ id: "fixture-shirt", quantity: 1 }],
      }));
    });
    await digital.goto("/checkout");
    await expect(digital.getByRole("heading", { name: "Delivery address" })).toBeHidden();
    await expect(digital.locator("[data-checkout-shipping-amount]")).toHaveText("Free");
    await digital.screenshot({ path: resolve(root, "digital-only-no-address.png"), fullPage: true, animations: "disabled" });
  } finally {
    await context.close();
  }
});

test("checkout start sends delivery only while the cart needs it, even after fields go stale", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const baseURL = testInfo.project.use.baseURL as string;
  const root = resolve("runs/checkout-contact-proof", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const address = {
    name: "Proof shopper",
    line1: "1 Example Way",
    city: "New York",
    region: "NY",
    postalCode: "10001",
    country: "US",
  };
  const seedCart = () => {
    localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
      version: 1,
      lines: [{ id: "fixture-shirt", quantity: 1 }],
    }));
  };
  const fillContact = async (page: import("@playwright/test").Page) => {
    await page.getByLabel("Email", { exact: true }).fill("proof@example.test");
    await page.getByLabel("Recipient", { exact: true }).fill(address.name);
    await page.getByLabel("Address line 1", { exact: true }).fill(address.line1);
    await page.getByLabel("City", { exact: true }).fill(address.city);
    await page.getByLabel("Postal code", { exact: true }).fill(address.postalCode);
    await page.getByLabel("Country", { exact: true }).selectOption(address.country);
  };

  const physicalContext = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  let physicalBodies: unknown[] = [];
  try {
    const page = await physicalContext.newPage();
    const harness = await installOfflineCheckoutHarness(page, { baseURL });
    await page.addInitScript(seedCart);
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Delivery address" })).toBeVisible();
    await expect(page.getByLabel("State or region (required for United States delivery)", { exact: true })).toBeVisible();
    await fillContact(page);
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    const status = page.locator("[data-guest-cart-status]");
    await expect(status).toHaveAttribute("role", "alert");
    await expect(status).toHaveText("Enter a state for United States delivery.");
    expect(harness.counts().startCalls).toBe(0);
    await page.screenshot({ path: resolve(root, "physical-missing-us-region.png"), fullPage: true, animations: "disabled" });
    await page.getByLabel("State or region (required for United States delivery)", { exact: true }).fill(address.region);
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect.poll(() => harness.counts().startCalls).toBe(1);
    physicalBodies = harness.startBodies();
    expect(physicalBodies).toHaveLength(1);
    expect((physicalBodies[0] as { contact: unknown }).contact).toEqual({ email: "proof@example.test", delivery: address });
  } finally {
    await physicalContext.close();
  }

  const staleContext = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  let staleBodies: unknown[] = [];
  try {
    const page = await staleContext.newPage();
    const harness = await installOfflineCheckoutHarness(page, { baseURL });
    // Two physical lines, so removing one triggers a catalog refresh without a reload
    // (a reload would clear the unsaved address and leave the form disabled while the catalog is down).
    await page.addInitScript(() => {
      localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
        version: 1,
        lines: [{ id: "fixture-shirt", quantity: 1 }, { id: "fixture-mug", quantity: 1 }],
      }));
    });
    const physicalProduct = (id: string, name: string) => ({
      id,
      found: true,
      name,
      sku: id.toUpperCase(),
      price: { listable: true, regularText: "$24.00", saleText: null },
      availability: { status: "in-stock", sellable: true, listable: true },
    });
    await page.route("**/api/guest-cart/snapshot**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          products: [physicalProduct("fixture-shirt", "Synthetic fixture shirt"), physicalProduct("fixture-mug", "Synthetic fixture mug")],
        }),
      }),
    );
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Delivery address" })).toBeVisible();
    await fillContact(page);
    await page.getByLabel("State or region (required for United States delivery)", { exact: true }).fill(address.region);
    await page.unroute("**/api/guest-cart/snapshot**");
    // The remaining line becomes digital-only after Commerce's next catalog answer,
    // but the first refresh after removing the mug fails.
    harness.setDigital(true);
    await page.route("**/api/guest-cart/snapshot**", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "catalog_unavailable" }),
      }),
    );
    await page.getByRole("article").filter({ hasText: "Synthetic fixture mug" }).getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("[data-guest-cart-status]")).toContainText("We couldn't load the latest prices.");
    await page.unroute("**/api/guest-cart/snapshot**");

    let releaseRetry: () => void = () => {};
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    await page.route("**/api/guest-cart/snapshot**", async (route) => {
      await retryGate;
      // fallback(), not continue(): continue() skips the offline harness's context route and hits the real server.
      await route.fallback();
    });

    const retryButton = page.getByRole("button", { name: "Try again" });
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toBeEnabled();
    await retryButton.click();
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toBeDisabled();

    releaseRetry();
    await expect(retryButton).toBeHidden();
    await page.unroute("**/api/guest-cart/snapshot**");
    await expect(page.getByRole("heading", { name: "Delivery address" })).toBeHidden();
    await expect(page.getByLabel("City", { exact: true })).toHaveValue(address.city);
    await page.screenshot({ path: resolve(root, "digital-after-physical-stale-fields.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect.poll(() => harness.counts().startCalls).toBe(1);
    staleBodies = harness.startBodies();
    expect(staleBodies).toHaveLength(1);
    expect((staleBodies[0] as { contact: unknown }).contact).toEqual({ email: "proof@example.test" });
  } finally {
    await staleContext.close();
  }
  await writeFile(
    resolve(root, "checkout-start-contact-bodies.json"),
    `${JSON.stringify({ physical: physicalBodies, digitalAfterStaleAddress: staleBodies }, null, 2)}\n`,
  );
});

test("retryable unconfirmed return reveals the hosted-checkout retry link; confirmed and tokenless returns keep it hidden", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const baseURL = testInfo.project.use.baseURL as string;
  const redirectUrl = "https://checkout.stripe.com/c/pay/cs_test_fixture_retry";
  const seedRetention = () => {
    localStorage.setItem("dinkus.guest-checkout.v1", JSON.stringify({
      capabilityId: "fixture-cap-1",
      capability: "fixture-cap-1.secret",
      attemptId: "fixture-attempt-retry",
    }));
  };

  const retryContext = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  try {
    const page = await retryContext.newPage();
    await installOfflineCheckoutHarness(page, { baseURL, statusRetryRedirect: redirectUrl });
    await page.addInitScript(seedRetention);
    await page.goto("/checkout/success?session_id=fixture-retry");
    const retry = page.locator("[data-guest-checkout-retry]");
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAttribute("href", redirectUrl);
    await expect(retry).toHaveText("Continue to secure checkout");
    await expect(page.locator("[data-guest-checkout-order]")).toBeHidden();
  } finally {
    await retryContext.close();
  }

  const confirmedContext = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  try {
    const page = await confirmedContext.newPage();
    const harness = await installOfflineCheckoutHarness(page, { baseURL });
    await page.addInitScript(() => {
      localStorage.setItem("dinkus.guest-checkout.v1", JSON.stringify({
        capabilityId: "fixture-cap-1",
        capability: "fixture-cap-1.secret",
        attemptId: "fixture-attempt-0",
      }));
    });
    await page.goto("/checkout/success?session_id=fixture-confirmed");
    await expect(page.locator("[data-guest-checkout-return-status]")).toContainText("pending");
    await expect(page.locator("[data-guest-checkout-retry]")).toBeHidden();
    await page.getByRole("button", { name: "Check status again" }).click();
    await expect(page.locator("[data-guest-checkout-order]")).toBeVisible();
    await expect(page.locator("[data-guest-checkout-retry]")).toBeHidden();
    expect(harness.counts().statusCalls).toBe(2);
  } finally {
    await confirmedContext.close();
  }

  const tokenlessContext = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
  try {
    const page = await tokenlessContext.newPage();
    const harness = await installOfflineCheckoutHarness(page, { baseURL, statusRetryRedirect: redirectUrl });
    await page.goto("/checkout/success");
    await expect(page.getByRole("heading", { name: "We couldn't confirm your order" })).toBeVisible();
    await expect(page.locator("[data-guest-checkout-retry]")).toBeHidden();
    expect(harness.counts().statusCalls).toBe(0);
  } finally {
    await tokenlessContext.close();
  }
});


for (const scenario of ["prepared capability", "lost first-start response"] as const) {
  test(`retained ${scenario} remains recoverable after cart reload`, async ({ browser }, testInfo) => {
    test.setTimeout(60_000);
    const context = await freshOfflineContext(browser, testInfo.project.use.baseURL as string, testInfo.project.use.viewport);
    try {
      const page = await context.newPage();
      const lostStart = scenario === "lost first-start response";
      const harness = await installOfflineCheckoutHarness(page, {
        baseURL: testInfo.project.use.baseURL as string,
        digital: true,
        statusWithoutAttempt: !lostStart,
        loseFirstStartResponse: lostStart,
      });
      await page.addInitScript(() => {
        if (localStorage.getItem("dinkus.guest-cart.v1")) return;
        localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({ version: 1, lines: [{ id: "fixture-shirt", quantity: 1 }] }));
      });
      await page.goto("/checkout");
      await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled();
      if (lostStart) {
        await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
        await page.getByRole("button", { name: "Continue to secure checkout" }).click();
        await expect(page.locator("[data-guest-cart-status]")).toContainText("may have reached Commerce");
      }
      const retained = await page.evaluate(() => JSON.parse(localStorage.getItem("dinkus.guest-checkout.v1")!));
      expect(retained.attemptId).toBeNull();
      expect(retained.awaitingStart === true).toBe(lostStart);
      await page.reload();
      const proof = resolve("runs/pr80-recovery-20261012", testInfo.project.name);
      await mkdir(proof, { recursive: true });
      if (lostStart) {
        await expect(page.locator("[data-guest-cart-qty]")).toBeDisabled();
        await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
        await page.screenshot({ path: resolve(proof, "lost-start-reloaded.png"), fullPage: true });
        await expect(page.getByRole("button", { name: "Check checkout status" })).toBeVisible({ timeout: 5_000 });
        await page.getByRole("button", { name: "Check checkout status" }).click();
        await expect(page.locator("[data-guest-cart-status]")).toContainText("still pending");
        await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
        await expect(page.locator("[data-guest-cart-qty]")).toBeDisabled();
        expect(harness.counts()).toEqual({ prepareCalls: 1, startCalls: 1, statusCalls: 1 });
        const recovered = await page.evaluate(() => JSON.parse(localStorage.getItem("dinkus.guest-checkout.v1")!));
        expect(recovered.capability).toBe(retained.capability);
        expect(recovered.attemptId).toBe("fixture-attempt-1");
      } else {
        // The cart checks a capability it only prepared by itself on load and unlocks.
        await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled();
        await expect(page.getByRole("button", { name: "Check checkout status" })).toBeHidden();
        await expect(page.locator("[data-guest-cart-qty]")).toBeEnabled();
        expect(harness.counts()).toEqual({ prepareCalls: 1, startCalls: 0, statusCalls: 1 });
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("dinkus.guest-checkout.v1")!).capability)).toBe(retained.capability);
      }
      expect(harness.blocked).toEqual([]);
      await page.screenshot({ path: resolve(proof, `${lostStart ? "lost-start" : "prepared"}-recovered.png`), fullPage: true });
    } finally { await context.close(); }
  });
}
