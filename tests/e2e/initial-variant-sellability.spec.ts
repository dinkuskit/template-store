import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { catalogOp, COMMERCE_API, COMMERCE_SKU_INDEX } from "./helpers/product-page";

const headers = { "X-EmDash-Request": "1" };

for (const javaScriptEnabled of [false, true]) {
  test(`cold sold-out options stay honest and recover to a buyable option (${javaScriptEnabled ? "enhanced" : "plain"})`, async ({ browser, request }, testInfo) => {
    test.setTimeout(180_000);
    // Authenticate only the disposable merchant API; shopper contexts below start without its cookies.
    expect((await request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
    expect((await request.get(`${COMMERCE_API}/catalog/public`)).ok()).toBe(true);
    await expect.poll(() => execFileSync("sqlite3", [".artifacts/e2e/content.db",
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_%'",
    ], { encoding: "utf8" }), { timeout: 90_000 }).toContain(COMMERCE_SKU_INDEX);

    const sku = `COLD-${testInfo.project.name}-${javaScriptEnabled ? "JS" : "PLAIN"}`.toUpperCase();
    const slug = sku.toLowerCase();
    const created = await request.post("/_emdash/api/content/products", { headers, data: { slug, data: { title: "Option tee", visual_label: "Tee" } } });
    expect(created.ok(), await created.text()).toBe(true);
    const entry = (await created.json()).data;
    const pageId: string = (entry.item ?? entry).id;
    const context = await browser.newContext({ javaScriptEnabled, viewport: testInfo.project.use.viewport,
      isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
    try {
      const { catalogItemId: small } = await catalogOp<{ catalogItemId: string }>(request, { op: "create", commandId: sku, entryId: pageId, name: "Option tee", sku });
      const choice = await catalogOp<{ product: { members: { catalogItemId: string }[] } }>(request, {
        op: "option", productId: small, optionId: "size", optionLabel: "Size", values: [
          { valueId: "small", label: "Small", member: { catalogItemId: small, fulfillment: "physical" } },
          { valueId: "large", label: "Large", member: { commandId: `${sku}-L`, name: "Option tee", sku: `${sku}-L`, fulfillment: "physical" } },
          { valueId: "xl", label: "XL", member: { commandId: `${sku}-XL`, name: "Option tee", sku: `${sku}-XL`, fulfillment: "physical" } },
        ],
      });
      const [, large, xl] = choice.product.members.map(member => member.catalogItemId);
      expect(large).toBeTruthy();
      expect(xl).toBeTruthy();
      for (const [id, regular, stockStatus] of [[small, "24", "in-stock"], [large!, "26", "on-backorder"], [xl!, "28", "out-of-stock"]]) {
        const saved = await catalogOp<{ saved: boolean }>(request, { op: "prices", catalogItemId: id, productId: small, regular, sale: "", stockStatus });
        expect(saved.saved).toBe(true);
      }
      expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
      const shopper = await context.newPage();
      // Both the canonical selected-option URL and the agent/feed landing must render honestly from cold HTML.
      const paths = javaScriptEnabled ? [`/variants/${xl}`] : [`/products/${slug}?variant=${xl}`, `/variants/${xl}`];
      for (const path of paths) {
        await shopper.goto(path);
        await expect(shopper.locator('[data-variant-choice][value="XL"]')).toBeChecked();
        await expect(shopper.locator("[data-product-status]")).toHaveText("Out of stock");
        await expect(shopper.locator("[data-add-to-cart]")).toHaveAttribute("data-add-to-cart-sellable", "false");
        await expect(shopper.locator("[data-add-to-cart]")).toBeDisabled();
        await expect(shopper.locator("[data-add-to-cart]")).toHaveText("Sold out");
      }
      // Disabled presentation is not a security boundary: a forged POST still cannot add the sold-out member.
      const refused = await shopper.request.post("/cart/add.js", {
        headers: { origin: new URL(shopper.url()).origin }, form: { productId: small, "options[Size]": "XL", quantity: "1" },
      });
      expect(refused.status()).toBe(422);
      expect((await (await shopper.request.get("/cart.js")).json()).cart.lines).toEqual([]);
      for (const [id, label, status, amount] of [[small, "Small", "In stock", "$24.00"], [large!, "Large", "Available on backorder", "$26.00"]]) {
        if (javaScriptEnabled) {
          // Vite may finish this page's module after navigation. Its price decoration is appended
          // after the picker listeners, so do not race a fast cached navigation with the radio check.
          await expect(shopper.locator("[data-product-price] [data-rough-callout]")).toBeAttached();
          await shopper.getByRole("radio", { name: label, exact: true }).check();
        } else {
          await shopper.locator("[data-product-options-fallback] select").selectOption(id);
          await shopper.locator("[data-product-options-fallback] button").click();
          await expect(shopper).toHaveURL(new RegExp(`[?&]variant=${id}$`, "u"));
        }
        await expect(shopper.locator("[data-product-status]")).toHaveText(status);
        await expect(shopper.locator("[data-variant-price]")).toHaveText(amount);
        const add = shopper.locator("[data-add-to-cart]");
        await expect(add).toBeEnabled();
        await expect(add).toHaveText("Add to cart");
        await shopper.locator("[data-add-to-cart-qty]").fill("2");
        await shopper.locator("[data-add-to-cart-qty]").press("Enter");
        if (javaScriptEnabled) await expect(shopper.locator("[data-add-to-cart-status]")).toHaveText("Added to your cart.");
        else await expect(shopper).toHaveURL(/\/cart\?added=2$/u);
        const cart = (await (await shopper.request.get("/cart.js")).json()).cart;
        expect(cart.lines.find((line: { catalogItemId: string }) => line.catalogItemId === id)).toMatchObject({ quantity: 2 });
        if (javaScriptEnabled) {
          await shopper.getByRole("radio", { name: "XL (sold out)", exact: true }).check();
        } else {
          await shopper.goto(`/variants/${xl}`);
        }
        await expect(shopper.locator("[data-add-to-cart]")).toBeDisabled();
      }
      const cart = (await (await shopper.request.get("/cart.js")).json()).cart;
      expect(cart.lines).toHaveLength(2);
      expect(cart.itemCount).toBe(4);
    } finally {
      await context.close();
      expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
    }
  });
}
