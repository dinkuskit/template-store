// Only the explicit Registry build may select external authentication.
export const registryConfigPath = "runs/registry/wrangler.jsonc";

export function registryAccessOptions(env) {
  const enabled = env.DINKUS_REGISTRY_ACCESS_ENABLED ?? "0";
  if (enabled !== "0" && enabled !== "1") {
    throw new Error("Invalid DINKUS_REGISTRY_ACCESS_ENABLED");
  }
  if (enabled === "0") return undefined;
  const teamDomain = env.DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN?.trim();
  if (!teamDomain || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(teamDomain)) {
    throw new Error("Missing or invalid DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN");
  }
  return {
    teamDomain,
    audienceEnvVar: "CF_ACCESS_AUDIENCE",
    autoProvision: true,
    // EmDash makes the first user Admin. Later identities have no admin role.
    defaultRole: 10,
    syncRoles: false,
    syncName: false,
  };
}

export function selectedRegistryAccessOptions(env) {
  const cloudflare = env.DINKUS_HOSTING_PROFILE === "cloudflare" || env.ASTRO_ADAPTER === "cloudflare";
  if (!cloudflare || env.DINKUS_WRANGLER_CONFIG !== registryConfigPath) return undefined;
  return registryAccessOptions(env);
}
