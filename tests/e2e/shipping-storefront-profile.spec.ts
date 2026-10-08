import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { collectionPath } from "../../src/features/store-shell/index.js";
import { COMMERCE_NATIVE_PLUGIN_ID } from "../../src/features/commerce-catalog/installed.js";

function inventoryishUrl(url: string): boolean {
  return /configure-inventory|@dinkuskit\/inventory|dinkuskit\.inventory|dinkus-inventory|\/api\/proof\/stock/iu.test(
    url,
  );
}

test("shipping profile uses installed catalog and fail-closes without a native plugin", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const root = resolve("runs/v1-release/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const inventoryRequests: string[] = [];
  const watch = (target: { on(event: "request", handler: (req: { url(): string }) => void): void }) => {
    target.on("request", (req) => {
      if (inventoryishUrl(req.url())) inventoryRequests.push(req.url());
    });
  };
  watch(page);

  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  expect((await request.post("/api/proof/stock", { data: { commandId: "shipping-blocked", delta: "-3", reason: "proof-change" } })).status()).toBe(404);

  const installedCatalog = await request.get(
    `/_emdash/api/plugins/${COMMERCE_NATIVE_PLUGIN_ID}/catalog/public`,
  );
  expect(installedCatalog.ok()).toBe(false);

  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  watch(context);
  const admin = await context.newPage();
  watch(admin);
  await admin.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/products");
  try {
    await expect(admin.getByRole("button", { name: "Get Started" })).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("button", { name: "Get Started" }).click();
  } catch {
    await expect(admin.getByRole("dialog", { name: /Welcome to EmDash/ })).toHaveCount(0);
  }
  await expect(admin.getByRole("heading", { name: "Products", exact: true })).toHaveCount(0);

  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-storefront-profile", "shipping");
  await expect(page.locator("#commerce-catalog")).toHaveText("Shop");
  await expect(page.getByRole("alert")).toHaveText("The product catalog is temporarily unavailable.");
  await expect(page.locator("[data-commerce-product]")).toHaveCount(0);
  await expect(page.locator("[data-commerce-empty]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toHaveCount(0);
  await expect(page.locator(".home-opener__deck")).toContainText("Browse products published in Commerce");
  await expect(page.locator(".home-opener__deck")).toContainText("Checkout is not available yet");
  await expect(page.getByText("Two connected styles", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Inventory + manual", { exact: true })).toHaveCount(0);
  await expect(page.locator(".home-opener__primary")).toHaveAttribute("href", "#commerce-catalog");
  await expect(page.locator(".home-opener__actions a")).toHaveCount(2);
  await expect(page.locator('.home-opener__actions a[href="#commerce-catalog"]')).toHaveCount(2);
  await expect(page.locator('a[href="#catalog-title"]')).toHaveCount(0);
  await expect(page.locator('a[href="#managed-product"]')).toHaveCount(0);
  await expect(page.locator("[data-integration-demos]")).toHaveCount(0);
  await expect(page.locator("[data-managed-product]")).toHaveCount(0);
  await expect(page.locator("[data-unmanaged-product]")).toHaveCount(0);
  await expect(page.locator("[data-stock-value]")).toHaveCount(0);
  await expect(page.locator("[data-inventory-sku]")).toHaveCount(0);
  await expect(page.locator("[data-merch-item=everyday-tee]")).toHaveCount(0);
  await expect(page.locator("[data-merch-item=canvas-cap]")).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "public-home.png"), fullPage: true, animations: "disabled" });

  await page.goto("/cart");
  await expect(page.locator("[data-guest-cart-checkout]")).toHaveText("Checkout unavailable");

  const tees = collectionPath("Tees");
  const collectionResponse = await page.goto(tees);
  expect(collectionResponse?.ok()).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-storefront-profile", "shipping");
  await expect(page.locator("h1")).toHaveText("Tees");
  await expect(page.locator("[data-merch-item=boxy-tee-preview]")).toBeVisible();
  await expect(page.locator("[data-merch-item=everyday-tee]")).toHaveCount(0);
  await expect(page.locator("[data-stock-value]")).toHaveCount(0);
  await expect(page.locator("[data-inventory-sku]")).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "public-collection.png"), fullPage: true, animations: "disabled" });

  const previewProduct = await page.goto("/products/boxy-tee-preview");
  expect(previewProduct?.ok()).toBe(true);
  await expect(page.locator("[data-product-page=boxy-tee-preview]")).toHaveAttribute(
    "data-product-source",
    "preview",
  );
  await expect(page.locator("[data-product-status]")).toHaveText("Preview only · not purchasable");
  await expect(page.locator("[data-stock-value]")).toHaveCount(0);
  await expect(page.locator("[data-product-page] a[href*='checkout'], [data-product-page] a[href*='cart']")).toHaveCount(0);
  expect((await page.goto("/products/everyday-tee"))?.status()).toBe(503);

  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: resolve(root, "public-unavailable-catalog.png"), fullPage: true, animations: "disabled" });
  expect(inventoryRequests, inventoryRequests.join("\n")).toEqual([]);

  await writeFile(
    resolve(root, "assertions.json"),
    `${JSON.stringify(
      {
        project: testInfo.project.name,
        profile: "shipping",
        catalogAuthority: "installed-public",
        nativePluginMounted: false,
        catalogState: "unavailable",
        inventedProducts: false,
        managedDemos: "absent",
        quantityShown: "never",
        inventoryRequests: inventoryRequests.length,
        homeOpenerHref: "#commerce-catalog",
        catalogHeading: "commerce-catalog",
        staleDemoCopy: false,
      },
      null,
      2,
    )}\n`,
  );
  await context.close();
});
