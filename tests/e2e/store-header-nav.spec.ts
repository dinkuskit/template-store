import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const proofRoot = resolve("runs/store-header-nav-20261017/browser");

test("the seeded main menu leads from every store page to the shop and its categories", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const phone = testInfo.project.name.includes("mobile");

  await page.goto("/");
  const header = page.locator("[data-store-header]");
  const main = page.getByRole("navigation", { name: "Main" });
  const toggle = header.getByRole("button", { name: "Menu" });
  const shopLinks = main.getByRole("button", { name: "Show Shop links" });

  if (phone) {
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(main).toBeHidden();
    await page.screenshot({ path: resolve(root, "home-menu-closed.png") });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  } else {
    await expect(toggle).toBeHidden();
  }
  await expect(main.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("link", { name: "Shop", exact: true })).toHaveAttribute("href", "/#commerce-catalog");
  const hats = main.getByRole("link", { name: "Hats" });
  await expect(hats).toBeHidden();

  if (!phone) {
    // A mouse hover opens Shop and leaving closes it, with aria-expanded in step.
    await main.getByRole("link", { name: "Shop", exact: true }).hover();
    await expect(hats).toBeVisible();
    await expect(shopLinks).toHaveAttribute("aria-expanded", "true");
    await page.mouse.move(0, 0);
    await expect(hats).toBeHidden();
    await expect(shopLinks).toHaveAttribute("aria-expanded", "false");
  }

  await shopLinks.click();
  await expect(shopLinks).toHaveAttribute("aria-expanded", "true");
  if (!phone) await page.mouse.move(0, 0);
  for (const label of ["All products", "Hats", "Hoodies", "Tees"]) {
    await expect(main.getByRole("link", { name: label })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: resolve(root, "home-shop-open.png") });

  // Escape and a second chevron click each hide the open dropdown.
  await page.keyboard.press("Escape");
  await expect(shopLinks).toHaveAttribute("aria-expanded", "false");
  await expect(shopLinks).toBeFocused();
  await expect(hats).toBeHidden();
  await shopLinks.click();
  await expect(hats).toBeVisible();
  await shopLinks.click();
  await expect(shopLinks).toHaveAttribute("aria-expanded", "false");
  await expect(hats).toBeHidden();

  await shopLinks.click();
  await main.getByRole("link", { name: "Hoodies" }).click();
  await expect(page).toHaveURL(/\/categories\/hoodies\/?$/u);
  await expect(page.locator("h1")).toHaveText("Hoodies");
  if (phone) await toggle.click();
  else await page.mouse.move(0, 0);
  await expect(main.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: resolve(root, "category-page.png") });

  for (const path of ["/cart", "/products/everyday-tee"]) {
    await page.goto(path);
    await expect(page.locator("[data-store-main-nav] a")).toHaveCount(6);
    await expect(page.locator("[data-store-header] [data-guest-cart-nav]")).toBeVisible();
  }

  if (phone) {
    // The narrowest supported phone keeps brand, cart and Menu on screen.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    await toggle.click();
    await expect(main.getByRole("link", { name: "Shop", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: resolve(root, "home-320-menu-open.png") });
  }
});

test("without JavaScript the main menu still opens on hover and shows in full on phones", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const main = page.getByRole("navigation", { name: "Main" });
    const hats = main.getByRole("link", { name: "Hats" });
    await expect(page.locator("[data-store-header]").getByRole("button", { name: "Menu" })).toBeHidden();
    if (testInfo.project.name.includes("mobile")) {
      await expect(hats).toBeVisible();
    } else {
      await expect(hats).toBeHidden();
      await main.getByRole("link", { name: "Shop", exact: true }).hover();
      await expect(hats).toBeVisible();
    }
  } finally {
    await context.close();
  }
});
