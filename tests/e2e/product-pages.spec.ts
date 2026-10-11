import { expect, test } from "@playwright/test";

// Demo profile: seeded Commerce items get published product entries, placeholder
// images, and whole-card links from the home page.
test("clicking a home card lands on its product page with a Commerce price", async ({ page, request }) => {
  test.setTimeout(180_000);
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  await page.goto("/");
  const shirt = page.locator("a[data-product-link]", { hasText: "Dinkus Demo Heavyweight T-Shirt" });
  await expect.poll(async () => { await page.reload(); return shirt.count(); }, { timeout: 60_000 }).toBe(1);

  for (const card of await page.locator("a[data-product-link]").all()) {
    await expect(card).toHaveAttribute("href", /^\/products\/[a-z0-9-]+$/);
    await expect(card.locator("[data-add-to-cart]")).toHaveCount(0);
  }
  const demoCards = page.locator('a[data-product-link][href^="/products/demo-"]');
  await expect(demoCards).not.toHaveCount(0);
  for (const card of await demoCards.all()) {
    await expect(card.locator("img[data-demo-placeholder]")).toBeVisible();
    await expect(card.locator("[data-commerce-image-placeholder]")).toHaveCount(0);
  }

  await shirt.click();
  await expect(page).toHaveURL(/\/products\/demo-shirt$/);
  await expect(page.locator("[data-product-page]")).toBeVisible();
  await expect(page.locator("[data-product-price]")).toHaveText("$32.00");
  await expect(page.locator("[data-product-status]")).toHaveText("In stock");
  await expect(page.locator(".product-detail img[data-demo-placeholder]")).toBeVisible();

  // Sale price, sold-out state, and the size picker on their own pages.
  await page.goto("/products/demo-cap");
  await expect(page.locator("[data-product-price]")).toContainText("$24.00");
  await page.goto("/products/demo-socks");
  await expect(page.locator("[data-product-status]")).toHaveText("Out of stock");
  await expect(page.locator("[data-add-to-cart]")).toHaveCount(0);
  await page.goto("/products/demo-hoodie");
  await expect(page.locator("[data-product-from-price]")).toHaveText("from $56.00");
  await expect(page.locator("[data-variant-price]")).toHaveText("$56.00");
  await page.getByLabel("Medium").check();
  await expect(page.locator("[data-variant-price]")).toHaveText("$60.00");
});
