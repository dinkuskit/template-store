// The demo Worker this builds (dinkuskit-template-demo, demo.dinkuskit.com) was retired on 18 Oct 2026
// (hosted-demo-retired-20261031): this script, wrangler.jsonc and pnpm build go in a follow-up PR.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensurePairedCommerceBuild, PAIRED_COMMERCE_DIR_ENV } from "./lib/paired-commerce.mjs";

const root = resolve(import.meta.dirname, "..");
const wranglerConfigPath = resolve(root, "wrangler.jsonc");

function parseJsonc(text) {
  return JSON.parse(
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1"),
  );
}

export function readDemoCatalogProfile(configPath = wranglerConfigPath) {
  const config = parseJsonc(readFileSync(configPath, "utf8"));
  const profile = config.vars?.DINKUS_CATALOG_PROFILE;
  if (typeof profile !== "string" || profile.length === 0) {
    throw new Error("wrangler.jsonc must define vars.DINKUS_CATALOG_PROFILE.");
  }
  if (profile === "native-development") {
    throw new Error("DINKUS_CATALOG_PROFILE=native-development is retired: the demo runs Commerce's Registry build (template-one-build-registry-20261031).");
  }
  return profile;
}

/** The demo Worker (the committed wrangler.jsonc) bundles the paired Commerce Registry build; a store's own
 * Registry config installs Commerce from the Registry instead and gets none. */
export function demoBundlesPairedCommerce(env, configPath = wranglerConfigPath) {
  return isCloudflareBuild(env) && resolve(root, configPath) === wranglerConfigPath;
}

/** The Commerce profile a Cloudflare demo build bakes in, from the Wrangler vars, when they name one. */
export function readDemoCommerceProfile(configPath = wranglerConfigPath) {
  const config = parseJsonc(readFileSync(configPath, "utf8"));
  const profile = config.vars?.DINKUS_COMMERCE_PROFILE;
  return typeof profile === "string" && profile.length > 0 ? profile : undefined;
}

export function isCloudflareBuild(env) {
  return env.DINKUS_HOSTING_PROFILE === "cloudflare" ||
    env.ASTRO_ADAPTER === "cloudflare";
}

if (import.meta.main) {
  const configPath = process.env.DINKUS_WRANGLER_CONFIG
    ? resolve(root, process.env.DINKUS_WRANGLER_CONFIG)
    : wranglerConfigPath;
  const commerceProfile = isCloudflareBuild(process.env) ? readDemoCommerceProfile(configPath) : undefined;
  const env = {
    ...process.env,
    ...(isCloudflareBuild(process.env)
      ? { DINKUS_CATALOG_PROFILE: readDemoCatalogProfile(configPath) }
      : {}),
    ...(commerceProfile ? { DINKUS_COMMERCE_PROFILE: commerceProfile } : {}),
  };
  // The demo Worker mounts the pinned Commerce's Registry build under LOADER, as a Registry store installs it.
  if (demoBundlesPairedCommerce(process.env, configPath)) {
    const dir = ensurePairedCommerceBuild({ env: process.env });
    if (!dir) throw new Error(`The demo build needs the paired Commerce Registry build; do not set ${PAIRED_COMMERCE_DIR_ENV} empty.`);
    env[PAIRED_COMMERCE_DIR_ENV] = dir;
  }
  const build = spawnSync("pnpm", ["exec", "astro", "build"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (build.error) throw build.error;
  process.exit(build.status ?? 1);
}
