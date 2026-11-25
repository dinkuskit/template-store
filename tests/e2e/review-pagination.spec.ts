import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { sellProduct } from "./helpers/product-page";
import { requireReviews, REVIEWS_ID, seedAskedOrder } from "./helpers/reviews";

test.use({ javaScriptEnabled: false });

test("a saved older review page can return to the latest after moderation", async ({ page, request, playwright }, testInfo) => {
  test.setTimeout(180_000);
  requireReviews();
  const tag = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  const origin = testInfo.project.use.baseURL!;
  const slug = `pagination-mug-${tag}`;
  const productName = "Creekside Camp Mug";
  const path = `/products/${slug}?variant=saved-selection`;
  const admin = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await admin.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
    const product = await sellProduct(admin, { title: productName, sku: slug.toUpperCase(), slug, regular: "18.00" });
    for (let index = 0; index < 21; index++) {
      const asked = seedAskedOrder(`pagination-${tag}-${index}`, [{ productId: product.itemId, productName }]);
      const response = await request.post(asked.link(product.itemId), {
        headers: { origin, "sec-fetch-site": "same-origin" },
        form: { stars: "4", body: `Field note ${index + 1}`, name: "" },
      });
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain('data-review-result="sent"');
      await response.dispose();
    }

    await page.setViewportSize({ width: tag === "mobile" ? 390 : 1440, height: 900 });
    expect((await page.goto(path))?.status()).toBe(200);
    const section = page.locator("#reviews");
    const reviews = section.locator("[data-product-review]");
    await expect(reviews).toHaveCount(20);
    await expect(reviews.first()).toContainText("Field note 21");
    await section.getByRole("link", { name: "More reviews" }).click();
    await expect(reviews).toHaveCount(1);
    await expect(reviews).toContainText("Field note 1");
    const bookmark = page.url();
    const olderId = await reviews.getAttribute("data-product-review");
    const moderation = await admin.post(`/_emdash/api/plugins/${REVIEWS_ID}/admin`, {
      headers: { "X-EmDash-Request": "1" },
      data: { page: "/reviews", type: "block_action", action_id: `hide:${olderId}` },
    });
    expect(moderation.status()).toBe(200);
    expect((await moderation.json()).data.toast?.type).toBe("success");

    await page.goto(path);
    const stale = await page.goto(bookmark);
    expect(stale?.status()).toBe(200);
    await expect(section.getByRole("heading")).toHaveText(`20 reviews for ${productName}`);
    await expect(reviews).toHaveCount(0);
    const root = resolve("runs/review-pagination/browser", testInfo.project.name);
    await mkdir(root, { recursive: true });
    const recovery = section.getByRole("link", { name: "Back to latest reviews" });
    console.log(JSON.stringify({ project: testInfo.project.name, staleStatus: stale?.status(), reviewCount: 20, visibleReviews: 0, recoveryLinks: await recovery.count() }));
    await expect(section).toContainText("No reviews on this page.", { timeout: 2000 });
    await recovery.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${origin}${path}#reviews`);
    await expect(reviews).toHaveCount(20);
    await expect(reviews.first()).toContainText("Field note 21");
    await expect(recovery).toHaveCount(0);
    const data = JSON.parse(await page.locator("script[data-product-jsonld]").textContent() ?? "{}");
    expect(data.review).toHaveLength(5);
    const savedUrl = new URL(bookmark);
    const proof = { stalePath: `${savedUrl.pathname}${savedUrl.search}${savedUrl.hash}`, staleStatus: stale?.status(), reviewCount: 20, recoveredRows: await reviews.count(), queryPreserved: true, javaScriptEnabled: false };
    await writeFile(resolve(root, "recovery.json"), `${JSON.stringify(proof)}\n`);
    console.log(JSON.stringify({ project: testInfo.project.name, recoveredRows: proof.recoveredRows, queryPreserved: true, javaScriptEnabled: false }));
  } finally {
    await admin.dispose();
  }
});
