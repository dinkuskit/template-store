#!/usr/bin/env node
// Builds src/features/product-category/taxonomy.json from one pinned release of
// Shopify's Standard Product Taxonomy (template-product-category-list-20261124).
//
//   node scripts/build-product-taxonomy.mjs <categories.txt> <all_mappings.json>
//
// Both files come from the release tag named in VERSION below, for example
// https://raw.githubusercontent.com/Shopify/product-taxonomy/v2026-11/dist/en/categories.txt
// https://raw.githubusercontent.com/Shopify/product-taxonomy/v2026-11/dist/en/integrations/all_mappings.json
// Moving to a newer release is a named upgrade step, never a silent refresh.
//
// The table keeps each category's own name (a full name is its ancestors' names
// joined with " > ", since an id's parent is the id without its last part) and
// the Google product category id only where it differs from the parent's
// (ids are visited parents first, so each comparison sees the parent's result).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION = "2026-11";
const SOURCE = `https://github.com/Shopify/product-taxonomy/tree/v${VERSION}`;
const ID = /^[a-z]{2}(-\d{1,4}){0,10}$/;

const [categoriesPath, mappingsPath] = process.argv.slice(2);
if (!categoriesPath || !mappingsPath) {
  console.error("usage: build-product-taxonomy.mjs <categories.txt> <all_mappings.json>");
  process.exit(2);
}

const bare = (gid) => gid.trim().replace(/^gid:\/\/shopify\/TaxonomyCategory\//, "");
const parent = (id) => (id.includes("-") ? id.slice(0, id.lastIndexOf("-")) : null);

const names = {};
for (const line of readFileSync(categoriesPath, "utf8").split("\n")) {
  if (!line.startsWith("gid://")) continue;
  const at = line.indexOf(" : ");
  const id = bare(line.slice(0, at));
  const path = line.slice(at + 3).trim().split(" > ");
  if (!ID.test(id) || !path.at(-1)) throw new Error(`unexpected category line: ${line}`);
  if (parent(id) && !(parent(id) in names)) throw new Error(`parent listed after child: ${id}`);
  names[id] = path.at(-1);
}

const mappings = JSON.parse(readFileSync(mappingsPath, "utf8")).mappings;
const toGoogle = mappings.filter((m) => m.input_taxonomy.startsWith(`shopify/${VERSION}`)
  && m.output_taxonomy.startsWith("google/"));
if (toGoogle.length !== 1) throw new Error(`expected one shopify/${VERSION} to Google mapping, found ${toGoogle.length}`);
const googleVersion = toGoogle[0].output_taxonomy.replace(/^google\//, "");
const mapped = new Map();
for (const rule of toGoogle[0].rules) {
  const id = bare(rule.input.category.id);
  const out = rule.output.category?.[0]?.id;
  if (id in names && /^\d+$/.test(out ?? "")) mapped.set(id, out);
}

// What a lookup that walks up from the id would find for it at its parent.
const inherited = (id) => {
  for (let at = parent(id); at; at = parent(at)) if (at in google) return google[at];
  return undefined;
};
const google = {};
for (const id of Object.keys(names)) {
  // Shopify maps nothing for a few categories (Bundles, Cannabis Products):
  // "" keeps such a category from borrowing its parent's Google id.
  const own = mapped.get(id) ?? "";
  if (own !== (inherited(id) ?? "")) google[id] = own;
}

const table = {
  taxonomy: "shopify",
  version: VERSION,
  google_version: googleVersion,
  source: SOURCE,
  license: "MIT, Copyright (c) Shopify",
  names,
  google,
};
const output = fileURLToPath(new URL("../src/features/product-category/taxonomy.json", import.meta.url));
writeFileSync(output, JSON.stringify(table) + "\n");
console.log(`${Object.keys(names).length} categories, ${mapped.size} Google mappings (${Object.keys(google).length} kept), wrote ${output}`);
