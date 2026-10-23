import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface SaxTag {
  name: string;
}

interface SaxParser {
  onopentag: ((node: SaxTag) => void) | null;
  onerror: ((err: Error) => void) | null;
  write(xml: string): SaxParser;
  close(): SaxParser;
}

interface SaxModule {
  parser(
    strict: boolean,
    opt?: { xmlns?: boolean; strictEntities?: boolean },
  ): SaxParser;
}

const require = createRequire(import.meta.url);
const sax = require("sax") as SaxModule;

const PRODUCT_SVGS = [
  "public/images/products/shirt.svg",
  "public/images/products/hoodie.svg",
  "public/images/products/tote.svg",
  "public/images/products/mug.svg",
  "public/images/products/tray.svg",
  "public/images/products/socks.svg",
  "public/images/products/cap.svg",
  "public/images/products/bottle.svg",
  "public/images/products/throw.svg",
] as const;

const MERCH_SVGS = [
  "public/merch/tee.svg",
  "public/merch/hoodie.svg",
  "public/merch/cap.svg",
  "public/merch/beanie.svg",
] as const;

function assertValidSvgXml(svgSource: string, fileLabel: string): void {
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  let rootTag = "";
  parser.onopentag = (node: SaxTag) => {
    if (!rootTag) rootTag = node.name;
  };
  parser.onerror = (err: Error) => {
    throw new Error(`Invalid SVG XML in ${fileLabel}: ${err.message}`);
  };
  parser.write(svgSource).close();
  expect(rootTag, fileLabel).toBe("svg");
}

describe("A2 — Pigment Drift product illustrations & living hero/card ink-wash", () => {
  it("replaces all 9 product placeholder SVGs and 4 merch SVGs with valid Pigment Drift risograph artwork", () => {
    for (const relPath of [...PRODUCT_SVGS, ...MERCH_SVGS]) {
      const source = readFileSync(resolve(relPath), "utf8");
      assertValidSvgXml(source, relPath);
      expect(source, relPath).toContain('viewBox="0 0 640 480"');
      expect(source, relPath).not.toContain("Demo placeholder");
      expect(source, relPath).not.toContain("#d9e2ec");
      expect(source, relPath).toContain("<feTurbulence");
      expect(source, relPath).toContain("<feDisplacementMap");
      // Loaded through <img>, so the page cannot pause them: the artwork stays still.
      expect(source, relPath).not.toContain("<animate");
      expect(source, relPath).toContain("DINKUS //");
      expect(source, relPath).toContain("DINKUS // STUDIO");
    }
  });

  it("wires the living Pigment Drift SVG wash in HomeOpener.astro and hover response in ProductMedia.astro", () => {
    const homeOpener = readFileSync(
      resolve("src/features/store-shell/blocks/HomeOpener.astro"),
      "utf8",
    );
    expect(homeOpener).toContain('class="home-opener__pigment-wash"');
    expect(homeOpener).toContain('data-pigment-drift="hero"');
    expect(homeOpener).toContain("<feTurbulence");
    expect(homeOpener).toContain("<feDisplacementMap");
    expect(homeOpener).toContain("var(--store-bg)");
    expect(homeOpener).toContain("var(--store-surface-subtle)");
    expect(homeOpener).toContain("var(--store-accent)");
    expect(homeOpener).toContain("var(--store-ink)");
    expect(homeOpener).toContain("prefers-reduced-motion: reduce");
    expect(homeOpener).toContain("pauseAnimations");

    const productMedia = readFileSync(
      resolve("src/features/commerce-catalog/ProductMedia.astro"),
      "utf8",
    );
    expect(productMedia).toContain("data-pigment-drift-media");
    expect(productMedia).toContain('class="product-media__pigment-wash"');
    expect(productMedia).toContain('data-pigment-drift="product-media"');
    expect(productMedia).toContain("prefers-reduced-motion: reduce");

    const commerceCatalog = readFileSync(
      resolve("src/features/commerce-catalog/CommerceCatalog.astro"),
      "utf8",
    );
    expect(commerceCatalog).toContain(".shop-card:hover");
    expect(commerceCatalog).toContain("prefers-reduced-motion");

    const merchCatalog = readFileSync(
      resolve("src/features/store-shell/MerchCatalog.astro"),
      "utf8",
    );
    expect(merchCatalog).toContain('data-pigment-drift="product-media"');
    expect(merchCatalog).toContain(".merch-card:hover");

    const storeFooter = readFileSync(
      resolve("src/features/store-shell/StoreFooter.astro"),
      "utf8",
    );
    expect(storeFooter).toContain('data-pigment-drift="footer"');
    expect(storeFooter).toContain("footer-chromatic-tide");
    expect(storeFooter).toContain("var(--pigment-stop-1");
    expect(storeFooter).toContain("var(--pigment-stop-4");

    const productDetail = readFileSync(
      resolve("src/pages/products/[id].astro"),
      "utf8",
    );
    expect(productDetail).toContain("data-product-stage-visual");
    expect(productDetail).toContain("rough-ink-callout");

    const checkoutReturn = readFileSync(
      resolve("src/features/guest-cart/GuestCheckoutReturn.astro"),
      "utf8",
    );
    expect(checkoutReturn).toContain("data-ephemera-receipt");
    expect(checkoutReturn).toContain("data-ephemera-stamp");
    expect(checkoutReturn).toContain("data-ephemera-barcode");
  });
});
