import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

export function readDemoCatalogProfile() {
  const config = parseJsonc(readFileSync(wranglerConfigPath, "utf8"));
  const profile = config.vars?.DINKUS_CATALOG_PROFILE;
  if (typeof profile !== "string" || profile.length === 0) {
    throw new Error("wrangler.jsonc must define vars.DINKUS_CATALOG_PROFILE.");
  }
  return profile;
}

export function isCloudflareBuild(env) {
  return env.DINKUS_HOSTING_PROFILE === "cloudflare" ||
    env.ASTRO_ADAPTER === "cloudflare";
}

if (import.meta.main) {
  const env = {
    ...process.env,
    ...(isCloudflareBuild(process.env)
      ? { DINKUS_CATALOG_PROFILE: readDemoCatalogProfile() }
      : {}),
  };
  const build = spawnSync("pnpm", ["exec", "astro", "build"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (build.error) throw build.error;
  process.exit(build.status ?? 1);
}
