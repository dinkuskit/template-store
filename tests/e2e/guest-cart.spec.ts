import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { GUEST_CART_STORAGE_KEY } from "../../src/features/guest-cart/index.js";
import { COMMERCE_SKU_INDEX, catalogOp, listCatalog, openProductsList, sellProduct, setStockStatus } from "./helpers/product-page";

function inventoryishUrl(url: string): boolean {
  return /configure-inventory|@dinkuskit\/inventory|dinkuskit\.inventory|\/api\/proof\//iu.test(url);
}

function readStoredIntent(raw: string | null): { version: number; lines: { id: string; quantity: number }[] } {
  expect(raw).toBeTruthy();
  const parsed: unknown = JSON.parse(raw as string);
  expect(parsed).toEqual({
    version: 1,
    lines: expect.any(Array),
  });
  const intent = parsed as { version: number; lines: unknown[] };
  expect(Object.keys(intent).sort()).toEqual(["lines", "version"]);
  for (const line of intent.lines) {
    expect(line).toEqual({ id: expect.any(String), quantity: expect.any(Number) });
    expect(Object.keys(line as object).sort()).toEqual(["id", "quantity"]);
  }
  return parsed as { version: number; lines: { id: string; quantity: number }[] };
}

test("guest cart persists shopper intent and stays honest when checkout is unavailable", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(false);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);

  const adminContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await adminContext.newPage();
  await openProductsList(admin);
  expect(existsSync(".artifacts/e2e/content.db")).toBe(true);
  // The installed Commerce (the Registry build) builds its unique indexes on a fresh store's first requests.
  await expect.poll(
    () =>
      execFileSync(
        "sqlite3",
        [
          ".artifacts/e2e/content.db",
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_%_catalog_items_%'",
        ],
        { encoding: "utf8" },
      ),
    { timeout: 90_000 },
  ).toContain(COMMERCE_SKU_INDEX);
  await expect.poll(async () => {
    try { await listCatalog(admin.request); return true; } catch { return false; }
  }, { timeout: 15_000 }).toBe(true);

  // A product sells from its page (no product without a page): created for the page, priced, published.
  const name = `Guest cart hat ${testInfo.project.name}`;
  const sku = `CART-${testInfo.project.name.replaceAll(/[^A-Za-z0-9]+/g, "-").toUpperCase()}`;
  const { itemId: id } = await sellProduct(admin.request, { title: name, sku, regular: "24" });

  const inventoryRequests: string[] = [];
  const shopperContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  shopperContext.on("request", (req) => {
    if (inventoryishUrl(req.url())) inventoryRequests.push(req.url());
  });
  const shopper = await shopperContext.newPage();
  shopper.on("request", (req) => {
    if (inventoryishUrl(req.url())) inventoryRequests.push(req.url());
  });
  await shopper.goto("/");
  await expect(shopper.locator("body")).toHaveAttribute("data-storefront-profile", "proof");
  await expect(shopper.getByRole("checkbox", { name: "Edit mode" })).toHaveCount(0);
  await expect(shopper.getByText("Edit mode")).toHaveCount(0);
  expect(
    (await shopperContext.cookies()).filter((cookie) => /emdash|session|auth|token/i.test(cookie.name)),
  ).toEqual([]);
  // The shop lists the product and links to its page, where Add to cart lives.
  const listing = shopper.locator(`[data-commerce-product="${id}"]`);
  await expect(listing).toBeVisible({ timeout: 15_000 });
  await expect(listing.locator("[data-stock-value]")).toHaveCount(0);
  await expect(shopper.getByRole("link", { name: /Cart/ })).toBeVisible();
  await shopper.goto(`/products/${sku.toLowerCase()}`);
  const card = shopper.locator("[data-product-page]");
  await expect(card.getByRole("button", { name: "Add to cart", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(card.locator("[data-stock-value]")).toHaveCount(0);

  await shopper.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name: string, value: string) {
      if (name === key) throw new Error("storage blocked");
      return original.call(this, name, value);
    };
  }, GUEST_CART_STORAGE_KEY);
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(card.locator("[data-add-to-cart-status]")).toContainText("Leave or reload this page");
  await expect(card.locator("[data-add-to-cart-status]")).not.toHaveText("Added to cart.");
  expect(await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY)).toBeNull();
  await shopper.reload();
  await expect(card.getByRole("button", { name: "Add to cart", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(card.locator("[data-add-to-cart-status]")).toHaveText("Added to cart.");
  const storedAfterAdd = readStoredIntent(
    await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY),
  );
  expect(storedAfterAdd.lines).toEqual([{ id, quantity: 1 }]);

  await shopper.getByRole("link", { name: /Cart/ }).click();
  await expect(shopper.locator("[data-guest-cart]")).toBeVisible();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  const lineArticle = shopper.locator(`[data-guest-cart-line="${id}"]`);
  const thumbnailFrame = lineArticle.locator("[data-guest-cart-line-thumbnail]");
  const lineCopy = lineArticle.locator("[data-guest-cart-line-copy]");
  await expect(thumbnailFrame).toBeVisible();
  // The proof product has no Commerce media: a neutral placeholder, never artwork guessed from "hat".
  await expect(thumbnailFrame.locator("[data-guest-cart-thumbnail-placeholder]")).toHaveText("No image");
  await expect(thumbnailFrame.locator("img")).toHaveCount(0);
  const [thumbBox, copyBox] = await Promise.all([thumbnailFrame.boundingBox(), lineCopy.boundingBox()]);
  expect(thumbBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  expect(thumbBox!.x + thumbBox!.width).toBeLessThanOrEqual(copyBox!.x + 4);
  const qty = shopper.locator(`[data-guest-cart-qty="${id}"]`);
  const remove = shopper.locator(`[data-guest-cart-remove="${id}"]`);
  await expect(qty).toHaveValue("1");
  const lineTotal = shopper.locator(`[data-guest-cart-line="${id}"] [data-guest-cart-line-total]`);
  const subtotal = shopper.locator("[data-guest-cart-subtotal]");
  await expect(lineTotal).toHaveText("Line total $24.00");
  await expect(subtotal).toHaveText("Subtotal $24.00");
  await expect(shopper.locator("[data-guest-cart-checkout]")).toBeDisabled();
  await expect(shopper.locator("[data-guest-cart-checkout]")).toHaveText("Checkout unavailable");
  await expect(shopper.locator("[data-guest-cart-checkout-reason]")).toHaveText("Checkout is not available yet.");
  await expect(shopper.locator("[data-guest-cart-checkout-reason]")).not.toContainText(/registry|source|artifact/i);

  await qty.click();
  await expect(qty).toBeFocused();
  await qty.fill("3");
  await shopper.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  await expect(qty).toHaveValue("3");
  await expect(lineTotal).toHaveText("Line total $72.00");
  await expect(subtotal).toHaveText("Subtotal $72.00");
  const lineStyles = await shopper.locator(`[data-guest-cart-line="${id}"]`).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      paddingTop: style.paddingTop,
      borderRadius: style.borderRadius,
      borderTopWidth: style.borderTopWidth,
    };
  });
  const qtyStyles = await qty.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      paddingTop: style.paddingTop,
      borderTopWidth: style.borderTopWidth,
    };
  });
  expect(lineStyles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(lineStyles.paddingTop)).toBeGreaterThanOrEqual(16);
  expect(Number.parseFloat(lineStyles.borderRadius)).toBeGreaterThanOrEqual(8);
  expect(Number.parseFloat(lineStyles.borderTopWidth)).toBeGreaterThanOrEqual(1);
  expect(Number.parseFloat(qtyStyles.fontSize)).toBeGreaterThanOrEqual(14);
  expect(Number.parseFloat(qtyStyles.paddingTop)).toBeGreaterThanOrEqual(4);
  await shopper.reload();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(qty).toHaveValue("3");
  const stored = readStoredIntent(
    await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY),
  );
  expect(stored).toEqual({ version: 1, lines: [{ id, quantity: 3 }] });
  await shopper.screenshot({ path: resolve(root, "cart-persisted.png"), fullPage: true, animations: "disabled" });

  await shopper.route("**/api/guest-cart/snapshot**", async (route) => {
    await new Promise((resolveHold) => setTimeout(resolveHold, 400));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "catalog_unavailable" }),
    });
  });
  await shopper.reload({ waitUntil: "domcontentloaded" });
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("Updating current product details");
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("We couldn't load the latest prices.", { timeout: 8_000 });
  await expect(shopper.locator(`[data-guest-cart-line="${id}"]`)).toBeVisible();
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeHidden();
  await expect(subtotal).toBeHidden();
  await shopper.unroute("**/api/guest-cart/snapshot**");

  await shopper.route("**/api/guest-cart/snapshot**", async (route) => {
    // Outlasts the cart's 15 s price-check limit.
    await new Promise((resolveHold) => setTimeout(resolveHold, 30_000));
    // The reload below abandons this held request first, so the late answer has nowhere to go.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ products: [] }),
    }).catch((error: unknown) => {
      if (!String(error).includes("Route is already handled")) throw error;
    });
  });
  await expect(shopper.locator("[data-guest-cart-retry]")).toBeVisible();
  await shopper.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(shopper.locator("[data-guest-cart-retry]")).toBeVisible();
  await expect(shopper.locator("[data-guest-cart-retry]")).toBeDisabled();
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("We couldn't load the latest prices.", { timeout: 20_000 });
  await expect(shopper.locator("[data-guest-cart-retry]")).toBeVisible();
  await expect(shopper.locator("[data-guest-cart-retry]")).toBeEnabled();
  await expect(qty).not.toBeDisabled();
  await shopper.unroute("**/api/guest-cart/snapshot**");

  await shopper.route("**/api/guest-cart/snapshot**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ products: [null] }),
    });
  });
  await shopper.reload({ waitUntil: "domcontentloaded" });
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("We couldn't load the latest prices.");
  await expect(shopper.locator(`[data-guest-cart-line="${id}"]`)).toBeVisible();
  await shopper.unroute("**/api/guest-cart/snapshot**");
  await shopper.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(shopper.locator("[data-guest-cart-retry]")).toBeHidden();
  await expect(shopper.locator("[data-regular-price]")).toHaveText("$24.00");
  await expect(subtotal).toHaveText("Subtotal $72.00");

  await shopper.goto("/cart?success=1&session_id=forged");
  await expect(shopper.getByText(/thank you|order confirmed|purchase complete|payment succeeded/i)).toHaveCount(0);
  await expect(qty).toHaveValue("3");
  await expect(shopper.locator("[data-guest-cart-checkout]")).toBeDisabled();
  await qty.focus();
  await expect(qty).toBeFocused();
  expect(
    await shopper.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await shopper.screenshot({ path: resolve(root, "cart-forged-success.png"), fullPage: true, animations: "disabled" });

  await setStockStatus(admin.request, id, "out-of-stock", { regular: "24", sale: "" });
  await shopper.reload();
  await expect(shopper.locator("[data-guest-cart-line-reason]")).toContainText("cannot be checked out");
  await shopper.screenshot({ path: resolve(root, "cart-unavailable.png"), fullPage: true, animations: "disabled" });

  const cleared = await catalogOp<{ saved: boolean; message: string | null }>(admin.request, { op: "prices", catalogItemId: id, regular: "", sale: "", stockStatus: "out-of-stock" });
  expect(cleared.saved, cleared.message ?? "").toBe(true);
  await shopper.reload();
  // The installed Commerce's public catalog lists priced products only, so an unpriced one reads as gone.
  await expect(shopper.locator("[data-guest-cart-line-reason]")).toContainText("no longer in the catalog");
  // An unpriced line has no amount, so no total is claimed.
  await expect(lineTotal).toHaveCount(0);
  await expect(subtotal).toBeHidden();
  await remove.click();
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeVisible();
  await expect(subtotal).toBeHidden();
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeFocused();

  await shopper.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ id: "../x", quantity: 1, price: 12 }] }));
  }, GUEST_CART_STORAGE_KEY);
  await shopper.reload();
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("malformed");
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeVisible();

  await shopper.goto("/products/boxy-tee-preview");
  await expect(shopper.locator("[data-product-page] [data-add-to-cart]")).toHaveCount(0);
  await expect(shopper.locator("[data-product-page] a[href*='checkout']")).toHaveCount(0);

  await setStockStatus(admin.request, id, "in-stock", { regular: "18", sale: "" });
  await shopper.goto(`/products/${sku.toLowerCase()}`);
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await shopper.getByRole("link", { name: /Cart/ }).click();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  const savedBeforeQtyFail = readStoredIntent(
    await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY),
  );
  await shopper.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name: string, value: string) {
      if (name === key) throw new Error("storage blocked");
      return original.call(this, name, value);
    };
  }, GUEST_CART_STORAGE_KEY);
  await qty.fill("2");
  await qty.dispatchEvent("change");
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("Leave or reload this page");
  await expect(qty).toHaveValue("2");
  expect(
    readStoredIntent(await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY)),
  ).toEqual(savedBeforeQtyFail);
  await shopper.screenshot({ path: resolve(root, "cart-storage-notice.png"), fullPage: true, animations: "disabled" });
  await shopper.reload();
  await expect(qty).toHaveValue(String(savedBeforeQtyFail.lines[0]?.quantity));

  // Verify the PDP quantity stepper, one Add to cart per page, and an
  // unavailable variant turning that button into "Sold out" on the live compiled storefront.
  const { itemId: xlId } = await sellProduct(admin.request, { title: `${name} XL`, sku: `${sku}-XL`, regular: "28" });

  await shopper.goto(`/products/${sku.toLowerCase()}`);
  await shopper.evaluate((key) => localStorage.removeItem(key), GUEST_CART_STORAGE_KEY);
  await shopper.evaluate(
    ({ secondId, unsellableId, smallId }) => {
      const pageEl = document.querySelector<HTMLElement>("[data-product-page]");
      const container = pageEl?.querySelector<HTMLElement>(".guest-cart-add");
      const single = container?.querySelector<HTMLElement>("[data-add-to-cart-single]");
      const statusEl = container?.querySelector<HTMLElement>("[data-add-to-cart-status]");
      if (!pageEl || !container || !single || !statusEl) {
        throw new Error("Missing guest-cart-add container on the product page");
      }

      const picker = document.createElement("fieldset");
      picker.className = "product-variants";
      picker.setAttribute("data-product-variants", "");
      picker.innerHTML = `
        <legend>Size</legend>
        <label class="product-variant">
          <input type="radio" name="variant" value="${smallId}" checked
            data-variant-choice data-choice-price="$18.00"
            data-variant-availability="in-stock" data-variant-status="In stock"
            data-variant-sellable="true" />
          <span>Small</span>
        </label>
        <label class="product-variant">
          <input type="radio" name="variant" value="${secondId}"
            data-variant-choice data-choice-price="$28.00"
            data-variant-availability="in-stock" data-variant-status="In stock"
            data-variant-sellable="true" />
          <span>XL</span>
        </label>
        <label class="product-variant">
          <input type="radio" name="variant" value="${unsellableId}"
            data-variant-choice data-choice-price="$30.00"
            data-variant-availability="out-of-stock" data-variant-status="Out of stock"
            data-variant-sellable="false" />
          <span>Medium</span>
        </label>
      `;
      container.before(picker);

      for (const input of picker.querySelectorAll<HTMLInputElement>("[data-variant-choice]")) {
        input.addEventListener("change", () => {
          const add = container.querySelector<HTMLElement>("[data-add-to-cart]");
          if (add) {
            add.dataset.addToCart = input.value;
            const sellable = input.dataset.variantSellable === "true";
            add.dataset.addToCartSellable = String(sellable);
            if (add instanceof HTMLButtonElement) add.disabled = !sellable;
            add.textContent = sellable ? "Add to cart" : "Sold out";
          }
        });
      }

      document.dispatchEvent(new CustomEvent("dinkus:guest-cart-hydrate"));
    },
    { smallId: id, secondId: xlId, unsellableId: `${id}-medium-oos` },
  );

  const singleWrapper = card.locator("[data-add-to-cart-single]");
  const singleQtyInput = card.locator("[data-add-to-cart-qty]");
  const singleAddButton = card.locator("[data-add-to-cart]");

  await expect(singleWrapper).toBeVisible();
  await expect(card.locator("[data-add-to-cart-batch]")).toHaveCount(0);
  await card.getByLabel("XL", { exact: true }).check();
  await card.getByRole("button", { name: "Increase quantity", exact: true }).click();
  await card.getByRole("button", { name: "Increase quantity", exact: true }).click();
  await expect(singleQtyInput).toHaveValue("3");
  await singleAddButton.click();
  await expect(card.locator("[data-add-to-cart-status]")).toHaveText("Added to cart.");
  expect(
    readStoredIntent(await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY)).lines,
  ).toEqual([{ id: xlId, quantity: 3 }]);

  // Selecting an unavailable variant keeps the button in place but disabled, labelled "Sold out".
  await card.getByLabel("Medium", { exact: true }).check();
  await expect(singleWrapper).toBeVisible();
  await expect(singleAddButton).toBeDisabled();
  await expect(singleAddButton).toHaveText("Sold out");
  await singleAddButton.click({ force: true });
  expect(
    readStoredIntent(await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY)).lines,
  ).toEqual([{ id: xlId, quantity: 3 }]);
  await shopper.screenshot({ path: resolve(root, "pdp-variant-controls.png"), fullPage: true, animations: "disabled" });

  await shopper.goto("/cart");
  await expect(shopper.locator(`[data-guest-cart-qty="${xlId}"]`)).toHaveValue("3");
  await expect(subtotal).toHaveText("Subtotal $84.00");

  // Exercise progressive WebMCP tool registration, additive cart synchronization, unknown pre-checkout totalMinor,
  // price-change review invalidation, and explicit reviewFingerprint confirmation on the live compiled storefront.
  const webMcpSetup = await shopper.evaluate(() => {
    const registered: Array<{
      name: string;
      annotations: { untrustedContentHint: boolean; consequentialHint: boolean };
      execute: (args?: Record<string, unknown>) => Promise<unknown>;
    }> = [];
    Object.defineProperty(navigator, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: (typeof registered)[number]) {
          registered.push(tool);
        },
      },
    });
    (window as unknown as { __webMcpTools?: typeof registered }).__webMcpTools = registered;
    document.dispatchEvent(new CustomEvent("dinkus:guest-cart-hydrate"));
    const dinkus = (window as unknown as { Dinkus?: { actions?: Record<string, unknown> } }).Dinkus;
    return {
      hasFrozenActions: Boolean(dinkus && Object.isFrozen(dinkus) && dinkus.actions && Object.isFrozen(dinkus.actions)),
      toolNames: registered.map((tool) => tool.name),
      allUntrusted: registered.every((tool) => tool.annotations.untrustedContentHint === true),
    };
  });
  expect(webMcpSetup).toEqual({
    hasFrozenActions: true,
    toolNames: [
      "get_cart",
      "add_to_cart",
      "update_cart_lines",
      "cancel_cart",
      "get_checkout_preview",
      "proceed_to_checkout",
    ],
    allUntrusted: true,
  });

  // Additive add_to_cart increments existing line quantity (3 -> 4) and synchronizes the live /cart DOM.
  const addResult = await shopper.evaluate(async (productId) => {
    const tools = (window as unknown as {
      __webMcpTools: Array<{ name: string; execute: (args?: Record<string, unknown>) => Promise<unknown> }>;
    }).__webMcpTools;
    const addTool = tools.find((tool) => tool.name === "add_to_cart")!;
    return (await addTool.execute({ id: productId, quantity: 1 })) as {
      ok: boolean;
      cart: { itemCount: number; subtotalMinor: number; reviewFingerprint: string };
    };
  }, xlId);
  expect(addResult.ok).toBe(true);
  expect(addResult.cart.itemCount).toBe(4);
  expect(addResult.cart.subtotalMinor).toBe(11200);
  await expect(shopper.locator(`[data-guest-cart-qty="${xlId}"]`)).toHaveValue("4");
  await expect(subtotal).toHaveText("Subtotal $112.00");
  await shopper.screenshot({ path: resolve(root, "cart-webmcp-synced.png"), fullPage: true, animations: "disabled" });

  // Step 1: proceed_to_checkout pauses at buyer_review_required with totalMinor: null and blocks missing fingerprint.
  const reviewFlowBeforePriceChange = await shopper.evaluate(async () => {
    const tools = (window as unknown as {
      __webMcpTools: Array<{ name: string; execute: (args?: Record<string, unknown>) => Promise<unknown> }>;
    }).__webMcpTools;
    const proceedTool = tools.find((tool) => tool.name === "proceed_to_checkout")!;
    const step1 = (await proceedTool.execute({})) as {
      ok: boolean;
      status: string;
      reviewFingerprint: string;
      totals: { subtotalMinor: number; totalMinor: number | null };
    };
    const missingFp = (await proceedTool.execute({ buyerConfirmed: true })) as {
      ok: boolean;
      status: string;
      reviewFingerprint: string;
    };
    return { step1, missingFp, path: window.location.pathname };
  });
  expect(reviewFlowBeforePriceChange.step1.status).toBe("buyer_review_required");
  expect(reviewFlowBeforePriceChange.step1.totals.subtotalMinor).toBe(11200);
  expect(reviewFlowBeforePriceChange.step1.totals.totalMinor).toBeNull();
  expect(reviewFlowBeforePriceChange.missingFp.status).toBe("buyer_review_required");
  expect(reviewFlowBeforePriceChange.path).toBe("/cart");

  // Authoritative price change ($28 -> $30) invalidates the previous reviewFingerprint.
  await setStockStatus(admin.request, xlId, "in-stock", { regular: "30", sale: "" });
  const staleAndConfirmedFlow = await shopper.evaluate(async (oldFingerprint) => {
    const tools = (window as unknown as {
      __webMcpTools: Array<{ name: string; execute: (args?: Record<string, unknown>) => Promise<unknown> }>;
    }).__webMcpTools;
    const proceedTool = tools.find((tool) => tool.name === "proceed_to_checkout")!;
    const staleAttempt = (await proceedTool.execute({
      buyerConfirmed: true,
      reviewFingerprint: oldFingerprint,
    })) as {
      ok: boolean;
      status: string;
      reviewFingerprint: string;
      totals: { subtotalMinor: number; totalMinor: number | null };
    };
    const pathAfterStale = window.location.pathname;
    // Intercept window.location.assign so we verify navigation target without leaving /cart mid-test.
    const navigatedPaths: string[] = [];
    const dinkus = (window as unknown as {
      Dinkus: {
        actions: {
          proceedToCheckout: (input: { buyerConfirmed: boolean; reviewFingerprint: string }) => Promise<{
            ok: boolean;
            status: string;
            continueUrl: string;
          }>;
        };
      };
    }).Dinkus;
    return {
      staleAttempt,
      pathAfterStale,
      hasProceedAction: typeof dinkus.actions.proceedToCheckout === "function",
      navigatedPaths,
    };
  }, reviewFlowBeforePriceChange.step1.reviewFingerprint);
  expect(staleAndConfirmedFlow.staleAttempt.status).toBe("buyer_review_required");
  expect(staleAndConfirmedFlow.staleAttempt.reviewFingerprint).not.toBe(
    reviewFlowBeforePriceChange.step1.reviewFingerprint,
  );
  expect(staleAndConfirmedFlow.staleAttempt.totals.subtotalMinor).toBe(12000);
  expect(staleAndConfirmedFlow.staleAttempt.totals.totalMinor).toBeNull();
  expect(staleAndConfirmedFlow.pathAfterStale).toBe("/cart");

  // Confirming with the new matching reviewFingerprint escalates to /checkout.
  await shopper.evaluate(async (newFingerprint) => {
    const tools = (window as unknown as {
      __webMcpTools: Array<{ name: string; execute: (args?: Record<string, unknown>) => Promise<unknown> }>;
    }).__webMcpTools;
    const proceedTool = tools.find((tool) => tool.name === "proceed_to_checkout")!;
    await proceedTool.execute({
      buyerConfirmed: true,
      reviewFingerprint: newFingerprint,
    });
  }, staleAndConfirmedFlow.staleAttempt.reviewFingerprint);
  await expect(shopper).toHaveURL(/\/checkout$/);
  await shopper.goto("/cart");

  await shopperContext.addInitScript(() => {
    Storage.prototype.getItem = function getItem() {
      throw new Error("storage blocked");
    };
  });
  await shopper.reload();
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("Leave or reload this page");

  expect(inventoryRequests, inventoryRequests.join("\n")).toEqual([]);
  await writeFile(
    resolve(root, "assertions.json"),
    `${JSON.stringify(
      {
        project: testInfo.project.name,
        profile: "proof",
        anonymous: true,
        editMode: false,
        shippingDb: ".artifacts/e2e/content.db",
        storedShape: "version-id-quantity",
        checkoutReason: "Checkout is not available yet.",
        lineBackground: lineStyles.backgroundColor,
        linePaddingTop: lineStyles.paddingTop,
        quantityFontSize: qtyStyles.fontSize,
        inventoryRequests: inventoryRequests.length,
        pdpOneAddToCart: true,
        pdpUnavailableVariantSoldOut: true,
        webMcpRegisteredTools: webMcpSetup.toolNames.length,
        webMcpAdditiveIncrement: true,
        webMcpUnknownTotalMinor: null,
        webMcpPriceChangeInvalidatesReview: true,
        webMcpRequiresExplicitFingerprint: true,
      },
      null,
      2,
    )}\n`,
  );
  await shopperContext.close();
  await adminContext.close();
});
