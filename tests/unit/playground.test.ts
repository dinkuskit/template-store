import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGuestCheckoutAdmission } from "../../src/features/guest-cart/checkout-admission.js";
import {
  applyPlaygroundNoIndex,
  dropRewrittenBodyHeaders,
  injectPlaygroundNoIndex,
  playgroundDatabaseKey,
} from "../../src/features/playground/contract.js";

describe("TemplateStore playground", () => {
  it("maps each visitor token to a distinct private database name", () => {
    expect(playgroundDatabaseKey("visitor-a")).not.toBe(
      playgroundDatabaseKey("visitor-b"),
    );
    expect(playgroundDatabaseKey("visitor-a")).toBe("template-store:visitor-a");
  });

  it("uses the template's own seed and no payment or coupon binding", () => {
    const seed = JSON.parse(
      readFileSync(resolve("seed/seed.json"), "utf8"),
    ) as { content?: { pages?: unknown[]; products?: unknown[] } };
    expect(seed.content?.pages?.length).toBeGreaterThan(0);
    expect(seed.content?.products?.length).toBeGreaterThan(0);

    const config = readFileSync("wrangler.playground.jsonc", "utf8");
    expect(config).not.toMatch(/"(?:PAYMENTS|COUPON|STRIPE)[^"]*"\s*:/i);
    expect(config).toContain("PLAYGROUND_DB");
    expect(config).toContain('"workers_dev": false');
    expect(config).toContain('"preview_urls": true');
    expect(config).toContain('"head_sampling_rate": 1');
  });

  it("keeps checkout closed without the exact supported authority", () => {
    expect(
      resolveGuestCheckoutAdmission({ runtime: null, catalog: null }),
    ).toBeNull();
    expect(readFileSync("src/features/guest-cart/present.ts", "utf8")).toContain(
      "Checkout unavailable",
    );
  });

  it("marks every playground response and HTML document noindex", () => {
    const headers = new Headers();
    applyPlaygroundNoIndex(headers);
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(injectPlaygroundNoIndex("<html><head><title>Store</title></head>"))
      .toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("drops length and validator headers once the HTML body is rewritten", () => {
    const headers = new Headers({
      "Content-Length": "12",
      ETag: '"abc"',
      "Content-Type": "text/html",
    });
    dropRewrittenBodyHeaders(headers);
    expect(headers.has("Content-Length")).toBe(false);
    expect(headers.has("ETag")).toBe(false);
    expect(headers.get("Content-Type")).toBe("text/html");
  });
});
