import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { armWelcomeObserver, dismissWelcome } from "./helpers/welcome";

// Site visibility (GrillTrack template-site-visibility-20261122): EmDash's Go live
// (Settings > General) is the store's one search-engine switch. While the store is
// in staging every storefront response asks search engines to stay away; once it
// is Live nothing does. The proof storefront stays noindex either way.
const proofRoot = resolve("runs/site-visibility-20261122/browser");
const STOREFRONT = ["/", "/cart", "/feeds/products.json", "/robots.txt"];

async function robotsHeaders(request: APIRequestContext): Promise<Array<string | undefined>> {
  const headers: Array<string | undefined> = [];
  for (const path of STOREFRONT) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBeLessThan(500);
    headers.push(response.headers()["x-robots-tag"]);
  }
  return headers;
}

async function openGeneralSettings(page: Page): Promise<void> {
  await armWelcomeObserver(page);
  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/settings/general");
  await expect(page).toHaveURL(/\/_emdash\/admin\/settings\/general/u);
  await dismissWelcome(page, page.getByText("Site Status"));
}

test("a store starts in staging and Go live lets search engines in", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("shipping-"), "The shipping store is the merchant store; the proof storefront is always noindex.");
  test.setTimeout(120_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  await openGeneralSettings(page);

  const toStaging = page.getByRole("button", { name: "Switch back to staging" });
  const goLive = page.getByRole("button", { name: "Go live" });
  // A fresh store is in staging; a rerun on the same store may find it Live.
  if (await toStaging.isVisible()) await toStaging.click();
  await expect(page.getByText("Hidden from search engines")).toBeVisible();
  await expect(goLive).toBeVisible();
  await page.screenshot({ path: resolve(root, "1-staging.png") });

  expect(await robotsHeaders(page.request)).toEqual(STOREFRONT.map(() => "noindex, nofollow"));
  // EmDash's own routes keep their own headers.
  const admin = await page.request.get("/_emdash/api/settings");
  expect(admin.headers()["x-robots-tag"]).toBeUndefined();

  await goLive.click();
  await expect(page.getByText("Visible to search engines")).toBeVisible();
  await expect(toStaging).toBeVisible();
  await page.screenshot({ path: resolve(root, "2-live.png") });

  expect(await robotsHeaders(page.request)).toEqual(STOREFRONT.map(() => undefined));
});

test("the proof storefront stays out of search engines", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("shipping-"), "Runs on the proof store.");
  expect(await robotsHeaders(request)).toEqual(STOREFRONT.map(() => "noindex, nofollow"));
});
