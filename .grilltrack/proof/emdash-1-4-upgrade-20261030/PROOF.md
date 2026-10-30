# EmDash 1.2.0 to 1.4.0 upgrade of a filled store

PR: dinkuskit/template-store#176, head `6c63352` (EmDash 1.4.0, Commerce `v0.7.0-beta.4` b3494cb).
Before: template-store main `3dc4294` (EmDash 1.2.0, Commerce `v0.7.0-beta.3` 7740b4c).
Run 30 Oct 2026 in a cloud container, Node 24.22.0, local SQLite store (`DINKUS_STOREFRONT_PROFILE=proof`,
`DINKUS_CATALOG_PROFILE=native-development`), the same environment the browser suite uses.

## Steps

1. On main `3dc4294`, filled a store with main's own browser specs
   (`tests/e2e/commerce-catalog.spec.ts` and `tests/e2e/cms-pages-and-redirects.spec.ts`, desktop, 4 passed):
   the seeded demo catalog plus a merchant-made product page whose price was set, put on sale, edited and finally cleared.
2. Copied that database (sha256 `717f7ffa…31a8b8`) twice. Started main's store (1.2.0) on one copy and recorded the
   anonymous storefront: product cards and prices on `/`, the status of every published product page and category page.
3. Started this PR's store (1.4.0 + beta.4) on the other, byte-identical copy, recorded the same, then edited the
   existing product in the admin (spec below, 1 passed).
4. Compared the two databases.

## Results

| Check | EmDash 1.2.0 store | Same data on EmDash 1.4.0 |
|---|---|---|
| Starts on the existing database | yes | yes, no errors in the server log |
| Core migrations | 90, last `091_redirect_artifacts` | 90, last `091_redirect_artifacts` (nothing new to run) |
| Plugins (`_plugin_state`) | dinkus-commerce 0.2.0 active; dinkus-template-product-urls 1.0.0 active | same |
| Content | 4 pages, 15 products, 3 categories | same |
| Commerce storage | catalogItems 15, product_pages 11 | same |
| Home page cards | 9 | 9, same ids |
| Home page prices | regular:$14.00, regular:$18.00, regular:$22.00, regular:$26.00, regular:$28.00, regular:$30.00, regular:$32.00, regular:$48.00, regular:$56.00, sale:$24.00, sale:$42.00 | identical |
| Product pages | boxy-tee-preview 200, canvas-cap 200, demo-bottle 200, demo-cap 200, demo-hoodie 200, demo-mug 200, demo-shirt 200, demo-socks 200, demo-throw 200, demo-tote 200, demo-tray 200, everyday-tee 200, merchant-chromium-desktop 404, pullover-hoodie-preview 200, ribbed-beanie-preview 200 | identical (the merchant page is 404 because step 1 left it without a price) |
| Category pages | hats 200, hoodies 200, tees 200 | identical |

On 1.4.0 the existing merchant product still shows "Published: off the shop · SKU MERCHANT-chromium-desktop" in its
Commerce panel (link and SKU kept). Saving Regular 30 / Sale 25 there put it back on the shop at $30.00 / $25.00, and
its page `/products/merchant-chromium-desktop` answered 200.

The Registry (workerd sandbox) path is covered separately by `pnpm verify:paired-product-on-sale` against the real
`v0.7.0-beta.4` build (digests verified, 5 passed), and next by the approved beta store refresh plus a journeys run.

## Edit check (run from an ignored folder, importing the repo's helpers)

```ts
import { expect, test } from "@playwright/test";
import { openPanel, openProductPage, pageProductId, panelPrice, savePanelPrices } from "../../tests/e2e/helpers/product-page";

// A store filled on EmDash 1.2.0 + Commerce 0.7.0-beta.3 (main's own specs), restarted on 1.4.0 + beta.4.
test("the upgraded store still edits and sells its existing product", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const context = await browser.newContext();
  const admin = await context.newPage();
  const pageId = "01M66WEDGDG1NNVNRE7RR15P41";
  await admin.goto("/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin");
  const itemId = await pageProductId(admin.request, pageId);
  expect(itemId).toMatch(/\S/);
  await openProductPage(admin, pageId);
  // Left by the 1.2 run unpriced: Commerce kept the product and its page link.
  await expect((await openPanel(admin)).getByText("Published: off the shop · SKU MERCHANT-chromium-desktop", { exact: false })).toBeVisible();
  const card = page.locator(`[data-commerce-product="${itemId}"]`);
  await page.goto("/");
  await expect(card).toHaveCount(0);
  const panel = await savePanelPrices(admin, "30", "25");
  await expect(panelPrice(admin, panel, "Regular")).toHaveValue("30.00");
  await expect(panelPrice(admin, panel, "Sale")).toHaveValue("25.00");
  await page.goto("/");
  await expect(card.locator("s[data-regular-price]")).toHaveText("$30.00");
  await expect(card.locator("[data-sale-price]")).toHaveText("$25.00");
  expect((await request.get("/products/merchant-chromium-desktop")).status()).toBe(200);
  await context.close();
});
```
