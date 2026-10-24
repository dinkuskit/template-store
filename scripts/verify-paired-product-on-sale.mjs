// Proves the store's publish check (src/features/product-on-sale) against a real Commerce Registry build:
// fetches Commerce at DINKUS_PAIRED_COMMERCE_TAG (default v0.6.0-beta.1), builds its sandbox bundle, starts
// this store on a fresh database with that bundle installed under the beta runtime id, and runs
// tests/paired. DINKUS_PAIRED_COMMERCE_DIR skips the fetch and uses an already-built Commerce checkout.
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tag = process.env.DINKUS_PAIRED_COMMERCE_TAG ?? "v0.6.0-beta.1";
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
};

let commerceDir = process.env.DINKUS_PAIRED_COMMERCE_DIR;
if (!commerceDir) {
  commerceDir = resolve(root, ".artifacts/paired-commerce", tag);
  if (!existsSync(resolve(commerceDir, "dist/sandbox/plugin.mjs"))) {
    rmSync(commerceDir, { recursive: true, force: true });
    mkdirSync(commerceDir, { recursive: true });
    run("git", ["clone", "--depth", "1", "--branch", tag, "https://github.com/dinkuskit/commerce.git", commerceDir], root);
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], commerceDir);
    run("npm", ["run", "build"], commerceDir);
  }
}

const artifactDir = resolve(root, ".artifacts/paired");
const evidence = resolve(root, "test-results/paired-product-on-sale");
rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(resolve(artifactDir, "uploads"), { recursive: true });
mkdirSync(evidence, { recursive: true });
const port = process.env.DINKUS_PAIRED_PORT ?? "4651";
run("pnpm", ["exec", "playwright", "test", "-c", "tests/paired/playwright.config.ts"], root, {
  ...process.env,
  DINKUS_PAIRED_COMMERCE_DIR: resolve(commerceDir),
  DINKUS_COMMERCE_PROFILE: "beta",
  DINKUS_PAIRED_DB: resolve(artifactDir, "content.db"),
  DINKUS_PAIRED_ARTIFACTS: evidence,
  DINKUS_PAIRED_PORT: port,
  DINKUS_TEMPLATE_DB_URL: "file:./.artifacts/paired/content.db",
  DINKUS_TEMPLATE_UPLOADS_DIR: "./.artifacts/paired/uploads",
  EMDASH_SITE_URL: `http://127.0.0.1:${port}`,
});
