import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The DinkusKit Reviews the browser tests' proof store runs (template-product-rating-20261122): the Registry
// (sandboxed) build of the commit package.json pins, mounted through EmDash's `sandboxed: [...]` under
// Reviews' Registry id, the way a store that installed Reviews runs it. Only the proof store mounts it. Local
// dev, the playground and every store build mount none: a store's owner installs Reviews from the Registry.

const projectRoot = resolve(import.meta.dirname, "../..");

export const PAIRED_REVIEWS_DIR_ENV = "DINKUS_PAIRED_REVIEWS_DIR";
/** DinkusKit Reviews' Registry id, derived by EmDash from its publisher and the slug `dinkus-reviews`. */
export const REVIEWS_REGISTRY_RUNTIME_ID = "r_t7rmn7qidmbmuyge";
/** The files a built Reviews bundle has: the plugin workerd runs and the descriptor `sandboxed: [...]` takes. */
export const REVIEWS_BUILD_FILES = Object.freeze(["dist/plugin.mjs", "dist/index.mjs"]);

/** The exact Reviews commit the proof store pairs with, from package.json. */
export function pairedReviewsPin(root = projectRoot) {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const pin = manifest.dinkuskit?.sourcePins?.reviews;
  if (pin?.repository !== "https://github.com/dinkuskit/reviews.git" || !/^[0-9a-f]{40}$/u.test(pin.commit ?? "")) {
    throw new Error("package.json dinkuskit.sourcePins.reviews must name the public repository and a full commit.");
  }
  return { repository: pin.repository, commit: pin.commit };
}

/** Where the pin's build lives, one directory per commit, under ignored .artifacts. */
export function pairedReviewsDefaultDir(pin, root = projectRoot) {
  return resolve(root, ".artifacts/paired-reviews", pin.commit);
}

export function hasReviewsBuild(dir) {
  return REVIEWS_BUILD_FILES.every((file) => existsSync(resolve(dir, file)));
}

/**
 * The built Reviews the proof store mounts, or null when none is prepared. DINKUS_PAIRED_REVIEWS_DIR names a
 * checkout a developer built; set empty, it means none even when the pin's build exists.
 */
export function resolvePairedReviewsDir(env = process.env, root = projectRoot) {
  const explicit = env[PAIRED_REVIEWS_DIR_ENV];
  if (explicit !== undefined) {
    if (explicit.trim() === "") return null;
    const dir = resolve(root, explicit.trim());
    if (!hasReviewsBuild(dir)) {
      throw new Error(`${PAIRED_REVIEWS_DIR_ENV}=${explicit} has no built Reviews bundle (${REVIEWS_BUILD_FILES.join(", ")}); run npm run build in that Reviews checkout.`);
    }
    return dir;
  }
  const dir = pairedReviewsDefaultDir(pairedReviewsPin(root), root);
  return hasReviewsBuild(dir) ? dir : null;
}

function head(dir) {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : null;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
}

/**
 * The pin's build, fetched and built when missing (git fetch of the exact commit, npm ci without scripts,
 * npm run build). A developer's own DINKUS_PAIRED_REVIEWS_DIR is used as built, never rebuilt here.
 */
export function ensurePairedReviewsBuild({ env = process.env, root = projectRoot, log = console.log } = {}) {
  if (env[PAIRED_REVIEWS_DIR_ENV] !== undefined) {
    const dir = resolvePairedReviewsDir(env, root);
    log(dir ? `paired reviews: ${dir} (${PAIRED_REVIEWS_DIR_ENV})` : `paired reviews: none (${PAIRED_REVIEWS_DIR_ENV} is empty)`);
    return dir;
  }
  const pin = pairedReviewsPin(root);
  const dir = pairedReviewsDefaultDir(pin, root);
  if (hasReviewsBuild(dir) && head(dir) === pin.commit) {
    log(`paired reviews: ${pin.commit.slice(0, 12)} built`);
    return dir;
  }
  if (!dir.startsWith(`${resolve(root, ".artifacts")}/`)) throw new Error("Refusing to build Reviews outside .artifacts.");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  run("git", ["init", "--quiet", dir], root);
  run("git", ["remote", "add", "origin", pin.repository], dir);
  run("git", ["fetch", "--quiet", "--depth", "1", "origin", pin.commit], dir);
  run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], dir);
  if (head(dir) !== pin.commit) throw new Error(`Fetched Reviews did not resolve to ${pin.commit}`);
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
  run("npm", ["run", "build"], dir);
  if (!hasReviewsBuild(dir)) throw new Error(`Reviews ${pin.commit} built no bundle under ${dir}`);
  log(`paired reviews: ${pin.commit.slice(0, 12)} built`);
  return dir;
}

/** The plugin EmDash's `sandboxed: [...]` takes: the built descriptor under Reviews' Registry id. */
export async function pairedReviewsDescriptor(dir) {
  const descriptor = (await import(pathToFileURL(resolve(dir, "dist/index.mjs")).href)).default;
  return { ...descriptor, id: REVIEWS_REGISTRY_RUNTIME_ID, entrypoint: resolve(dir, "dist/plugin.mjs") };
}
