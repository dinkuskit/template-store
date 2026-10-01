import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

test.use({ trace: "off", video: "off" });

const CREATE_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/create";
const LIST_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/list";
const SAVE_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/save-prices";
const STATUS_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/set-manual-availability";

const PREPARE_ENDPOINT = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare";
const START_ENDPOINT = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/start";
const STATUS_ENDPOINT = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/status";

function unwrap<T>(body: unknown): T {
  if (typeof body === "object" && body !== null && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function unwrapError(body: unknown): { code: string; message: string } {
  if (typeof body === "object" && body !== null && "error" in body) {
    return (body as { error: { code: string; message: string } }).error;
  }
  return { code: "UNKNOWN_ERROR", message: "Non-error response shape received" };
}

async function adminPost(
  admin: Page,
  path: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return admin.request.post(path, {
    data,
    headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
  });
}

function queryDatabaseCount(dbPath: string, collection: string): number {
  const result = execFileSync(
    "sqlite3",
    [dbPath, `SELECT count(*) FROM _plugin_storage WHERE collection='${collection}'`],
    { encoding: "utf8" },
  ).trim();
  return Number.parseInt(result, 10);
}

test("guest checkout feasibility qualifies failclosed contract and denial boundaries in browser", async ({
  browser,
  request,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const isMobile = testInfo.project.name.includes("mobile");

  // Require actual baseURL from environment / test harness
  expect(baseURL).toBeTruthy();
  const requiredBaseURL = baseURL!;

  // Own feature proof root: never overwrite prior shipping / v1-release assertions
  const runDir = resolve("runs/checkout-integration-runs/20260930/browser", testInfo.project.name);
  await mkdir(runDir, { recursive: true });

  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);

  // 1. Seed test catalog item through admin
  const adminContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await adminContext.newPage();
  await admin.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/products");
  try {
    await expect(admin.getByRole("button", { name: "Get Started" })).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("button", { name: "Get Started" }).click();
  } catch {
    await expect(admin.getByRole("dialog", { name: /Welcome to EmDash/ })).toHaveCount(0);
  }
  await expect(admin.getByRole("heading", { name: "Products", exact: true })).toBeVisible();

  const dbPath = ".artifacts/e2e-shipping/content.db";
  expect(existsSync(dbPath)).toBe(true);

  await expect.poll(
    () =>
      execFileSync(
        "sqlite3",
        [
          dbPath,
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_dinkus-commerce_catalogItems_%'",
        ],
        { encoding: "utf8" },
      ),
    { timeout: 90_000 },
  ).toContain("uidx_plugin_dinkus-commerce_catalogItems_skuKey");

  await expect.poll(
    () =>
      execFileSync(
        "sqlite3",
        [
          dbPath,
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_dinkus-commerce_catalogItems_%'",
        ],
        { encoding: "utf8" },
      ),
    { timeout: 90_000 },
  ).toContain("uidx_plugin_dinkus-commerce_catalogItems_commandId");

  await expect.poll(async () => {
    const listed = await adminPost(admin, LIST_ROUTE, {});
    return listed.ok();
  }, { timeout: 15_000 }).toBe(true);

  const name = `Feasibility Hat ${testInfo.project.name}`;
  const sku = `FEASIBILITY-${testInfo.project.name.replaceAll(/[^A-Za-z0-9]+/g, "-").toUpperCase()}`;
  let created: APIResponse | null = null;
  await expect.poll(async () => {
    created = await adminPost(admin, CREATE_ROUTE, {
      commandId: `feasibility-${crypto.randomUUID()}`,
      name,
      sku,
      manageStock: false,
    });
    return created.ok();
  }, { timeout: 30_000 }).toBe(true);

  expect(created).not.toBeNull();
  const id = unwrap<{ item: { itemId: string } }>(await created!.json()).item.itemId;

  const priced = await adminPost(admin, SAVE_ROUTE, { catalogItemId: id, regular: "42", sale: "" });
  expect(priced.ok(), await priced.text()).toBe(true);

  const available = await adminPost(admin, STATUS_ROUTE, { catalogItemId: id, status: "in-stock" });
  expect(available.ok(), await available.text()).toBe(true);

  // 2. Denied cross-origin prepare cannot write: record count before and after
  const capCountBefore = queryDatabaseCount(dbPath, "checkoutGuestCapabilities");
  const crossOriginPrepare = await request.post(PREPARE_ENDPOINT, {
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    data: {},
  });
  // Safe origin rejection may occur at Astro HTML/CSRF guard before Commerce
  expect(crossOriginPrepare.status()).toBe(403);
  const capCountAfterDenied = queryDatabaseCount(dbPath, "checkoutGuestCapabilities");
  expect(capCountAfterDenied).toBe(capCountBefore);

  // 3. Real shopper page browser fetch prepare; store token in test-only sessionStorage BEFORE start
  const shopperContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const shopper = await shopperContext.newPage();
  await shopper.goto("/");

  const browserPrepareSummary = await shopper.evaluate(async (endpoint) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return { ok: false, status: res.status, tokenStored: false };
    const json = await res.json();
    const token = json.data?.capability?.capability ?? json.capability?.capability;
    const capId = json.data?.capabilityId ?? json.capabilityId;
    if (token && typeof token === "string") {
      sessionStorage.setItem("test_guest_capability", token);
    }
    return {
      ok: true,
      status: res.status,
      tokenStored: Boolean(sessionStorage.getItem("test_guest_capability")),
      capabilityMatchesId: typeof token === "string" && token.startsWith(`${capId}.`),
    };
  }, PREPARE_ENDPOINT);

  expect(browserPrepareSummary.ok).toBe(true);
  expect(browserPrepareSummary.status).toBe(200);
  expect(browserPrepareSummary.tokenStored).toBe(true);
  expect(browserPrepareSummary.capabilityMatchesId).toBe(true);

  // Exact capability count delta + 1 in database
  const capCountAfterValid = queryDatabaseCount(dbPath, "checkoutGuestCapabilities");
  expect(capCountAfterValid).toBe(capCountBefore + 1);

  // 4. Start once in browser after prepare/storage, reload, start again with same stored token; both 503 PAYMENTS_UNAVAILABLE
  const initialStartSummary = await shopper.evaluate(
    async ({ endpoint, catalogItemId }) => {
      const token = sessionStorage.getItem("test_guest_capability");
      if (!token) return { ok: false, status: 0, errorCode: "MISSING_SESSION_TOKEN" };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-commerce-guest-capability": token,
        },
        body: JSON.stringify({
          lines: [{ catalogItemId, quantity: 1 }],
        }),
      });
      let errorCode: string | null = null;
      try {
        const json = await res.json();
        errorCode = json.error?.code ?? null;
      } catch {}
      return {
        ok: res.ok,
        status: res.status,
        errorCode,
      };
    },
    { endpoint: START_ENDPOINT, catalogItemId: id },
  );

  expect(initialStartSummary.status).toBe(503);
  expect(initialStartSummary.errorCode).toBe("PAYMENTS_UNAVAILABLE");

  await shopper.reload();

  const reloadStartSummary = await shopper.evaluate(
    async ({ endpoint, catalogItemId }) => {
      const token = sessionStorage.getItem("test_guest_capability");
      if (!token) return { ok: false, status: 0, errorCode: "MISSING_SESSION_TOKEN" };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-commerce-guest-capability": token,
        },
        body: JSON.stringify({
          lines: [{ catalogItemId, quantity: 1 }],
        }),
      });
      let errorCode: string | null = null;
      try {
        const json = await res.json();
        errorCode = json.error?.code ?? null;
      } catch {}
      return {
        ok: res.ok,
        status: res.status,
        errorCode,
      };
    },
    { endpoint: START_ENDPOINT, catalogItemId: id },
  );

  expect(reloadStartSummary.status).toBe(503);
  expect(reloadStartSummary.errorCode).toBe("PAYMENTS_UNAVAILABLE");

  // 5. Denial boundary checks on start: missing capability, forged capability, extra fields, cross-origin
  const missingCapRes = await request.post(START_ENDPOINT, {
    headers: {
      "content-type": "application/json",
      origin: requiredBaseURL,
    },
    data: {
      lines: [{ catalogItemId: id, quantity: 1 }],
    },
  });
  expect(missingCapRes.status()).toBe(403);
  expect(unwrapError(await missingCapRes.json()).code).toBe("CAPABILITY_DENIED");

  const forgedCapRes = await request.post(START_ENDPOINT, {
    headers: {
      "content-type": "application/json",
      "x-commerce-guest-capability": "forged.not-a-secret",
      origin: requiredBaseURL,
    },
    data: {
      lines: [{ catalogItemId: id, quantity: 1 }],
    },
  });
  expect(forgedCapRes.status()).toBe(403);
  expect(unwrapError(await forgedCapRes.json()).code).toBe("CAPABILITY_DENIED");

  // Execute extraPrice and extraField probes directly within the shopper browser using sessionStorage bearer.
  // Genuine bearer token never leaves shopper browser context.
  const extraPriceSummary = await shopper.evaluate(
    async ({ endpoint, catalogItemId }) => {
      const token = sessionStorage.getItem("test_guest_capability");
      if (!token) return { ok: false, status: 0, errorCode: "MISSING_SESSION_TOKEN" };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-commerce-guest-capability": token,
        },
        body: JSON.stringify({
          lines: [{ catalogItemId, quantity: 1, unitPrice: "100" }],
        }),
      });
      let errorCode: string | null = null;
      try {
        const json = await res.json();
        errorCode = json.error?.code ?? null;
      } catch {}
      return { ok: res.ok, status: res.status, errorCode };
    },
    { endpoint: START_ENDPOINT, catalogItemId: id },
  );
  expect(extraPriceSummary.status).toBe(400);
  expect(extraPriceSummary.errorCode).toBe("INVALID_CART");

  const extraFieldSummary = await shopper.evaluate(
    async ({ endpoint, catalogItemId }) => {
      const token = sessionStorage.getItem("test_guest_capability");
      if (!token) return { ok: false, status: 0, errorCode: "MISSING_SESSION_TOKEN" };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-commerce-guest-capability": token,
        },
        body: JSON.stringify({
          lines: [{ catalogItemId, quantity: 1 }],
          cartId: "extra-injected-cart-id",
        }),
      });
      let errorCode: string | null = null;
      try {
        const json = await res.json();
        errorCode = json.error?.code ?? null;
      } catch {}
      return { ok: res.ok, status: res.status, errorCode };
    },
    { endpoint: START_ENDPOINT, catalogItemId: id },
  );
  expect(extraFieldSummary.status).toBe(400);
  expect(extraFieldSummary.errorCode).toBe("INVALID_CART");

  // Cross-origin runner probe may use forged.not-a-secret token; same-origin guard precedes capability check.
  const crossOriginStart = await request.post(START_ENDPOINT, {
    headers: {
      "content-type": "application/json",
      "x-commerce-guest-capability": "forged.not-a-secret",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    data: {
      lines: [{ catalogItemId: id, quantity: 1 }],
    },
  });
  expect(crossOriginStart.status()).toBe(403);

  // 6. Retain capability across retry and status query (safe summary return)
  const browserStatusSummary = await shopper.evaluate(async (endpoint) => {
    const token = sessionStorage.getItem("test_guest_capability");
    if (!token) return { ok: false, status: 0, orderNull: false, redirectUrlNull: false };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-commerce-guest-capability": token,
      },
      body: JSON.stringify({
        paid: true,
        attemptId: "forged-attempt",
      }),
    });
    let orderNull = false;
    let redirectUrlNull = false;
    try {
      const json = await res.json();
      const checkout = json.data?.checkout ?? json.checkout;
      orderNull = checkout?.order === null;
      redirectUrlNull = checkout?.redirectUrl === null;
    } catch {}
    return {
      ok: res.ok,
      status: res.status,
      orderNull,
      redirectUrlNull,
    };
  }, STATUS_ENDPOINT);

  expect(browserStatusSummary.status).toBe(200);
  expect(browserStatusSummary.orderNull).toBe(true);
  expect(browserStatusSummary.redirectUrlNull).toBe(true);

  // 7. Shopper browser UI interactions and forged query param resilience
  const card = shopper.locator(`[data-commerce-product="${id}"]`);
  await expect(card.getByRole("button", { name: "Add to cart", exact: true })).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();

  await shopper.getByRole("link", { name: /Cart/ }).click();
  await expect(shopper.getByRole("heading", { name: "Cart", exact: true })).toBeVisible();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();

  const checkoutBtn = shopper.locator("[data-guest-cart-checkout]");
  await expect(checkoutBtn).toBeDisabled();
  await expect(checkoutBtn).toHaveText("Checkout unavailable");

  const reasonEl = shopper.locator("[data-guest-cart-checkout-reason]");
  await expect(reasonEl).toHaveText("Checkout is not available yet.");

  // Screenshot capture showing honest disabled checkout without bearer tokens exposed
  const runScreenshot = resolve(runDir, "guest-checkout-disabled.png");
  await shopper.screenshot({ path: runScreenshot, fullPage: true, animations: "disabled" });

  // Forged return query in browser cannot confirm purchase or alter disabled state
  await shopper.goto("/cart?success=true&session_id=forged_stripe_session_99999&redirect_status=succeeded");
  await expect(shopper.getByRole("heading", { name: "Cart", exact: true })).toBeVisible();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(checkoutBtn).toBeDisabled();
  await expect(checkoutBtn).toHaveText("Checkout unavailable");
  await expect(reasonEl).toHaveText("Checkout is not available yet.");

  // 8. Zero orders / checkout carts / inventory mutations in SQLite
  // checkoutCarts: 0 implies 0 attempts and 0 embedded Commerce orders (orders collection is not the oracle)
  const checkoutCartCount = queryDatabaseCount(dbPath, "checkoutCarts");
  const inventoryConfigCount = queryDatabaseCount(dbPath, "storeInventoryConfigurations");
  const capabilityCount = queryDatabaseCount(dbPath, "checkoutGuestCapabilities");

  expect(checkoutCartCount).toBe(0);
  expect(inventoryConfigCount).toBe(0);
  expect(capabilityCount).toBe(capCountAfterValid);

  // 9. Document verified safe summary and blocked contracts (not faked with mocks)
  const assertions = {
    project: testInfo.project.name,
    isMobile,
    siteConfiguredBeforeColdstart: true,
    browserPrepareSafeSummary: {
      status: browserPrepareSummary.status,
      tokenStoredInSessionStorage: browserPrepareSummary.tokenStored,
      exactCapabilityDelta: 1,
    },
    defaultUnavailableDenialRetryAndReload: {
      initialStatus: initialStartSummary.status,
      initialErrorCode: initialStartSummary.errorCode,
      reloadStatus: reloadStartSummary.status,
      reloadErrorCode: reloadStartSummary.errorCode,
    },
    denials: {
      missingCapability: 403,
      forgedCapability: 403,
      extraPrice: 400,
      extraField: 400,
      crossOrigin: 403,
    },
    retainedCapabilityAcrossReload: true,
    statusProjectionSafe: {
      status: browserStatusSummary.status,
      orderNull: browserStatusSummary.orderNull,
      redirectUrlNull: browserStatusSummary.redirectUrlNull,
    },
    browserCheckoutDisabled: true,
    browserCheckoutReason: "Checkout is not available yet.",
    forgedReturnConfirmedPurchase: false,
    sqlite: {
      checkoutCarts: checkoutCartCount,
      checkoutCartsZeroImpliesZeroAttemptsOrEmbeddedOrders: true,
      storeInventoryConfigurations: inventoryConfigCount,
      checkoutGuestCapabilities: capabilityCount,
    },
    contracts: {
      redirect: "BLOCKED",
      paid: "BLOCKED",
      receipt: "BLOCKED",
      singlePaidOrder: "BLOCKED",
      lostPaymentResponse: "BLOCKED",
      restart: "BLOCKED",
      stripeAcceptance: "BLOCKED",
      registryAcceptance: "BLOCKED",
    },
  };

  await writeFile(resolve(runDir, "assertions.json"), JSON.stringify(assertions, null, 2), "utf8");
  await shopperContext.close();
  await adminContext.close();
});
