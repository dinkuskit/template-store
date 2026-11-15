// Proves the store's publish check (src/features/product-on-sale) against a real Commerce Registry build:
// the pinned Commerce (package.json dinkuskit.sourcePins.commerce), fetched and built once per commit by
// scripts/lib/paired-commerce.mjs as every store this template runs now mounts it, checked here against the
// recorded release digests, then this store started on a fresh database with that bundle installed under
// the pin's Registry runtime id, running tests/paired. DINKUS_PAIRED_COMMERCE_DIR uses an already-built
// Commerce checkout, which must hold the same commit and files.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ensurePairedCommerceBuild, pairedCommerceHead, pairedCommercePin, pairedCommerceProfile } from "./lib/paired-commerce.mjs";
import { commerceProfile } from "../src/features/commerce-profile/profiles.mjs";

// The Commerce that holds each page's product (dinkuskit/commerce#208, template-no-commerce-box-20261029):
// the first beta carrying it, 0.7.0-beta.3, here the 0.9.0-beta.1 beta on EmDash 1.4.0, where every product is made
// for its page (dinkuskit/commerce#241), variant options use the `option` op (#244) and the cart is held by
// Commerce (#272). The pin itself lives in
// package.json; this records the exact bytes its build must reproduce.
const COMMERCE = Object.freeze({
  tag: "v0.9.0-beta.1",
  // Whether this Commerce saves the page title sent as `name` (dinkuskit/commerce#188); 0.6.0 ignores it.
  names: true,
  files: {
    "dist/sandbox/plugin.mjs": "01742a27ee8513a0c2cfba142a88fb58cdd7661d3d6cc3d5e6299f1c6f855861",
    "dist/sandbox/index.mjs": "2dd3254e6b944853c42963f23f81c0f98c96142b57a9012a1b436429d018d30a",
  },
});

const root = resolve(import.meta.dirname, "..");
const pin = pairedCommercePin(root);
if (pin.tag !== COMMERCE.tag) throw new Error(`package.json pins Commerce ${pin.tag}; this proof records ${COMMERCE.tag}. Record the new release's build digests here.`);
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
};
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
/** The checkout's commit and built files are exactly the release's, or why not. */
function mismatch(dir) {
  if (pairedCommerceHead(dir) !== pin.commit) return `Commerce checkout ${dir} is not at ${pin.commit}`;
  for (const [file, digest] of Object.entries(COMMERCE.files)) {
    const path = resolve(dir, file);
    if (!existsSync(path)) return `${path} is missing`;
    if (sha256(path) !== digest) return `${path} does not match the recorded ${COMMERCE.tag} build`;
  }
  return null;
}

const commerceDir = ensurePairedCommerceBuild({ root });
if (!commerceDir) throw new Error("The paired proof needs a Commerce build; do not set DINKUS_PAIRED_COMMERCE_DIR empty.");
const wrong = mismatch(commerceDir);
if (wrong) throw new Error(wrong);
console.log(`paired proof: Commerce ${COMMERCE.tag} ${pin.commit.slice(0, 12)}, plugin.mjs ${COMMERCE.files["dist/sandbox/plugin.mjs"].slice(0, 12)} verified`);

const artifactDir = resolve(root, ".artifacts/paired");
const evidence = resolve(root, "test-results/paired-product-on-sale");
rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(resolve(artifactDir, "uploads"), { recursive: true });
mkdirSync(evidence, { recursive: true });
const port = process.env.DINKUS_PAIRED_PORT ?? "4651";
run("pnpm", ["exec", "playwright", "test", "-c", "tests/paired/playwright.config.ts"], root, {
  ...process.env,
  DINKUS_PAIRED_COMMERCE_DIR: commerceDir,
  // The pin's package decides the runtime id the store mounts the build under: a release is the stable
  // package, a pre-release the beta one; the spec reads Commerce's storage under the same id.
  DINKUS_COMMERCE_PROFILE: pairedCommerceProfile(pin),
  DINKUS_PAIRED_RUNTIME_ID: commerceProfile(pairedCommerceProfile(pin)).runtimeId,
  DINKUS_PAIRED_DB: resolve(artifactDir, "content.db"),
  DINKUS_PAIRED_ARTIFACTS: evidence,
  DINKUS_PAIRED_PORT: port,
  DINKUS_PAIRED_COMMERCE_NAMES: COMMERCE.names ? "1" : "0",
  DINKUS_TEMPLATE_DB_URL: "file:./.artifacts/paired/content.db",
  DINKUS_TEMPLATE_UPLOADS_DIR: "./.artifacts/paired/uploads",
  EMDASH_SITE_URL: `http://127.0.0.1:${port}`,
});
