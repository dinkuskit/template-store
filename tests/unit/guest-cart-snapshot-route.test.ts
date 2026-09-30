import { describe, expect, it } from "vitest";

import { GET } from "../../src/pages/api/guest-cart/snapshot.js";

describe("guest cart snapshot route", () => {
  it("rejects unsafe or excessive IDs without reading the catalog", async () => {
    const response = await GET({
      url: new URL("http://localhost/api/guest-cart/snapshot?ids=../etc/passwd"),
    } as Parameters<typeof GET>[0]);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_ids" });
  });
});
