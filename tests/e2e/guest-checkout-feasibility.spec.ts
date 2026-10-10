import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

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
  await installOfflineCheckoutHarness(page, { baseURL: testInfo.project.use.baseURL as string, synthetic: false });
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

  const runDir = resolve("runs/offline-harness-tests-runs/20261008", testInfo.project.name);
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
  await page.goto("/cart");
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
  expect(harness.counts()).toMatchObject({ prepareCalls: 1, startCalls: 0 });
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
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
  expect(harness.counts().statusCalls).toBe(2);
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
  await page.reload();
  await expect(page.locator("[data-guest-cart-checkout]")).toBeEnabled();
  await expect(page.locator("[data-guest-cart-qty]")).toBeEnabled();
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByRole("button", { name: "Continue to secure checkout" }).click();
  await expect(page.locator("[data-guest-cart-recover]")).toBeVisible();
  expect(harness.counts().prepareCalls).toBe(2);
  expect(harness.counts().startCalls).toBe(2);
  } finally { await context.close(); }
});

test("return status checks stop after the bounded retry budget", async ({ browser }, testInfo) => {
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
    await page.goto("/cart");
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
  test.skip(testInfo.project.name !== "shipping-chromium-desktop", "Proof screenshots are captured once on desktop.");
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
    });
    await physical.addInitScript(() => {
      localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({
        version: 1,
        lines: [{ id: "fixture-shirt", quantity: 1 }],
      }));
    });
    await physical.goto("/cart");
    await expect(physical.getByRole("heading", { name: "Delivery address" })).toBeVisible();
    await physical.screenshot({ path: resolve(root, "physical-empty.png"), fullPage: true, animations: "disabled" });

    await physical.getByLabel("Email", { exact: true }).fill("proof@example.test");
    await physical.getByLabel("Recipient", { exact: true }).fill("Proof shopper");
    await physical.getByLabel("Address line 1", { exact: true }).fill("1 Example Way");
    await physical.getByLabel("City", { exact: true }).fill("Testville");
    await physical.getByLabel("Postal code", { exact: true }).fill("00000");
    await physical.getByLabel("Country code", { exact: true }).fill("US");
    await physical.screenshot({ path: resolve(root, "physical-filled.png"), fullPage: true, animations: "disabled" });

    await physical.getByLabel("City", { exact: true }).fill("");
    await physical.getByRole("button", { name: "Continue to secure checkout" }).click();
    await expect(physical.locator("[data-guest-cart-status]")).toContainText("Complete the recipient");
    await physical.screenshot({ path: resolve(root, "physical-validation-error.png"), fullPage: true, animations: "disabled" });

    await physical.getByLabel("Recipient", { exact: true }).fill("");
    await physical.getByLabel("Address line 1", { exact: true }).fill("");
    await physical.getByLabel("Postal code", { exact: true }).fill("");
    await physical.getByLabel("Country code", { exact: true }).fill("");
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
    await digital.goto("/cart");
    await expect(digital.getByRole("heading", { name: "Delivery address" })).toBeHidden();
    await digital.screenshot({ path: resolve(root, "digital-only-no-address.png"), fullPage: true, animations: "disabled" });
  } finally {
    await context.close();
  }
});
