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
  const root = resolve(process.env.DINKUS_SHIPPING_PROOF_ROOT ?? "runs/v1-release/browser", testInfo.project.name);
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
  expect((await request.get("/proof")).status()).toBe(404);

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
  await expect(page.locator("[data-catalog-guidance]")).toHaveAttribute("data-catalog-guidance-state", "unavailable");
  await expect(page.locator("[data-catalog-guidance]")).toContainText("Products are not shown until the connected store can be reached");
  await expect(page.locator("[data-catalog-guidance]")).not.toContainText("added to your cart");
  await expect(page.getByRole("alert")).toHaveText("The product catalog is temporarily unavailable.");
  await expect(page.locator("[data-commerce-product]")).toHaveCount(0);
  await expect(page.locator("[data-commerce-empty]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add to cart", exact: true })).toHaveCount(0);
  await expect(page.locator(".home-opener__deck")).toContainText("Browse products published in Commerce");
  await expect(page.locator(".home-opener__deck")).not.toContainText("Checkout is not available yet");
  await expect(page.locator("[data-store-demo-banner]")).toHaveAttribute("data-checkout-available", "false");
  await expect(page.locator("[data-store-demo-banner]")).toHaveText("Demo / Test Store — Purchases and checkout are unavailable.");
  await expect(page.locator("[data-catalog-guidance]")).not.toContainText(/checkout/i);
  await expect(page.locator("[data-home-default]")).toHaveCount(0);
  await expect(page.getByText("Storefront composition is unavailable")).toHaveCount(0);
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
  const footerPolicies = page.getByRole("navigation", { name: "Policies & Care" });
  await expect(footerPolicies).toContainText("Policies & Care");
  await expect(footerPolicies.getByRole("link", { name: "Shipping", exact: true })).toHaveAttribute("href", "/shipping");
  await expect(footerPolicies.getByRole("link", { name: "Returns", exact: true })).toHaveAttribute("href", "/returns");
  await page.screenshot({ path: resolve(root, "public-home.png"), fullPage: true, animations: "disabled" });

  await page.goto("/cart");
  await expect(page.locator("[data-guest-cart-checkout]")).toHaveText("Checkout unavailable");
  await expect(footerPolicies.getByRole("link", { name: "Shipping", exact: true })).toHaveAttribute("href", "/shipping");
  await expect(footerPolicies.getByRole("link", { name: "Returns", exact: true })).toHaveAttribute("href", "/returns");

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
  await expect(page.locator("[data-product-sku]")).toHaveCount(0);
  await expect(page.locator("[data-product-gtin]")).toHaveCount(0);
  await expect(page.locator("[data-product-price]")).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  const previewJsonLd = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "");
  expect(previewJsonLd["@type"]).toBe("Product");
  expect(previewJsonLd.name).toBe("Boxy Tee");
  expect(previewJsonLd.offers).toBeUndefined();
  await expect(page.locator("[data-product-page] a[href*='checkout'], [data-product-page] a[href*='cart']")).toHaveCount(0);
  expect((await page.goto("/products/everyday-tee"))?.status()).toBe(503);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  expect((await page.goto("/products/does-not-exist"))?.status()).toBe(404);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  expect((await request.get("/shipping")).status()).toBe(200);
  expect((await request.get("/returns")).status()).toBe(200);
  await page.goto("/shipping");
  await expect(page.locator("[data-shipping-policy-unset]")).toHaveText("Shipping policy is not configured.");
  await expect(page.locator("[data-policy-body]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\$\d|\b[A-Z]{2}\b|\d+ days/);
  await expect(footerPolicies.getByRole("link", { name: "Shipping", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goto("/returns");
  await expect(page.locator("[data-return-policy-unset]")).toHaveText("Return policy is not configured.");
  await expect(page.locator("[data-policy-body]")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\$\d|\d+ days/);
  await expect(footerPolicies.getByRole("link", { name: "Returns", exact: true })).toHaveAttribute("aria-current", "page");
  const googleFeed = await request.get("/feeds/google-merchant.xml");
  const metaFeed = await request.get("/feeds/meta-catalog.csv");
  expect(googleFeed.status()).toBe(503);
  expect(metaFeed.status()).toBe(503);
  expect(await googleFeed.text()).not.toContain("boxy-tee");
  expect(await metaFeed.text()).not.toContain("boxy-tee");
  const googleSlash = await request.get("/feeds/google-merchant.xml/", { maxRedirects: 0 });
  expect(googleSlash.status()).not.toBe(200);
  if (googleSlash.status() === 301 || googleSlash.status() === 302) {
    expect(new URL(googleSlash.headers().location ?? "", googleSlash.url()).pathname).toBe("/feeds/google-merchant.xml");
  }

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
