import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/pages/api/checkout/status.js";

describe("checkout status browser proxy", () => {
  beforeEach(() => vi.stubEnv("EMDASH_SITE_URL", "http://store.test"));
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("returns its own non-200 error when Commerce is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    ));
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", {
        method: "POST",
        headers: { origin: "http://store.test", "x-commerce-guest-capability": "cap.secret" },
        body: "{}",
      }),
    } as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "CHECKOUT_STATUS_UPSTREAM_HTTP", message: "Checkout status unavailable." },
    });
    vi.unstubAllGlobals();
  });

  it("does not expose a fetch exception", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-exception-fixture")));
    const response = await POST({ request: new Request("http://store.test/api/checkout/status", {
      method: "POST", headers: { origin: "http://store.test", "x-commerce-guest-capability": "cap.secret" }, body: "{}",
    }) } as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: {
      code: "CHECKOUT_STATUS_FETCH_FAILED", message: "Checkout status unavailable.",
    } });
  });

  it("does not call Commerce without the shopper capability", async () => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", { method: "POST", body: "{}" }),
    } as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "CHECKOUT_UNAVAILABLE" } });
    expect(transport).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects non-JSON and malformed Commerce replies without leaking their body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("<html>upstream error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ));
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", {
        method: "POST",
        headers: { origin: "http://store.test", "x-commerce-guest-capability": "cap.secret" },
        body: "{}",
      }),
    } as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "CHECKOUT_STATUS_RESPONSE_INVALID", message: "Checkout status unavailable." },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    vi.unstubAllGlobals();
  });

  it("rejects an oversized Commerce reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "65537" },
      }),
    ));
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", {
        method: "POST",
        headers: { origin: "http://store.test", "x-commerce-guest-capability": "cap.secret" },
        body: "{}",
      }),
    } as never);
    expect(response.status).toBe(503);
    vi.unstubAllGlobals();
  });

  it("rejects a 2 MB request body before calling Commerce", async () => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", {
        method: "POST",
        headers: {
          origin: "http://store.test",
          "content-length": String(2 * 1024 * 1024),
          "x-commerce-guest-capability": "cap.secret",
        },
        body: "x",
      }),
    } as never);
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "CHECKOUT_UNAVAILABLE" } });
    expect(transport).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("drains a chunked 9 KB body without content-length and answers 413, not a dropped connection", async () => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024).fill(120);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls >= 9) { controller.close(); return; }
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    });
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", {
        method: "POST",
        headers: { origin: "http://store.test", "x-commerce-guest-capability": "cap.secret" },
        body,
        duplex: "half",
      } as RequestInit),
    } as never);
    expect(response.status).toBe(413);
    expect(pulls).toBe(9);
    expect(cancelled).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("stops draining an endless chunked body after the 64 KiB discard cap", async () => {
    vi.stubGlobal("fetch", vi.fn());
    let pulls = 0;
    const chunk = new Uint8Array(1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(chunk); },
    });
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", {
        method: "POST",
        headers: { origin: "http://store.test", "x-commerce-guest-capability": "cap.secret" },
        body,
        duplex: "half",
      } as RequestInit),
    } as never);
    expect(response.status).toBe(413);
    expect(pulls).toBeLessThanOrEqual(70);
    vi.unstubAllGlobals();
  });
});


describe("status proxy origin boundary", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const site = "https://store.example.test";
  const result = { ok: true, capabilityId: "cap", checkout: {
    schema: "dinkuskit.commerce.guest-checkout-projection/v1", state: "pending",
    attemptId: null, redirectUrl: null, order: null, retryAfter: null,
  } };
  it("preserves validated origin through real Commerce admission and dispatches only status", async () => {
    const { admitGuestCheckoutWrite } = await import("../../.artifacts/source-deps/commerce/src/features/checkout/origin-admission.js");
    vi.stubEnv("EMDASH_SITE_URL", site);
    const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      admitGuestCheckoutWrite({ requestUrl: String(url), headers, siteOrigin: site });
      expect(String(url)).toBe(site + "/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/status");
      expect(headers.get("origin")).toBe(site);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("cookie")).toBeNull();
      expect(init).toMatchObject({ method: "POST", body: "{}", cache: "no-store", redirect: "manual" });
      return Response.json(result);
    });
    vi.stubGlobal("fetch", transport);
    const response = await POST({ request: new Request(site + "/api/checkout/status", {
      method: "POST", headers: { origin: site, "sec-fetch-site": "same-origin", "x-commerce-guest-capability": "cap.secret", authorization: "Bearer synthetic", cookie: "synthetic=1" }, body: "{}",
    }) } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each([
    {}, { "sec-fetch-site": "same-origin" }, { origin: "null" },
    { origin: "https://foreign.example.test" },
    { origin: site, "sec-fetch-site": "cross-site" },
    { origin: site + "/path" },
  ] as Array<Record<string, string>>)("rejects untrusted origin signals before forwarding: %j", async headers => {
    vi.stubEnv("EMDASH_SITE_URL", site);
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    const response = await POST({ request: new Request(site + "/api/checkout/status", {
      method: "POST", headers: { ...headers, "x-commerce-guest-capability": "cap.secret" }, body: "{}",
    }) } as never);
    expect(response.status).toBe(403);
    expect(await response.clone().json()).toMatchObject({ error: { code: "CHECKOUT_STATUS_HOST_ORIGIN" } });
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("cap.secret");
  });
  it("does not trust request host as the configured store origin", async () => {
    vi.stubEnv("EMDASH_SITE_URL", site);
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    const response = await POST({ request: new Request("https://foreign.example.test/api/checkout/status", {
      method: "POST", headers: { origin: "https://foreign.example.test", "x-commerce-guest-capability": "cap.secret" }, body: "{}",
    }) } as never);
    expect(response.status).toBe(403); expect(transport).not.toHaveBeenCalled();
  });
  it("fails closed without an explicit canonical store origin", async () => {
    vi.stubEnv("EMDASH_SITE_URL", "");
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    const response = await POST({ request: new Request(site + "/api/checkout/status", {
      method: "POST", headers: { origin: site, "x-commerce-guest-capability": "cap.secret" }, body: "{}",
    }) } as never);
    expect(response.status).toBe(403); expect(transport).not.toHaveBeenCalled();
  });
});
