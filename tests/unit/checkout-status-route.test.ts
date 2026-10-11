import { describe, expect, it, vi } from "vitest";

import { POST } from "../../src/pages/api/checkout/status.js";

describe("checkout status browser proxy", () => {
  it("normalizes an unavailable Commerce response to a JSON success HTTP status", async () => {
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
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ error: "unavailable" });
    vi.unstubAllGlobals();
  });

  it("does not call Commerce without the shopper capability", async () => {
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const response = await POST({
      request: new Request("http://store.test/api/checkout/status", { method: "POST", body: "{}" }),
    } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "CAPABILITY_REQUIRED" } });
    expect(transport).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
