import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Payments and Ship as the playground installs them: the Registry bundles that
 * scripts/prepare-playground-plugins.mjs packed from each release tag, run in
 * the sandbox as Registry plugins do on a real store.
 */
export const PLAYGROUND_REGISTRY_PLUGINS = ["payments", "ship"];

export function playgroundRegistryPlugins() {
  return PLAYGROUND_REGISTRY_PLUGINS.map((name) => {
    const packed = new URL(`../../../.artifacts/playground-plugins/${name}/package/`, import.meta.url);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(new URL("manifest.json", packed), "utf8"));
    } catch {
      throw new Error(`The ${name} Registry bundle is missing; run pnpm prepare:sources first.`);
    }
    return {
      id: manifest.id,
      version: manifest.version,
      format: "standard",
      entrypoint: fileURLToPath(new URL("backend.js", packed)),
      capabilities: manifest.capabilities,
      allowedHosts: manifest.allowedHosts,
      storage: manifest.storage,
      routes: manifest.routes,
      hooks: manifest.hooks,
      adminPages: manifest.admin?.pages ?? [],
      adminWidgets: manifest.admin?.widgets ?? [],
      settingsSchema: manifest.admin?.settingsSchema,
    };
  });
}
