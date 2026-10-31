import { expect, test } from "@playwright/test";

test("live search result keyboard navigation continues after focus leaves the input", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/search");
  const search = page.locator("emdash-live-search");
  const input = search.locator('input[type="search"]');
  const results = search.locator(".emdash-live-search-results-list .emdash-live-search-result");
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get("emdash-live-search")))).toBe(true);
  const response = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/_emdash/api/search" && url.searchParams.get("q") === "for";
  });
  // Several seeded published descriptions contain "for"; this exercises real
  // mixed product/category results rather than a one-result or mocked list.
  await input.pressSequentially("for");
  expect((await response).ok()).toBe(true);
  await expect.poll(() => results.count()).toBeGreaterThanOrEqual(2);
  const count = await results.count();
  // Repeated Astro page-load notifications must not double-bind navigation.
  await page.evaluate(() => document.dispatchEvent(new Event("astro:page-load")));
  await page.evaluate(() => document.dispatchEvent(new Event("astro:page-load")));

  await input.press("ArrowDown");
  await expect(results.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(results.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(results.nth(count - 1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(results.nth(0)).toBeFocused();

  // Native Tab navigation and link activation remain available.
  await page.keyboard.press("Tab");
  await expect(results.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search.locator(".emdash-live-search-results")).toBeHidden();
  await expect(input).toBeFocused();
  const reopened = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/_emdash/api/search" && url.searchParams.get("q") === "for";
  });
  await input.pressSequentially("x");
  await input.press("ControlOrMeta+A");
  await input.pressSequentially("for");
  expect((await reopened).ok()).toBe(true);
  await expect(search.locator(".emdash-live-search-results-list")).toBeVisible();
  await expect.poll(() => results.count()).toBeGreaterThanOrEqual(2);
  await input.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const href = await results.nth(1).getAttribute("href");
  expect(href).toMatch(/^\/(?:products\/|categories\/|[a-z])/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new URL(href!, page.url()).href);
});
