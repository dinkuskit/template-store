import { describe, expect, it, vi } from "vitest";

import { POST } from "../../src/pages/api/checkout/status.js";

describe("checkout status browser proxy", () => {
  it("returns its own non-200 error when Commerce is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    ));
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", {
        method: "POST",
        headers: { "x-commerce-guest-capability": "cap.secret" },
        body: "{}",
      }),
    } as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "CHECKOUT_UNAVAILABLE", message: "Checkout status unavailable." },
    });
    vi.unstubAllGlobals();
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
        headers: { "x-commerce-guest-capability": "cap.secret" },
        body: "{}",
      }),
    } as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "CHECKOUT_UNAVAILABLE", message: "Checkout status unavailable." },
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
        headers: { "x-commerce-guest-capability": "cap.secret" },
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
        headers: { "x-commerce-guest-capability": "cap.secret" },
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
        headers: { "x-commerce-guest-capability": "cap.secret" },
        body,
        duplex: "half",
      } as RequestInit),
    } as never);
    expect(response.status).toBe(413);
    expect(pulls).toBeLessThanOrEqual(70);
    vi.unstubAllGlobals();
  });
});
