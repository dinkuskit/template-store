import assert from "node:assert/strict";
import test from "node:test";

import {
  isCloudflareBuild,
  readDemoCatalogProfile,
} from "../../scripts/build-demo.mjs";

test("demo Cloudflare builds read the catalog profile from Wrangler config", () => {
  assert.equal(readDemoCatalogProfile(), "native-development");
  assert.equal(
    isCloudflareBuild({
      DINKUS_HOSTING_PROFILE: "cloudflare",
      DINKUS_CATALOG_PROFILE: undefined,
    }),
    true,
  );
  assert.equal(
    isCloudflareBuild({
      ASTRO_ADAPTER: "cloudflare",
      DINKUS_CATALOG_PROFILE: "shipping",
    }),
    true,
  );
  assert.equal(isCloudflareBuild({}), false);
});
