import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { openProductsList, sellProduct } from "./helpers/product-page";
import { keptRating, requireReviews, seedAskedOrder } from "./helpers/reviews";

const proofRoot = resolve("runs/product-reviews-20261122/browser");

/** A buyer sends a review through the store's own /review page, as the emailed link does. */
async function sendReview(page: Page, link: string, stars: number, body: string, name?: string) {
  expect((await page.goto(link))?.status()).toBe(200);
  await page.locator(`input[name=stars][value='${stars}']`).check();
  if (body) await page.getByLabel("Your review (optional)").fill(body);
  if (name !== undefined) await page.getByLabel("Name shown with your review").fill(name);
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator("[data-review-submit]").click()]);
  await expect(page.locator("[data-review-result]")).toHaveAttribute("data-review-result", "sent");
}

type RatedJsonLd = { "@type"?: string; offers?: unknown; aggregateRating?: Record<string, unknown>; review?: { author: { name: string }; reviewRating: { ratingValue: number }; reviewBody?: string; datePublished: string }[] };
/** The product's data for search engines, as the page carries it. */
const jsonLd = async (page: import("@playwright/test").Page) =>
  JSON.parse(await page.locator("script[data-product-jsonld]").textContent() ?? "{}") as RatedJsonLd;

test("a product page shows its rating under the title and its reviews below, and nothing when it has none", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  requireReviews();
  const tag = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  const admin = await page.context().browser()!.newPage();
  await openProductsList(admin);
  const reviewed = await sellProduct(admin.request, { title: `Reviewed Mug ${tag}`, sku: `RVW-MUG-${tag.toUpperCase()}`, regular: "18.00" });
  const quiet = await sellProduct(admin.request, { title: `Quiet Mug ${tag}`, sku: `RVW-QUIET-${tag.toUpperCase()}`, regular: "18.00" });
  await admin.close();
  const path = `/products/rvw-mug-${tag}`;
  const trace: unknown[] = [];

  // No review yet: the page shows no stars and no reviews section, as Shopify's Dawn and WooCommerce do.
  expect((await page.goto(path))?.status()).toBe(200);
  await expect(page.locator("[data-product-page]")).toHaveAttribute("data-commerce-item", reviewed.itemId);
  await expect(page.locator("[data-product-rating]")).toHaveCount(0);
  await expect(page.locator("[data-product-reviews]")).toHaveCount(0);
  const bare = await jsonLd(page);
  expect(bare["@type"]).toBe("Product");
  expect(bare.aggregateRating).toBeUndefined();
  expect(bare.review).toBeUndefined();
  trace.push({ step: "no reviews yet", rating: "none shown", reviews: "none shown", jsonLd: "no aggregateRating, no review" });

  // Two buyers review it through the store's /review page: 5 stars with words, then 4 stars with no words or name.
  const line = [{ productId: reviewed.itemId, productName: `Reviewed Mug ${tag}` }];
  await sendReview(page, seedAskedOrder(`stars-a-${tag}`, line, { name: "Sam Taylor" }).link(reviewed.itemId), 5, "Keeps coffee hot for hours.\nWould buy again.");
  await sendReview(page, seedAskedOrder(`stars-b-${tag}`, line, { name: "Pat Shopper" }).link(reviewed.itemId), 4, "", "");
  expect(keptRating(reviewed.itemId)).toMatchObject({ value: 4.5, count: 2 });

  expect((await page.goto(path))?.status()).toBe(200);
  const rating = page.locator("[data-product-rating]");
  await expect(rating).toHaveAttribute("data-product-rating", "4.5");
  await expect(rating).toHaveAttribute("data-product-rating-count", "2");
  await expect(rating).toContainText("4.5 / 5");
  await expect(rating.getByRole("img")).toHaveAttribute("aria-label", "4.5 out of 5 stars, 2 reviews");
  await expect(rating.getByRole("link")).toHaveText("(2)");
  // The rating sits under the product's title, above the price.
  const order = await page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
    return { title: top(".product-detail__body h1"), rating: top("[data-product-rating]"), price: top("[data-product-price]") };
  });
  expect(order.title).toBeLessThan(order.rating);
  expect(order.rating).toBeLessThan(order.price);
  const section = page.locator("[data-product-reviews]");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(`2 reviews for Reviewed Mug ${tag}`);
  const items = section.locator("[data-product-review]");
  await expect(items).toHaveCount(2);
  // Newest first: the 4-star review with no words, shown under the name Reviews gives a buyer who left none.
  await expect(items.nth(0).getByRole("img")).toHaveAttribute("aria-label", "4 out of 5 stars");
  await expect(items.nth(0)).toContainText("Verified buyer");
  await expect(items.nth(1).getByRole("img")).toHaveAttribute("aria-label", "5 out of 5 stars");
  await expect(items.nth(1)).toContainText("Sam T.");
  await expect(items.nth(1)).toContainText("(verified buyer)");
  await expect(items.nth(1)).toContainText("Keeps coffee hot for hours.");
  // Nothing about the buyer beyond the name they chose, and no script draws the reviews.
  const html = await page.content();
  for (const secret of ["Taylor", "Shopper", "@example.test", "ord-stars-"]) expect(html).not.toContain(secret);
  expect(await section.locator("script").count()).toBe(0);
  // The count under the title leads to the reviews.
  await rating.getByRole("link").click();
  await expect(page).toHaveURL(/#reviews$/u);
  await expect(section).toBeInViewport();
  await page.goto(path);
  await page.screenshot({ path: resolve(root, "rating-and-reviews.png"), fullPage: true });
  // Search engines read the same rating and reviews from the product's data, beside its offer.
  const two = await jsonLd(page);
  expect(two.offers).toBeTruthy();
  expect(two.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4.5, bestRating: 5, worstRating: 1, reviewCount: 2 });
  expect(two.review?.map((review) => [review.author.name, review.reviewRating.ratingValue, review.reviewBody])).toEqual([
    ["Verified buyer", 4, undefined], ["Sam T.", 5, "Keeps coffee hot for hours.\nWould buy again."],
  ]);
  expect(two.review?.[0]?.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  expect(JSON.stringify(two)).not.toMatch(/Taylor|Shopper|@example\.test|ord-stars-/u);
  trace.push({ step: "two reviews (5 and 4 stars)", rating: "4.5 / 5", count: 2, heading: await section.getByRole("heading", { level: 2 }).innerText(), kept: keptRating(reviewed.itemId), jsonLd: { aggregateRating: two.aggregateRating, reviews: two.review?.length } });

  // 21 more reviews: the page shows 20, and "More reviews" shows the rest on the same page's address.
  for (let index = 0; index < 21; index++) {
    await sendReview(page, seedAskedOrder(`stars-more-${tag}-${index}`, line).link(reviewed.itemId), 5, `Review number ${index + 1}`);
  }
  expect((await page.goto(path))?.status()).toBe(200);
  await expect(page.locator("[data-product-rating]")).toHaveAttribute("data-product-rating-count", "23");
  await expect(section.getByRole("heading", { level: 2 })).toHaveText(`23 reviews for Reviewed Mug ${tag}`);
  await expect(items).toHaveCount(20);
  await expect(items.nth(0)).toContainText("Review number 21");
  // The product's data carries the 5 newest reviews, as WooCommerce's does, and the full count.
  const many = await jsonLd(page);
  expect(many.aggregateRating).toMatchObject({ reviewCount: 23 });
  expect(many.review?.map((review) => review.reviewBody)).toEqual([21, 20, 19, 18, 17].map((n) => `Review number ${n}`));
  const more = page.locator("[data-product-reviews-more]");
  await expect(more).toHaveText("More reviews");
  await more.click();
  await expect(page).toHaveURL(/[?&]reviews=[^#]+#reviews$/u);
  await expect(items).toHaveCount(3);
  await expect(items.nth(2)).toContainText("Keeps coffee hot for hours.");
  await expect(page.locator("[data-product-reviews-more]")).toHaveCount(0);
  // The later page keeps the rating and names no reviews: the newest are not on it.
  const later = await jsonLd(page);
  expect(later.aggregateRating).toMatchObject({ reviewCount: 23 });
  expect(later.review).toBeUndefined();
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", new RegExp(`${path}$`, "u"));
  trace.push({ step: "23 reviews", firstPage: 20, secondPage: 3, kept: keptRating(reviewed.itemId), jsonLd: { firstPageReviews: many.review?.length, reviewCount: many.aggregateRating?.reviewCount, laterPageReviews: 0 } });

  // The other product has no review: still no stars, no section.
  expect((await page.goto(`/products/rvw-quiet-${tag}`))?.status()).toBe(200);
  await expect(page.locator("[data-product-page]")).toHaveAttribute("data-commerce-item", quiet.itemId);
  await expect(page.locator("[data-product-rating]")).toHaveCount(0);
  await expect(page.locator("[data-product-reviews]")).toHaveCount(0);
  expect((await jsonLd(page)).aggregateRating).toBeUndefined();
  trace.push({ step: "another product with no reviews", rating: "none shown", jsonLd: "no aggregateRating" });
  await writeFile(resolve(root, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ project: testInfo.project.name, trace }));
});
