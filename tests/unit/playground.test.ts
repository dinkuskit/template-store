import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGuestCheckoutAdmission } from "../../src/features/guest-cart/checkout-admission.js";
import {
  applyPlaygroundNoIndex,
  checkPlaygroundCreationLimit,
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
    expect(config).not.toMatch(/(?:secret|payments|coupon|stripe)/i);
    expect(config).toContain("PLAYGROUND_DB");
    expect(config).toContain('"workers_dev": false');
    expect(config).toContain('"preview_urls": false');
    expect(config).toContain('"account_id": "cddb32366789cab1bdf4c25584dc1920"');
    expect(config).toContain('"pattern": "playground.dinkuskit.com"');
    expect(config).toContain('"previews_enabled": true');
    expect(config).toContain('"head_sampling_rate": 1');
  });

  it("rate-limits creation per client IP and globally with friendly 429s", async () => {
    const calls: string[] = [];
    const limiter = (blocked: boolean) => ({
      async limit({ key }: { key: string }) {
        calls.push(key);
        return { success: !blocked };
      },
    });
    const request = new Request("https://playground.dinkuskit.com/_playground/init", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.10" },
    });

    const ipLimited = await checkPlaygroundCreationLimit(request, {
      perIp: limiter(true),
      global: limiter(false),
    });
    expect(ipLimited?.status).toBe(429);
    expect(await ipLimited?.text()).toContain("from this IP");
    expect(calls).toEqual(["template-store:playground:create:ip:203.0.113.10"]);

    calls.length = 0;
    const globalLimited = await checkPlaygroundCreationLimit(request, {
      perIp: limiter(false),
      global: limiter(true),
    });
    expect(globalLimited?.status).toBe(429);
    expect(await globalLimited?.text()).toContain("busy");
    expect(calls).toEqual([
      "template-store:playground:create:ip:203.0.113.10",
      "template-store:playground:create:global",
    ]);
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
});
