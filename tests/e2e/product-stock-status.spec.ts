import { expect, test } from "@playwright/test";

test("variant availability is a retained polite status without moving picker focus", async ({ page, request }) => {
  test.setTimeout(180_000);
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  // The existing demo seed has Black/Large sold out and Black/Medium in stock.
  await page.goto("/");
  await page.goto("/products/demo-hoodie");
  const status = page.locator("[data-product-status]");
  for (const label of await page.locator(".product-variant").all()) {
    const box = await label.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  if (page.viewportSize()!.width <= 768) {
    for (const control of await page.locator("[data-add-to-cart-qty], [data-add-to-cart-qty-step]").all()) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expect(status).toHaveText("In stock");
  await expect(status).toHaveRole("status");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  // The live region must exist before the browser changes its text (including JS-off).
  const html = await (await request.get("/products/demo-hoodie")).text();
  expect(html).toMatch(/<p\b[^>]*data-product-status[^>]*role="status"[^>]*aria-atomic="true"/);
  const retained = await status.elementHandle();
  const large = page.locator('[data-variant-choice][value="Large"]');
  await large.focus();
  await large.press("Space");
  await expect(large).toBeChecked();
  await expect(large).toBeFocused();
  await expect(status).toHaveText("Out of stock");
  await expect(status).toHaveAttribute("data-availability-status", "out-of-stock");
  await expect(page.locator("[data-add-to-cart]")).toBeDisabled();
  await expect(status).toHaveRole("status");
  expect(await status.evaluate((node, original) => node === original, retained)).toBe(true);
  await large.press("ArrowLeft");
  const medium = page.locator('[data-variant-choice][value="Medium"]');
  await expect(medium).toBeChecked();
  await expect(medium).toBeFocused();
  await expect(status).toHaveText("In stock");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  expect(await status.evaluate((node, original) => node === original, retained)).toBe(true);

  // A simple product's static availability is not a live region.
  await page.goto("/products/demo-socks");
  await expect(status).toHaveText("Out of stock");
  await expect(status).not.toHaveAttribute("role");
  await expect(status).not.toHaveAttribute("aria-atomic");
});
