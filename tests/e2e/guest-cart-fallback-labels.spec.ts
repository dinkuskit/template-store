import { expect, test } from "@playwright/test";

import { GUEST_CART_STORAGE_KEY, type GuestCartCatalogSnapshot } from "../../src/features/guest-cart/index.js";
import { freshOfflineContext } from "./helpers/offline-checkout";

// Browser-local snapshots exercise presentation and recovery, not a real catalog
// outage, a Registry installation or a paid checkout. Native publication proof
// belongs to the paired/store operator's journey.
const intent = { version: 1, lines: [
  { id: "11111111-1111-4111-8111-111111111111", quantity: 2 },
  { id: "22222222-2222-4222-8222-222222222222", quantity: 3 },
] };
const publicNames = ["Public cap <Canvas>", "Public mug"];
const current: GuestCartCatalogSnapshot[] = intent.lines.map(({ id }, index) => ({
  id, found: true, name: publicNames[index], sku: `PUBLIC-${index + 1}`,
  price: { listable: true, regularText: "$16.00", saleText: null, unitMinor: "1600" },
  availability: { listable: true, sellable: true, status: "in-stock" },
}));

for (const path of ["/cart", "/checkout"]) {
  test(`${path} names unknown items without exposing catalog IDs and recovers current names`, async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const context = await freshOfflineContext(browser, testInfo.project.use.baseURL as string, testInfo.project.use.viewport);
    let releaseInitial!: () => void;
    const initial = new Promise<void>((resolve) => { releaseInitial = resolve; });
    let hold = true;
    let failed = false;
    let snapshots: GuestCartCatalogSnapshot[] = intent.lines.map(({ id }) => ({ id, found: false }));
    const unexpectedRequests: string[] = [];
    try {
      const page = await context.newPage();
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const apiOrNavigation = url.pathname.startsWith("/api/") || url.pathname.startsWith("/_emdash/api/") || route.request().isNavigationRequest();
        if (url.origin !== new URL(testInfo.project.use.baseURL as string).origin ||
            (apiOrNavigation && /checkout|payment/i.test(url.pathname) && url.pathname !== "/checkout")) {
          unexpectedRequests.push(url.href);
          await route.abort("blockedbyclient");
        } else if (url.pathname === "/api/guest-cart/snapshot") {
          if (hold) await initial;
          await route.fulfill({ status: failed ? 503 : 200, contentType: "application/json",
            body: JSON.stringify(failed ? { error: "catalog_unavailable" } : { products: snapshots }) });
        } else await route.continue();
      });
      await page.addInitScript(({ key, intent }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(intent));
      }, { key: GUEST_CART_STORAGE_KEY, intent });
      const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), GUEST_CART_STORAGE_KEY);
      const cart = page.locator("[data-guest-cart]");
      const checkRows = async (names: string[]) => {
        await expect(cart.locator("[data-guest-cart-line] h2")).toHaveText(names);
        for (const [index, name] of names.entries()) {
          await expect(page.getByRole("textbox", { name: `Quantity for ${name}`, exact: true })).toHaveValue(String(intent.lines[index].quantity));
          await expect(page.getByRole("button", { name: `Remove ${name}`, exact: true })).toBeVisible();
        }
        for (const { id } of intent.lines) await expect(cart).not.toContainText(id);
        expect(await stored()).toEqual(intent);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      };
      await page.goto(path);
      await checkRows(["Item 1", "Item 2"]);
      await expect(cart.locator("[data-guest-cart-checkout]")).toBeDisabled();
      hold = false;
      releaseInitial();
      await checkRows(["Unavailable item 1", "Unavailable item 2"]);
      await expect(cart.locator("[data-guest-cart-line-reason]")).toHaveText([
        "This product is no longer in the catalog and cannot be checked out.",
        "This product is no longer in the catalog and cannot be checked out.",
      ]);
      await expect(cart.locator("[data-guest-cart-subtotal]")).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}-missing.png`), fullPage: true });

      failed = true;
      await page.reload();
      await expect(cart.locator("[data-guest-cart-status]")).toContainText("We couldn't load the latest prices.");
      await checkRows(["Item 1", "Item 2"]);
      await expect(cart.locator("[data-guest-cart-checkout]")).toBeDisabled();
      await expect(cart.locator("[data-guest-cart-subtotal]")).toBeHidden();

      failed = false;
      snapshots = current;
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await checkRows(publicNames);
      await expect(cart.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$80.00");
      await expect(cart.locator("[data-guest-cart-retry]")).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}-recovered.png`), fullPage: true });

      // A redacted/unlisted response must not promote a title back into the UI.
      snapshots = [{ ...current[0], found: true, name: "Private draft title", sku: "",
        price: { listable: false, regularText: null, saleText: null },
        availability: { listable: false, sellable: false, status: "out-of-stock" },
      }, current[1]];
      await page.reload();
      await checkRows(["Unavailable item 1", publicNames[1]]);
      await expect(cart).not.toContainText("Private draft title");
      await expect(cart.locator("[data-guest-cart-subtotal]")).toBeHidden();
      await page.getByRole("button", { name: "Remove Unavailable item 1", exact: true }).click();
      await expect(cart.locator("[data-guest-cart-line] h2")).toHaveText([publicNames[1]]);
      expect(await stored()).toEqual({ version: 1, lines: [intent.lines[1]] });
      await expect(page.getByRole("textbox", { name: `Quantity for ${publicNames[1]}`, exact: true })).toHaveValue("3");
      await expect(cart.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$48.00");
      // Removing by the renamed control still targets the original ID, not a position.
      await page.getByRole("button", { name: `Remove ${publicNames[1]}`, exact: true }).click();
      await expect(cart.locator("[data-guest-cart-empty]")).toBeVisible();
      expect(await stored()).toEqual({ version: 1, lines: [] });
      expect(unexpectedRequests).toEqual([]);
    } finally {
      releaseInitial();
      await context.close();
    }
  });
}
