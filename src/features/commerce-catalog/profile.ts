export function usesNativeCommerceCatalog(
  env: Pick<NodeJS.ProcessEnv, "ASTRO_ADAPTER" | "DINKUS_CATALOG_PROFILE" | "DINKUS_HOSTING_PROFILE">,
): boolean {
  return env.DINKUS_HOSTING_PROFILE === "cloudflare" ||
    env.ASTRO_ADAPTER === "cloudflare" ||
    env.DINKUS_CATALOG_PROFILE === "native-development";
}
