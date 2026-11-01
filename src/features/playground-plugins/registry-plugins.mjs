import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commerceProfile } from "../commerce-profile/profiles.mjs";

/**
 * Commerce, Payments and Ship as the playground installs them: their Registry bundles, run inside the
 * visitor's own store (GrillTrack playground-plugins-in-store-20261023). Payments and Ship are packed from
 * their release tags; Commerce is the store's pinned Registry build (template-one-build-registry-20261031),
 * all prepared by scripts/prepare-playground-plugins.mjs.
 */
export const PLAYGROUND_REGISTRY_PLUGINS = ["commerce", "payments", "ship"];
/**
 * The Commerce package the store pins: Vite defines it for the Worker, the config reads the environment the
 * playground config sets from the pin, as the store's own config does.
 */
const COMMERCE_PACKAGE = typeof __DINKUS_COMMERCE_PROFILE__ === "undefined"
  ? (globalThis.process?.env?.DINKUS_COMMERCE_PROFILE ?? "stable")
  : __DINKUS_COMMERCE_PROFILE__;
/** The ID a store gives each plugin when it installs it from the Registry; Connect builds its return links from it. */
export const PLAYGROUND_INSTALLED_PLUGIN_IDS = {
  commerce: commerceProfile(COMMERCE_PACKAGE).runtimeId,
  payments: "r_3brsc2on3bu673rn",
  ship: "r_ehdlg5cxkb3ffqvr",
};

/** A prepared plugin's Registry manifest (config time only). */
export function playgroundPluginManifest(name) {
  const packed = new URL(`../../../.artifacts/playground-plugins/${name}/package/`, import.meta.url);
  try {
    return JSON.parse(readFileSync(new URL("manifest.json", packed), "utf8"));
  } catch {
    throw new Error(`The ${name} Registry bundle is missing; run pnpm prepare:sources first.`);
  }
}

export function playgroundRegistryPlugins() {
  return PLAYGROUND_REGISTRY_PLUGINS.map((name) => {
    const packed = new URL(`../../../.artifacts/playground-plugins/${name}/package/`, import.meta.url);
    const manifest = playgroundPluginManifest(name);
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
      editorPanels: manifest.admin?.editorPanels ?? [],
      settingsSchema: manifest.admin?.settingsSchema,
    };
  });
}

/** The page in each plugin that its Connect returns to. */
const PLUGIN_HOME = { commerce: "settings", payments: "status", ship: "shipping" };
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
