import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  demoBundlesPairedCommerce,
  isCloudflareBuild,
  readDemoCatalogProfile,
  readDemoCommerceProfile,
} from "../../scripts/build-demo.mjs";
import { pairedCommercePin, pairedCommerceProfile } from "../../scripts/lib/paired-commerce.mjs";

test("demo Cloudflare builds read the catalog profile from Wrangler config", () => {
  // The demo runs Commerce's Registry build as a shipping store installs it (template-one-build-registry-20261031).
  assert.equal(readDemoCatalogProfile(), "shipping");
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

test("the retired native profile is refused, and an explicit shipping config reads as such", () => {
  const retired = mkdtempSync(join(tmpdir(), "store-build-profile-"));
  try {
    const configPath = join(retired, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify({ vars: { DINKUS_CATALOG_PROFILE: "native-development" } }));
    assert.throws(() => readDemoCatalogProfile(configPath), /native-development is retired/);
  } finally {
    rmSync(retired, { recursive: true, force: true });
  }
  const directory = mkdtempSync(join(tmpdir(), "store-build-profile-"));
  try {
    const configPath = join(directory, "wrangler.jsonc");
    writeFileSync(configPath, JSON.stringify({ vars: { DINKUS_CATALOG_PROFILE: "shipping" } }));
    assert.equal(readDemoCatalogProfile(configPath), "shipping");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the demo Worker bundles the pinned Commerce's Registry build under the package its tag names", () => {
  // wrangler.jsonc's DINKUS_COMMERCE_PROFILE follows the pin: a pre-release pin is the beta package.
  assert.equal(readDemoCommerceProfile(), pairedCommerceProfile(pairedCommercePin()));
  assert.equal(demoBundlesPairedCommerce({ DINKUS_HOSTING_PROFILE: "cloudflare" }), true);
  // A store's own Registry config installs Commerce from the Registry and bundles none.
  assert.equal(demoBundlesPairedCommerce({ DINKUS_HOSTING_PROFILE: "cloudflare" }, "runs/registry/wrangler.jsonc"), false);
  assert.equal(demoBundlesPairedCommerce({}), false);
});
