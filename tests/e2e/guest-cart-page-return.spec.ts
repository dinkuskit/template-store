import { expect, test } from "@playwright/test";

import { GUEST_CART_STORAGE_KEY, type GuestCartCatalogSnapshot } from "../../src/features/guest-cart/index.js";
import { freshOfflineContext } from "./helpers/offline-checkout";

// Controlled snapshots and page lifecycle events prove presentation only. No
// checkout admission, merchant mutation, live outage or payment is claimed.
const intent = { version: 1, lines: [{ id: "11111111-1111-4111-8111-111111111111", quantity: 2 }] };
const initial: GuestCartCatalogSnapshot = {
  id: intent.lines[0].id, found: true, name: "Public notebook", sku: "NOTEBOOK",
  price: { listable: true, regularText: "$12.00", saleText: null, unitMinor: "1200" },
  availability: { listable: true, sellable: true, status: "in-stock" },
};

for (const path of ["/cart", "/checkout"]) {
  test(`${path} refreshes unchanged intent on page return and preserves unsaved edits`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const baseURL = testInfo.project.use.baseURL as string;
    const context = await freshOfflineContext(browser, baseURL, testInfo.project.use.viewport);
    const unexpected: string[] = [], errors: string[] = [];
    let product = initial, failed = false, snapshots = 0;
    try {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        const apiOrNavigation = url.pathname.startsWith("/api/") || url.pathname.startsWith("/_emdash/api/") || route.request().isNavigationRequest();
        if (url.origin !== new URL(baseURL).origin ||
            (apiOrNavigation && /checkout|payment/i.test(url.pathname) && url.pathname !== "/checkout")) {
          unexpected.push(url.href);
          await route.abort("blockedbyclient");
        } else if (url.pathname === "/api/guest-cart/snapshot") {
          snapshots++;
          await route.fulfill({ status: failed ? 503 : 200, contentType: "application/json",
            body: JSON.stringify(failed ? { error: "catalog_unavailable" } : { products: [product] }) });
        } else await route.continue();
      });
      await page.addInitScript(({ key, intent }) => localStorage.setItem(key, JSON.stringify(intent)), { key: GUEST_CART_STORAGE_KEY, intent });
      const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), GUEST_CART_STORAGE_KEY);
      const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const restore = () => page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await page.goto(path);
      const qty = page.locator("[data-guest-cart-qty]");
      const subtotal = page.locator("[data-guest-cart-subtotal-amount]");
      await expect(qty).toHaveValue("2");
      await expect(subtotal).toHaveText("$24.00");
      const firstCount = snapshots;
      product = { ...initial, price: { listable: true, regularText: "$10.00", saleText: null, unitMinor: "1000" } };
      // Initial pageshow is not a restored page and must not add another read.
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
      expect(snapshots).toBe(firstCount);
      await qty.focus(); await focus();
      await expect(subtotal).toHaveText("$20.00");
      await expect(qty).toBeFocused();
      expect(await stored()).toEqual(intent);

      product = { ...product, availability: { listable: true, sellable: false, status: "out-of-stock" } };
      await restore();
      await expect(page.locator("[data-guest-cart-line-reason]")).toHaveText("Out of stock and cannot be checked out.");
      await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
      expect(await stored()).toEqual(intent);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}-stock-refreshed.png`), fullPage: true });

      failed = true; await focus();
      await expect(page.locator("[data-guest-cart-status]")).toContainText("We couldn't load the latest prices.");
      await expect(page.locator("[data-guest-cart-subtotal]")).toBeHidden();
      await expect(page.locator("[data-guest-cart-checkout]")).toBeDisabled();
      expect(await stored()).toEqual(intent);
      failed = false; product = initial;
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(subtotal).toHaveText("$24.00");
      await expect(page.locator("[data-guest-cart-line-reason]")).toHaveCount(0);
      await qty.fill("3"); await qty.press("Tab");
      await expect(subtotal).toHaveText("$36.00");
      const savedThree = await stored();
      await page.evaluate(key => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw new Error("Synthetic blocked cart write");
          return original.call(this, name, value);
        };
      }, GUEST_CART_STORAGE_KEY);
      await qty.fill("4"); await qty.press("Tab");
      await expect(page.locator("[data-guest-cart-status]")).toContainText("could not be saved");
      const beforeReturn = snapshots;
      await focus(); await restore();
      await expect(qty).toHaveValue("4");
      await expect(subtotal).toHaveText("$48.00");
      expect(await stored()).toEqual(savedThree);
      expect(snapshots).toBe(beforeReturn);
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
