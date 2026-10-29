// Proves the store's publish check (src/features/product-on-sale) against a real Commerce Registry build:
// fetches Commerce at the exact commit below, builds its sandbox bundle, checks the built files against the
// recorded digests, starts this store on a fresh database with that bundle installed under the beta runtime
// id, and runs tests/paired. DINKUS_PAIRED_COMMERCE_DIR uses an already-built Commerce checkout, which must
// hold the same commit and files.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// The Commerce that holds each page's product (dinkuskit/commerce#208, template-no-commerce-box-20261029),
// at that pull request's head until the beta carrying it is cut; this pin then moves to the beta's tag.
const COMMERCE = Object.freeze({
  tag: "commerce#208",
  // Whether this Commerce saves the page title sent as `name` (dinkuskit/commerce#188); 0.6.0 ignores it.
  names: true,
  commit: "11d24e49c0d5918222ea730f5387a92111ab6354",
  files: {
    "dist/sandbox/plugin.mjs": "0d8bb7709076e93f23ea8abb25db9beec8be7321a6ed417e8b26891a6cdc9c5f",
    "dist/sandbox/index.mjs": "fc9072aa4bc0d78949b45b8602e6be9b99ab3badd687d16a3257e2a73efb4a65",
  },
});

const root = resolve(import.meta.dirname, "..");
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
};
const headOf = (dir) => spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout?.trim();
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
/** The checkout's commit and built files are exactly the release's, or why not. */
function mismatch(dir) {
  if (headOf(dir) !== COMMERCE.commit) return `Commerce checkout ${dir} is not at ${COMMERCE.commit}`;
  for (const [file, digest] of Object.entries(COMMERCE.files)) {
    const path = resolve(dir, file);
    if (!existsSync(path)) return `${path} is missing`;
    if (sha256(path) !== digest) return `${path} does not match the recorded ${COMMERCE.tag} build`;
  }
  return null;
}

let commerceDir = process.env.DINKUS_PAIRED_COMMERCE_DIR && resolve(process.env.DINKUS_PAIRED_COMMERCE_DIR);
if (!commerceDir) {
  commerceDir = resolve(root, ".artifacts/paired-commerce", COMMERCE.commit);
  if (mismatch(commerceDir)) {
    rmSync(commerceDir, { recursive: true, force: true });
    mkdirSync(commerceDir, { recursive: true });
    run("git", ["init", "--quiet", commerceDir], root);
    run("git", ["remote", "add", "origin", "https://github.com/dinkuskit/commerce.git"], commerceDir);
    run("git", ["fetch", "--quiet", "--depth", "1", "origin", COMMERCE.commit], commerceDir);
    run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], commerceDir);
    if (headOf(commerceDir) !== COMMERCE.commit) throw new Error(`Fetched Commerce did not resolve to ${COMMERCE.commit}`);
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], commerceDir);
    run("npm", ["run", "build"], commerceDir);
  }
}
const wrong = mismatch(commerceDir);
if (wrong) throw new Error(wrong);
console.log(`paired proof: Commerce ${COMMERCE.tag} ${COMMERCE.commit.slice(0, 12)}, plugin.mjs ${COMMERCE.files["dist/sandbox/plugin.mjs"].slice(0, 12)} verified`);

const artifactDir = resolve(root, ".artifacts/paired");
const evidence = resolve(root, "test-results/paired-product-on-sale");
rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(resolve(artifactDir, "uploads"), { recursive: true });
mkdirSync(evidence, { recursive: true });
const port = process.env.DINKUS_PAIRED_PORT ?? "4651";
run("pnpm", ["exec", "playwright", "test", "-c", "tests/paired/playwright.config.ts"], root, {
  ...process.env,
  DINKUS_PAIRED_COMMERCE_DIR: commerceDir,
  DINKUS_COMMERCE_PROFILE: "beta",
  DINKUS_PAIRED_DB: resolve(artifactDir, "content.db"),
  DINKUS_PAIRED_ARTIFACTS: evidence,
  DINKUS_PAIRED_PORT: port,
  DINKUS_PAIRED_COMMERCE_NAMES: COMMERCE.names ? "1" : "0",
  DINKUS_TEMPLATE_DB_URL: "file:./.artifacts/paired/content.db",
  DINKUS_TEMPLATE_UPLOADS_DIR: "./.artifacts/paired/uploads",
  EMDASH_SITE_URL: `http://127.0.0.1:${port}`,
});
