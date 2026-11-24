import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

import type { DinkusStorefrontActions } from "../../src/features/guest-cart/webmcp";
import { COMMERCE_SKU_INDEX, listCatalog, openProductsList, sellProduct } from "./helpers/product-page";

// The cart lives in Commerce; the browser holds only its key in an HttpOnly cookie
// (template-cart-real-form-20261113, template-cart-count-cookie-20261113).

async function storeWithProduct(browser: Browser, testInfo: TestInfo, suffix: string, openAdmin = true) {
  const adminContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await adminContext.newPage();
  if (openAdmin) await openProductsList(admin);
  else {
    // These shopper regressions need native content/catalog writes, not the admin React welcome screen.
    const signedIn = await adminContext.request.get("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/products");
    expect(signedIn.ok()).toBe(true);
  }
  expect(existsSync(".artifacts/e2e/content.db")).toBe(true);
  // The installed Commerce (the Registry build) builds its unique indexes on a fresh store's first requests.
  await expect.poll(
    () => execFileSync("sqlite3", [
      ".artifacts/e2e/content.db",
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_%'",
    ], { encoding: "utf8" }),
    { timeout: 90_000 },
  ).toContain(COMMERCE_SKU_INDEX);
  await expect.poll(async () => {
    try { await listCatalog(admin.request); return true; } catch { return false; }
  }, { timeout: 15_000 }).toBe(true);
  const tag = `${testInfo.project.name}-${suffix}`.replaceAll(/[^A-Za-z0-9]+/g, "-").toUpperCase();
  const name = `Cart hat ${tag}`;
  const sku = `CART-${tag}`;
  const { itemId } = await sellProduct(admin.request, { title: name, sku, regular: "24" });
  await adminContext.close();
  return { name, sku, itemId, productPath: `/products/${sku.toLowerCase()}` };
}

async function cookieNamed(page: Page, name: string) {
  return (await page.context().cookies()).find((cookie) => cookie.name === name);
}

async function openFocusCart(shopper: Page, testInfo: TestInfo, ids: string[]) {
  for (const id of ids) {
    const added = await shopper.request.post("/cart/add", {
      form: { id, quantity: "1" },
      headers: { origin: new URL(testInfo.project.use.baseURL!).origin },
    });
    expect(added.ok()).toBe(true);
  }
  await shopper.goto("/cart");
  await shopper.waitForFunction(() => (window as unknown as Record<symbol, boolean>)[Symbol.for("dinkuskit.server-cart.bound")]);
}

test("keyboard Update keeps focus on its line without reclaiming focus from navigation", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { itemId } = await storeWithProduct(browser, testInfo, "focus-update", false);
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  try {
    const shopper = await context.newPage();
    await openFocusCart(shopper, testInfo, [itemId]);
    const line = shopper.locator(`[data-guest-cart-line="${itemId}"]`);
    const update = line.getByRole("button", { name: "Update", exact: true });
    const quantity = line.locator("[data-guest-cart-qty]");
    await quantity.fill("2");
    await update.press("Enter");
    await expect(line.locator("[data-guest-cart-line-total]")).toHaveText("Line total $48.00");
    await expect(update).toBeFocused();

    await context.route("**/cart/update", async (route) => { await held; await route.continue(); }, { times: 1 });
    await quantity.fill("3");
    await update.press("Enter");
    await expect(update).toBeDisabled();
    const nav = shopper.locator("[data-store-header] [data-guest-cart-nav]");
    await nav.focus();
    release();
    await expect(line.locator("[data-guest-cart-line-total]")).toHaveText("Line total $72.00");
    await expect(nav).toBeFocused();
  } finally { release(); await context.close(); }
});

test("keyboard Remove puts focus on the first remaining line", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const first = await storeWithProduct(browser, testInfo, "focus-remove-first", false);
  const second = await storeWithProduct(browser, testInfo, "focus-remove-second", false);
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  try {
    const shopper = await context.newPage();
    await openFocusCart(shopper, testInfo, [first.itemId, second.itemId]);
    const line = shopper.locator(`[data-guest-cart-line="${first.itemId}"]`);
    await line.getByRole("button", { name: `Remove ${first.name}`, exact: true }).press("Enter");
    await expect(line).toHaveCount(0);
    await expect(shopper.locator(`[data-guest-cart-line="${second.itemId}"] [data-guest-cart-qty]`)).toBeFocused();
  } finally { await context.close(); }
});

test("the cart works with script off: add, change, remove, and an honest checkout button", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const { name, itemId, productPath } = await storeWithProduct(browser, testInfo, "plain");
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport, javaScriptEnabled: false });
  const shopper = await context.newPage();

  await shopper.goto(productPath);
  const card = shopper.locator("[data-product-page]");
  // Enter in the quantity field sends the form, as any plain form does. (A click right after typing races
  // the store's smooth scroll, which never settles for Playwright with script off.)
  await card.locator("[data-add-to-cart-qty]").fill("2");
  await card.locator("[data-add-to-cart-qty]").press("Enter");
  await expect(shopper).toHaveURL(/\/cart\?added=2$/u);
  await expect(shopper.locator("[data-guest-cart-status]")).toHaveText("Added to your cart.");
  const line = shopper.locator(`[data-guest-cart-line="${itemId}"]`);
  await expect(line.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(line.locator("[data-guest-cart-qty]")).toHaveValue("2");
  await expect(line.locator("[data-guest-cart-line-total]")).toHaveText("Line total $48.00");
  await expect(shopper.locator("[data-guest-cart-subtotal]")).toHaveText("Subtotal $48.00");

  const key = await cookieNamed(shopper, "dk_cart");
  expect(key).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  expect(key?.value).toMatch(/^[A-Za-z0-9._~-]+\.[A-Za-z0-9._~-]+$/u);
  expect(await cookieNamed(shopper, "dk_cart_count")).toMatchObject({ value: "2", httpOnly: false });

  // Adding the same item again merges into one line.
  await shopper.goto(productPath);
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(line.locator("[data-guest-cart-qty]")).toHaveValue("3");
  await expect(shopper.locator("[data-guest-cart-subtotal]")).toHaveText("Subtotal $72.00");

  // A cleared Quantity box is a draft, not a removal: the browser stops the form and the line stays.
  await line.locator("[data-guest-cart-qty]").fill("");
  await line.locator("[data-guest-cart-qty]").press("Enter");
  expect(await line.locator("[data-guest-cart-qty]").evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  expect((await cookieNamed(shopper, "dk_cart_count"))?.value).toBe("3");
  await line.locator("[data-guest-cart-qty]").fill("5");
  await line.locator("[data-guest-cart-qty]").press("Enter");
  await expect(shopper).toHaveURL(/\/cart$/u);
  await expect(line.locator("[data-guest-cart-qty]")).toHaveValue("5");
  await expect(line.locator("[data-guest-cart-line-total]")).toHaveText("Line total $120.00");
  expect((await cookieNamed(shopper, "dk_cart_count"))?.value).toBe("5");

  // The proof store takes no payments: checkout says so and never pretends.
  await expect(shopper.locator("[data-guest-cart-checkout]")).toBeDisabled();
  await expect(shopper.locator("[data-guest-cart-checkout]")).toHaveText("Checkout unavailable");
  await expect(shopper.locator("[data-guest-cart-checkout-reason]")).toHaveText("Checkout is not available yet.");
  await shopper.screenshot({ path: resolve(root, "cart-script-off.png"), fullPage: true, animations: "disabled" });

  // The same cart follows the shopper to a fresh tab: it lives on the server, not in this page.
  const another = await context.newPage();
  await another.goto("/cart");
  await expect(another.locator(`[data-guest-cart-line="${itemId}"] [data-guest-cart-qty]`)).toHaveValue("5");

  await line.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeVisible();
  await expect(line).toHaveCount(0);
  expect((await cookieNamed(shopper, "dk_cart_count"))?.value).toBe("0");

  // A refused plain-form add lands on the cart page, which says why.
  const refused = await shopper.request.post("/cart/add", {
    form: { id: "no_such_item", quantity: "1" },
    headers: { origin: new URL(shopper.url()).origin },
    maxRedirects: 0,
  });
  expect(refused.status()).toBe(303);
  await shopper.goto(refused.headers().location ?? "/cart");
  await expect(shopper).toHaveURL(/\/cart\?cart_error=[A-Z_]+$/u);
  await expect(shopper.locator("[data-guest-cart-status][role=alert]")).toBeVisible();
  await shopper.screenshot({ path: resolve(root, "cart-refused-add-script-off.png"), fullPage: true, animations: "disabled" });
  await context.close();
});

// Shopify's Dawn and Horizon themes make Check out a submit button of the one cart form, so a quantity the shopper
// typed but did not press Update for is saved before checkout opens (template-cart-checkout-saves-quantities-20261123).
test("one cart form saves every typed quantity: Update saves them all, and Check out saves them before checkout", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const first = await storeWithProduct(browser, testInfo, "form-first", false);
  const second = await storeWithProduct(browser, testInfo, "form-second", false);
  const origin = new URL(testInfo.project.use.baseURL!).origin;
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ viewport: testInfo.project.use.viewport, javaScriptEnabled });
    try {
      const shopper = await context.newPage();
      for (const id of [first.itemId, second.itemId]) {
        expect((await shopper.request.post("/cart/add", { form: { id, quantity: "1" }, headers: { origin } })).ok()).toBe(true);
      }
      await shopper.goto("/cart");
      if (javaScriptEnabled) await shopper.waitForFunction(() => (window as unknown as Record<symbol, boolean>)[Symbol.for("dinkuskit.server-cart.bound")]);
      const rowFor = (id: string) => shopper.locator(`[data-guest-cart-line="${id}"]`);
      // Every quantity and Update belongs to the one cart form, as Shopify's do (an open checkout's button too;
      // this store's is the disabled "Checkout unavailable").
      for (const control of [rowFor(first.itemId).locator("[data-guest-cart-qty]"), rowFor(second.itemId).locator("[data-guest-cart-qty]"), rowFor(second.itemId).getByRole("button", { name: "Update" })]) {
        expect(await control.evaluate((element: HTMLInputElement | HTMLButtonElement) => element.form?.id)).toBe("guest-cart-form");
      }

      expect((await rowFor(first.itemId).getByRole("button", { name: "Update" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);

      // The shopper types 2 on the second line and 4 on the first, then presses only the first line's Update.
      await rowFor(second.itemId).locator("[data-guest-cart-qty]").fill("2");
      await rowFor(first.itemId).locator("[data-guest-cart-qty]").fill("4");
      // With script off, Enter sends the form (a click right after typing races the store's smooth scroll there).
      if (javaScriptEnabled) await rowFor(first.itemId).getByRole("button", { name: "Update" }).click();
      else await rowFor(first.itemId).locator("[data-guest-cart-qty]").press("Enter");
      await expect(shopper.locator("[data-guest-cart-subtotal]")).toHaveText("Subtotal $144.00");
      await expect(rowFor(first.itemId).locator("[data-guest-cart-qty]")).toHaveValue("4");
      await expect(rowFor(second.itemId).locator("[data-guest-cart-qty]")).toHaveValue("2");
      expect((await cookieNamed(shopper, "dk_cart_count"))?.value).toBe("6");
      if (javaScriptEnabled) await expect(rowFor(first.itemId).getByRole("button", { name: "Update" })).toBeFocused();
      else await expect(shopper).toHaveURL(/\/cart$/u);

      // The proof store takes no payments, so its Check out is the disabled one. The cart form's Check out post
      // itself saves a typed 3 and opens checkout; 0 removes a line, as Shopify's updates[] does.
      const checkout = await shopper.request.post("/cart/update", {
        form: { [`updates[${first.itemId}]`]: "3", [`updates[${second.itemId}]`]: "0", checkout: "1" },
        headers: { origin },
        maxRedirects: 0,
      });
      expect(checkout.status()).toBe(303);
      expect(checkout.headers().location).toBe("/checkout");
      const saved = await (await shopper.request.get("/cart.js")).json();
      expect(saved).toMatchObject({ ok: true, cart: { itemCount: 3, lines: [{ catalogItemId: first.itemId, quantity: 3 }] } });

      // A blank or broken quantity refuses the whole form and opens nothing.
      const refused = await shopper.request.post("/cart/update", {
        form: { [`updates[${first.itemId}]`]: "", checkout: "1" },
        headers: { origin },
        maxRedirects: 0,
      });
      expect(refused.headers().location).toBe("/cart?cart_error=INVALID_CART");
      expect((await (await shopper.request.get("/cart.js")).json()).cart.itemCount).toBe(3);
      await shopper.goto("/cart");
      await shopper.screenshot({ path: resolve(root, `cart-one-form-${javaScriptEnabled ? "script" : "script-off"}.png`), fullPage: true, animations: "disabled" });
    } finally { await context.close(); }
  }
});

test("with script the same forms change the cart in place, and agents read it as JSON", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const { itemId, productPath } = await storeWithProduct(browser, testInfo, "script");
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  // A browser that shopped before this change still holds the old browser-only cart and checkout keys. They are
  // never read again (no real store ran that cart): the shopper starts with an empty server cart and nothing breaks.
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem("dinkus.guest-cart.v1")) {
        localStorage.setItem("dinkus.guest-cart.v1", JSON.stringify({ version: 1, lines: [{ id: "old-item", quantity: 3 }] }));
        localStorage.setItem("dinkus.guest-checkout.v1", JSON.stringify({ capability: "old.capability", attemptId: "old-attempt" }));
      }
    } catch { /* storage blocked */ }
  });
  const shopper = await context.newPage();
  const errors: string[] = [];
  shopper.on("pageerror", (error) => errors.push(error.message));
  await shopper.goto("/cart");
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeVisible();
  await expect(shopper.locator("[data-guest-cart-line]")).toHaveCount(0);
  await shopper.goto(productPath);
  const card = shopper.locator("[data-product-page]");
  await card.locator("[data-add-to-cart-qty-increase]").click();
  await expect(card.locator("[data-add-to-cart-qty]")).toHaveValue("2");
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(card.locator("[data-add-to-cart-status]")).toHaveText("Added to your cart.");
  await expect(shopper).toHaveURL(new RegExp(`${productPath}$`, "u"));
  await expect(shopper.locator("[data-store-header] [data-guest-cart-count]")).toHaveText("2");
  await shopper.screenshot({ path: resolve(root, "product-added-script-on.png"), fullPage: true, animations: "disabled" });

  const cart = await shopper.evaluate(async () => (await fetch("/cart.js", { headers: { accept: "application/json" } })).json());
  expect(cart).toMatchObject({ ok: true, cart: { itemCount: 2, lines: [{ catalogItemId: itemId, quantity: 2 }] } });
  expect(typeof cart.cart.version).toBe("string");

  // An agent quoting an old version changes nothing.
  const stale = await shopper.evaluate(async () => {
    const response = await fetch("/cart/update.js", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: "stale", lines: [] }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(stale).toMatchObject({ status: 409, body: { ok: false, error: { code: "CONTENTION" }, cart: { itemCount: 2 } } });

  // The browser agent tools work on the same cart.
  const viaAgent = await shopper.evaluate(async (id) => {
    const actions = (window as unknown as { Dinkus: { actions: {
      getCart(): Promise<{ ok: boolean; version: string | null }>;
      updateCart(input: { version: string | null; lines: { id: string; quantity: number }[] }): Promise<{ ok: boolean; cart?: { itemCount: number } }>;
    } } }).Dinkus.actions;
    const read = await actions.getCart();
    return actions.updateCart({ version: read.version, lines: [{ id, quantity: 4 }] });
  }, itemId);
  expect(viaAgent).toMatchObject({ ok: true, cart: { itemCount: 4 } });
  await expect(shopper.locator("[data-store-header] [data-guest-cart-count]")).toHaveText("4");

  // show_variant opens the product's published page, found from its Commerce id.
  const shown = await shopper.evaluate(async (id) => {
    const actions = (window as unknown as { Dinkus: { actions: {
      showVariant(input: { productId: string }): Promise<{ ok: boolean; url?: string }>;
    } } }).Dinkus.actions;
    return actions.showVariant({ productId: id });
  }, itemId);
  expect(shown).toEqual({ ok: true, url: productPath });
  await expect(shopper).toHaveURL(new RegExp(`${productPath}$`, "u"));
  const missing = await shopper.request.get("/variants/no_such_item", { headers: { accept: "application/json" } });
  expect(missing.status()).toBe(404);

  await shopper.goto("/cart");
  const line = shopper.locator(`[data-guest-cart-line="${itemId}"]`);
  await expect(line.locator("[data-guest-cart-qty]")).toHaveValue("4");
  await line.locator("[data-guest-cart-qty]").fill("");
  await line.getByRole("button", { name: "Update" }).click();
  await expect(shopper.locator("[data-store-header] [data-guest-cart-count]")).toHaveText("4");
  expect((await (await shopper.request.get("/cart.js")).json()).cart.itemCount).toBe(4);
  await line.locator("[data-guest-cart-qty]").fill("1");
  await line.getByRole("button", { name: "Update" }).click();
  await expect(shopper.locator(`[data-guest-cart-line="${itemId}"] [data-guest-cart-line-total]`)).toHaveText("Line total $24.00");
  await expect(shopper).toHaveURL(/\/cart$/u);
  await expect(shopper.locator("[data-store-header] [data-guest-cart-count]")).toHaveText("1");
  await shopper.screenshot({ path: resolve(root, "cart-updated-script-on.png"), fullPage: true, animations: "disabled" });
  expect(errors).toEqual([]);
  await context.close();
});

test("returning to the cart draws changes saved in another tab", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { itemId } = await storeWithProduct(browser, testInfo, "tab-return", false);
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  try {
    const first = await context.newPage();
    await openFocusCart(first, testInfo, [itemId]);
    const quantity = first.locator(`[data-guest-cart-line="${itemId}"] [data-guest-cart-qty]`);
    const subtotal = first.locator("[data-guest-cart-subtotal-amount]");
    await expect(quantity).toHaveValue("1");
    await expect(subtotal).toHaveText("$24.00");

    const second = await context.newPage();
    await openFocusCart(second, testInfo, []);
    await second.locator("[data-guest-cart-qty]").fill("3");
    await second.getByRole("button", { name: "Update", exact: true }).click();
    await expect(second.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$72.00");
    const { cart } = await (await second.request.get("/cart.js")).json();
    expect(cart).toMatchObject({ itemCount: 3, lines: [{ catalogItemId: itemId, quantity: 3 }] });

    await first.bringToFront();
    // Playwright emulates focus on every page, so a tab switch need not emit visibilitychange.
    await first.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(first.locator("[data-guest-cart-line]")).toHaveCount(cart.lines.length);
    await expect(quantity).toHaveValue(String(cart.lines[0].quantity));
    // /cart.js returns quantities, not money. The fixture's Commerce price is $24 per unit.
    await expect(subtotal).toHaveText(`$${(24 * cart.lines[0].quantity).toFixed(2)}`);
  } finally { await context.close(); }
});

for (const firstResponse of ["return", "agent"] as const) {
  test(`a WebMCP redraw wins when the ${firstResponse} response arrives first`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const { itemId } = await storeWithProduct(browser, testInfo, `return-webmcp-${firstResponse}`, false);
    const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
    const arrivals = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const releases = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    try {
      const shopper = await context.newPage();
      await openFocusCart(shopper, testInfo, [itemId]);
      const quantity = shopper.locator("[data-guest-cart-qty]");
      const subtotal = shopper.locator("[data-guest-cart-subtotal-amount]");
      await expect(quantity).toHaveValue("1");
      await expect(subtotal).toHaveText("$24.00");

      const updated = await context.request.post("/cart/update", {
        form: { [`updates[${itemId}]`]: "3" },
        headers: { origin: new URL(testInfo.project.use.baseURL!).origin },
      });
      expect(updated.ok()).toBe(true);

      await shopper.evaluate(() => {
        // Signal one task after the real body is read, so the first redraw has finished before releasing the second.
        const fetchCart = window.fetch;
        let reads = 0;
        window.fetch = async (input, init) => {
          const response = await fetchCart(input, init);
          if (input === "/cart") {
            const text = response.text.bind(response);
            response.text = async () => {
              const html = await text();
              setTimeout(() => { document.documentElement.dataset.cartReads = String(++reads); }, 0);
              return html;
            };
          }
          return response;
        };
      });
      let requests = 0;
      await shopper.route("**/cart", async (route) => {
        const index = requests++;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        arrivals[index].resolve();
        await releases[index].promise;
        await route.fulfill({ response });
      });
      await shopper.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await arrivals[0].promise;
      const agent = await shopper.evaluate(async (id) => {
        const { Dinkus } = window as unknown as { Dinkus: { actions: DinkusStorefrontActions } };
        const before = await Dinkus.actions.getCart();
        if (!before.ok || before.itemCount !== 3) throw new Error("The return refresh must have been drawn from three saved items");
        return Dinkus.actions.updateCart({ version: before.version, lines: [{ id, quantity: 5 }] });
      }, itemId);
      expect(agent).toMatchObject({ ok: true, cart: { itemCount: 5, subtotalMinor: 12000 } });
      await arrivals[1].promise;

      const order = firstResponse === "return" ? [0, 1] : [1, 0];
      for (const [step, index] of order.entries()) {
        releases[index].resolve();
        await expect(shopper.locator("html")).toHaveAttribute("data-cart-reads", String(step + 1));
      }

      const wire = await (await shopper.request.get("/cart.js")).json();
      expect(wire).toMatchObject({ ok: true, cart: { itemCount: 5, lines: [{ catalogItemId: itemId, quantity: 5 }] } });
      await expect(shopper.locator("[data-store-header] [data-guest-cart-count]")).toHaveText("5");
      await expect(quantity).toHaveValue("5");
      await expect(subtotal).toHaveText("$120.00");
    } finally {
      for (const release of releases) release.resolve();
      await context.close();
    }
  });
}

test("a second cart change is ignored until the saved cart is drawn", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const first = await storeWithProduct(browser, testInfo, "lock-first", false);
  const second = await storeWithProduct(browser, testInfo, "lock-second", false);
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let changesSent = 0;
  try {
    const shopper = await context.newPage();
    for (const { itemId } of [first, second]) {
      const added = await context.request.post("/cart/add", {
        form: { id: itemId, quantity: "1" },
        headers: { origin: new URL(testInfo.project.use.baseURL!).origin, accept: "text/html" },
      });
      expect(added.ok()).toBe(true);
    }
    await shopper.goto("/cart");
    await shopper.waitForFunction(() => (window as unknown as Record<symbol, boolean>)[Symbol.for("dinkuskit.server-cart.bound")]);
    await context.route("**/cart/update", async (route) => {
      changesSent += 1;
      if (changesSent > 1) return route.continue();
      await held;
      return route.continue();
    });
    const section = shopper.locator("[data-server-cart]");
    const rowFor = (id: string) => section.locator(`[data-guest-cart-line="${id}"]`);
    const quantity = rowFor(first.itemId).locator("[data-guest-cart-qty]");
    const update = rowFor(first.itemId).getByRole("button", { name: "Update" });
    const remove = rowFor(second.itemId).getByRole("button", { name: `Remove ${second.name}` });
    const target = await quantity.boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(target?.width).toBeGreaterThanOrEqual(44);

    await quantity.fill("3");
    await update.click();
    await expect.poll(() => changesSent).toBe(1);
    await expect(section).toHaveAttribute("aria-busy", "true");
    for (const control of await section.locator("[data-guest-cart-qty], [data-guest-cart-update], [data-guest-cart-remove]").all()) {
      await expect(control).toBeDisabled();
    }
    // Native controls prevent activation. An explicit submit also must not slip through the lock.
    const ignored = await remove.evaluate((button: HTMLButtonElement) =>
      !button.form!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })),
    );
    expect(ignored).toBe(true);
    release();

    await expect(section).not.toHaveAttribute("aria-busy", "true");
    await expect(update).toBeEnabled();
    await expect(remove).toBeEnabled();
    await expect(section.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$96.00");
    const saved = await (await shopper.request.get("/cart.js")).json();
    expect(saved).toMatchObject({ ok: true, cart: { itemCount: 4 } });
    expect(saved.cart.lines).toHaveLength(2);
    expect(saved.cart.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ catalogItemId: first.itemId, quantity: 3 }),
      expect.objectContaining({ catalogItemId: second.itemId, quantity: 1 }),
    ]));
    await expect(section.locator("[data-guest-cart-line]")).toHaveCount(saved.cart.lines.length);
    await expect(shopper.locator("[data-guest-cart-count]").first()).toHaveText(String(saved.cart.itemCount));
    for (const line of saved.cart.lines) {
      await expect(rowFor(line.catalogItemId).locator("[data-guest-cart-qty]")).toHaveValue(String(line.quantity));
    }
    expect(changesSent).toBe(1);
  } finally {
    release();
    await context.close();
  }
});

test("a WebMCP change redraws the cart after a held shopper save", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { itemId } = await storeWithProduct(browser, testInfo, "lock-webmcp", false);
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const held = Promise.withResolvers<void>();
  const saved = Promise.withResolvers<void>();
  try {
    const added = await context.request.post("/cart/add", {
      form: { id: itemId, quantity: "1" },
      headers: { origin: new URL(testInfo.project.use.baseURL!).origin, accept: "text/html" },
    });
    expect(added.ok()).toBe(true);
    const shopper = await context.newPage();
    await shopper.goto("/cart");
    await shopper.waitForFunction(() => "Dinkus" in window);
    const section = shopper.locator("[data-server-cart]");
    const quantity = section.locator("[data-guest-cart-qty]");
    const subtotal = section.locator("[data-guest-cart-subtotal-amount]");
    await shopper.route("**/cart/update", async (route) => {
      // Commerce has saved 3 and the server has drawn that cart, but the browser has neither result yet.
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      saved.resolve();
      await held.promise;
      await route.fulfill({ response });
    });
    await quantity.fill("3");
    await section.getByRole("button", { name: "Update" }).click();
    await saved.promise;
    await expect(section).toHaveAttribute("aria-busy", "true");

    const agent = await shopper.evaluate(async (id) => {
      const { Dinkus } = window as unknown as { Dinkus: { actions: DinkusStorefrontActions } };
      const before = await Dinkus.actions.getCart();
      if (!before.ok || before.itemCount !== 3) throw new Error("The agent must see the saved shopper update first");
      return Dinkus.actions.updateCart({ version: before.version, lines: [{ id, quantity: 5 }] });
    }, itemId);
    expect(agent).toMatchObject({ ok: true, cart: { itemCount: 5, subtotalMinor: 12000 } });
    await expect(quantity).toBeDisabled();
    held.resolve();

    const wire = await (await context.request.get("/cart.js")).json();
    expect(wire).toMatchObject({ ok: true, cart: { itemCount: 5, lines: [{ catalogItemId: itemId, quantity: 5 }] } });
    await expect(quantity).toBeEnabled();
    await expect(quantity).toHaveValue(String(wire.cart.lines[0].quantity));
    await expect(subtotal).toHaveText("$120.00");
    await expect(shopper.locator("[data-guest-cart-count]").first()).toHaveText(String(wire.cart.itemCount));
  } finally {
    held.resolve();
    await context.close();
  }
});

test("the thank-you page trusts only the order behind the cart cookie", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const { productPath } = await storeWithProduct(browser, testInfo, "return");
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport, javaScriptEnabled: false });
  const shopper = await context.newPage();

  // No cart cookie: no order is claimed, whatever the URL says.
  await shopper.goto("/checkout/success?session_id=cs_test_forged");
  await expect(shopper.locator("[data-guest-checkout-return]")).toHaveAttribute("data-guest-checkout-return-state", "no-cart");
  await expect(shopper.locator("[data-guest-checkout-order]")).toHaveCount(0);
  await expect(shopper.locator("#guest-checkout-return-title")).toHaveText("Thank you");
  await shopper.screenshot({ path: resolve(root, "thank-you-no-cart.png"), fullPage: true, animations: "disabled" });

  // A cart that was never paid goes back to the cart with its items.
  await shopper.goto(productPath);
  await shopper.locator("[data-product-page]").getByRole("button", { name: "Add to cart", exact: true }).click();
  await shopper.goto("/checkout/success?session_id=cs_test_forged");
  await expect(shopper).toHaveURL(/\/cart\?cart_error=NOT_PAID$/u);
  await expect(shopper.locator("[data-guest-cart-status][role=alert]")).toHaveText("Your payment was not completed. Your items are still in your cart.");
  await expect(shopper.locator("[data-guest-cart-line]")).toHaveCount(1);
  await shopper.screenshot({ path: resolve(root, "cart-not-paid.png"), fullPage: true, animations: "disabled" });
  await context.close();
});
