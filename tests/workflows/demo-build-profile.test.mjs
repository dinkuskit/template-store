import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("an explicitly selected shipping config does not inherit the native demo profile", () => {
  const directory = mkdtempSync(join(tmpdir(), "store-build-profile-"));
  try {
    const configPath = join(directory, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify({ vars: { DINKUS_CATALOG_PROFILE: "shipping" } }));
    assert.equal(readDemoCatalogProfile(configPath), "shipping");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
