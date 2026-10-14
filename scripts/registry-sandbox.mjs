import { fileURLToPath } from "node:url";
import { registryConfigPath } from "./registry-access.mjs";

export function selectedRegistrySandboxRunner(env) {
  const cloudflare = env.DINKUS_HOSTING_PROFILE === "cloudflare" || env.ASTRO_ADAPTER === "cloudflare";
  if (!cloudflare || env.DINKUS_WRANGLER_CONFIG !== registryConfigPath) return undefined;
  return fileURLToPath(new URL("../src/features/registry-sandbox/runner.ts", import.meta.url));
}
