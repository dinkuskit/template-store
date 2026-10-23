import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const proofRoot = resolve(
  "runs/managed-product-availability-20260829/browser",
);

test("renders Blocks and observes the Inventory 8 -> 5 -> 8 sequence", async ({
  page,
  request,
}, testInfo) => {
  const project = testInfo.project.name;
  const screenshotRoot = resolve(proofRoot, project);
  await mkdir(screenshotRoot, { recursive: true });

  const setupResponse = await request.get("/_emdash/api/setup/dev-bypass");
  expect(setupResponse.ok()).toBe(true);
  expect((await request.get("/shop/dinkus-template-managed-product", { maxRedirects: 0 })).status()).toBe(404);
  expect((await request.get("/collections/tees", { maxRedirects: 0 })).status()).toBe(404);
  const canonicalProduct = await request.get("/products/everyday-tee", { maxRedirects: 0 });
  expect(canonicalProduct.ok()).toBe(true);
  expect(canonicalProduct.headers().location).toBeUndefined();

  await page.goto("/");
  await expect(page.locator('[data-layout="blocks"] [data-home-opener] h1')).toHaveText("Everyday essentials, clearly presented");
  const heroAction = page.locator(".home-opener__primary");
  await expect(heroAction).toHaveText("Shop the collection");
  await expect(heroAction).toHaveCSS("color", "rgb(255, 254, 251)");
  await expect(heroAction).toHaveCSS("background-color", "rgb(23, 32, 51)");
  await expect(page.locator("[data-cms-composition]")).toBeVisible();
  await expect(page.locator("#commerce-catalog")).toHaveCount(1);
  const factRailOverflow = await page
    .locator(".home-opener__facts")
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(factRailOverflow).toBe(false);
  await expect(page.locator("[data-integration-demos]")).toHaveCount(0);
  await expect(page.locator("[data-managed-product]")).toHaveCount(0);
  await expect(page.locator("[data-unmanaged-product]")).toHaveCount(0);
  await expect(page.locator(".store-header__status")).toHaveText("Store");
  await expect(page.locator("[data-footer-provenance]")).toHaveText(
    "Transactional facts remain in Commerce; EmDash owns the surrounding composition.",
  );

  await page.goto("/proof");
  await expect(page.locator("[data-proof-intro] h1")).toHaveText("Integration demonstrations");
  await expect(page.locator("[data-cms-composition]")).toHaveCount(0);
  await expect(page.locator('a[href="#commerce-catalog"]')).toHaveCount(0);
  await expect(page.locator(".store-header__status")).toHaveText("Demo store");
  await expect(page.locator("[data-footer-provenance]")).toHaveText(
    "Transactional facts remain in Commerce and Inventory; EmDash owns the surrounding composition.",
  );
  await expect(page.locator("[data-collection-nav] a")).toHaveText(["Hats", "Hoodies", "Tees"]);
  await expect(page.locator("[data-merch-item=everyday-tee] [data-merch-status]")).toHaveText("8 available");
  await expect(page.locator("[data-merch-item=pullover-hoodie-preview] [data-merch-status]")).toHaveText("Preview only · not purchasable");
  await expect(page.locator("[data-merch-source=preview] a")).toHaveCount(3);
  await expect(page.locator("[data-commerce-sku]")).toHaveText(
    "DINKUS-DEMO-001",
  );
  await expect(page.locator("[data-inventory-sku]")).toHaveText(
    "dinkus-inventory-sku-demo",
  );
  await expect(page.locator("[data-stock-value]")).toHaveText("8");
  await expect(
    page.locator("[data-managed-product] [data-regular-price]"),
  ).toHaveText("$12.00");
  await expect(
    page.locator("[data-managed-product] [data-sale-price]"),
  ).toHaveCount(0);
  const initialVersion = await page
    .locator("[data-managed-product]")
    .getAttribute("data-stock-version");
  await page.screenshot({
    path: resolve(screenshotRoot, "initial.png"),
    fullPage: true,
  });

  const changedResponse = await request.post("/api/proof/stock", {
    data: {
      commandId: `${project}-browser-change`,
      delta: "-3",
      reason: "proof-change",
    },
  });
  expect(changedResponse.ok()).toBe(true);
  await page.reload();
  await expect(page.locator("[data-stock-value]")).toHaveText("5");
  await expect(page.locator("[data-merch-item=everyday-tee] [data-merch-status]")).toHaveText("5 available");
  await page.getByRole("link", { name: "View Everyday Tee details" }).click();
  await expect(page.locator("[data-product-status]")).toHaveText("5 available");
  await page.screenshot({ path: resolve(screenshotRoot, "product-changed.png"), fullPage: true });
  await page.goto("/proof");
  const changedVersion = await page
    .locator("[data-managed-product]")
    .getAttribute("data-stock-version");
  await page.screenshot({
    path: resolve(screenshotRoot, "changed.png"),
    fullPage: true,
  });

  const restoredResponse = await request.post("/api/proof/stock", {
    data: {
      commandId: `${project}-browser-restore`,
      delta: "3",
      reason: "proof-restore",
    },
  });
  expect(restoredResponse.ok()).toBe(true);
  await page.reload();
  await expect(page.locator("[data-stock-value]")).toHaveText("8");
  await expect(page.locator("[data-merch-item=everyday-tee] [data-merch-status]")).toHaveText("8 available");
  const restoredVersion = await page
    .locator("[data-managed-product]")
    .getAttribute("data-stock-version");
  await page.screenshot({
    path: resolve(screenshotRoot, "restored.png"),
    fullPage: true,
  });

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);
  expect(BigInt(changedVersion ?? "0")).toBeGreaterThan(
    BigInt(initialVersion ?? "0"),
  );
  expect(BigInt(restoredVersion ?? "0")).toBeGreaterThan(
    BigInt(changedVersion ?? "0"),
  );

  await writeFile(
    resolve(screenshotRoot, "assertions.json"),
    `${JSON.stringify(
      {
        project,
        blocks: ["home_opener"],
        commerceSku: "DINKUS-DEMO-001",
        inventorySku: "dinkus-inventory-sku-demo",
        sequence: ["8", "5", "8"],
        versions: [initialVersion, changedVersion, restoredVersion],
        horizontalOverflow,
        factRailOverflow,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
