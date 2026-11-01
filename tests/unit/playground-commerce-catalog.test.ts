import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAYGROUND_DEMO_PRODUCTS } from "../../src/features/playground/demo-commerce-seed.js";
import { PLAYGROUND_REGISTRY_PLUGINS } from "../../src/features/playground-plugins/registry-plugins.mjs";

describe("TemplateStore playground Commerce catalog", () => {
  it("installs Commerce's Registry build in-store, with no native Commerce entry", () => {
    const config = readFileSync("astro.playground.config.mjs", "utf8");
    expect(config).toContain("...playgroundRegistryPlugins()");
    expect(config).not.toMatch(/dinkusCommerce/);
    expect(config).not.toMatch(/DINKUS_CATALOG_PROFILE/);
    expect(PLAYGROUND_REGISTRY_PLUGINS).toContain("commerce");
    expect(readFileSync("wrangler.playground.jsonc", "utf8")).not.toContain("native-development");
  });

  it("seeds each per-visitor DB from the template's own demo products, including the variant hoodie", () => {
    expect(PLAYGROUND_DEMO_PRODUCTS.length).toBeGreaterThan(0);
    expect(PLAYGROUND_DEMO_PRODUCTS.some((product) => product.variant?.options.some((option) => option.optionId === "size"))).toBe(true);
    expect(PLAYGROUND_DEMO_PRODUCTS.every((product) => product.sku.startsWith("DEMO-HOSTED-"))).toBe(true);
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware).toContain("ensurePlaygroundDemoCatalog");
  });

  it("preserves an intentional empty saved shipping-country setting", () => {
    const seed = readFileSync("src/features/playground/demo-commerce-seed.ts", "utf8");
    expect(seed).toContain("if (current.revision !== null) return;");
    expect(seed).not.toContain("shippingCountries.length === 0");
  });

  it("smoke-checks the deployed playground for the catalog fallback", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain('data-catalog-guidance-state="ready"');
    expect(ci).toContain("catalog is unavailable");
  });
});
