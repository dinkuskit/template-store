import { beforeEach, describe, expect, it, vi } from "vitest";

const readSetting = vi.hoisted(() => vi.fn());
vi.mock("emdash", () => ({
  getSiteSettings: readSetting,
}));

const { STAGING_ROBOTS, isStorefrontPath, siteIsStaging, withStagingRobots } = await import(
  "../../src/features/site-visibility/index.js"
);

describe("site visibility", () => {
  beforeEach(() => {
    readSetting.mockReset();
  });

  it("lets search engines in only once the owner pressed Go live", async () => {
    readSetting.mockResolvedValueOnce({ title: "Shop", staging: false });
    expect(await siteIsStaging()).toBe(false);
    // Staging, a store that never chose, and anything unreadable all stay out of search.
    for (const settings of [{ staging: true }, {}, { staging: null }]) {
      readSetting.mockResolvedValueOnce(settings);
      expect(await siteIsStaging()).toBe(true);
    }
    readSetting.mockRejectedValueOnce(new Error("no database"));
    expect(await siteIsStaging()).toBe(true);
  });

  it("covers every storefront path and leaves EmDash's own routes alone", () => {
    for (const path of ["/", "/products/red-hat", "/collections/hats", "/cart", "/feeds/products.json", "/robots.txt", "/_emdashy"]) {
      expect(isStorefrontPath(path)).toBe(true);
    }
    for (const path of ["/_emdash", "/_emdash/", "/_emdash/admin", "/_emdash/api/content/products", "/_EMDASH/admin"]) {
      expect(isStorefrontPath(path)).toBe(false);
    }
  });

  it("asks search engines to stay away with the same words EmDashHead uses", async () => {
    expect(STAGING_ROBOTS).toBe("noindex, nofollow");
    const page = withStagingRobots(new Response("<p>Shop</p>", { headers: { "Content-Type": "text/html" } }));
    expect(page.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(await page.text()).toBe("<p>Shop</p>");

    // A redirect's headers are read-only, so it gets a copy with the same status and target.
    const redirect = withStagingRobots(Response.redirect("https://store.test/cart", 302));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe("https://store.test/cart");
    expect(redirect.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});
