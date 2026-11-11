import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { GUEST_CART_STORAGE_KEY } from "../../src/features/guest-cart/index.js";

// Seed expectations come from scripts/demo-seed-policy.js: the simple shirt is
// $32, Black/Small hoodie $56, Black/Large sold out, Heather gray/Large $60.
// No native admin saves or checkout starts are needed for this presentation fix.
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

for (const mode of ["disabled", "blocked", "enhanced"] as const) {
  test(`product controls wait for handlers: ${mode}`, async ({ browser, request }, testInfo) => {
    test.setTimeout(180_000);
    expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
    // Fresh EmDash materializes the signed plugin's unique indexes on its
    // scheduler tick. Wait for the normal create-only seed, not a private DB write.
    await expect.poll(async () => {
      const response = await request.get("/products/demo-shirt");
      return response.ok() && (await response.text()).includes("data-add-to-cart=");
    }, { timeout: 60_000 }).toBe(true);
    const context = await browser.newContext({ ...testInfo.project.use, javaScriptEnabled: mode !== "disabled" });
    const page = await context.newPage();
    let starts = 0;
    context.on("request", (req) => { if (/\/(?:checkout\/start|guest-checkout\/start)(?:\?|$)/u.test(req.url())) starts += 1; });
    if (mode === "blocked") {
      // JS is permitted in this browser, but no handler can load or run.
      await context.route("**/*", async (route) => {
        if (route.request().isNavigationRequest() && route.request().resourceType() === "document") {
          const response = await route.fetch();
          await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": "script-src 'none'" } });
        } else await route.continue();
      });
    }
    const root = resolve("runs/product-control-readiness", testInfo.project.name, mode);
    await mkdir(root, { recursive: true });
    try {
      await page.goto("/products/demo-shirt");
      await expect(page.locator("[data-product-price]")).toHaveText("$32.00");
      await expect(page.locator("[data-product-status]")).toHaveText("In stock");
      const simpleId = await page.locator("[data-add-to-cart]").getAttribute("data-add-to-cart");
      expect(simpleId).toBeTruthy();
      if (mode !== "enhanced") {
        await expect(page.locator("[data-add-to-cart-single]")).toBeHidden();
        await expect(page.locator("[data-add-to-cart-qty]")).toBeHidden();
        await expect(page.locator("[data-add-to-cart-requirement]")).toContainText("Cart controls need JavaScript.");
        await expect(page.getByRole("link", { name: "browse the shop", exact: true })).toHaveAttribute("href", "/");
        await page.screenshot({ path: resolve(root, "simple.png"), fullPage: true });
      } else {
        await expect(page.locator("[data-add-to-cart-requirement]")).toBeHidden();
        await expect(page.locator("[data-add-to-cart]")).toHaveAttribute("data-guest-cart-ready", "1");
        await page.getByRole("button", { name: "Increase quantity" }).click();
        await expect(page.locator("[data-add-to-cart-qty]")).toHaveValue("2");
        await page.locator("[data-add-to-cart]").focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("[data-add-to-cart-status]")).toHaveText("Added to cart.");
        expect(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY) ?? "null"))
          .toEqual({ version: 1, lines: [{ id: simpleId, quantity: 2 }] });
      }
      await fits(page);

      await page.goto("/products/demo-hoodie");
      await expect(page.locator("[data-variant-price]")).toHaveText("$56.00");
      if (mode !== "enhanced") {
        for (const fieldset of await page.locator("[data-product-variants]").all()) await expect(fieldset).toBeHidden();
        await expect(page.locator("[data-variant-requirement]")).toHaveText("Showing Black / Small. Enable JavaScript or reload this page to choose another option.");
        await expect(page.locator("[data-add-to-cart-single]")).toBeHidden();
        await expect(page.locator("[data-add-to-cart-requirement]")).toBeVisible();
      } else {
        await expect(page.locator("[data-variant-requirement]")).toBeHidden();
        for (const fieldset of await page.locator("[data-product-variants]").all()) await expect(fieldset).toBeVisible();
        await page.getByLabel("Large").check();
        await expect(page.locator("[data-product-status]")).toHaveText("Out of stock");
        await expect(page.locator("[data-add-to-cart]")).toBeDisabled();
        await page.getByLabel("Heather gray").check();
        await expect(page.locator("[data-product-status]")).toHaveText("In stock");
        await expect(page.locator("[data-variant-price]")).toHaveText("$60.00");
        await expect(page.locator("[data-add-to-cart]")).toBeEnabled();
        const members = JSON.parse(await page.locator("[data-variant-members]").textContent() ?? "[]") as { id: string; values: Record<string, string> }[];
        const member = members.find((item) => item.values.Color === "Heather gray" && item.values.Size === "Large");
        expect(member).toBeTruthy();
        await expect(page.locator("[data-add-to-cart]")).toHaveAttribute("data-add-to-cart", member!.id);
        await page.locator("[data-add-to-cart]").click();
        await expect(page.locator("[data-add-to-cart-status]")).toHaveText("Added to cart.");
        expect(JSON.parse(await page.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY) ?? "null"))
          .toEqual({ version: 1, lines: [{ id: simpleId, quantity: 2 }, { id: member!.id, quantity: 1 }] });
        await page.reload();
        await expect(page.getByLabel("Small")).toBeChecked();
        await expect(page.locator("[data-variant-price]")).toHaveText("$56.00");
      }
      await fits(page);
      await page.screenshot({ path: resolve(root, "variants.png"), fullPage: true });
      // An unsellable simple product still exposes no buying controls or false
      // promise that merely enabling JavaScript makes it purchasable.
      await page.goto("/products/demo-socks");
      await expect(page.locator("[data-product-status]")).toHaveText("Out of stock");
      await expect(page.locator("[data-add-to-cart], [data-add-to-cart-requirement]")).toHaveCount(0);
      expect(starts).toBe(0);
    } finally {
      await context.close();
    }
  });
}
