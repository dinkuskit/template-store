import { describe, expect, it } from "vitest";

import { usesNativeCommerceCatalog } from "../../src/features/commerce-catalog/profile.js";

describe("Commerce catalog profile", () => {
  it.each([
    [{ DINKUS_HOSTING_PROFILE: "cloudflare" }, true],
    [{ ASTRO_ADAPTER: "cloudflare" }, true],
    [{ DINKUS_CATALOG_PROFILE: "native-development" }, true],
    [{ DINKUS_HOSTING_PROFILE: "node" }, false],
    [{}, false],
  ])("selects native Commerce storage for %j", (env, expected) => {
    expect(usesNativeCommerceCatalog(env)).toBe(expected);
  });
});
