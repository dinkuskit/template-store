import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { UNMANAGED_PRODUCT_ITEM_ID } from "../../src/features/unmanaged-product-sellability/index.js";

const proofRoot = resolve(
  "runs/unmanaged-product-sellability-20260925/browser",
);

async function openHomeEditor(page: Page): Promise<void> {
  await page.goto(
    "/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/pages/home",
  );
  await expect(page).toHaveURL(/\/_emdash\/admin\/content\/pages\/home/);
  const welcome = page.getByRole("dialog", { name: /Welcome to EmDash/ });
  try {
    await expect(welcome).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Get Started" }).click();
    await expect(welcome).toHaveCount(0);
  } catch {
    await expect(welcome).toHaveCount(0);
  }
  await expect(
    page.locator('input[value="DinkusKit Store Starter"]'),
  ).toBeVisible({ timeout: 30_000 });
}

test("admin composition and public unmanaged availability stay operable", async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name;
  const screenshotRoot = resolve(proofRoot, project);
  await mkdir(screenshotRoot, { recursive: true });

  const setupResponse = await request.get("/_emdash/api/setup/dev-bypass");
  expect(setupResponse.ok()).toBe(true);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await openHomeEditor(adminPage);
  await adminPage.screenshot({
    path: resolve(screenshotRoot, "admin-before.png"),
    fullPage: true,
  });

  await page.goto("/");
  await expect(page.locator('[data-layout="blocks"] [data-home-opener] h1')).toHaveText("Everyday essentials, clearly presented");
  await expect(page.locator(".home-opener__actions a").nth(1)).toHaveText("See availability proof");
  await expect(page.locator("[data-unmanaged-sku]")).toHaveText(
    "DINKUS-DEMO-UNMANAGED",
  );
  await expect(page.locator("[data-unmanaged-product]")).toHaveAttribute(
    "data-availability-status",
    "in-stock",
  );
  await expect(page.locator("[data-unmanaged-product]")).toHaveAttribute(
    "data-sellable",
    "true",
  );
  await expect(page.locator("[data-availability-label]")).toHaveText("In stock");
  await expect(page.locator("[data-merch-item=canvas-cap] [data-merch-status]")).toHaveText("In stock");
  await expect(page.locator("[data-quantity-shown]")).toHaveText("never");
  await expect(
    page.locator("[data-unmanaged-product] [data-regular-price]"),
  ).toHaveText("$12.00");
  await expect(
    page.locator("[data-unmanaged-product] [data-sale-price]"),
  ).toHaveText("$10.00");
  await expect(page.getByText("DINKUS-DEMO-UNPRICED")).toHaveCount(0);
  await expect(
    page.locator("[data-unmanaged-product] [data-stock-value]"),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshotRoot, "public-in-stock.png"),
    fullPage: true,
  });

  const outOfStockResponse = await request.post(
    "/api/proof/unmanaged-availability",
    {
      data: {
        catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
        status: "out-of-stock",
      },
    },
  );
  expect(outOfStockResponse.ok()).toBe(true);
  await page.reload();
  await expect(page.locator("[data-unmanaged-product]")).toHaveAttribute(
    "data-availability-status",
    "out-of-stock",
  );
  await expect(page.locator("[data-unmanaged-product]")).toHaveAttribute(
    "data-sellable",
    "false",
  );
  await expect(page.locator("[data-availability-label]")).toHaveText(
    "Out of stock",
  );
  await expect(page.locator("[data-merch-item=canvas-cap] [data-merch-status]")).toHaveText("Out of stock");
  await expect(page.locator("[data-quantity-shown]")).toHaveText("never");
  await page.screenshot({
    path: resolve(screenshotRoot, "public-out-of-stock.png"),
    fullPage: true,
  });

  const backorderResponse = await request.post(
    "/api/proof/unmanaged-availability",
    {
      data: {
        catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
        status: "available-on-backorder",
      },
    },
  );
  expect(backorderResponse.ok()).toBe(true);
  await page.reload();
  await expect(page.locator("[data-unmanaged-product]")).toHaveAttribute(
    "data-availability-status",
    "available-on-backorder",
  );
  await expect(page.locator("[data-unmanaged-product]")).toHaveAttribute(
    "data-sellable",
    "true",
  );
  await expect(page.locator("[data-availability-label]")).toHaveText(
    "Available on backorder",
  );
  await expect(page.locator("[data-merch-item=canvas-cap] [data-merch-status]")).toHaveText("Available on backorder");
  await page.screenshot({
    path: resolve(screenshotRoot, "public-backorder.png"),
    fullPage: true,
  });

  const restoredResponse = await request.post(
    "/api/proof/unmanaged-availability",
    {
      data: {
        catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
        status: "in-stock",
      },
    },
  );
  expect(restoredResponse.ok()).toBe(true);
  await page.reload();
  await expect(page.locator("[data-unmanaged-product]")).toHaveAttribute(
    "data-availability-status",
    "in-stock",
  );
  await expect(page.locator("[data-sellable-label]")).toHaveText("Sellable: Yes");
  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  const unmanagedOverflow = await page
    .locator("[data-unmanaged-product]")
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(horizontalOverflow).toBe(false);
  expect(unmanagedOverflow).toBe(false);
  await page.screenshot({
    path: resolve(screenshotRoot, "public-restored.png"),
    fullPage: true,
  });

  await openHomeEditor(adminPage);
  await adminPage.screenshot({
    path: resolve(screenshotRoot, "admin-after.png"),
    fullPage: true,
  });
  await adminContext.close();

  await writeFile(
    resolve(screenshotRoot, "assertions.json"),
    `${JSON.stringify(
      {
        project,
        adminPath: "/_emdash/admin/content/pages/home",
        commerceSku: "DINKUS-DEMO-UNMANAGED",
        sequence: [
          "in-stock",
          "out-of-stock",
          "available-on-backorder",
          "in-stock",
        ],
        quantityShown: "never",
        horizontalOverflow,
        unmanagedOverflow,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
