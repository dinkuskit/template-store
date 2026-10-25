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
  await expect(page.locator("[data-product-page] h1")).toHaveText("Dinkus Demo Heavyweight T-Shirt");
  await expect(page.locator("[data-product-price]")).toHaveText("$32.00");
  await expect(page.locator("[data-product-status]")).toHaveText("In stock");
  await expect(page.locator("[data-product-sku]")).toHaveText("SKU DEMO-HOSTED-SHIRT");
  await expect(page.locator(".product-detail img[data-demo-placeholder]")).toBeVisible();
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  const shirtJsonLd = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "");
  expect(shirtJsonLd["@type"]).toBe("Product");
  expect(shirtJsonLd.sku).toBe("DEMO-HOSTED-SHIRT");
  expect(shirtJsonLd.offers.price).toBe("32.00");
  expect(shirtJsonLd.offers.priceCurrency).toBe("USD");
  expect(shirtJsonLd.offers.availability).toBe("https://schema.org/InStock");

  // Sale price, sold-out state, and the size picker on their own pages.
  await page.goto("/products/demo-cap");
  await expect(page.locator("[data-product-price]")).toContainText("$24.00");
  await page.goto("/products/demo-socks");
  await expect(page.locator("[data-product-status]")).toHaveText("Out of stock");
  await expect(page.locator("[data-add-to-cart]")).toHaveCount(0);
  await page.goto("/products/demo-hoodie");
  // One Color picker, one Size picker and one Add to cart; the sold-out Black Large stays visible.
  await expect(page.locator("[data-product-from-price]")).toHaveCount(0);
  await expect(page.locator("[data-product-variants]")).toHaveCount(2);
  await expect(page.locator("[data-product-variants] legend")).toHaveText(["Color", "Size"]);
  await expect(page.getByLabel("Black")).toBeChecked();
  await expect(page.locator("[data-add-to-cart-batch]")).toHaveCount(0);
  await expect(page.getByLabel("Large")).toHaveAttribute("data-variant-sold-out", "true");
  await expect(page.locator("[data-variant-price]")).toHaveText("$56.00");
  const hoodieJsonLd = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "");
  const hoodieCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(hoodieJsonLd.offers).toMatchObject({ price: "56.00", availability: "https://schema.org/InStock" });
  await page.getByLabel("Medium").check();
  await expect(page.locator("[data-variant-price]")).toHaveText("$60.00");
  const hoodieAfterChange = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "");
  expect(hoodieAfterChange.offers).toMatchObject({ price: "60.00", availability: "https://schema.org/InStock", url: hoodieCanonical });
  expect(hoodieAfterChange.sku).toBe(await page.locator("[data-product-sku]").getAttribute("data-product-sku"));
  expect(hoodieAfterChange.url).toBe(hoodieCanonical);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", hoodieCanonical ?? "");
  await page.getByLabel("Small").check();
  await expect(page.locator("[data-variant-price]")).toHaveText("$56.00");
  expect(JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "")).toEqual(hoodieJsonLd);
  // Large is only sold out in Black.
  await page.getByLabel("Heather gray").check();
  await expect(page.getByLabel("Large")).toHaveAttribute("data-variant-sold-out", "false");
  await page.getByLabel("Large").check();
  await expect(page.locator("[data-variant-price]")).toHaveText("$60.00");
  await expect(page.locator("[data-product-status]")).toHaveText("In stock");
  await page.getByLabel("Black").check();
  await expect(page.locator("[data-product-status]")).toHaveText("Out of stock");
  await page.getByLabel("Medium").check();
  await page.reload();
  await expect(page.getByLabel("Black")).toBeChecked();
  await expect(page.getByLabel("Small")).toBeChecked();
  expect(JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "")).toEqual(hoodieJsonLd);
});
