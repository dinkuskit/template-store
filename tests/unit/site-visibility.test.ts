import { beforeEach, describe, expect, it, vi } from "vitest";

const readSetting = vi.hoisted(() => vi.fn());
const writeSettings = vi.hoisted(() => vi.fn());
const setIfAbsent = vi.hoisted(() => vi.fn());
vi.mock("emdash", () => ({
  getSiteSetting: readSetting,
  setSiteSettings: writeSettings,
  OptionsRepository: class { setIfAbsent = setIfAbsent; },
}));

const { STAGING_OPTION, STAGING_ROBOTS, isStorefrontPath, siteIsStaging, startUndecidedStoreInStaging, withStagingRobots } = await import(
  "../../src/features/site-visibility/index.js"
);

describe("site visibility", () => {
  beforeEach(() => {
    readSetting.mockReset();
    writeSettings.mockReset();
    setIfAbsent.mockReset();
  });

  it("reads EmDash's staging setting and treats anything else as live", async () => {
    readSetting.mockResolvedValueOnce(true);
    expect(await siteIsStaging()).toBe(true);
    expect(readSetting).toHaveBeenCalledWith("staging");
    for (const value of [false, undefined, null, "true", 1]) {
      readSetting.mockResolvedValueOnce(value);
      expect(await siteIsStaging()).toBe(false);
    }
    readSetting.mockRejectedValueOnce(new Error("no database"));
    expect(await siteIsStaging()).toBe(false);
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

  it("starts a store that never chose staging or Live in staging, and keeps any choice", async () => {
    const db = {};
    setIfAbsent.mockResolvedValueOnce(true);
    await startUndecidedStoreInStaging(db);
    expect(setIfAbsent).toHaveBeenCalledWith(STAGING_OPTION, true);
    expect(STAGING_OPTION).toBe("site:staging");
    expect(writeSettings).toHaveBeenCalledWith({ staging: true }, db);

    // The owner already pressed Go live (or chose staging): nothing is written.
    writeSettings.mockReset();
    setIfAbsent.mockResolvedValueOnce(false);
    await startUndecidedStoreInStaging(db);
    expect(writeSettings).not.toHaveBeenCalled();
  });
});
