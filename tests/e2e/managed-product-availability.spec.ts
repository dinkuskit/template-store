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

  await page.goto("/");
  await expect(page.locator('[data-dinkus-block="page-hero"]')).toBeVisible();
  await expect(page.locator('[data-dinkus-block="fact-rail"]')).toBeVisible();
  const heroAction = page.locator(".dinkus-page-hero__action").first();
  await expect(heroAction).toHaveText("Inspect the managed product");
  await expect(heroAction).toHaveCSS("color", "rgb(255, 254, 251)");
  await expect(heroAction).toHaveCSS("background-color", "rgb(23, 32, 51)");
  await expect(page.locator("[data-cms-composition]")).toBeVisible();
  await expect(page.locator("[data-commerce-sku]")).toHaveText(
    "DINKUS-DEMO-001",
  );
  await expect(page.locator("[data-inventory-sku]")).toHaveText(
    "dinkus-inventory-sku-demo",
  );
  await expect(page.locator("[data-stock-value]")).toHaveText("8");
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
  const factRailOverflow = await page
    .locator('[data-dinkus-block="fact-rail"]')
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(horizontalOverflow).toBe(false);
  expect(factRailOverflow).toBe(false);
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
        blocks: ["dinkus.page-hero", "dinkus.fact-rail"],
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
