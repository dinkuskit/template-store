#!/usr/bin/env node
// Splits the browser tests into the CI shards that run side by side. Each shard
// runs its spec files at every size (desktop, phone and the shipping store), on
// its own runner with its own disposable stores.
//
// Shards 1 to 3 name their spec files; every other spec file, including one
// added later, runs in the last shard, so a split run can never skip a file.
// A shard that names a spec file that no longer exists, or a file named twice,
// fails every shard.
//
// Balanced by the per-file times (desktop plus phone) of main run 45028987401
// (22 Nov 2026): about 190 seconds of tests each.
//
//   node scripts/e2e-shards.mjs <shard>   one Playwright file filter per line
//   node scripts/e2e-shards.mjs --check   the plan only
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const NAMED = [
  [
    "commerce-catalog",
    "structured-data-policy-feed",
    "home-opener-section",
    "cms-pages-and-redirects",
  ],
  [
    "admin-product-categories",
    "shipping-storefront-profile",
    "merch-catalog",
    "managed-product-availability",
    "store-footer-contrast",
    "order-lookup",
  ],
  [
    "upstream-blocks",
    "unmanaged-product-sellability",
    "store-header-nav",
    "product-pages",
  ],
];
const SHARDS = NAMED.length + 1;

const testDir = resolve(import.meta.dirname, "..", "tests", "e2e");
const specs = readdirSync(testDir)
  .filter((name) => name.endsWith(".spec.ts"))
  .map((name) => name.slice(0, -".spec.ts".length))
  .sort();

const claimed = new Map();
NAMED.forEach((files, index) => {
  for (const file of files) {
    if (!specs.includes(file)) throw new Error(`shard ${index + 1} names ${file}.spec.ts, which tests/e2e no longer has`);
    if (claimed.has(file)) throw new Error(`${file}.spec.ts is named by shards ${claimed.get(file)} and ${index + 1}`);
    claimed.set(file, index + 1);
  }
});

function plan(shard) {
  return specs.filter((file) => (claimed.get(file) ?? SHARDS) === shard);
}

const arg = process.argv[2];
if (arg === "--check") {
  for (let shard = 1; shard <= SHARDS; shard += 1) console.log(`${shard}/${SHARDS}: ${plan(shard).join(", ")}`);
  process.exit(0);
}
const shard = Number(arg);
if (!/^[1-9][0-9]*$/u.test(arg ?? "") || shard > SHARDS) {
  console.error(`usage: node scripts/e2e-shards.mjs <1-${SHARDS}> | --check`);
  process.exit(2);
}
// Playwright reads each argument as a regular expression over the spec path, so
// anchor it: one name must not also select a longer name that starts with it.
for (const file of plan(shard)) console.log(`tests/e2e/${file}\\.spec\\.ts$`);
