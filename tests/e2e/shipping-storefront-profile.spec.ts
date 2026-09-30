import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { collectionPath } from "../../src/features/store-shell/index.js";

function inventoryishUrl(url: string): boolean {
  return /configure-inventory|@dinkuskit\/inventory|dinkuskit\.inventory|\/api\/proof\/stock/iu.test(
    url,
  );
}

test("shipping profile admin catalog reaches the storefront without Inventory", async ({
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
  await expect(admin.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  await expect(admin.getByText(/coming soon/i)).toHaveCount(0);
  await expect(admin.getByText(/manage stock/i)).toHaveCount(0);
  await expect.poll(
    () =>
      execFileSync(
        "sqlite3",
        [
          ".artifacts/e2e-shipping/content.db",
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_dinkus-commerce_catalogItems_%'",
        ],
        { encoding: "utf8" },
      ),
    { timeout: 90_000 },
  ).toContain("uidx_plugin_dinkus-commerce_catalogItems_skuKey");

  const name = `Shipping hat ${testInfo.project.name}`;
  await admin.getByLabel("Name", { exact: true }).fill(name);
  await admin.getByLabel("SKU", { exact: true }).fill(`SHIP-${testInfo.project.name}`);
  const created = admin.waitForResponse(
    (response) =>
      response.url().endsWith("/catalog-items/create") && response.request().method() === "POST",
  );
  await admin.getByRole("button", { name: "Add product", exact: true }).click();
  const response = await created;
  expect(response.ok(), await response.text()).toBe(true);
  const id = (await response.json()).data.item.itemId;
  const card = page.locator(`[data-commerce-product="${id}"]`);
  await expect(admin.getByLabel("Regular", { exact: true })).toBeVisible();
  await admin.screenshot({ path: resolve(root, "admin-products.png"), fullPage: true, animations: "disabled" });

  async function save(regular: string, sale: string) {
    await admin.getByLabel("Regular", { exact: true }).fill(regular);
    await admin.getByLabel("Sale", { exact: true }).fill(sale);
    const saved = admin.waitForResponse(
      (response) =>
        response.url().endsWith("/catalog-items/save-prices") &&
        response.request().method() === "POST",
    );
    await admin.getByRole("button", { name: "Save", exact: true }).click();
    const result = await saved;
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()).data;
  }
  expect((await save("24", "18")).saved).toBe(true);

  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-storefront-profile", "shipping");
  await expect(page.locator("#commerce-catalog")).toHaveText("Shop");
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
  await expect(card.locator("s[data-regular-price]")).toHaveText("$24.00");
  await expect(card.locator("[data-sale-price]")).toHaveText("$18.00");
  await expect(card.locator("[data-commerce-availability]")).toHaveText("In stock");
  await expect(card.locator("[data-stock-value]")).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "public-home.png"), fullPage: true, animations: "disabled" });

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
  expect((await page.goto("/products/everyday-tee"))?.status()).toBe(404);

  await page.goto("/");
  await card.getByRole("link", { name: "View product", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator("[data-sale-price]")).toHaveText("$18.00");
  await expect(page.locator("[data-commerce-availability]")).toHaveAttribute(
    "data-commerce-availability",
    "in-stock",
  );
  await expect(page.locator("[data-stock-value]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: resolve(root, "public-product.png"), fullPage: true, animations: "disabled" });

  const statusRoute = "/_emdash/api/plugins/dinkus-commerce/catalog-items/set-manual-availability";
  for (const status of ["out-of-stock", "available-on-backorder", "in-stock"] as const) {
    const changed = await admin.request.post(statusRoute, {
      data: { catalogItemId: id, status },
      headers: { "X-EmDash-Request": "1" },
    });
    expect(changed.ok(), await changed.text()).toBe(true);
    await page.goto("/");
    await expect(card.locator("[data-commerce-availability]")).toHaveAttribute(
      "data-commerce-availability",
      status,
    );
    await expect(card.locator("[data-stock-value]")).toHaveCount(0);
    await expect(page.locator("[data-managed-product]")).toHaveCount(0);
  }
  await page.screenshot({ path: resolve(root, "public-availability.png"), fullPage: true, animations: "disabled" });
  expect(inventoryRequests, inventoryRequests.join("\n")).toEqual([]);

  await writeFile(
    resolve(root, "assertions.json"),
    `${JSON.stringify(
      {
        project: testInfo.project.name,
        profile: "shipping",
        commercePin: "81a6f571b5ad3dcc73ba6af9a89bdb438c6a8e06",
        managedDemos: "absent",
        quantityShown: "never",
        inventoryRequests: inventoryRequests.length,
        comingSoon: false,
        manageStock: false,
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
