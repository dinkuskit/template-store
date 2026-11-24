import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// A DinkusKit Tax checkout a developer built, mounted through EmDash's `sandboxed: [...]` the way a store that
// installed Tax runs it (dinkuskit/tax ledger shared-addons-door). Only where DINKUS_PAIRED_TAX_DIR names it:
// local dev and every store build mount none, because a store's owner installs Tax from the Registry.

const projectRoot = resolve(import.meta.dirname, "../..");
export const PAIRED_TAX_DIR_ENV = "DINKUS_PAIRED_TAX_DIR";
/** Outside the Registry the plugin runs under its own id; the store finds a Registry install by its slug. */
export const TAX_PLUGIN_ID = "dinkus-tax";
const BUILD_FILES = ["dist/plugin.mjs", "dist/index.mjs"];

export function resolvePairedTaxDir(env = process.env, root = projectRoot) {
  const named = env[PAIRED_TAX_DIR_ENV]?.trim();
  if (!named) return null;
  const dir = resolve(root, named);
  if (!BUILD_FILES.every((file) => existsSync(resolve(dir, file)))) {
    throw new Error(`${PAIRED_TAX_DIR_ENV}=${named} has no built Tax bundle (${BUILD_FILES.join(", ")}); run npm run build in that Tax checkout.`);
  }
  return dir;
}

export async function pairedTaxDescriptor(dir) {
  const descriptor = (await import(pathToFileURL(resolve(dir, "dist/index.mjs")).href)).default;
  return { ...descriptor, id: TAX_PLUGIN_ID, entrypoint: resolve(dir, "dist/plugin.mjs") };
}
