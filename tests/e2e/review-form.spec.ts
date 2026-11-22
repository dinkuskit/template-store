import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { openProductsList } from "./helpers/product-page";
import { keptRating, keptReviews, requireReviews, reviewsStorage, seedAskedOrder } from "./helpers/reviews";

const proofRoot = resolve("runs/review-page-20261122/browser");
const SECRET = "ab".repeat(32);
const LINK = `/review?o=evt_1&p=camp-mug&k=${SECRET}`;
const tagOf = (project: string) => (project.includes("mobile") ? "mobile" : "desktop");

/** The installed plugins build their storage indexes on a fresh store's first admin requests. */
async function warm(page: Page) {
  requireReviews();
  const admin = await page.context().browser()!.newPage();
  await openProductsList(admin);
  await admin.close();
}

for (const [name, address] of [["no link", "/review"], ["a made-up link", LINK]] as const) {
  test(`the review page answers ${name} as a link that does not work`, async ({ page }, testInfo) => {
    const response = await page.goto(address);
    expect(response?.status()).toBe(404);
    const headers = response!.headers();
    expect(headers["cache-control"]).toBe("no-store");
    // The link's secret is in the address, so the page never passes its address on.
    expect(headers["referrer-policy"]).toBe("no-referrer");
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.locator("[data-review-page]")).toHaveAttribute("data-review-page", "closed");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This link does not work");
    await expect(page.locator("[data-review-form]")).toHaveCount(0);
    expect(await page.content()).not.toContain(SECRET);
    await expect(page.locator("[data-store-header]")).toBeVisible();
    const root = resolve(proofRoot, testInfo.project.name);
    await mkdir(root, { recursive: true });
    await page.screenshot({ path: resolve(root, `closed-${address === LINK ? "link" : "bare"}.png`), fullPage: true });
  });
}

test("the emailed link opens a plain form, keeps one review per product and keeps what was typed", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await warm(page);
  const tag = tagOf(testInfo.project.name);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  const mug = `form-mug-${tag}`, hat = `form-hat-${tag}`;
  const order = seedAskedOrder(`form-${tag}`, [{ productId: mug, productName: "Camp mug" }, { productId: hat, productName: "Red hat" }]);
  const trace: unknown[] = [];

  // 1. The link opens the form for that product, and shows nothing of the order or the buyer's email.
  let response = await page.goto(order.link(mug));
  expect(response?.status()).toBe(200);
  expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response!.headers()["cache-control"]).toBe("no-store");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How was Camp mug?");
  await expect(page.locator("[data-review-form]")).toHaveAttribute("method", "post");
  await expect(page.getByLabel("Name shown with your review")).toHaveValue("Sam T.");
  expect(await page.locator("[data-review-page] script").count()).toBe(0);
  const html = await page.content();
  expect(html).not.toContain(order.orderId);
  expect(html).not.toContain("@example.test");
  expect(html).not.toContain("Taylor");
  await page.screenshot({ path: resolve(root, "1-form.png"), fullPage: true });
  trace.push({ step: "open link", status: 200, heading: "How was Camp mug?", name: "Sam T." });

  // 2. Sent without a rating (the browser's own check switched off): refused, and the words typed are kept.
  await page.getByLabel("Your review (optional)").fill("Keeps coffee hot for hours.");
  await page.locator("input[name=stars]").evaluateAll((inputs) => inputs.forEach((input) => input.removeAttribute("required")));
  [response] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator("[data-review-submit]").click()]);
  expect(response!.status()).toBe(422);
  await expect(page.locator("[data-review-error]")).toHaveText("Choose a rating from 1 to 5 stars.");
  await expect(page.getByLabel("Your review (optional)")).toHaveValue("Keeps coffee hot for hours.");
  expect(keptReviews(order.orderId)).toHaveLength(0);
  await page.screenshot({ path: resolve(root, "2-refused.png"), fullPage: true });
  trace.push({ step: "send without stars", status: 422, message: "Choose a rating from 1 to 5 stars.", kept: 0 });

  // 3. With a rating: kept and published.
  await page.locator("input[name=stars][value='5']").check();
  [response] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator("[data-review-submit]").click()]);
  expect(response!.status()).toBe(200);
  await expect(page.locator("[data-review-result]")).toHaveAttribute("data-review-result", "sent");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thank you for your review");
  await page.screenshot({ path: resolve(root, "3-thanks.png"), fullPage: true });
  expect(keptReviews(order.orderId)).toHaveLength(1);
  expect(keptReviews(order.orderId)[0]).toMatchObject({ productId: mug, stars: 5, body: "Keeps coffee hot for hours.", name: "Sam T.", status: "published" });
  expect(keptRating(mug)).toMatchObject({ value: 5, count: 1 });
  trace.push({ step: "send with 5 stars", status: 200, result: "sent", rating: keptRating(mug) });

  // 4. The same link again: already reviewed.
  expect((await page.goto(order.link(mug)))?.status()).toBe(200);
  await expect(page.locator("[data-review-result]")).toHaveAttribute("data-review-result", "already");
  await page.screenshot({ path: resolve(root, "4-already.png"), fullPage: true });
  // 5. The order's other product has its own form.
  expect((await page.goto(order.link(hat)))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How was Red hat?");
  trace.push({ step: "same link again", status: 200, result: "already" }, { step: "other product", status: 200 });
  await writeFile(resolve(root, "journey.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ project: testInfo.project.name, trace }));
});

test("refused posts keep nothing, and the longest allowed review is kept whole", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await warm(page);
  const tag = tagOf(testInfo.project.name);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  const mug = `refuse-mug-${tag}`;
  const lines = [{ productId: mug, productName: "Camp mug" }];
  const fresh = seedAskedOrder(`refuse-fresh-${tag}`, lines, { askedDaysAgo: 59 });
  const old = seedAskedOrder(`refuse-old-${tag}`, lines, { askedDaysAgo: 61 });
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const post = (address: string, headers: Record<string, string> = { origin, "sec-fetch-site": "same-origin" }) => page.request.post(address, {
    headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, data: "stars=1&body=Not+allowed&name=Mallory", maxRedirects: 0 });
  const trace: unknown[] = [];
  const refused = async (step: string, address: string, expected: number, headers?: Record<string, string>) => {
    const before = reviewsStorage();
    const response = await post(address, headers);
    expect(response.status(), step).toBe(expected);
    const html = await response.text();
    expect(html).not.toContain('data-review-result="sent"');
    expect(html).not.toContain('data-review-result="held"');
    expect(reviewsStorage(), step).toBe(before);
    trace.push({ step, status: response.status(), storageUnchanged: true });
  };

  await refused("POST with a wrong secret", fresh.link(mug, "cd".repeat(32)), 404);
  await refused("POST for a product not in the order", fresh.link("blue-hat"), 404);
  // A link works for 60 days: the right secret a day later opens nothing and keeps nothing.
  expect((await page.goto(old.link(mug)))?.status()).toBe(404);
  await refused("POST with the right secret, link asked 61 days ago", old.link(mug), 404);
  await refused("POST from another site, right secret", fresh.link(mug), 403, { origin: "https://evil.example.test", "sec-fetch-site": "cross-site" });

  // The longest review the form allows, in Chinese characters, which a plain form sends as 9 bytes each.
  const words = "漢".repeat(2000), name = "名".repeat(60);
  expect((await page.goto(fresh.link(mug)))?.status()).toBe(200);
  await page.locator("input[name=stars][value='5']").check();
  await page.getByLabel("Your review (optional)").fill(words);
  await page.getByLabel("Name shown with your review").fill(name);
  const [response] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator("[data-review-submit]").click()]);
  const bytes = Buffer.byteLength(response.request().postData() ?? "");
  expect(bytes).toBeGreaterThan(16 * 1024);
  expect(response.status()).toBe(200);
  await expect(page.locator("[data-review-result]")).toHaveAttribute("data-review-result", "sent");
  const kept = keptReviews(fresh.orderId);
  expect(kept).toHaveLength(1);
  expect(kept[0]!.body).toBe(words);
  expect(kept[0]!.name).toBe(name);
  trace.push({ step: "browser form, 2,000 Chinese characters and a 60-character name, link asked 59 days ago", formBytes: bytes, status: 200, result: "sent", keptCharacters: 2000 });

  // Replay: the same link posted again with 1 star changes nothing.
  const before = reviewsStorage();
  const again = await post(fresh.link(mug));
  expect(again.status()).toBe(200);
  expect(await again.text()).toContain('data-review-result="already"');
  expect(reviewsStorage()).toBe(before);
  expect(keptRating(mug)).toMatchObject({ value: 5, count: 1 });
  trace.push({ step: "POST the same link again with 1 star", status: 200, result: "already", storageUnchanged: true, rating: keptRating(mug) });
  await writeFile(resolve(root, "refusals.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ project: testInfo.project.name, trace }));
});
