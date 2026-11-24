import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// A DinkusKit Coupons checkout a developer built, mounted through EmDash's `sandboxed: [...]` the way a store that
// installed Coupons runs it (template-checkout-coupon-box-20261124). Only where DINKUS_PAIRED_COUPONS_DIR names it:
// local dev and every store build mount none, because a store's owner installs Coupons from the Registry.

const projectRoot = resolve(import.meta.dirname, "../..");
export const PAIRED_COUPONS_DIR_ENV = "DINKUS_PAIRED_COUPONS_DIR";
/** Outside the Registry the plugin runs under its own id; the store finds a Registry install by its slug. */
export const COUPONS_PLUGIN_ID = "dinkus-coupons";
const BUILD_FILES = ["dist/plugin.mjs", "dist/index.mjs"];

export function resolvePairedCouponsDir(env = process.env, root = projectRoot) {
  const named = env[PAIRED_COUPONS_DIR_ENV]?.trim();
  if (!named) return null;
  const dir = resolve(root, named);
  if (!BUILD_FILES.every((file) => existsSync(resolve(dir, file)))) {
    throw new Error(`${PAIRED_COUPONS_DIR_ENV}=${named} has no built Coupons bundle (${BUILD_FILES.join(", ")}); run npm run build in that Coupons checkout.`);
  }
  return dir;
}

export async function pairedCouponsDescriptor(dir) {
  const descriptor = (await import(pathToFileURL(resolve(dir, "dist/index.mjs")).href)).default;
  return { ...descriptor, id: COUPONS_PLUGIN_ID, entrypoint: resolve(dir, "dist/plugin.mjs") };
}
