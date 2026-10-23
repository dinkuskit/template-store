import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Payments and Ship as the playground installs them: the Registry bundles that
 * scripts/prepare-playground-plugins.mjs packed from each release tag, run inside
 * the visitor's own store (GrillTrack playground-plugins-in-store-20261023).
 */
export const PLAYGROUND_REGISTRY_PLUGINS = ["payments", "ship"];
/** The ID a store gives each plugin when it installs it from the Registry; Connect builds its return links from it. */
export const PLAYGROUND_INSTALLED_PLUGIN_IDS = { payments: "r_3brsc2on3bu673rn", ship: "r_ehdlg5cxkb3ffqvr" };

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
      id: PLAYGROUND_INSTALLED_PLUGIN_IDS[name],
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

/** The page in each plugin that its Connect returns to. */
const PLUGIN_HOME = { payments: "status", ship: "shipping" };
/** The playground's page about Connect: in a real store these links open DinkusKit.com or Ship. */
export const PLAYGROUND_CONNECT_PAGE = "/connect-to-dinkuskit";

/**
 * For an admin API call to Payments or Ship, a rewrite of the answer that
 * points its DinkusKit.com and Ship links at the playground's Connect page,
 * since the playground is not connected to either. Null for every other path.
 */
export function retargetPlaygroundPluginLinks(pathname, origin) {
  const name = PLAYGROUND_REGISTRY_PLUGINS.find((candidate) =>
    pathname.startsWith(`/_emdash/api/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS[candidate]}/`));
  if (!name) return null;
  const back = encodeURIComponent(`/_emdash/admin/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS[name]}/${PLUGIN_HOME[name]}`);
  const page = `${origin}${PLAYGROUND_CONNECT_PAGE}`;
  return (body) => body
    .replaceAll("https://dinkuskit.com/account/connect?connection_id=", `${page}?back=${back}&connection_id=`)
    .replace(/https:\/\/ship\.dinkuskit\.com\/stores\/[^"\\]*/g, `${page}?back=${back}&from=ship`);
}
