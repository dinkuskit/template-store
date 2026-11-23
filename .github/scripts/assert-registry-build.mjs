import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Inspect the adapter's emitted artifact, not just the generator's input config.
// This is local compilation evidence, never deployment or plugin installation.
export function assertRegistryBuild(config) {
  assert.ok(config.worker_loaders?.some(({ binding }) => binding === "LOADER"),
    "Registry build must bind LOADER");
  assert.equal(config.vars?.DINKUS_CATALOG_PROFILE, "shipping",
    "Registry build must use the shipping catalog");
  assert.equal(config.vars?.DINKUS_PROOF_MODE, "0",
    "Registry build must disable proof mode");
  // The store's Cloudflare sender (store-email-sender-20261122).
  assert.ok(config.send_email?.some(({ name }) => name === "EMAIL"),
    "Registry build must bind EMAIL (send_email) for the store's Cloudflare sender");
  assert.match(config.vars?.DINKUS_EMAIL_FROM ?? "", /^[^\s@]+@[^\s@]+$/,
    "Registry build must name the store's sender address");
}

if (import.meta.main) {
  assertRegistryBuild(JSON.parse(readFileSync("dist/server/wrangler.json", "utf8")));
  // The guarded sender is bundled into the Worker, never Cloudflare's unguarded one alone.
  const bundled = readdirSync("dist/server", { recursive: true }).filter(file => /\.m?js$/.test(file))
    .some(file => readFileSync(join("dist/server", file), "utf8").includes("MARKETING_BLOCKED: "));
  assert.ok(bundled, "Registry build must bundle the store's guarded Cloudflare sender");
  console.log("Registry build artifact: LOADER, shipping catalog, proof mode off, EMAIL binding, sender address and guarded sender verified; no deployment performed.");
}
