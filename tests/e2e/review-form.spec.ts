import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const proofRoot = resolve("runs/review-page-20261122/browser");
const SECRET = "ab".repeat(32);
const LINK = `/review?o=evt_1&p=camp-mug&k=${SECRET}`;

// The proof store has no DinkusKit Reviews installed: the page must answer every link as one that does not work.
for (const [name, address] of [["no link", "/review"], ["a made-up link", LINK]] as const) {
  test(`the review page answers ${name} as a link that does not work when Reviews is not installed`, async ({ page }, testInfo) => {
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

test("a review posted to a store without Reviews, or from another site, keeps nothing and shows no form", async ({ request }) => {
  const senders: Record<string, string>[] = [{ origin: "https://evil.example.test", "sec-fetch-site": "cross-site" }, {}];
  for (const headers of senders) {
    const response = await request.post(LINK, {
      headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
      data: "stars=5&body=Great&name=Sam",
      maxRedirects: 0,
    });
    expect(response.status()).not.toBe(200);
    const html = await response.text();
    expect(html).not.toContain("data-review-form");
    expect(html).not.toContain("data-review-result");
  }
});
