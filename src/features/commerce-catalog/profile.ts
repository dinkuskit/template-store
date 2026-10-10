export interface CommerceCatalogProfileEnv {
  ASTRO_ADAPTER?: string;
  DINKUS_CATALOG_PROFILE?: string;
  DINKUS_HOSTING_PROFILE?: string;
}

export function usesNativeCommerceCatalog(
  env: CommerceCatalogProfileEnv,
): boolean {
  return env.DINKUS_HOSTING_PROFILE === "cloudflare" ||
    env.ASTRO_ADAPTER === "cloudflare" ||
    env.DINKUS_CATALOG_PROFILE === "native-development";
}
