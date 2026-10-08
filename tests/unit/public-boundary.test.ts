import { describe, expect, it, vi } from "vitest";

vi.mock("@astrojs/cloudflare/entrypoints/server", () => ({
  default: {
    fetch: vi.fn().mockImplementation(async () => new Response("OK", { status: 200 })),
  },
}));

vi.mock("@emdash-cms/cloudflare/worker", () => ({
  createScheduledHandler: () => () => undefined,
  PluginBridge: class PluginBridge {},
}));

import {
  applySecurityHeaders,
  demoNoIndexEnabled,
  evaluatePublicBoundary,
  slashlessRedirectPath,
} from "../../src/features/security/public-boundary.js";
import astroEntry from "@astrojs/cloudflare/entrypoints/server";
import worker from "../../src/worker.js";

const astroFetch = astroEntry.fetch as ReturnType<typeof vi.fn>;

describe("public boundary access evaluation", () => {
  it("allows standard storefront shopper GET endpoints", () => {
    expect(evaluatePublicBoundary("GET", "/").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/home").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/cart").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/sitemap.xml").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/sitemap-commerce.xml").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/shop/DEMO-HOSTED-SHIRT").allowed).toBe(false);
    expect(evaluatePublicBoundary("GET", "/categories/apparel").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/products/hoodie-black").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/api/guest-cart/snapshot").allowed).toBe(true);
  });

  it("allows static assets and public media GET endpoints", () => {
    expect(evaluatePublicBoundary("GET", "/_astro/client.js").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/merch/hoodie.svg").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/_emdash/api/media/file/hero.png").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/favicon.ico").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/robots.txt").allowed).toBe(true);
  });

  it("leaves slash variants to Astro's built-in 301 handler", () => {
    expect(slashlessRedirectPath("/cart/")).toBeUndefined();
    expect(slashlessRedirectPath("/checkout/success/")).toBeUndefined();
    expect(slashlessRedirectPath("/checkout/cancel/")).toBeUndefined();
    expect(slashlessRedirectPath("/checkout/other/")).toBeUndefined();
    expect(evaluatePublicBoundary("GET", "/checkout/success").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/checkout/cancel").allowed).toBe(true);
  });

  it("allows only strict lowercase child sitemap names", () => {
    expect(evaluatePublicBoundary("GET", "/sitemap-a1-collection.xml").allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/sitemap-Collection.xml").allowed).toBe(false);
    expect(evaluatePublicBoundary("GET", "/sitemap-a_collection.xml").allowed).toBe(false);
    expect(evaluatePublicBoundary("GET", "/sitemap-a.xml/extra").allowed).toBe(false);
  });

  it("allows HEAD requests on public read endpoints", () => {
    expect(evaluatePublicBoundary("HEAD", "/").allowed).toBe(true);
    expect(evaluatePublicBoundary("HEAD", "/shop/DEMO-HOSTED-SHIRT").allowed).toBe(false);
    expect(evaluatePublicBoundary("HEAD", "/cart").allowed).toBe(true);
  });

  it("allows only the exact installed guest POST protocol and safe callback reads", () => {
    const base = "/_emdash/api/plugins/dinkus-commerce/checkout/guest";
    expect(evaluatePublicBoundary("POST", `${base}/prepare`).allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", `${base}/start`).allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", `${base}/status`).allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", `${base}/start`).status).toBe(405);
    expect(evaluatePublicBoundary("GET", "/checkout/success").allowed).toBe(true);
    expect(evaluatePublicBoundary("HEAD", "/checkout/cancel").allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", "/cart/").status).toBe(405);
    expect(evaluatePublicBoundary("PUT", "/checkout/success/").status).toBe(405);
    expect(evaluatePublicBoundary("DELETE", "/checkout/cancel/").status).toBe(405);
    expect(evaluatePublicBoundary("POST", "/checkout/success").status).toBe(405);
    expect(evaluatePublicBoundary("POST", "/_emdash/api/plugins/r_other/checkout/guest/start").status).toBe(405);
    expect(evaluatePublicBoundary("POST", `${base.replace("dinkus-commerce", "dinkus-%63ommerce")}/start`).allowed).toBe(true);
    expect(evaluatePublicBoundary("POST", `${base}/%2573tart`).allowed).toBe(true);
  });

  it("admits only same-host Commerce image transforms", () => {
    const origin = "https://shop.example.test/shop/hat";
    const href = encodeURIComponent("https://shop.example.test/_emdash/api/media/file/01HAT.png");
    const search = `?href=${href}&w=300&f=webp`;
    expect(evaluatePublicBoundary("GET", "/_image", search, origin).allowed).toBe(true);
    expect(evaluatePublicBoundary("HEAD", "/_image", search, origin).allowed).toBe(true);
    expect(evaluatePublicBoundary("GET", "/_image", search).status).toBe(404);
    expect(evaluatePublicBoundary("POST", "/_image", search, origin).status).toBe(405);
    const foreign = encodeURIComponent("https://evil.example/_emdash/api/media/file/01HAT.png");
    expect(evaluatePublicBoundary("GET", "/_image", `?href=${foreign}&w=300&f=webp`, origin).status).toBe(404);
    expect(evaluatePublicBoundary("GET", "/_image", `?href=${href}&w=9000&f=webp`, origin).status).toBe(404);
    expect(evaluatePublicBoundary("GET", "/_image", `?href=${href}&w=300&f=png`, origin).status).toBe(404);
    expect(evaluatePublicBoundary("GET", "/_image", `?href=${href}&w=300&f=webp&q=1`, origin).status).toBe(404);
  });

  it("denies unknown routes with 404", () => {
    const unknownRoute = evaluatePublicBoundary("GET", "/nonexistent");
    expect(unknownRoute.allowed).toBe(false);
    expect(unknownRoute.status).toBe(404);

    const apiOther = evaluatePublicBoundary("GET", "/api/unknown-handler");
    expect(apiOther.allowed).toBe(false);
    expect(apiOther.status).toBe(404);
  });

  it("denies bare dynamic segment prefixes without resource identifier with 404", () => {
    expect(evaluatePublicBoundary("GET", "/shop").status).toBe(404);
    expect(evaluatePublicBoundary("GET", "/collections").status).toBe(404);
    expect(evaluatePublicBoundary("GET", "/products").status).toBe(404);
  });

  it("denies mutations and POST requests on public read-only host with 405", () => {
    const postSnapshot = evaluatePublicBoundary("POST", "/api/guest-cart/snapshot");
    expect(postSnapshot.allowed).toBe(false);
    expect(postSnapshot.status).toBe(405);

    const postRoot = evaluatePublicBoundary("POST", "/");
    expect(postRoot.allowed).toBe(false);
    expect(postRoot.status).toBe(405);

    const putCart = evaluatePublicBoundary("PUT", "/cart");
    expect(putCart.allowed).toBe(false);
    expect(putCart.status).toBe(405);

    const patchProduct = evaluatePublicBoundary("PATCH", "/products/hoodie-black");
    expect(patchProduct.allowed).toBe(false);
    expect(patchProduct.status).toBe(405);

    const deleteProduct = evaluatePublicBoundary("DELETE", "/products/hoodie-black");
    expect(deleteProduct.allowed).toBe(false);
    expect(deleteProduct.status).toBe(405);
  });

  it("denies unsupported HTTP methods with 405", () => {
    const optionsCheck = evaluatePublicBoundary("OPTIONS", "/");
    expect(optionsCheck.allowed).toBe(false);
    expect(optionsCheck.status).toBe(405);
  });

  it("denies administrative endpoints with 403", () => {
    const adminRoot = evaluatePublicBoundary("GET", "/admin");
    expect(adminRoot.allowed).toBe(false);
    expect(adminRoot.status).toBe(403);

    const adminSub = evaluatePublicBoundary("GET", "/admin/settings");
    expect(adminSub.allowed).toBe(false);
    expect(adminSub.status).toBe(403);

    const emdashAdmin = evaluatePublicBoundary("GET", "/_emdash/admin");
    expect(emdashAdmin.allowed).toBe(false);
    expect(emdashAdmin.status).toBe(403);
  });

  it("denies setup, auth, schema, and proof endpoints with 403", () => {
    expect(evaluatePublicBoundary("GET", "/_emdash/api/setup").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/api/setup").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/_emdash/api/auth").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/api/auth").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/_emdash/api/schema").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/api/proof/stock").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/api/proof/unmanaged-availability").status).toBe(403);
    const scheduled = evaluatePublicBoundary("GET", "/__scheduled");
    expect(scheduled.allowed).toBe(false);
    expect(scheduled.status).toBe(404);
    expect(evaluatePublicBoundary("POST", "/__scheduled").allowed).toBe(false);
  });

  it("denies dev-bypass in path or query with 403", () => {
    expect(evaluatePublicBoundary("GET", "/_emdash/api/setup/dev-bypass").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/", "?dev-bypass=1").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/shop/DEMO-HOSTED-SHIRT", "?dev-bypass=true").status).toBe(403);
  });

  it("denies path traversal and percent-encoded attacks with 403", () => {
    expect(evaluatePublicBoundary("GET", "/shop/..").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/shop/../admin").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/shop/%2e%2e/admin").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/%61dmin").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/%41%64%6d%69%6e").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/%2561dmin").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/products/test%00").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/cart", "?target=%2e%2e/admin").status).toBe(403);
    expect(evaluatePublicBoundary("GET", "/cart", "?next=%2561dmin").status).toBe(403);
  });

  it("applies standard security headers", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { DINKUS_STOREFRONT_PROFILE: "proof" });
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("keeps every profile noindex until an explicit launch setting", () => {
    const shipping = new Headers();
    applySecurityHeaders(shipping, { DINKUS_STOREFRONT_PROFILE: "shipping" });
    expect(shipping.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(demoNoIndexEnabled({ DINKUS_STOREFRONT_PROFILE: "shipping" })).toBe(true);
    expect(demoNoIndexEnabled({ DINKUS_STOREFRONT_PROFILE: "proof" })).toBe(true);
    expect(demoNoIndexEnabled({ DINKUS_DEMO_NOINDEX: "1" })).toBe(true);
    expect(demoNoIndexEnabled({ DINKUS_LAUNCH_INDEXABLE: "1" })).toBe(false);
  });
});

describe("worker boundary handler", () => {
  const dummyCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  };

  it("fails closed with 503 when RATE_LIMITER binding is missing", async () => {
    const request = new Request("http://demo.dinkuskit.com/", {
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    const res = await worker.fetch(request, {}, dummyCtx);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/Rate limiter service unavailable/);
  });

  it("fails closed with 503 when cf-connecting-ip is missing", async () => {
    const limiter = { limit: vi.fn() };
    const request = new Request("http://demo.dinkuskit.com/", {
      headers: { "x-forwarded-for": "198.51.100.1" }, // untrusted header must NOT be used
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/Client IP/);
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when rate limiter throws an error", async () => {
    const limiter = {
      limit: vi.fn().mockRejectedValue(new Error("Rate limiter backend down")),
    };
    const request = new Request("http://demo.dinkuskit.com/", {
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/Rate limiter failure/);
  });

  it("fails closed with 503 when rate limiter returns a malformed response", async () => {
    const limiter = {
      limit: vi.fn().mockResolvedValue(null as unknown as { success: boolean }),
    };
    const request = new Request("http://demo.dinkuskit.com/", {
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/Rate limiter malformed/);
  });

  it("returns 429 Too Many Requests with Retry-After when rate limit is exceeded", async () => {
    const limiter = {
      limit: vi.fn().mockResolvedValue({ success: false }),
    };
    const request = new Request("http://demo.dinkuskit.com/", {
      headers: { "cf-connecting-ip": "198.51.100.42" },
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(limiter.limit).toHaveBeenCalledWith({ key: "demo:public:198.51.100.42" });
  });

  it("does not call the framework for encoded, unknown, or mutation targets", async () => {
    astroFetch.mockClear();
    const limiter = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const headers = { "cf-connecting-ip": "198.51.100.1" };
    const encoded = await worker.fetch(
      new Request("http://demo.dinkuskit.com/%2561dmin", { headers }),
      { RATE_LIMITER: limiter },
      dummyCtx,
    );
    const unknown = await worker.fetch(
      new Request("http://demo.dinkuskit.com/not-a-route", { headers }),
      { RATE_LIMITER: limiter },
      dummyCtx,
    );
    const mutation = await worker.fetch(
      new Request("http://demo.dinkuskit.com/cart", { method: "POST", headers }),
      { RATE_LIMITER: limiter },
      dummyCtx,
    );
    expect(encoded.status).toBe(403);
    expect(unknown.status).toBe(404);
    expect(mutation.status).toBe(405);
    expect(astroFetch).not.toHaveBeenCalled();
  });

  it("denies traversal attack before framework decoding", async () => {
    const limiter = {
      limit: vi.fn().mockResolvedValue({ success: true }),
    };
    const request = new Request("http://demo.dinkuskit.com/shop/%2e%2e/admin", {
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(403);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("denies mutation methods before framework handler", async () => {
    const limiter = {
      limit: vi.fn().mockResolvedValue({ success: true }),
    };
    const request = new Request("http://demo.dinkuskit.com/api/guest-cart/snapshot", {
      method: "POST",
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(405);
  });

  it("delegates allowed public GET requests to Astro handler and adds security headers", async () => {
    const limiter = {
      limit: vi.fn().mockResolvedValue({ success: true }),
    };
    const request = new Request("http://demo.dinkuskit.com/categories/apparel", {
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("rejects slash variants before Astro handles built-in redirects", async () => {
    astroFetch.mockClear();
    const limiter = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const request = new Request("http://demo.dinkuskit.com/cart/?from=bookmark", {
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(404);
    expect(astroFetch).not.toHaveBeenCalled();
  });

  it("rejects non-read methods on slash variants with 405", async () => {
    astroFetch.mockClear();
    const limiter = { limit: vi.fn().mockResolvedValue({ success: true }) };
    const request = new Request("http://demo.dinkuskit.com/cart/", {
      method: "POST",
      headers: { "cf-connecting-ip": "198.51.100.1" },
    });
    const res = await worker.fetch(request, { RATE_LIMITER: limiter }, dummyCtx);
    expect(res.status).toBe(405);
    expect(astroFetch).not.toHaveBeenCalled();
  });

  it("reads demo noindex policy from the Worker env binding", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, { DINKUS_DEMO_NOINDEX: "1" });
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});
