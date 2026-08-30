import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const featureMap = readFileSync(resolve(root, "FEATURE_MAP.md"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const expectedPins = {
  "@dinkuskit/blocks":
    "github:dinkuskit/blocks#82a31183cc06ae0fc5b4829f5a8875753ecde10a",
  "@dinkuskit/inventory":
    "github:dinkuskit/inventory#d735b180b3f4ed911667586f5131ff1727e46546",
};
const expectedCommerceCommit =
  "530348c07769a010b0fa4ef24604292a4254eda0";

const failures = [];
for (const feature of [
  "dinkus.store-shell",
  "dinkus.managed-product-availability",
]) {
  if (!featureMap.includes(`\`${feature}\``)) {
    failures.push(`FEATURE_MAP.md is missing ${feature}`);
  }
}
if (
  manifest.dinkuskit?.sourcePins?.commerce?.repository !==
    "https://github.com/dinkuskit/commerce.git" ||
  manifest.dinkuskit?.sourcePins?.commerce?.commit !==
    expectedCommerceCommit
) {
  failures.push("Commerce source preparation must retain its exact repository and commit");
}

const managedProductRuntime = readFileSync(
  resolve(root, "src/features/managed-product-availability/runtime.ts"),
  "utf8",
);
for (const officialAction of [
  "createStoreInventoryConfiguration",
  "configureCatalogItemInventory",
]) {
  if (!managedProductRuntime.includes(officialAction)) {
    failures.push(`managed-product runtime must use ${officialAction}`);
  }
}
if (managedProductRuntime.includes("startManagedSkuRegistration")) {
  failures.push(
    "managed-product runtime must not bypass Configure Inventory with startManagedSkuRegistration",
  );
}
for (const path of [
  "src/features/store-shell/index.ts",
  "src/features/managed-product-availability/index.ts",
  "bin/verify-web",
  "scripts/check-worktree-text.mjs",
  "skills/managed-product-verification/SKILL.md",
]) {
  try {
    statSync(resolve(root, path));
  } catch {
    failures.push(`required path is missing: ${path}`);
  }
}
for (const [name, expected] of Object.entries(expectedPins)) {
  if (manifest.dependencies?.[name] !== expected) {
    failures.push(`${name} must remain pinned to ${expected}`);
  }
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(?:astro|mjs|ts)$/u.test(entry.name)
        ? [path]
        : [];
  });
}

for (const path of sourceFiles(resolve(root, "src"))) {
  const source = readFileSync(path, "utf8");
  if (/from\s+["']@dinkuskit\/(?:blocks|commerce|inventory)\/src\//u.test(source)) {
    failures.push(`${path} imports a Dinkus package internal`);
  }
  if (/\bany\b/u.test(source)) {
    failures.push(`${path} contains an explicit any`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`feature audit: ${failure}`);
  process.exit(1);
}

console.log("feature audit: ok");
