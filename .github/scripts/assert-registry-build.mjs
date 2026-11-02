import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Inspect the adapter's emitted artifact, not just the generator's input config.
// This is local compilation evidence, never deployment or plugin installation.
export function assertRegistryBuild(config) {
  assert.ok(config.worker_loaders?.some(({ binding }) => binding === "LOADER"),
    "Registry build must bind LOADER");
  assert.equal(config.vars?.DINKUS_CATALOG_PROFILE, "shipping",
    "Registry build must use the shipping catalog");
  assert.equal(config.vars?.DINKUS_PROOF_MODE, "0",
    "Registry build must disable proof mode");
}

if (import.meta.main) {
  assertRegistryBuild(JSON.parse(readFileSync("dist/server/wrangler.json", "utf8")));
  console.log("Registry build artifact: LOADER, shipping catalog and proof mode off verified; no deployment performed.");
}
