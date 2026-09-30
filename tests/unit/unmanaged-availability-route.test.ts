import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/pages/api/proof/unmanaged-availability.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proof unmanaged availability route", () => {
  it("returns 404 unless proof mode is explicitly enabled", async () => {
    vi.stubEnv("DINKUS_PROOF_MODE", "0");
    const request = new Request(
      "http://localhost/api/proof/unmanaged-availability",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          catalogItemId: "dinkus-template-unmanaged-product",
          status: "out-of-stock",
        }),
      },
    );

    const response = await POST({ request } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(404);
  });

  it("returns 404 in shipping even when legacy proof mode is on", async () => {
    vi.stubEnv("DINKUS_PROOF_MODE", "1");
    vi.stubEnv("DINKUS_STOREFRONT_PROFILE", "shipping");
    const request = new Request(
      "http://localhost/api/proof/unmanaged-availability",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          catalogItemId: "dinkus-template-unmanaged-product",
          status: "out-of-stock",
        }),
      },
    );

    const response = await POST({ request } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(404);
  });
});
