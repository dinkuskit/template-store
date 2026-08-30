import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../src/pages/api/proof/stock.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proof stock route", () => {
  it("returns 404 unless proof mode is explicitly enabled", async () => {
    vi.stubEnv("DINKUS_PROOF_MODE", "0");
    const request = new Request("http://localhost/api/proof/stock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "disabled-proof-route",
        delta: "-3",
        reason: "proof-change",
      }),
    });

    const response = await POST({ request } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(404);
  });
});
