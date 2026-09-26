import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const proofRoot = resolve("runs/merch-catalog-20260925/browser");

test("merchandise is editable in EmDash and visible in the classic catalog", async ({ page, request, browser }, testInfo) => {
  test.setTimeout(120_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await admin.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/merchandise/everyday-tee");
  await expect(admin).toHaveURL(/\/content\/merchandise\/everyday-tee/);
  const welcome = admin.getByRole("dialog", { name: /Welcome to EmDash/ });
  try {
    await expect(welcome).toBeVisible({ timeout: 5_000 });
    await admin.getByRole("button", { name: "Get Started" }).click();
  } catch {
    await expect(welcome).toHaveCount(0);
  }
  await expect(welcome).toHaveCount(0);
  await expect(admin.locator('input[value="Everyday Tee"]')).toBeVisible({ timeout: 30_000 });
  await expect(admin.locator('input[value="Tees"]')).toBeVisible();
  await admin.screenshot({ path: resolve(root, "admin-merch-item.png"), fullPage: true });
  await adminContext.close();

  for (const missing of ["/products/not-published", "/collections/not-published"]) {
    const response = await page.goto(missing);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not found");
  }

  await page.goto("/");
  await expect(page.locator("[data-merch-catalog]")).toBeVisible();
  await expect(page.locator("[data-merch-item=everyday-tee] h4")).toHaveText("Everyday Tee");
  await expect(page.locator("[data-merch-item=canvas-cap] h4")).toHaveText("Canvas Cap");
  await expect(page.locator("[data-merch-source=preview]")).toHaveCount(3);
  await expect(page.locator("[data-merch-source=preview] [data-product-price]")).toHaveCount(0);
  await expect(page.locator("[data-merch-item=everyday-tee] [data-regular-price]")).toHaveText("$12.00");
  await expect(page.locator("[data-merch-item=canvas-cap] [data-sale-price]")).toHaveText("$10.00");
  await expect(page.locator("[data-merch-item=dinkus-template-unpriced-product]")).toHaveCount(0);
  await expect(page.locator("[data-merch-item=everyday-tee]")).toHaveAttribute("data-merch-source", "managed");
  await expect(page.locator("[data-merch-item=canvas-cap]")).toHaveAttribute("data-merch-source", "unmanaged");
  const illustrations = page.locator("[data-merch-catalog] .merch-card__visual img");
  await expect(illustrations).toHaveCount(5);
  for (const image of await illustrations.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await expect(page.locator("[data-merch-source=preview] a")).toHaveCount(3);
  await page.getByRole("navigation", { name: "Merchandise collections" }).getByRole("link", { name: "Tees" }).click();
  await expect(page.locator("h1")).toHaveText("Tees");
  await expect(page.locator("[data-merch-item]")).toHaveCount(2);
  await expect(page.locator("[data-merch-catalog] h2")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: resolve(root, "public-collection.png"), fullPage: true });
  await page.getByRole("link", { name: "View Everyday Tee details" }).click();
  await expect(page.locator("[data-product-page=everyday-tee] h1")).toHaveText("Everyday Tee");
  await expect(page.locator("[data-product-status]")).toHaveText("8 available");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expect(page.locator("[data-product-page] a[href*='checkout'], [data-product-page] a[href*='cart']")).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "public-product.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to Tees" }).click();
  await expect(page.locator("h1")).toHaveText("Tees");
  await page.getByRole("link", { name: "Catalog" }).click();
  await expect(page.locator("[data-merch-catalog]")).toBeVisible();
  await page.getByRole("link", { name: "View Boxy Tee details" }).click();
  await expect(page.locator("[data-product-status]")).toHaveText("Preview only · not purchasable");
  await expect(page.locator("[data-product-page] a[href*='checkout'], [data-product-page] a[href*='cart']")).toHaveCount(0);
  await page.getByRole("link", { name: "Catalog" }).click();
  await page.getByRole("link", { name: "View Canvas Cap details" }).click();
  await expect(page.locator("[data-product-page=canvas-cap]")).toHaveAttribute("data-product-source", "unmanaged");
  await expect(page.locator("[data-product-status]")).toHaveText("In stock");
  await expect(page.locator("[data-product-page] [data-stock-value]")).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "public-cap-product.png"), fullPage: true });
  await page.getByRole("link", { name: "Catalog" }).click();
  await page.getByRole("link", { name: "View availability for Everyday Tee" }).click();
  await expect(page).toHaveURL(/#managed-product$/);
  await expect(page.locator("#managed-product")).toBeFocused();
  await expect(page.locator("#managed-product h2")).toHaveText("Everyday Tee");
  await expect(page.locator("#managed-product [data-stock-value]")).toHaveText("8");
  const managedDetails = page.locator("#managed-product details");
  await expect(managedDetails).not.toHaveAttribute("open", "");
  await managedDetails.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(managedDetails).toHaveAttribute("open", "");
  await expect(page.locator("[data-inventory-sku]")).toHaveText("dinkus-inventory-sku-demo");
  await expect(page.locator("#managed-product .managed-product__provenance")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(managedDetails).not.toHaveAttribute("open", "");
  await page.getByRole("link", { name: "View availability for Canvas Cap" }).click();
  await expect(page).toHaveURL(/#unmanaged-product$/);
  await expect(page.locator("#unmanaged-product")).toBeFocused();
  await expect(page.locator("#unmanaged-product h2")).toHaveText("Canvas Cap");
  await expect(page.locator("[data-availability-label]")).toHaveText("In stock");
  const unmanagedDetails = page.locator("#unmanaged-product details");
  await expect(unmanagedDetails).not.toHaveAttribute("open", "");
  await unmanagedDetails.locator("summary").focus();
  await page.keyboard.press(" ");
  await expect(unmanagedDetails).toHaveAttribute("open", "");
  await expect(page.locator("[data-quantity-shown]")).toHaveText("never");
  await expect(page.locator("#unmanaged-product [data-stock-value]")).toHaveCount(0);
  await expect(page.locator("#unmanaged-product .unmanaged-product__provenance")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: resolve(root, "public-catalog.png"), fullPage: true });
  await writeFile(resolve(root, "assertions.json"), `${JSON.stringify({ project: testInfo.project.name, adminPath: "/_emdash/admin/content/merchandise/everyday-tee", collections: ["Hats", "Hoodies", "Tees"], previewCount: 3, horizontalOverflow: overflow }, null, 2)}\n`);
});
