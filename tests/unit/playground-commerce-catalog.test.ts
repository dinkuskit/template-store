import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAYGROUND_DEMO_PRODUCTS } from "../../src/features/playground/demo-commerce-seed.js";

describe("TemplateStore playground Commerce catalog", () => {
  it("registers the native Commerce plugin so catalog/public exists", () => {
    const config = readFileSync("astro.playground.config.mjs", "utf8");
    expect(config).toMatch(/dinkusCommerce\(\{\s*enableLocalStockManagement:\s*false\s*\}\)/);
    expect(config).not.toMatch(/DINKUS_CATALOG_PROFILE/);
  });

  it("seeds each per-visitor DB from the template's own demo products, including the variant hoodie", () => {
    expect(PLAYGROUND_DEMO_PRODUCTS.length).toBeGreaterThan(0);
    expect(PLAYGROUND_DEMO_PRODUCTS.some((product) => product.variant?.optionId === "size")).toBe(true);
    expect(PLAYGROUND_DEMO_PRODUCTS.every((product) => product.sku.startsWith("DEMO-HOSTED-"))).toBe(true);
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware).toContain("ensurePlaygroundDemoCatalog");
  });

  it("preserves an intentional empty saved shipping-country setting", () => {
    const seed = readFileSync("src/features/playground/demo-commerce-seed.ts", "utf8");
    expect(seed).toContain("currentSettings.revision === null");
    expect(seed).not.toContain("currentSettings.settings.shippingCountries.length === 0");
  });

  it("smoke-checks the deployed playground for the catalog fallback", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain('data-catalog-guidance-state="ready"');
    expect(ci).toContain("catalog is unavailable");
  });
});
