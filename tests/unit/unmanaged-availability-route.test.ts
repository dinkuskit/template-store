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
});
