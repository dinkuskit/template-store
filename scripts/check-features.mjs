import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const featureMap = readFileSync(resolve(root, "FEATURE_MAP.md"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const expectedPins = {
  "@dinkuskit/blocks":
    "github:dinkuskit/blocks#fe03bfac91798ac0b411b952fe23c26afefbf570",
  "@dinkuskit/inventory":
    "github:dinkuskit/inventory#5889c7d59398376da51ac400d5c1f1214aba2c6b",
};
const expectedCommerceCommit =
  "81a6f571b5ad3dcc73ba6af9a89bdb438c6a8e06";

const failures = [];
for (const feature of [
  "dinkus.store-shell",
  "dinkus.managed-product-availability",
  "dinkus.unmanaged-product-sellability",
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
const unmanagedProductRuntime = readFileSync(
  resolve(root, "src/features/unmanaged-product-sellability/runtime.ts"),
  "utf8",
);
for (const officialAction of [
  "resolveStorefrontAvailability",
  "setCatalogItemManualAvailability",
  "setCatalogItemRegularPrice",
  "setCatalogItemSalePrice",
]) {
  if (!unmanagedProductRuntime.includes(officialAction)) {
    failures.push(`unmanaged-product runtime must use ${officialAction}`);
  }
}
if (!managedProductRuntime.includes("setCatalogItemRegularPrice")) {
  failures.push("managed-product runtime must set Regular through Commerce");
}
if (unmanagedProductRuntime.includes("@dinkuskit/inventory")) {
  failures.push("unmanaged-product runtime must not contact Inventory");
}
if (
  !featureMap.includes("How to reach") ||
  !featureMap.includes("[data-unmanaged-product]") ||
  !featureMap.includes("[data-stock-value]") ||
  !featureMap.includes("[data-regular-price]") ||
  !featureMap.includes("DINKUS-DEMO-UNPRICED")
) {
  failures.push(
    "FEATURE_MAP.md must include storefront driver rows for managed 8-5-8 and unmanaged manual availability",
  );
}
for (const path of [
  "src/features/store-shell/index.ts",
  "src/features/store-shell/price.ts",
  "docs/implementation/unpriced-public-home.md",
  "src/features/managed-product-availability/index.ts",
  "src/features/unmanaged-product-sellability/index.ts",
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
